import React, { useState, useRef, useEffect } from 'react';
import { AppConfig, VirtualMemory, UserTool, ModelConfig } from '../types';
import { Icons } from './Icon';

import { PRESET_TOOLS, TOOL_CATEGORIES } from './ToolLibrary';

interface ConfigPanelProps {
  config: AppConfig;
  setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
  onImport: (file: File) => void;
  onExport: (type: 'state' | 'raw') => void;
  isOpen: boolean;
  onCloseMobile: () => void;
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({ config, setConfig, onImport, onExport, isOpen, onCloseMobile }) => {
  const [activeTab, setActiveTab] = useState<'models' | 'system' | 'memory' | 'tools'>('models');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  
  // Model Management State
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editModelForm, setEditModelForm] = useState<Partial<ModelConfig>>({});

  // Memory State
  const [newMemoryName, setNewMemoryName] = useState('');
  const [newMemoryContent, setNewMemoryContent] = useState('');

  // Tool State
  const [newToolJson, setNewToolJson] = useState(`{
  "name": "get_weather",
  "description": "Get current weather",
  "parameters": {
    "type": "OBJECT",
    "properties": {
      "city": { "type": "STRING", "description": "City name" }
    },
    "required": ["city"]
  }
}`);
  const [newToolImpl, setNewToolImpl] = useState(`// JavaScript Sandbox
// You can use standard JavaScript.
// 'args' is available as an object (e.g., args.city).

// Example: Return a simple string
return "晴天";`);
  const [newToolAuto, setNewToolAuto] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // --- Model Handlers ---
  const handleEditModel = (model: ModelConfig) => {
      setEditingModelId(model.id);
      setEditModelForm({...model});
  };

  const handleCreateModel = () => {
      const newId = crypto.randomUUID();
      const newModel: ModelConfig = {
          id: newId,
          name: 'New Model',
          provider: 'openai',
          modelId: 'gpt-4o',
          apiKey: '',
          baseUrl: 'https://api.openai.com/v1'
      };
      setEditingModelId(newId);
      setEditModelForm(newModel);
  };

  const handleSaveModel = () => {
      if (!editModelForm.name || !editModelForm.apiKey || !editModelForm.modelId) {
          alert("Name, Model ID, and API Key are required.");
          return;
      }
      
      setConfig(prev => {
          const exists = prev.models.find(m => m.id === editingModelId);
          let newModels;
          if (exists) {
              newModels = prev.models.map(m => m.id === editingModelId ? { ...m, ...editModelForm } as ModelConfig : m);
          } else {
              newModels = [...prev.models, { ...editModelForm, id: editingModelId! } as ModelConfig];
          }
          return { ...prev, models: newModels, activeModelId: prev.activeModelId || editingModelId! };
      });
      setEditingModelId(null);
      setEditModelForm({});
  };

  const handleDeleteModel = (id: string) => {
      if (config.models.length <= 1) {
          alert("You must have at least one model configured.");
          return;
      }
      setConfig(prev => {
          const newModels = prev.models.filter(m => m.id !== id);
          // If we deleted the active model, switch to the first one
          const newActiveId = prev.activeModelId === id ? newModels[0].id : prev.activeModelId;
          return { ...prev, models: newModels, activeModelId: newActiveId };
      });
  };

  const handleSetActiveModel = (id: string) => {
      setConfig(prev => ({ ...prev, activeModelId: id }));
  };

  // --- Memory Handlers ---
  const handleAddMemory = () => {
    if (!newMemoryName || !newMemoryContent) return;
    const memory: VirtualMemory = {
      id: crypto.randomUUID(),
      name: newMemoryName,
      content: newMemoryContent,
      active: true,
    };
    setConfig(prev => ({ ...prev, memories: [...prev.memories, memory] }));
    setNewMemoryName('');
    setNewMemoryContent('');
  };

  const toggleMemory = (id: string) => {
    setConfig(prev => ({
      ...prev,
      memories: prev.memories.map(m => m.id === id ? { ...m, active: !m.active } : m)
    }));
  };

  const deleteMemory = (id: string) => {
    setConfig(prev => ({ ...prev, memories: prev.memories.filter(m => m.id !== id) }));
  };

  // --- Tool Handlers ---
  const handleAddTool = () => {
    try {
      const parsed = JSON.parse(newToolJson);
      if (!parsed.name) throw new Error("Tool needs a name");
      
      const tool: UserTool = {
        id: crypto.randomUUID(),
        definition: parsed,
        active: true,
        implementation: newToolImpl,
        autoExecute: newToolAuto
      };
      setConfig(prev => ({ ...prev, tools: [...prev.tools, tool] }));
    } catch (e: any) {
      alert("Invalid JSON for tool: " + e.message);
    }
  };

  const deleteTool = (id: string) => {
    setConfig(prev => ({ ...prev, tools: prev.tools.filter(t => t.id !== id) }));
  };

  const toggleTool = (id: string) => {
    setConfig(prev => ({
        ...prev,
        tools: prev.tools.map(t => t.id === id ? { ...t, active: !t.active } : t)
    }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onImport(e.target.files[0]);
    }
  };

  return (
    <div 
      className={`
        fixed inset-y-0 left-0 z-40 bg-slate-900 border-r border-slate-800 transition-all duration-300 ease-in-out flex flex-col
        ${isOpen ? 'translate-x-0 w-80' : '-translate-x-full w-80 md:translate-x-0 md:w-0 md:overflow-hidden md:border-none'}
      `}
    >
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900">
        <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2 tracking-wide">
          <Icons.Brain /> Ge Brain
        </h2>
        <button onClick={onCloseMobile} className="md:hidden text-slate-400 hover:text-white">
          <Icons.X />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 mx-0 bg-slate-900/50">
        {(['models', 'system', 'memory', 'tools'] as const).map((tab) => (
            <button 
                key={tab}
                onClick={() => setActiveTab(tab)} 
                className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wider transition-colors border-b-2 ${
                    activeTab === tab 
                    ? 'text-blue-400 border-blue-400 bg-slate-800/30' 
                    : 'text-slate-500 border-transparent hover:text-slate-300'
                }`}
            >
                {tab}
            </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        
        {/* === MODELS TAB === */}
        {activeTab === 'models' && (
            <div className="space-y-4 animate-fadeIn">
                {editingModelId ? (
                    <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 space-y-3">
                        <h3 className="text-xs font-bold text-white mb-2">{editModelForm.id ? 'Edit Model' : 'New Model'}</h3>
                        
                        <div>
                            <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Display Name</label>
                            <input 
                                value={editModelForm.name || ''} 
                                onChange={e => setEditModelForm(prev => ({...prev, name: e.target.value}))}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-white focus:border-blue-500 outline-none"
                            />
                        </div>

                        <div>
                            <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Provider</label>
                            <select 
                                value={editModelForm.provider || 'gemini'} 
                                onChange={e => setEditModelForm(prev => ({...prev, provider: e.target.value as any}))}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-white focus:border-blue-500 outline-none"
                            >
                                <option value="gemini">Google Gemini</option>
                                <option value="openai">OpenAI Compatible</option>
                            </select>
                        </div>

                        <div>
                            <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Model ID</label>
                            <input 
                                value={editModelForm.modelId || ''} 
                                onChange={e => setEditModelForm(prev => ({...prev, modelId: e.target.value}))}
                                placeholder={editModelForm.provider === 'gemini' ? "gemini-2.5-flash" : "gpt-4"}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-white focus:border-blue-500 outline-none"
                            />
                        </div>

                        {editModelForm.provider === 'openai' && (
                            <div>
                                <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Base URL</label>
                                <input 
                                    value={editModelForm.baseUrl || ''} 
                                    onChange={e => setEditModelForm(prev => ({...prev, baseUrl: e.target.value}))}
                                    placeholder="https://api.openai.com/v1"
                                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-white focus:border-blue-500 outline-none"
                                />
                            </div>
                        )}

                        <div>
                            <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">API Key</label>
                            <input 
                                type="password"
                                value={editModelForm.apiKey || ''} 
                                onChange={e => setEditModelForm(prev => ({...prev, apiKey: e.target.value}))}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-white focus:border-blue-500 outline-none"
                            />
                        </div>

                        <div className="flex gap-2 pt-2">
                            <button onClick={handleSaveModel} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2 rounded">Save</button>
                            <button onClick={() => { setEditingModelId(null); setEditModelForm({}); }} className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold py-2 rounded">Cancel</button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="space-y-2">
                            {config.models.map(m => (
                                <div 
                                    key={m.id} 
                                    className={`p-3 rounded-lg border transition-all cursor-pointer ${
                                        config.activeModelId === m.id 
                                        ? 'bg-blue-900/20 border-blue-500/50 ring-1 ring-blue-500/20' 
                                        : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                                    }`}
                                    onClick={() => handleSetActiveModel(m.id)}
                                >
                                    <div className="flex justify-between items-center mb-1">
                                        <div className="flex items-center gap-2">
                                            <div className={`w-3 h-3 rounded-full border-2 ${config.activeModelId === m.id ? 'border-blue-500 bg-blue-500' : 'border-slate-600'}`}></div>
                                            <span className="text-xs font-bold text-slate-200">{m.name}</span>
                                        </div>
                                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                                            <button onClick={() => handleEditModel(m)} className="p-1.5 text-slate-500 hover:text-blue-400 rounded hover:bg-slate-800"><Icons.Settings /></button>
                                            <button onClick={() => handleDeleteModel(m.id)} className="p-1.5 text-slate-500 hover:text-red-400 rounded hover:bg-slate-800"><Icons.Trash /></button>
                                        </div>
                                    </div>
                                    <div className="pl-5 text-[10px] text-slate-500 font-mono truncate">
                                        {m.modelId} • {m.provider}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button 
                            onClick={handleCreateModel}
                            className="w-full py-2 border-2 border-dashed border-slate-800 text-slate-500 text-xs font-bold rounded-lg hover:border-blue-500/50 hover:text-blue-400 transition-colors flex items-center justify-center gap-2"
                        >
                            <Icons.Plus /> Add Model
                        </button>
                    </>
                )}
            </div>
        )}

        {/* === SYSTEM TAB === */}
        {activeTab === 'system' && (
          <div className="space-y-4 animate-fadeIn">
            <div>
              <div className="flex justify-between items-center mb-2">
                 <label className="text-xs text-slate-400 font-medium">System Instructions</label>
                 <span className="text-[9px] text-green-500 uppercase font-bold bg-green-500/10 px-1.5 py-0.5 rounded border border-green-500/20">Live</span>
              </div>
              <textarea 
                value={config.systemPrompt}
                onChange={(e) => setConfig(c => ({...c, systemPrompt: e.target.value}))}
                className="w-full h-80 bg-slate-950 text-slate-300 p-3 rounded-md text-sm border border-slate-800 focus:border-blue-500 outline-none resize-none leading-relaxed"
                placeholder="You are a helpful assistant..."
              />
            </div>
          </div>
        )}

        {/* === MEMORY TAB === */}
        {activeTab === 'memory' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                <h3 className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider">New Memory Block</h3>
                <input 
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-white mb-2 focus:border-blue-500 outline-none"
                    placeholder="Name (e.g., Project Specs)"
                    value={newMemoryName}
                    onChange={(e) => setNewMemoryName(e.target.value)}
                />
                <textarea 
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-white h-20 mb-2 focus:border-blue-500 outline-none resize-none"
                    placeholder="Content..."
                    value={newMemoryContent}
                    onChange={(e) => setNewMemoryContent(e.target.value)}
                />
                <button 
                    onClick={handleAddMemory}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium py-1.5 rounded transition-colors flex justify-center items-center gap-2"
                >
                    <Icons.Plus /> Add Memory
                </button>
            </div>

            <div className="space-y-2">
                {config.memories.map(m => (
                    <div key={m.id} className={`group p-3 rounded-lg border transition-all ${m.active ? 'border-blue-500/30 bg-blue-900/10' : 'border-slate-800 bg-slate-900'}`}>
                        <div className="flex justify-between items-center mb-1">
                            <div className="flex items-center gap-2">
                                <input 
                                    type="checkbox" 
                                    checked={m.active} 
                                    onChange={() => toggleMemory(m.id)} 
                                    className="accent-blue-500 cursor-pointer"
                                />
                                <span className={`text-xs font-semibold ${m.active ? 'text-blue-200' : 'text-slate-400'}`}>{m.name}</span>
                            </div>
                            <button onClick={() => deleteMemory(m.id)} className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><Icons.Trash /></button>
                        </div>
                        <p className="text-[10px] text-slate-500 line-clamp-2 pl-5">{m.content}</p>
                    </div>
                ))}
                {config.memories.length === 0 && (
                    <div className="text-center py-8 text-xs text-slate-600 italic">No memories defined.</div>
                )}
            </div>
          </div>
        )}

        {/* === TOOLS TAB === */}
        {activeTab === 'tools' && (
           <div className="space-y-4 animate-fadeIn">
             <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-800">
                <h3 className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider">Define Function (JSON)</h3>
                <textarea 
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[10px] font-mono text-green-400 h-32 mb-3 focus:border-purple-500 outline-none resize-none custom-scrollbar"
                    value={newToolJson}
                    onChange={(e) => setNewToolJson(e.target.value)}
                    spellCheck={false}
                />
                
                <h3 className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider">JavaScript Implementation</h3>
                <textarea 
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-[10px] font-mono text-blue-300 h-24 mb-3 focus:border-purple-500 outline-none resize-none custom-scrollbar"
                    value={newToolImpl}
                    onChange={(e) => setNewToolImpl(e.target.value)}
                    placeholder="// args is available. e.g. return 'Done';"
                    spellCheck={false}
                />
                
                <div className="flex items-center gap-2 mb-3">
                    <input 
                        type="checkbox" 
                        id="autoExec"
                        checked={newToolAuto}
                        onChange={(e) => setNewToolAuto(e.target.checked)}
                        className="accent-purple-500 w-3 h-3"
                    />
                    <label htmlFor="autoExec" className="text-xs text-slate-300 cursor-pointer select-none">
                        Auto-Execute (Sandbox)
                    </label>
                </div>

                <button 
                    onClick={handleAddTool}
                    className="w-full bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium py-1.5 rounded transition-colors flex justify-center items-center gap-2"
                >
                    <Icons.Plus /> Register Tool
                </button>
            </div>

            <div className="space-y-2">
                {config.tools.map(t => (
                    <div key={t.id} className={`p-3 rounded-lg border border-slate-800 bg-slate-900 group transition-all ${t.active ? '' : 'opacity-70'}`}>
                        <div className="flex justify-between items-start">
                            <div className="flex-1 min-w-0 mr-2">
                                <div className={`text-xs font-bold font-mono flex items-center gap-2 ${t.active ? 'text-purple-300' : 'text-slate-400 decoration-slate-600 decoration-2'}`}>
                                    {t.definition.name}
                                    {t.autoExecute && (
                                        <span className="text-[9px] bg-purple-900/50 text-purple-200 px-1 py-0.5 rounded border border-purple-500/30">AUTO</span>
                                    )}
                                    {!t.active && (
                                         <span className="text-[9px] bg-slate-800 text-slate-500 px-1 py-0.5 rounded border border-slate-700">OFF</span>
                                    )}
                                </div>
                                <div className="text-[10px] text-slate-500 mt-1 line-clamp-2">{t.definition.description}</div>
                            </div>
                            <div className="flex gap-1 shrink-0">
                                <button 
                                    onClick={() => toggleTool(t.id)} 
                                    className={`p-1.5 rounded transition-colors ${
                                        t.active 
                                        ? 'text-green-400 hover:text-green-300 bg-green-500/10' 
                                        : 'text-slate-500 hover:text-slate-300 bg-slate-800 hover:bg-slate-700'
                                    }`}
                                    title={t.active ? "Disable Tool" : "Enable Tool"}
                                >
                                    <Icons.Power />
                                </button>
                                <button onClick={() => deleteTool(t.id)} className="p-1.5 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-slate-800 rounded"><Icons.Trash /></button>
                            </div>
                        </div>
                    </div>
                ))}
                 {config.tools.length === 0 && (
                    <div className="text-center py-8 text-xs text-slate-600 italic">No tools registered.</div>
                )}
            </div>
           </div>
        )}
      </div>

      <div className="p-4 border-t border-slate-800 bg-slate-900 flex gap-2">
        <label className="flex-1 cursor-pointer bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs py-2 px-3 rounded flex items-center justify-center gap-2 transition-colors">
            <Icons.Upload /> Import
            <input type="file" onChange={handleFileUpload} accept=".json" className="hidden" />
        </label>
        
        <div className="flex-1 relative" ref={exportRef}>
            <button 
                onClick={() => setShowExportMenu(!showExportMenu)} 
                className="w-full bg-emerald-700/80 hover:bg-emerald-600 border border-emerald-600/50 text-emerald-100 text-xs py-2 px-3 rounded flex items-center justify-center gap-2 transition-colors"
            >
                <Icons.Save /> Export
            </button>
            {showExportMenu && (
                <div className="absolute bottom-full mb-2 right-0 w-48 bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden z-50">
                    <button 
                        onClick={() => { onExport('state'); setShowExportMenu(false); }}
                        className="w-full text-left px-4 py-3 hover:bg-slate-800 text-xs text-slate-200 border-b border-slate-800"
                    >
                        <span className="font-bold block text-white">Export Session</span>
                        <span className="text-[10px] text-slate-500">Save Full App State</span>
                    </button>
                    <button 
                        onClick={() => { onExport('raw'); setShowExportMenu(false); }}
                        className="w-full text-left px-4 py-3 hover:bg-slate-800 text-xs text-slate-200"
                    >
                        <span className="font-bold block text-orange-300">Export Raw Request</span>
                        <span className="text-[10px] text-slate-500">Debug API JSON Body</span>
                    </button>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};