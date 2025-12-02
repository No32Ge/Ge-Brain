import { GoogleGenAI, Content, Part } from "@google/genai";
import { AppConfig, Message, ModelConfig, ToolCall } from "../types";

// --- Unified Types for Stream Consumption ---
export interface StreamChunk {
    textDelta?: string;
    toolCalls?: ToolCall[]; // Full snapshot of tool calls for this turn (simpler than deltas for UI)
}

// --- Tree Helper ---
export const getThread = (messageMap: Record<string, Message>, headId: string | null): Message[] => {
    if (!headId || !messageMap[headId]) return [];
    
    const thread: Message[] = [];
    let currentId: string | null = headId;
    
    while (currentId) {
        const msg = messageMap[currentId];
        if (!msg) break;
        thread.unshift(msg);
        currentId = msg.parentId;
    }
    
    return thread;
};

// --- Gemini Converters ---

export const buildSystemInstruction = (config: AppConfig): string => {
  const activeMemories = config.memories
    .filter(m => m.active)
    .map(m => `<Memory name="${m.name}">\n${m.content}\n</Memory>`)
    .join("\n\n");

  if (!activeMemories) return config.systemPrompt;

  return `${config.systemPrompt}\n\n=== VIRTUAL MEMORY CONTEXT ===\n${activeMemories}`;
};

export const convertHistoryToGemini = (messages: Message[]): Content[] => {
  return messages.map(msg => {
    let parts: Part[] = [];

    if (msg.role === 'model') {
       if (msg.content) parts.push({ text: msg.content });
       if (msg.toolCalls) {
           parts.push(...msg.toolCalls.map(tc => ({
               functionCall: {
                   name: tc.name,
                   args: tc.args
                   // Gemini SDK might not ingest ID in functionCall part for history in all versions, 
                   // but strictly for context it relies on sequence.
               }
           })));
       }
    } else if (msg.role === 'user') {
      parts = [{ text: msg.content || '' }];
    } else if (msg.role === 'tool' && msg.toolResults) {
      parts = msg.toolResults.map(tr => {
        let parsedResult;
        try {
            // Try to parse as JSON first (e.g. {"weather": "sunny"})
            parsedResult = JSON.parse(tr.result);
        } catch (e) {
            // Fallback for plain strings (e.g. "Sunny") or malformed JSON
            // We wrap it to ensure it's not treated as an error by the model
            parsedResult = tr.result;
        }

        return {
          functionResponse: {
            id: tr.callId,
            name: tr.callId, // Fallback/Alternative depending on SDK version
            response: { result: parsedResult }
          }
        };
      });
    }

    return {
      role: msg.role === 'tool' ? 'tool' : (msg.role === 'model' ? 'model' : 'user'),
      parts: parts
    };
  });
};

// --- OpenAI Converters ---

const convertHistoryToOpenAI = (messages: Message[], systemInstruction: string): any[] => {
    const openaiMsgs: any[] = [
        { role: 'system', content: systemInstruction }
    ];

    for (const m of messages) {
        if (m.role === 'user') {
            openaiMsgs.push({ role: 'user', content: m.content || '' });
        } else if (m.role === 'model') {
            const msg: any = { role: 'assistant' };
            if (m.content) msg.content = m.content;
            if (m.toolCalls && m.toolCalls.length > 0) {
                msg.tool_calls = m.toolCalls.map(tc => ({
                    id: tc.id,
                    type: 'function',
                    function: {
                        name: tc.name,
                        arguments: JSON.stringify(tc.args)
                    }
                }));
                // OpenAI requires content to be null if tool_calls is present and no text
                if (!msg.content) msg.content = null; 
            }
            openaiMsgs.push(msg);
        } else if (m.role === 'tool' && m.toolResults) {
            // OpenAI requires one message per tool result with specific tool_call_id
            for (const tr of m.toolResults) {
                openaiMsgs.push({
                    role: 'tool',
                    tool_call_id: tr.callId,
                    content: tr.result
                });
            }
        }
    }
    return openaiMsgs;
};

const mapToolsToOpenAI = (tools: any[]) => {
    return tools.map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters
        }
    }));
};

// --- Debug / Export Helper ---

export const getRawRequest = (config: AppConfig, messages: Message[]) => {
    const activeModel = config.models.find(m => m.id === config.activeModelId);
    if (!activeModel) throw new Error("No active model selected.");

    const systemInstruction = buildSystemInstruction(config);
    const activeTools = config.tools.filter(t => t.active).map(t => t.definition);

    if (activeModel.provider === 'openai') {
        const msgs = convertHistoryToOpenAI(messages, systemInstruction);
        const body: any = {
            model: activeModel.modelId,
            messages: msgs,
            stream: true
        };
        if (activeTools.length > 0) {
            body.tools = mapToolsToOpenAI(activeTools);
        }
        return body;
    } else {
        // Gemini
        const contents = convertHistoryToGemini(messages);
        const toolsConfig = activeTools.length > 0 ? [{ functionDeclarations: activeTools }] : undefined;
        
        // Return structure matching generateContentStream args for clarity
        return {
            model: activeModel.modelId,
            contents: contents,
            config: {
                systemInstruction: systemInstruction,
                tools: toolsConfig,
            }
        };
    }
};

// --- Streamers ---

async function* streamGemini(
    model: ModelConfig, 
    history: Message[], 
    systemInstruction: string,
    tools: any[]
): AsyncGenerator<StreamChunk> {
    const ai = new GoogleGenAI({ apiKey: model.apiKey });
    const contents = convertHistoryToGemini(history);
    const toolsConfig = tools.length > 0 ? [{ functionDeclarations: tools }] : undefined;

    const result = await ai.models.generateContentStream({
        model: model.modelId,
        contents: contents,
        config: {
            systemInstruction: systemInstruction,
            tools: toolsConfig,
        }
    });

    for await (const chunk of result) {
        const text = chunk.text;
        let toolCalls: ToolCall[] | undefined;

        const parts = chunk.candidates?.[0]?.content?.parts;
        if (parts) {
            const fcs = parts.filter((p: any) => p.functionCall).map((p: any) => p.functionCall);
            if (fcs.length > 0) {
                toolCalls = fcs.map((fc: any) => ({
                    id: fc.id || `call_${crypto.randomUUID().split('-')[0]}`, // Generate ID if Gemini doesn't provide one
                    name: fc.name,
                    args: fc.args
                }));
            }
        }

        yield { textDelta: text, toolCalls };
    }
}

async function* streamOpenAI(
    model: ModelConfig, 
    history: Message[], 
    systemInstruction: string,
    tools: any[]
): AsyncGenerator<StreamChunk> {
    const messages = convertHistoryToOpenAI(history, systemInstruction);
    const baseUrl = model.baseUrl ? model.baseUrl.replace(/\/$/, '') : 'https://api.openai.com/v1';
    
    const body: any = {
        model: model.modelId,
        messages: messages,
        stream: true
    };

    if (tools.length > 0) {
        body.tools = mapToolsToOpenAI(tools);
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${model.apiKey}`
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        let errorMsg = res.statusText;
        try {
             const errJson = await res.json();
             errorMsg = errJson.error?.message || errorMsg;
        } catch {}
        throw new Error(`OpenAI API Error (${res.status}): ${errorMsg}`);
    }

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) return;

    let buffer = '';
    // Accumulate tool calls for the current turn
    let currentToolCalls: Map<number, { id: string, name: string, args: string }> = new Map();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            if (trimmed === 'data: [DONE]') return;
            
            try {
                const json = JSON.parse(trimmed.slice(6));
                const delta = json.choices[0]?.delta;
                
                if (delta?.content) {
                    yield { textDelta: delta.content };
                }

                if (delta?.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const index = tc.index;
                        const existing = currentToolCalls.get(index) || { id: '', name: '', args: '' };
                        
                        if (tc.id) existing.id = tc.id;
                        if (tc.function?.name) existing.name = tc.function.name;
                        if (tc.function?.arguments) existing.args += tc.function.arguments;
                        
                        currentToolCalls.set(index, existing);
                    }
                    
                    const toolCallsSnapshot: ToolCall[] = [];
                    for (const tc of currentToolCalls.values()) {
                        let parsedArgs = {};
                        try { parsedArgs = JSON.parse(tc.args); } catch {}
                        
                        toolCallsSnapshot.push({
                            id: tc.id,
                            name: tc.name,
                            args: parsedArgs
                        });
                    }
                    
                    yield { toolCalls: toolCallsSnapshot };
                }

            } catch (e) {
                // Ignore parse errors for partial chunks
            }
        }
    }
}

// --- Main Export ---

export const sendMessageStream = async (
  config: AppConfig,
  history: Message[]
): Promise<AsyncGenerator<StreamChunk>> => {
  const activeModel = config.models.find(m => m.id === config.activeModelId);
  if (!activeModel) throw new Error("No active model selected.");
  if (!activeModel.apiKey) throw new Error("API Key is missing for the selected model.");

  const systemInstruction = buildSystemInstruction(config);
  const activeTools = config.tools.filter(t => t.active).map(t => t.definition);

  if (activeModel.provider === 'openai') {
      return streamOpenAI(activeModel, history, systemInstruction, activeTools);
  } else {
      return streamGemini(activeModel, history, systemInstruction, activeTools);
  }
};