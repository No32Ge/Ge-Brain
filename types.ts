import { FunctionDeclaration } from "@google/genai";



// App Logic Types
export interface VirtualMemory {
  id: string;
  name: string;
  content: string;
  active: boolean;
}

export interface UserTool {
  id: string;
  definition: FunctionDeclaration;
  active: boolean;
  implementation?: string; // JS Code execution logic
  autoExecute?: boolean; // Whether to run automatically
}

export type ModelProvider = 'gemini' | 'openai';

export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  modelId: string;
  apiKey: string;
  baseUrl?: string;
}

export interface AppConfig {
  activeModelId: string;
  models: ModelConfig[];
  systemPrompt: string;
  memories: VirtualMemory[];
  tools: UserTool[];
}

export interface ToolCall {
    id: string;
    name: string;
    args: any;
}

export interface Message {
  id: string;
  role: 'user' | 'model' | 'tool';
  content?: string; 
  
  // Unified Tool Calls (Model requesting execution)
  toolCalls?: ToolCall[]; 
  
  // Unified Tool Results (User/System providing results)
  toolResults?: { 
    callId: string; 
    result: string; // JSON string usually
    isError?: boolean;
  }[];
  
  timestamp: number;
  
  // Tree Structure Pointers
  parentId: string | null;
  childrenIds: string[];
}

// Deprecated linear state for backward compatibility types, 
// but the app now uses tree state.
export interface ConversationState {
  config: AppConfig;
  messageMap: Record<string, Message>;
  headId: string | null;
}

export const DEFAULT_CONFIG: AppConfig = {
  activeModelId: 'default-gemini',
  models: [
    {
      id: 'default-gemini',
      name: 'Gemini 2.5 Flash',
      provider: 'gemini',
      modelId: 'gemini-2.5-flash',
      apiKey: ''
    }
  ],
  systemPrompt: 'You are a helpful AI assistant.',
  memories: [],
  tools: [],
};