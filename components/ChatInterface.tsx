import React, { useState, useRef, useEffect } from 'react';
import { Message, AppConfig, ToolCall, UserTool } from '../types';
import { sendMessageStream, getThread } from '../services/geminiService';
import { Icons } from './Icon';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// @ts-ignore
import JSZip from 'jszip';

interface ChatInterfaceProps {
    currentThread: Message[];
    messageMap: Record<string, Message>;
    headId: string | null;
    updateState: (newMap: Record<string, Message>, newHeadId: string | null) => void;
    config: AppConfig;
    onToggleSidebar: () => void;
    isSidebarOpen: boolean;
}

interface AttachedFile {
    name: string;
    content: string;
}

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <button
            onClick={handleCopy}
            className="text-slate-400 hover:text-white transition-colors"
            title="Copy code"
        >
            {copied ? <span className="text-green-400"><Icons.Check /></span> : <Icons.Copy />}
        </button>
    );
};

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
    currentThread,
    messageMap,
    headId,
    updateState,
    config,
    onToggleSidebar,
    isSidebarOpen
}) => {
    const [inputMode, setInputMode] = useState<'user' | 'fake_tool'>('user');
    const [input, setInput] = useState('');

    // Attachments State
    const [attachments, setAttachments] = useState<AttachedFile[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Fake Tool State
    const [selectedToolName, setSelectedToolName] = useState<string>('');
    const [fakeArgs, setFakeArgs] = useState('{}');
    const [fakeOutput, setFakeOutput] = useState('{"status": "success"}');

    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const activeModel = config.models.find(m => m.id === config.activeModelId);

    // Update selected tool when config changes
    useEffect(() => {
        if (config.tools.length > 0 && !selectedToolName) {
            setSelectedToolName(config.tools[0].definition.name);
        }
    }, [config.tools]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [currentThread.length, isLoading]);

    const appendToTree = (parentId: string | null, newMessage: Message, updatesMap: Record<string, Message>) => {
        const updatedMap = { ...updatesMap, [newMessage.id]: newMessage };
        if (parentId && updatedMap[parentId]) {
            updatedMap[parentId] = {
                ...updatedMap[parentId],
                childrenIds: [...updatedMap[parentId].childrenIds, newMessage.id]
            };
        }
        return updatedMap;
    };

    const processConversationTurn = async (startMap: Record<string, Message>, startHeadId: string) => {
        setIsLoading(true);
        const modelMsgId = crypto.randomUUID();

        // Initial placeholder node
        const initialModelMsg: Message = {
            id: modelMsgId,
            role: 'model',
            content: '',
            toolCalls: [],
            timestamp: Date.now(),
            parentId: startHeadId,
            childrenIds: []
        };

        // Update state synchronously for UI feedback
        let currentMap = appendToTree(startHeadId, initialModelMsg, startMap);
        let currentHead = modelMsgId;
        updateState(currentMap, currentHead);

        try {
            const historyForApi = getThread(currentMap, startHeadId);
            const stream = await sendMessageStream(config, historyForApi);

            let accumulatedText = '';
            let currentToolCalls: ToolCall[] = [];

            for await (const chunk of stream) {
                if (chunk.textDelta) {
                    accumulatedText += chunk.textDelta;
                }
                if (chunk.toolCalls) {
                    currentToolCalls = chunk.toolCalls;
                }

                // Update the node in the map
                currentMap = {
                    ...currentMap,
                    [modelMsgId]: {
                        ...currentMap[modelMsgId],
                        content: accumulatedText,
                        toolCalls: currentToolCalls.length > 0 ? currentToolCalls : undefined
                    }
                };
                updateState(currentMap, currentHead);
            }

            // Stream complete. Handle Auto-Execution.
            const finalMsg = currentMap[modelMsgId];
            if (finalMsg.toolCalls && finalMsg.toolCalls.length > 0) {
                const executionQueue = finalMsg.toolCalls.map(tc => {
                    const toolConfig = config.tools.find(t => t.definition.name === tc.name);
                    if (toolConfig && toolConfig.autoExecute && toolConfig.implementation) {
                        return { tc, toolConfig };
                    }
                    return null;
                }).filter(Boolean) as { tc: ToolCall, toolConfig: UserTool }[];

                if (executionQueue.length > 0) {
                    const results: { callId: string, result: string }[] = [];

                    for (const item of executionQueue) {
                        let result = '';
                        try {
                            // Eval with Async IIFE wrapper to allow await
                            const args = item.tc.args;
                            const func = new Function('args', `return (async () => { ${item.toolConfig.implementation} })()`);
                            const output = await func(args);
                            // Always stringify result, even if it's a primitive string.
                            // This ensures it is stored as "Sunny" (quoted) if the output is "Sunny".
                            // If output is object, it becomes JSON object string.
                            result = JSON.stringify(output);
                        } catch (e: any) {
                            result = JSON.stringify({ error: e.message });
                        }
                        results.push({ callId: item.tc.id, result });
                    }

                    // If we have auto-executed results, append a Tool Message
                    if (results.length > 0) {
                        const toolMsgId = crypto.randomUUID();
                        const toolMsg: Message = {
                            id: toolMsgId,
                            role: 'tool',
                            toolResults: results,
                            timestamp: Date.now(),
                            parentId: currentHead,
                            childrenIds: []
                        };

                        currentMap = appendToTree(currentHead, toolMsg, currentMap);
                        currentHead = toolMsgId;
                        updateState(currentMap, currentHead);

                        // If ALL tools requested were auto-executed, we can continue the turn automatically.
                        if (results.length === finalMsg.toolCalls.length) {
                            await processConversationTurn(currentMap, currentHead);
                        }
                    }
                }
            }

        } catch (error: any) {
            console.error(error);
            const errorMessage = `Error: ${error.message || 'Unknown error occurred'}`;

            currentMap = {
                ...currentMap,
                [modelMsgId]: {
                    ...currentMap[modelMsgId],
                    content: errorMessage
                }
            };
            updateState(currentMap, currentHead);

        } finally {
            setIsLoading(false);
        }
    };

    const handleSend = async () => {
        if (isLoading) return;
        if (!activeModel?.apiKey) {
            alert("Please configure an API Key for the active model in the settings panel.");
            onToggleSidebar();
            return;
        }

        let nextParentId = headId;
        let nextMap = { ...messageMap };

        if (inputMode === 'user') {
            if (!input.trim() && attachments.length === 0) return;

            // Combine input with attachments
            let finalContent = input;
            if (attachments.length > 0) {
                const fileContext = attachments.map(f =>
                    `\n<file name="${f.name}">\n${f.content}\n</file>`
                ).join("\n");

                finalContent = `${finalContent}\n\n=== ATTACHED FILES ===\n${fileContext}`;
            }

            const newMessage: Message = {
                id: crypto.randomUUID(),
                role: 'user',
                content: finalContent,
                timestamp: Date.now(),
                parentId: nextParentId,
                childrenIds: []
            };

            nextMap = appendToTree(nextParentId, newMessage, nextMap);
            nextParentId = newMessage.id;

            // Reset Inputs
            setInput('');
            setAttachments([]);

            // Commit User Message state before streaming
            updateState(nextMap, nextParentId);
            await processConversationTurn(nextMap, nextParentId);

        } else {
            // Fake Tool Mode
            if (!selectedToolName) {
                alert("No tool selected.");
                return;
            }

            try {
                const parsedArgs = JSON.parse(fakeArgs);
                const callId = `call_${crypto.randomUUID().split('-')[0]}`; // Generate specific ID

                // 1. Inject Fake Model Call
                const fakeModelCall: Message = {
                    id: crypto.randomUUID(),
                    role: 'model',
                    timestamp: Date.now(),
                    toolCalls: [{
                        id: callId,
                        name: selectedToolName,
                        args: parsedArgs
                    }],
                    parentId: nextParentId,
                    childrenIds: []
                };
                nextMap = appendToTree(nextParentId, fakeModelCall, nextMap);
                nextParentId = fakeModelCall.id;

                // 2. Inject Fake Tool Response
                const fakeToolResponse: Message = {
                    id: crypto.randomUUID(),
                    role: 'tool',
                    timestamp: Date.now() + 10,
                    toolResults: [{
                        callId: callId,
                        result: fakeOutput
                    }],
                    parentId: nextParentId,
                    childrenIds: []
                };
                nextMap = appendToTree(nextParentId, fakeToolResponse, nextMap);
                nextParentId = fakeToolResponse.id;

                setFakeOutput('');

                // Commit Fake sequence state before streaming
                updateState(nextMap, nextParentId);
                await processConversationTurn(nextMap, nextParentId);

            } catch (e) {
                alert("Invalid JSON in Arguments or Output fields.");
                return;
            }
        }
    };

    const handleToolSubmit = async (callId: string, result: string) => {
        if (isLoading) return;

        const toolMessage: Message = {
            id: crypto.randomUUID(),
            role: 'tool',
            toolResults: [{ callId, result }],
            timestamp: Date.now(),
            parentId: headId,
            childrenIds: []
        };

        let nextMap = appendToTree(headId, toolMessage, messageMap);
        let nextHead = toolMessage.id;

        updateState(nextMap, nextHead);
        await processConversationTurn(nextMap, nextHead);
    };

    const handleRegenerate = async (msgId: string) => {
        if (isLoading) return;

        const msg = messageMap[msgId];
        if (!msg || !msg.parentId) return; // Cannot regenerate root or unknown

        // We want to branch off from the PARENT of the message we are regenerating.
        const parentId = msg.parentId;

        // Trigger stream from parent
        await processConversationTurn(messageMap, parentId);
    };

    const navigateBranch = (msgId: string, direction: 'prev' | 'next') => {
        const msg = messageMap[msgId];
        if (!msg || !msg.parentId) return;

        const parent = messageMap[msg.parentId];
        if (!parent) return;

        const currentIndex = parent.childrenIds.indexOf(msgId);
        if (currentIndex === -1) return;

        let nextIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
        // Clamp
        if (nextIndex < 0) nextIndex = 0;
        if (nextIndex >= parent.childrenIds.length) nextIndex = parent.childrenIds.length - 1;

        const nextChildId = parent.childrenIds[nextIndex];

        // Find the leaf of this new branch to set as head
        let ptr = nextChildId;
        while (true) {
            const node = messageMap[ptr];
            if (!node || node.childrenIds.length === 0) break;
            ptr = node.childrenIds[node.childrenIds.length - 1]; // Follow latest
        }

        updateState(messageMap, ptr);
    };

    // --- File Upload Handlers ---

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        const newAttachments: AttachedFile[] = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];

            try {
                if (file.name.endsWith('.zip')) {
                    const zip = await JSZip.loadAsync(file);

                    // Convert object to array of promises to process concurrently
                    const promises: Promise<void>[] = [];

                    zip.forEach((relativePath: string, zipEntry: any) => {
                        promises.push((async () => {
                            if (zipEntry.dir) return;
                            // Skip hidden files or macOS metadata
                            if (relativePath.includes('__MACOSX') || relativePath.startsWith('.')) return;

                            try {
                                const content = await zipEntry.async('string');
                                // Basic binary check: look for null bytes. Not perfect but fast.
                                if (content.indexOf('\0') === -1) {
                                    newAttachments.push({
                                        name: relativePath,
                                        content: content
                                    });
                                }
                            } catch (err) {
                                console.warn(`Failed to read zip entry ${relativePath}`, err);
                            }
                        })());
                    });

                    await Promise.all(promises);

                } else {
                    // Regular file
                    const text = await file.text();
                    // Basic binary check
                    if (text.indexOf('\0') === -1) {
                        newAttachments.push({
                            name: file.name,
                            content: text
                        });
                    }
                }
            } catch (err) {
                console.error("Error processing file", file.name, err);
                alert(`Failed to process ${file.name}`);
            }
        }

        setAttachments(prev => [...prev, ...newAttachments]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const removeAttachment = (index: number) => {
        setAttachments(prev => prev.filter((_, i) => i !== index));
    };

    return (
        <div className={`flex-1 flex flex-col h-full bg-slate-950 relative transition-all duration-300 ${isSidebarOpen ? 'md:ml-80' : 'md:ml-0'}`}>

            {/* Header */}
            <div className="h-14 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md flex items-center px-4 sticky top-0 z-20">
                <button
                    onClick={onToggleSidebar}
                    className="p-2 mr-4 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 transition-colors"
                >
                    {isSidebarOpen ? <Icons.ChevronLeft /> : <Icons.Menu />}
                </button>
                <div className="flex-1">
                    <h1 className="text-sm font-semibold text-slate-200">Ge Brain Studio</h1>
                    <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${activeModel ? 'bg-green-500' : 'bg-red-500'}`}></span>
                        <p className="text-[10px] text-slate-500">{activeModel ? activeModel.name : 'No Model Selected'}</p>
                    </div>
                </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 scroll-smooth">
                {currentThread.length === 0 && (
                    <div className="h-[60vh] flex flex-col items-center justify-center text-slate-600 animate-fadeIn">
                        <div className="p-4 bg-slate-900 rounded-full mb-4">
                            <Icons.Brain />
                        </div>
                        <h3 className="text-lg font-medium text-slate-300">Ready to Iterate</h3>
                        <p className="mt-2 text-sm max-w-xs text-center">Configure your models, memories and tools in the sidebar, then start chatting.</p>
                    </div>
                )}

                {currentThread.map((msg) => {
                    const parent = msg.parentId ? messageMap[msg.parentId] : null;
                    const siblingCount = parent ? parent.childrenIds.length : 0;
                    const currentSiblingIndex = parent ? parent.childrenIds.indexOf(msg.id) : 0;

                    return (
                        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group animate-slideUp relative`}>

                            <div className={`max-w-[90%] md:max-w-[80%] lg:max-w-[70%] rounded-2xl p-5 shadow-sm relative ${msg.role === 'user'
                                ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-tr-sm'
                                : msg.role === 'tool'
                                    ? 'bg-slate-900 border border-slate-800 text-slate-300 rounded-lg w-full'
                                    : 'bg-slate-800 text-slate-100 rounded-tl-sm border border-slate-700/50'
                                }`}>

                                {/* Branch Navigation */}
                                {siblingCount > 1 && (
                                    <div className="absolute -top-3 left-0 right-0 flex justify-center z-10">
                                        <div className="bg-slate-800 border border-slate-700 rounded-full px-2 py-0.5 flex items-center gap-2 text-[10px] text-slate-400 shadow-md">
                                            <button
                                                onClick={() => navigateBranch(msg.id, 'prev')}
                                                disabled={currentSiblingIndex === 0}
                                                className="hover:text-white disabled:opacity-30"
                                            >
                                                <Icons.ChevronLeft />
                                            </button>
                                            <span className="font-mono">{currentSiblingIndex + 1} / {siblingCount}</span>
                                            <button
                                                onClick={() => navigateBranch(msg.id, 'next')}
                                                disabled={currentSiblingIndex === siblingCount - 1}
                                                className="hover:text-white disabled:opacity-30"
                                            >
                                                <Icons.ChevronRight />
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Role Label for Non-User */}
                                {msg.role !== 'user' && (
                                    <div className="text-[10px] font-bold uppercase tracking-wider mb-2 opacity-50 flex items-center gap-2">
                                        {msg.role === 'model'
                                            ? (msg.toolCalls && msg.toolCalls.length > 0
                                                ? <><Icons.Tool /> Tool Request</>
                                                : <><Icons.Brain /> {activeModel?.name || 'Model'}</>)
                                            : <><Icons.Tool /> Tool Result</>}
                                    </div>
                                )}

                                {/* Content with Markdown */}
                                {msg.content && (
                                    <div className="prose prose-invert prose-sm max-w-none leading-7 text-sm break-words">
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            components={{
                                                code({ node, inline, className, children, ...props }: any) {
                                                    const match = /language-(\w+)/.exec(className || '');
                                                    return !inline && match ? (
                                                        <div className="relative my-4 rounded-lg overflow-hidden border border-slate-700/50 bg-slate-950">
                                                            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800">
                                                                <span className="text-[10px] uppercase font-mono text-slate-400">{match[1]}</span>
                                                                <CopyButton text={String(children).replace(/\n$/, '')} />
                                                            </div>
                                                            <div className="p-4 overflow-x-auto">
                                                                <pre className="whitespace-pre-wrap break-all overflow-x-auto">
                                                                    <code className={`!bg-transparent text-sm font-mono block w-full ${className}`} {...props}>
                                                                        {children}
                                                                    </code>
                                                                </pre>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <code className="bg-slate-700/40 rounded px-1.5 py-0.5 text-xs font-mono text-slate-200" {...props}>
                                                            {children}
                                                        </code>
                                                    );
                                                },
                                                a: ({ node, ...props }) => <a className="text-blue-400 hover:text-blue-300 underline underline-offset-4" target="_blank" rel="noopener noreferrer" {...props} />,
                                                table: ({ node, ...props }) => <div className="overflow-x-auto my-4 rounded-lg border border-slate-700"><table className="w-full text-left" {...props} /></div>,
                                                thead: ({ node, ...props }) => <thead className="bg-slate-900/50 text-slate-200" {...props} />,
                                                th: ({ node, ...props }) => <th className="p-3 text-xs font-bold uppercase tracking-wider border-b border-slate-700" {...props} />,
                                                td: ({ node, ...props }) => <td className="p-3 border-b border-slate-800 text-slate-300" {...props} />,
                                                blockquote: ({ node, ...props }) => <blockquote className="border-l-2 border-blue-500 pl-4 italic my-4 text-slate-400" {...props} />,
                                            }}
                                        >
                                            {msg.content}
                                        </ReactMarkdown>
                                    </div>
                                )}

                                {/* Tool Calls Rendering */}
                                {msg.role === 'model' && msg.toolCalls?.map((tc, idx) => {
                                    // Check if answered by looking ahead in current thread
                                    const nextMsgIndex = currentThread.findIndex(m => m.id === msg.id) + 1;
                                    const nextMsg = currentThread[nextMsgIndex];

                                    // Robust check: Does the next message contain a result for THIS specific call ID?
                                    const isAnswered = nextMsg && nextMsg.role === 'tool' && nextMsg.toolResults?.some(tr => tr.callId === tc.id);

                                    return (
                                        <div key={idx} className="mt-4 bg-slate-950/50 rounded-lg p-4 border border-purple-500/30 overflow-hidden">
                                            <div className="flex items-center gap-2 text-purple-400 text-xs font-bold uppercase mb-2">
                                                <Icons.Tool /> {isAnswered ? "Call History" : "Function Call"}
                                            </div>
                                            <div className="text-xs font-mono text-slate-400 mb-3 bg-slate-950 p-2 rounded">
                                                <span className="text-purple-300 font-bold">{tc.name}</span>
                                                <span className="text-slate-500">(</span>
                                                <span className="text-orange-200">{JSON.stringify(tc.args)}</span>
                                                <span className="text-slate-500">)</span>
                                            </div>
                                            <div className="text-[10px] text-slate-600 mb-2 font-mono">ID: {tc.id}</div>
                                            {!isAnswered ? (
                                                <ToolExecutor
                                                    callId={tc.id}
                                                    name={tc.name}
                                                    onExecute={(res) => handleToolSubmit(tc.id, res)}
                                                />
                                            ) : (
                                                <div className="text-[10px] text-green-500 flex items-center gap-1.5 bg-green-500/10 px-2 py-1 rounded w-fit">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Executed
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                                {/* Tool Result Rendering */}
                                {msg.role === 'tool' && msg.toolResults?.map((tr, idx) => (
                                    <div key={idx} className="mt-2">
                                        <div className="text-[10px] text-slate-500 mb-1 font-mono">Result for ID: {tr.callId}</div>
                                        <div className="font-mono text-xs text-green-400 bg-slate-950 p-3 rounded border border-slate-800/50 overflow-x-auto">
                                            <span className="opacity-50 select-none mr-2">{'> '}</span>{tr.result}
                                        </div>
                                    </div>
                                ))}

                                <div className="text-[10px] opacity-30 mt-3 text-right flex justify-end gap-3">
                                    <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    {msg.role === 'model' && !isLoading && (
                                        <button
                                            onClick={() => handleRegenerate(msg.id)}
                                            className="hover:text-blue-400 transition-colors flex items-center gap-1"
                                            title="Regenerate Response"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" /></svg>
                                            Regenerate
                                        </button>
                                    )}
                                </div>
                            </div>

                        </div>
                    );
                })}

                {isLoading && currentThread[currentThread.length - 1]?.role !== 'model' && (
                    <div className="flex justify-start animate-pulse">
                        <div className="bg-slate-800/50 text-slate-400 rounded-2xl rounded-tl-sm p-4 text-xs flex items-center gap-2">
                            <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce"></span>
                            <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce delay-100"></span>
                            <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce delay-200"></span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 md:p-6 bg-gradient-to-t from-slate-950 via-slate-950 to-transparent">
                <div className="max-w-4xl mx-auto relative shadow-2xl rounded-xl bg-slate-900/90 backdrop-blur border border-slate-700/50 overflow-hidden">

                    {/* Mode Tabs */}
                    <div className="flex border-b border-slate-800">
                        <button
                            onClick={() => setInputMode('user')}
                            className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${inputMode === 'user' ? 'bg-slate-800 text-blue-400' : 'hover:bg-slate-800/50 text-slate-500'}`}
                        >
                            <Icons.MessageSquare /> Message
                        </button>
                        <button
                            onClick={() => setInputMode('fake_tool')}
                            className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${inputMode === 'fake_tool' ? 'bg-purple-900/20 text-purple-400' : 'hover:bg-slate-800/50 text-slate-500'}`}
                        >
                            <Icons.Tool /> Fake Tool Output
                        </button>
                    </div>

                    {inputMode === 'user' ? (
                        <div className="relative">
                            {/* Attachments List */}
                            {attachments.length > 0 && (
                                <div className="flex flex-wrap gap-2 p-2 bg-slate-900 border-b border-slate-800">
                                    {attachments.map((file, idx) => (
                                        <div key={idx} className="flex items-center gap-2 bg-slate-800 text-slate-200 text-xs px-2 py-1.5 rounded-md border border-slate-700">
                                            <span className="text-blue-400"><Icons.File /></span>
                                            <span className="max-w-[150px] truncate">{file.name}</span>
                                            <button onClick={() => removeAttachment(idx)} className="text-slate-500 hover:text-red-400 ml-1">
                                                <div className="scale-75"><Icons.X /></div>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <textarea
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSend();
                                    }
                                }}
                                placeholder="Type your message..."
                                className="w-full bg-transparent text-slate-100 pl-12 pr-14 py-4 focus:outline-none resize-none custom-scrollbar"
                                rows={1}
                                style={{ minHeight: '60px', maxHeight: '200px' }}
                            />

                            {/* Attachment Button */}
                            <div className="absolute left-3 top-1/2 -translate-y-1/2">
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="p-2 text-slate-500 hover:text-blue-400 transition-colors"
                                    title="Attach files (Text or Zip)"
                                >
                                    <Icons.Paperclip />
                                </button>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    multiple
                                    onChange={handleFileSelect}
                                />
                            </div>

                            <button
                                onClick={handleSend}
                                disabled={isLoading || (!input.trim() && attachments.length === 0)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600 transition-all text-white shadow-lg shadow-blue-900/20"
                            >
                                <Icons.Send />
                            </button>
                        </div>
                    ) : (
                        <div className="p-4 bg-purple-900/5">
                            {config.tools.length === 0 ? (
                                <div className="text-center py-4 text-xs text-slate-500">
                                    No registered tools found. Please add tools in the sidebar first.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Select Tool</label>
                                        <select
                                            value={selectedToolName}
                                            onChange={(e) => setSelectedToolName(e.target.value)}
                                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-2 text-xs text-white outline-none focus:border-purple-500"
                                        >
                                            {config.tools.map(t => (
                                                <option key={t.id} value={t.definition.name}>{t.definition.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Fake Arguments (JSON)</label>
                                            <textarea
                                                value={fakeArgs}
                                                onChange={(e) => setFakeArgs(e.target.value)}
                                                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-2 text-xs font-mono text-orange-200 outline-none focus:border-purple-500 h-20 resize-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Fake Output (JSON/String)</label>
                                            <textarea
                                                value={fakeOutput}
                                                onChange={(e) => setFakeOutput(e.target.value)}
                                                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-2 text-xs font-mono text-green-400 outline-none focus:border-purple-500 h-20 resize-none"
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleSend}
                                        disabled={isLoading || !selectedToolName}
                                        className="w-full bg-purple-600 hover:bg-purple-500 text-white py-2 rounded text-xs font-bold uppercase tracking-wide transition-colors"
                                    >
                                        Inject & Run
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                </div>
                <div className="text-center mt-2 text-[10px] text-slate-600">
                    {inputMode === 'user' ? 'Press Enter to send' : 'Injects fake history and triggers model response'}
                </div>
            </div>
        </div>
    );
};

const ToolExecutor: React.FC<{ callId: string, name: string, onExecute: (result: string) => void }> = ({ callId, name, onExecute }) => {
    const [result, setResult] = useState('');

    return (
        <div className="flex flex-col gap-2 mt-2">
            <input
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono"
                placeholder='Enter JSON result... e.g. {"temperature": 22}'
                value={result}
                onChange={(e) => setResult(e.target.value)}
            />
            <button
                onClick={() => onExecute(result)}
                className="self-end bg-purple-700 hover:bg-purple-600 text-white px-4 py-1.5 rounded text-xs font-medium transition-colors"
            >
                Submit Result
            </button>
        </div>
    )
}