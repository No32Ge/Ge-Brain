import React, { useState, useMemo } from 'react';
import { ConfigPanel } from './components/ConfigPanel';
import { ChatInterface } from './components/ChatInterface';
import { AppConfig, Message, DEFAULT_CONFIG, ConversationState } from './types';
import { getRawRequest, getThread } from './services/geminiService';

function App() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  
  // Tree-based State
  const [messageMap, setMessageMap] = useState<Record<string, Message>>({});
  const [headId, setHeadId] = useState<string | null>(null);
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Compute linear thread for current view
  const currentThread = useMemo(() => {
      return getThread(messageMap, headId);
  }, [messageMap, headId]);

  const handleExport = (type: 'state' | 'raw') => {
    let content = "";
    let filename = "";

    if (type === 'state') {
        const state: ConversationState = { config, messageMap, headId };
        content = JSON.stringify(state, null, 2);
        filename = `brain-studio-tree-${new Date().toISOString()}.json`;
    } else {
        try {
            // Raw export follows the current active branch
            const rawReq = getRawRequest(config, currentThread);
            content = JSON.stringify(rawReq, null, 2);
            filename = `api-debug-request-${new Date().toISOString()}.json`;
        } catch (e: any) {
            alert("Failed to generate raw request: " + e.message);
            return;
        }
    }

    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        const state: any = JSON.parse(json);
        
        // 1. Handle Legacy Config Import (Schema V1 - Array Based)
        if (Array.isArray(state.messages)) {
            let legacyMessages = state.messages as Message[];
            
            // Convert Array to Tree
            const newMap: Record<string, Message> = {};
            let prevId: string | null = null;
            
            legacyMessages.forEach((msg) => {
                // Ensure unique ID if missing or collision (unlikely in old export but safe)
                if (!msg.id) msg.id = crypto.randomUUID();
                
                const newMsg: Message = {
                    ...msg,
                    parentId: prevId,
                    childrenIds: []
                };
                
                newMap[newMsg.id] = newMsg;
                
                if (prevId && newMap[prevId]) {
                    newMap[prevId].childrenIds.push(newMsg.id);
                }
                prevId = newMsg.id;
            });

            // Config Migration
            let newConfig = state.config || DEFAULT_CONFIG;
            if (typeof newConfig.apiKey === 'string') { // Ancient format
                 newConfig = {
                     ...DEFAULT_CONFIG,
                     systemPrompt: newConfig.systemPrompt || DEFAULT_CONFIG.systemPrompt,
                     memories: newConfig.memories || [],
                     tools: newConfig.tools || [],
                     models: [
                         {
                             id: 'legacy-gemini',
                             name: 'Imported Gemini',
                             provider: 'gemini',
                             modelId: newConfig.model || 'gemini-2.5-flash',
                             apiKey: newConfig.apiKey
                         }
                     ],
                     activeModelId: 'legacy-gemini'
                 };
            }

            setConfig(newConfig);
            setMessageMap(newMap);
            setHeadId(prevId); // Last message is head
            alert("Legacy session restored and converted to tree format.");
            return;
        }

        // 2. Handle Tree State Import
        if (state.messageMap && state.headId) {
             setConfig(state.config || DEFAULT_CONFIG);
             setMessageMap(state.messageMap);
             setHeadId(state.headId);
             alert("Session restored successfully.");
        } else {
             throw new Error("Unknown file format");
        }
      } catch (err) {
        alert("Failed to import configuration: " + err);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-200 font-sans selection:bg-blue-500/30">
      {/* Overlay for mobile when sidebar is open */}
      {isSidebarOpen && (
        <div 
            className="fixed inset-0 bg-black/50 z-30 md:hidden backdrop-blur-sm"
            onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <ConfigPanel 
        config={config} 
        setConfig={setConfig} 
        onImport={handleImport} 
        onExport={handleExport}
        isOpen={isSidebarOpen}
        onCloseMobile={() => setIsSidebarOpen(false)}
      />
      
      <ChatInterface 
        currentThread={currentThread}
        messageMap={messageMap}
        headId={headId}
        updateState={(map, head) => {
            setMessageMap(map);
            setHeadId(head);
        }}
        config={config} 
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        isSidebarOpen={isSidebarOpen}
      />
    </div>
  );
}

export default App;