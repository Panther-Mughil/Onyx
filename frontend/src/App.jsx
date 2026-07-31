import { useEffect, useState, useRef } from 'react';
import { Square, Settings, Cpu, HardDrive, Info, Activity, SlidersHorizontal, Settings2, Trash2, X, Zap, Network, Plus, Gauge, BookOpen, Power } from 'lucide-react';
import './index.css';

const OnyxLogo = ({ size = 20, color = "#22d3ee" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 12l10 10 10-10Z" />
    <path d="M2 12h20" />
    <path d="M12 2v20" />
  </svg>
);

function App() {
  const [backendStatus, setBackendStatus] = useState({ status: 'checking', message: '' });
  const [activeServers, setActiveServers] = useState([]); // Array of { modelId, port, isReady }
  const [logs, setLogs] = useState([]);
  
  // Modals & Navigation
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null); 
  const [activeTab, setActiveTab] = useState('load'); 
  const [telemetry, setTelemetry] = useState(null);

  const [isServerSettingsOpen, setIsServerSettingsOpen] = useState(false);
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);
  const [serverSettings, setServerSettings] = useState({
    port: 1234,
    networkHost: false,
    cors: true,
    jitModelLoading: false,
    autoUnload: false,
    rpcServers: []
  });

  const [isProxyRunning, setIsProxyRunning] = useState(true);
  const [systemLogs, setSystemLogs] = useState([]);

  const saveSettings = (newSettings) => {
    setServerSettings(newSettings);
    fetch('http://127.0.0.1:3001/api/settings/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings)
    }).catch(() => {});
  };

  const handleSelectModel = (model) => {
    setSelectedModel(model);
    if (model) {
      const applied = serverSettings.appliedConfigs?.[model.id];
      const savedConfig = serverSettings.savedModelConfigs?.[model.id];
      
      if (applied) {
        setConfig(applied);
        setRememberSettings(!!savedConfig);
      } else if (savedConfig) {
        setConfig(savedConfig);
        setRememberSettings(true);
      } else {
        setConfig(initialConfig);
        setRememberSettings(false);
      }
    }
  };

  const toggleProxy = () => {
    if (isProxyRunning) {
      fetch('http://127.0.0.1:3001/api/server/proxy/stop', { method: 'POST' })
        .then(() => setIsProxyRunning(false))
        .catch(() => {});
    } else {
      fetch('http://127.0.0.1:3001/api/server/network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: serverSettings.port, networkHost: serverSettings.networkHost })
      }).then(() => setIsProxyRunning(true)).catch(() => {});
    }
  };

  const logsEndRef = useRef(null);

  const appliedConfigs = serverSettings.appliedConfigs || {};
  const savedModelConfigs = serverSettings.savedModelConfigs || {};
  const [newRpcInput, setNewRpcInput] = useState("");
  const [benchmarkStatus, setBenchmarkStatus] = useState({ isRunning: false, logs: [], pp: null, tg: null });

  const initialConfig = {
    ctxSize: 2048,
    gpuLayers: 28,
    threads: navigator.hardwareConcurrency || 4,
    evalBatchSize: 2048,
    physicalBatchSize: 512,
    concurrency: 1,
    unifiedKv: true,
    offloadKv: true,
    keepInMemory: true,
    mmap: true,
    flashAttention: false,
    kCacheQuant: 'f16',
    vCacheQuant: 'f16',
    cpuMoe: false,
    localGpus: []
  };

  const [config, setConfig] = useState(initialConfig);
  const [rememberSettings, setRememberSettings] = useState(false);


  const fetchStatusAndLogs = () => {
    fetch('http://127.0.0.1:3001/api/server/status')
      .then(res => res.json())
      .then(data => {
         setActiveServers(data.servers || []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (selectedModel) {
      fetch(`http://127.0.0.1:3001/api/server/logs?modelId=${selectedModel.id}`, { cache: 'no-store' })
        .then(res => res.json())
        .then(data => setLogs(data))
        .catch(() => {});
    } else {
      setLogs([]);
    }
  }, [selectedModel, activeServers]);

  useEffect(() => {
    if (selectedModel) {
      setConfig(prev => {
        let newConfig = { ...prev };
        let updated = false;
        if (selectedModel.context_length && newConfig.ctxSize > selectedModel.context_length) {
          newConfig.ctxSize = selectedModel.context_length;
          updated = true;
        }
        if (selectedModel.block_count && newConfig.gpuLayers > selectedModel.block_count) {
          newConfig.gpuLayers = selectedModel.block_count;
          updated = true;
        }
        return updated ? newConfig : prev;
      });
    }
  }, [selectedModel]);

  useEffect(() => {
    if (telemetry && telemetry.gpus && (!config.localGpus || config.localGpus.length === 0)) {
        const initGpus = telemetry.gpus.map((g, i) => ({ index: i, name: g.name, active: true }));
        setConfig(prev => ({ ...prev, localGpus: initGpus }));
    }
  }, [telemetry]);
  useEffect(() => {
    fetch('http://127.0.0.1:3001/api/settings')
      .then(res => res.json())
      .then(data => {
        if (Object.keys(data).length > 0) {
          setServerSettings(prev => ({ ...prev, ...data }));
        }
      })
      .catch(() => {})
      .finally(() => setHasLoadedSettings(true));
  }, []);

  useEffect(() => {
    if (!selectedModel) {
      fetch('http://127.0.0.1:3001/api/system/logs', { cache: 'no-store' })
        .then(res => res.json())
        .then(data => setSystemLogs(data))
        .catch(() => {});
    }
  }, [selectedModel, activeServers]);
 // Refresh logs periodically with status poll implicitly

  useEffect(() => {
    fetch('http://127.0.0.1:3001/health')
      .then((res) => res.json())
      .then((data) => setBackendStatus(data))
      .catch(() => setBackendStatus({ status: 'error', message: 'Offline' }));

    fetch('http://127.0.0.1:3001/api/models')
      .then(res => res.json())
      .then(data => setModels(data))
      .catch(err => console.error(err));

    fetchStatusAndLogs();
    const interval = setInterval(fetchStatusAndLogs, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, systemLogs]);

  useEffect(() => {
    const fetchTelemetry = () => {
        fetch('http://127.0.0.1:3001/api/server/telemetry', { cache: 'no-store' })
          .then(res => res.json())
          .then(data => setTelemetry(data))
          .catch(() => {});
    };
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let interval;
    if (activeTab === 'benchmark') {
       const fetchBench = () => {
         fetch('http://127.0.0.1:3001/api/server/benchmark/status', { cache: 'no-store' })
           .then(res => res.json())
           .then(data => setBenchmarkStatus({ isRunning: data.is_running, logs: data.logs, pp: data.pp, tg: data.tg }))
           .catch(() => {});
       };
       fetchBench();
       interval = setInterval(fetchBench, 1000);
    }
    return () => clearInterval(interval);
  }, [activeTab]);

  useEffect(() => {
    fetch('http://127.0.0.1:3001/api/server/network', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: serverSettings.port, networkHost: serverSettings.networkHost })
    }).catch(err => console.error("Failed to update network proxy", err));
  }, [serverSettings.port, serverSettings.networkHost]);

  const handleConfigChange = (e) => {
    const { name, value, type, checked } = e.target;
    setConfig(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : (type === 'number' || type === 'range' ? Number(value) : value)
    }));
    setRememberSettings(false);
  };

  const handleToggle = (name) => {
    setConfig(prev => ({ ...prev, [name]: !prev[name] }));
    setRememberSettings(false);
  };

  const isConfigDirty = () => {
    if (!selectedModel || !appliedConfigs[selectedModel.id]) return false;
    const current = config;
    const applied = appliedConfigs[selectedModel.id];
    
    // Deep equality check ignoring key order
    const keys1 = Object.keys(current);
    const keys2 = Object.keys(applied);
    
    if (keys1.length !== keys2.length) return true;
    
    for (let key of keys1) {
      if (typeof current[key] === 'object' && current[key] !== null) {
        if (JSON.stringify(current[key]) !== JSON.stringify(applied[key])) return true;
      } else if (current[key] !== applied[key]) {
        return true;
      }
    }
    return false;
  };

  const handleAddRpc = () => {
    if (!newRpcInput.trim()) return;
    saveSettings({
      ...serverSettings,
      rpcServers: [...(serverSettings.rpcServers || []), { address: newRpcInput.trim(), active: false }]
    });
    setNewRpcInput("");
  };

  const handleStartServer = async () => {
    if (!selectedModel) return;
    try {
      const newSavedConfigs = { ...savedModelConfigs };
      if (rememberSettings) {
        newSavedConfigs[selectedModel.id] = config;
      } else {
        delete newSavedConfigs[selectedModel.id];
      }

      const newAppliedConfigs = { ...appliedConfigs, [selectedModel.id]: config };

      const response = await fetch('http://127.0.0.1:3001/api/server/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: selectedModel.id, ...config, rpcServers: serverSettings.rpcServers || [] })
      });
      const result = await response.json();
      if (!result.success) {
        alert("Error starting server: " + result.message);
      } else {
        saveSettings({
          ...serverSettings,
          savedModelConfigs: newSavedConfigs,
          appliedConfigs: newAppliedConfigs
        });
      }
    } catch (err) {
      alert("Failed to reach backend.");
    }
  };

  const handleStopServer = async (modelId) => {
    try {
      await fetch('http://127.0.0.1:3001/api/server/stop', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId })
      });
      
      const nextApplied = { ...appliedConfigs };
      delete nextApplied[modelId];
      saveSettings({
        ...serverSettings,
        appliedConfigs: nextApplied
      });
      if (selectedModel && selectedModel.id === modelId) {
        handleSelectModel(null);
      }
    } catch(e) { console.error(e); }
  };

  const handleClearLogs = async () => {
    if (!selectedModel) {
      try {
        const res = await fetch('http://127.0.0.1:3001/api/system/logs/clear', { method: 'POST' });
        if (res.ok) {
           setSystemLogs([]);
        } else {
           alert("Failed to clear system logs! This usually means your backend is running an old version. Please close the terminal and run start.bat again.");
        }
      } catch(e) { console.error(e); }
      return;
    }
    setLogs([]);
    try {
      await fetch('http://127.0.0.1:3001/api/server/logs/clear', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: selectedModel.id })
      });
    } catch(e) { console.error(e); }
  };

  const formatLog = (line) => {
    if (line.includes(" W ")) return "log-warn";
    if (line.includes(" E ") || line.includes("error")) return "log-err";
    if (line.includes(" I ")) return "log-info";
    return "";
  };

  const isModelRunning = selectedModel ? activeServers.some(s => s.modelId === selectedModel.id) : false;

  if (!hasLoadedSettings) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-main)' }}>
        <svg className="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
      </div>
    );
  }

  return (
    <div className="app-container">
      
      {/* Top Navbar */}
      <div className="top-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', userSelect: 'none', marginRight: '8px' }}>
            <OnyxLogo size={22} />
            <span style={{ fontSize: '16px', fontWeight: '800', letterSpacing: '0.5px' }}>Onyx</span>
          </div>

          <div style={{ width: '1px', height: '20px', background: 'var(--border-color)' }}></div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-input)', padding: '4px 12px', borderRadius: '16px', fontSize: '12px' }}>
            <button 
              className="icon-btn" 
              style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', color: isProxyRunning ? 'var(--ready-green)' : 'var(--text-muted)' }}
              onClick={toggleProxy}
              title={isProxyRunning ? 'Stop Master Gateway' : 'Start Master Gateway'}
            >
              <Power size={14} /> 
              {isProxyRunning ? 'Gateway: Running' : 'Gateway: Stopped'}
            </button>
            <div style={{ width: '1px', height: '14px', background: 'var(--border-color)' }}></div>
            Active Models: {activeServers.length}
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: activeServers.length > 0 ? 'var(--ready-green)' : 'var(--border-color)', marginLeft: '4px' }}></div>
          </div>
          <button className="secondary-btn" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setIsServerSettingsOpen(true)}>
            <Settings2 size={14} /> Global Settings
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="primary-btn" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setIsModalOpen(true)}>
            + Load New Model
          </button>
        </div>
      </div>

      {/* Main Split View */}
      <div className="main-content">
        
        {/* LEFT PANE */}
        <div className="left-pane" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: '1 1 60%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <h3 style={{ fontSize: '14px', marginBottom: '12px', fontWeight: '600', flexShrink: 0 }}>Loaded Models</h3>
            <div className="box" style={{ padding: '16px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {activeServers.length > 0 ? (
                activeServers.map(server => {
                  const modelDetails = models.find(m => m.id === server.modelId);
                  if (!modelDetails) return null;
                  const isSelected = selectedModel && selectedModel.id === server.modelId;
                  
                  return (
                    <div key={server.modelId} style={{ 
                        border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border-color)', 
                        padding: '16px', 
                        borderRadius: '12px',
                        background: isSelected ? 'rgba(34, 211, 238, 0.05)' : 'var(--bg-input)',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                    }} onClick={() => { 
                      if (isSelected) {
                        handleSelectModel(null);
                      } else {
                        handleSelectModel(modelDetails); 
                        setActiveTab('load'); 
                      }
                    }}>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <div style={{ 
                            border: `1px solid ${server.isReady ? 'var(--ready-green)' : '#eab308'}`, 
                            color: server.isReady ? 'var(--ready-green)' : '#eab308', 
                            padding: '2px 8px', 
                            borderRadius: '4px', 
                            fontSize: '10px', 
                            fontWeight: 'bold',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}>
                          {!server.isReady && (
                             <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                          )}
                          {server.isReady ? 'READY' : 'LOADING...'}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Port: <strong>{server.port}</strong></div>
                      </div>

                      {!server.isReady && (
                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)' }}>
                            <span>Loading weights...</span>
                            <span>{server.progress > 0 ? `${Math.floor(server.progress)}%` : 'Allocating...'}</span>
                          </div>
                          <div style={{ width: '100%', height: '4px', background: 'var(--bg-main)', borderRadius: '2px', overflow: 'hidden' }}>
                            {server.progress > 0 ? (
                              <div style={{ width: `${server.progress}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.5s ease-out' }}></div>
                            ) : (
                              <div className="indeterminate-progress"></div>
                            )}
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ color: 'var(--text-main)', fontWeight: '600', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ color: 'var(--accent)' }}>llm</span> {modelDetails.name}
                        </div>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Size <strong style={{color: 'var(--text-main)', marginLeft: '4px'}}>{modelDetails.size_gb.toFixed(2)} GB</strong></span>
                          <button className="secondary-btn" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={(e) => { e.stopPropagation(); handleStopServer(server.modelId); }}>
                            <Square size={14} /> Eject
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--border-color)', gap: '16px' }}>
                  <OnyxLogo size={80} color="var(--border-color)" />
                  <div style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: '500' }}>No active engines. Select a model to begin.</div>
                </div>
              )}
            </div>
          </div>

          <div style={{ flex: '1 1 40%', display: 'flex', flexDirection: 'column', marginTop: '24px', minHeight: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ display: 'flex', gap: '16px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: '600' }}>Developer Logs {selectedModel ? `(${selectedModel.name})` : ''}</h3>
              </div>
              <button className="secondary-btn" onClick={handleClearLogs} style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Trash2 size={12} /> Clear Logs
              </button>
            </div>
            <div className="terminal">
              {!selectedModel ? (
                 systemLogs.length === 0 ? 
                   <div style={{ color: 'var(--text-muted)' }}>System logs empty...</div> :
                   systemLogs.map((l, i) => <div key={i} className={`log-line ${formatLog(l)}`}>{l}</div>)
              ) : (
                 logs.map((l, i) => <div key={i} className={`log-line ${formatLog(l)}`}>{l}</div>)
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>

        {/* RIGHT PANE */}
        <div className="right-pane">
          <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <Cpu size={20} color="var(--text-muted)" />
            <h2 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>
              {selectedModel ? selectedModel.name : 'System & Settings'}
            </h2>
          </div>
          
          <div className="tab-header">
            <div className={`tab-btn ${activeTab === 'info' ? 'active' : ''}`} onClick={() => setActiveTab('info')} title="Info">
              <Info size={16} /> <span className="tab-label">Info</span>
            </div>
            <div className={`tab-btn ${activeTab === 'load' ? 'active' : ''}`} onClick={() => setActiveTab('load')} title="Options">
              <SlidersHorizontal size={16} /> <span className="tab-label">Options</span>
            </div>
            <div className={`tab-btn ${activeTab === 'rpc' ? 'active' : ''}`} onClick={() => setActiveTab('rpc')} title="Devices">
              <Network size={16} /> <span className="tab-label">Devices</span>
            </div>
            <div className={`tab-btn ${activeTab === 'monitoring' ? 'active' : ''}`} onClick={() => setActiveTab('monitoring')} title="Monitoring">
              <Activity size={16} /> <span className="tab-label">Monitoring</span>
            </div>
            <div className={`tab-btn ${activeTab === 'benchmark' ? 'active' : ''}`} onClick={() => setActiveTab('benchmark')} title="Benchmark">
              <Gauge size={16} /> <span className="tab-label">Benchmark</span>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            
            {activeTab === 'info' && (
              selectedModel ? (
                <div style={{ padding: '16px' }}>
                  <div className="form-section-title"><Info size={16}/> Model Information</div>
                  <div style={{ background: 'var(--bg-input)', borderRadius: '8px', padding: '0 16px' }}>
                    <div className="info-row"><span>Model</span> <span style={{background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '12px'}}>{selectedModel.name}</span></div>
                    <div className="info-row"><span>File</span> <span style={{background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '12px'}}>{selectedModel.id.substring(0, 20)}...</span></div>
                    <div className="info-row"><span>Format</span> <span style={{background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '12px'}}>GGUF</span></div>
                    <div className="info-row"><span>Quantization</span> <span style={{background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '12px'}}>{selectedModel.quantization}</span></div>

                    <div className="info-row"><span>Size on disk</span> <span style={{background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '12px'}}>{selectedModel.size_gb.toFixed(2)} GB</span></div>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Select a model from the top menu or loaded models to view information.</div>
              )
            )}

            {activeTab === 'load' && (
              selectedModel ? (
                <>
                  <div className="form-section">
                    <div className="form-section-title"><Settings size={16}/> Context and Offload</div>
                    
                    <div style={{ marginBottom: '20px' }}>
                      <div className="form-row">
                        <span>Context Length</span>
                        <input type="number" className="num-input" name="ctxSize" value={config.ctxSize} max={selectedModel?.context_length || 128000} onChange={handleConfigChange} />
                      </div>
                      <input type="range" className="range-slider" min="256" max={selectedModel?.context_length || 128000} step="256" name="ctxSize" value={config.ctxSize} onChange={handleConfigChange} />
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                        Maximum context for this model is {selectedModel?.context_length ? selectedModel.context_length : '128000'}.
                      </div>
                    </div>

                    <div>
                      <div className="form-row">
                        <span>GPU Offload (Layers)</span>
                        <input type="number" className="num-input" name="gpuLayers" value={config.gpuLayers} max={selectedModel?.block_count || 99} onChange={handleConfigChange} />
                      </div>
                      <input type="range" className="range-slider" min="0" max={selectedModel?.block_count || 99} name="gpuLayers" value={config.gpuLayers} onChange={handleConfigChange} />
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px', display: 'flex', gap: '8px' }}>
                        <Info size={14}/> <span>Model offload limited to dedicated GPU memory.</span>
                      </div>
                    </div>
                  </div>

                  <div className="form-section">
                    <div className="form-section-title"><BookOpen size={16}/> Advanced</div>
                    
                    <div className="form-row" style={{marginBottom: '16px'}}>
                      <span>CPU Thread Pool Size</span>
                      <input type="number" className="num-input" name="threads" value={config.threads} max={navigator.hardwareConcurrency || 32} onChange={handleConfigChange} />
                    </div>

                    <div className="form-row" style={{marginBottom: '16px'}}>
                      <span>Evaluation Batch Size</span>
                      <input type="number" className="num-input" name="evalBatchSize" value={config.evalBatchSize} onChange={handleConfigChange} />
                    </div>

                    <div className="form-row" style={{marginBottom: '16px'}}>
                      <span>Physical Batch Size</span>
                      <input type="number" className="num-input" name="physicalBatchSize" value={config.physicalBatchSize} onChange={handleConfigChange} />
                    </div>

                    <div className="form-row" style={{marginBottom: '16px'}}>
                      <span>Max Concurrency</span>
                      <input type="number" className="num-input" name="concurrency" value={config.concurrency} onChange={handleConfigChange} />
                    </div>

                    <div className="form-row" style={{marginBottom: '16px'}}>
                      <span>Unified KV Cache</span>
                      <div className={`toggle-switch ${config.unifiedKv ? 'active' : ''}`} onClick={() => handleToggle('unifiedKv')}></div>
                    </div>

                    <div className="form-row" style={{marginBottom: '16px'}}>
                      <span>Offload KV Cache to GPU Memory</span>
                      <div className={`toggle-switch ${config.offloadKv ? 'active' : ''}`} onClick={() => handleToggle('offloadKv')}></div>
                    </div>

                    <div className="form-row" style={{marginBottom: '16px'}}>
                      <span>Keep Model in Memory</span>
                      <div className={`toggle-switch ${config.keepInMemory ? 'active' : ''}`} onClick={() => handleToggle('keepInMemory')}></div>
                    </div>

                    <div className="form-row" style={{marginBottom: '16px'}}>
                      <span>Try mmap()</span>
                      <div className={`toggle-switch ${config.mmap ? 'active' : ''}`} onClick={() => handleToggle('mmap')}></div>
                    </div>

                    <div className="form-row" style={{marginBottom: '16px'}}>
                      <span>Flash Attention</span>
                      <div className={`toggle-switch ${config.flashAttention ? 'active' : ''}`} onClick={() => handleToggle('flashAttention')}></div>
                    </div>

                    <div className="form-row" style={{marginBottom: '16px'}}>
                      <span>K Cache Quantization</span>
                      <select className="select-input" name="kCacheQuant" value={config.kCacheQuant} onChange={handleConfigChange} style={{ width: '140px' }}>
                        <option value="f16">f16 (Disable)</option>
                        <option value="q8_0">q8_0</option>
                        <option value="q4_0">q4_0</option>
                        <option value="q4_1">q4_1</option>
                        <option value="q5_0">q5_0</option>
                        <option value="q5_1">q5_1</option>
                        <option value="iq4_nl">iq4_nl</option>
                      </select>
                    </div>

                    <div className="form-row" style={{marginBottom: '16px'}}>
                      <span>V Cache Quantization</span>
                      <select className="select-input" name="vCacheQuant" value={config.vCacheQuant} onChange={handleConfigChange} style={{ width: '140px' }}>
                        <option value="f16">f16 (Disable)</option>
                        <option value="q8_0">q8_0</option>
                        <option value="q4_0">q4_0</option>
                        <option value="q4_1">q4_1</option>
                        <option value="q5_0">q5_0</option>
                        <option value="q5_1">q5_1</option>
                        <option value="iq4_nl">iq4_nl</option>
                      </select>
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Select a model to configure load settings.</div>
              )
            )}

            {activeTab === 'rpc' && (
              selectedModel ? (
                <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div className="form-section">
                    <h4 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px', marginTop: '4px', color: 'var(--text-main)' }}>GPUs</h4>
                    {(!config.localGpus || config.localGpus.length === 0) ? (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px', fontSize: '12px' }}>No GPUs detected.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '32px' }}>
                        {config.localGpus.map((gpu, idx) => (
                          <div key={idx} className="form-row" style={{ background: 'var(--bg-input)', padding: '8px 12px', borderRadius: '6px', marginBottom: 0 }}>
                            <span style={{ fontSize: '13px', fontWeight: '500' }}>GPU {gpu.index}: <span style={{ color: 'var(--text-muted)' }}>{gpu.name}</span></span>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                              <div className={`toggle-switch ${gpu.active ? 'active' : ''}`} onClick={() => {
                                const newGpus = [...config.localGpus];
                                newGpus[idx] = { ...newGpus[idx], active: !newGpus[idx].active };
                                setConfig({ ...config, localGpus: newGpus });
                                setRememberSettings(false);
                              }}></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <h4 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px', color: 'var(--text-main)' }}>RPC Workers</h4>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>Add remote llama-rpc-server endpoints to distribute inference.</p>
                    
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                      <input 
                        type="text" 
                        className="select-input" 
                        placeholder="e.g. 192.168.1.50:50052" 
                        value={newRpcInput}
                        onChange={(e) => setNewRpcInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddRpc(); }}
                      />
                      <button className="primary-btn" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={handleAddRpc}>
                        <Plus size={14} /> Add
                      </button>
                    </div>
                  <div style={{ marginTop: '8px' }}>
                    {(!serverSettings.rpcServers || serverSettings.rpcServers.length === 0) ? (
                      <div style={{ textAlign: 'center', padding: '16px', border: '1px dashed var(--border)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '13px' }}>
                        No RPC workers added.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {serverSettings.rpcServers.map((server, idx) => (
                          <div key={idx} className="form-row" style={{ background: 'var(--bg-input)', padding: '8px 12px', borderRadius: '6px', marginBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Network size={16} color={server.active ? "var(--primary)" : "var(--text-muted)"} />
                              <span style={{ color: 'var(--text-main)', fontSize: '13px', fontFamily: 'monospace' }}>{server.address}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                              <div className={`toggle-switch ${server.active ? 'active' : ''}`} onClick={() => {
                                const newServers = [...serverSettings.rpcServers];
                                newServers[idx].active = !newServers[idx].active;
                                saveSettings({ ...serverSettings, rpcServers: newServers });
                              }}></div>
                              <button style={{ background: 'transparent', color: 'var(--danger)', display: 'flex', border: 'none', cursor: 'pointer', padding: '4px' }} onClick={() => {
                                const newServers = serverSettings.rpcServers.filter((_, i) => i !== idx);
                                saveSettings({ ...serverSettings, rpcServers: newServers });
                              }}>
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              ) : (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Select a model to configure Devices.</div>
              )
            )}

            {activeTab === 'benchmark' && (
              selectedModel ? (
                <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="form-section-title" style={{ padding: 0, border: 'none' }}><Gauge size={16}/> Hardware Benchmark</div>
                    <button className="primary-btn" disabled={benchmarkStatus.isRunning} onClick={() => {
                      fetch('http://127.0.0.1:3001/api/server/benchmark/start', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...config, modelId: selectedModel.id })
                      }).then(() => {
                        setBenchmarkStatus(prev => ({ ...prev, isRunning: true, logs: [], pp: null, tg: null }));
                      });
                    }}>
                      {benchmarkStatus.isRunning ? 'Running...' : 'Run Benchmark'}
                    </button>
                  </div>
                  
                  <div className="box" style={{ flex: 1, minHeight: '300px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', fontSize: '13px', fontWeight: '600', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      Terminal Output
                      <button style={{ background: 'transparent', color: 'var(--text-muted)', display: 'flex', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => {
                        fetch('http://127.0.0.1:3001/api/server/benchmark/clear', { method: 'POST' });
                        setBenchmarkStatus(prev => ({ ...prev, logs: [], pp: null, tg: null }));
                      }} title="Clear Logs">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="terminal" style={{ margin: 0, borderRadius: '0 0 12px 12px', border: 'none', borderTop: 'none', flex: 1, minHeight: 0 }}>
                      {benchmarkStatus.logs.length === 0 ? (
                        <div style={{ color: '#555' }}>Ready to benchmark...</div>
                      ) : (
                        benchmarkStatus.logs.map((l, i) => <div key={i} className="log-line">{l}</div>)
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '16px' }}>
                    <div className="box" style={{ flex: 1, padding: '20px', textAlign: 'center', background: 'var(--bg-input)' }}>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>Prompt Processing (PP)</div>
                      <div style={{ fontSize: '24px', fontWeight: 'bold', color: benchmarkStatus.pp ? 'var(--ready-green)' : 'var(--text-main)' }}>
                        {benchmarkStatus.pp ? `${benchmarkStatus.pp.toFixed(2)} t/s` : '--'}
                      </div>
                    </div>
                    <div className="box" style={{ flex: 1, padding: '20px', textAlign: 'center', background: 'var(--bg-input)' }}>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>Token Generation (TG)</div>
                      <div style={{ fontSize: '24px', fontWeight: 'bold', color: benchmarkStatus.tg ? 'var(--ready-green)' : 'var(--text-main)' }}>
                        {benchmarkStatus.tg ? `${benchmarkStatus.tg.toFixed(2)} t/s` : '--'}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Select a model to run hardware benchmarks.</div>
              )
            )}

            {activeTab === 'monitoring' && (
              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                
                {!telemetry ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>Fetching telemetry...</div>
                ) : (
                  <>
                    <div className="box" style={{ padding: '16px' }}>
                       <h4 style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: 'var(--text-main)' }}><Cpu size={16}/> {telemetry.cpu_name}</h4>
                       <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                          <div style={{ background: 'var(--bg-input)', padding: '12px', borderRadius: '8px' }}>
                             <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Usage</div>
                             <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{telemetry.cpu_usage_pct.toFixed(1)}%</div>
                          </div>
                          <div style={{ background: 'var(--bg-input)', padding: '12px', borderRadius: '8px' }}>
                             <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Temperature</div>
                             <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{telemetry.cpu_temp_c > 0 ? `${telemetry.cpu_temp_c.toFixed(1)} °C` : 'N/A'}</div>
                          </div>
                       </div>
                    </div>

                    <div className="box" style={{ padding: '16px' }}>
                       <h4 style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: 'var(--text-main)' }}><HardDrive size={16}/> System RAM</h4>
                       <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div className="info-row" style={{ padding: '4px 0' }}><span>Total Memory</span> <span>{telemetry.ram_total_gb.toFixed(2)} GB</span></div>
                          <div className="info-row" style={{ padding: '4px 0' }}><span>Available Memory</span> <span>{(telemetry.ram_total_gb - telemetry.ram_used_gb).toFixed(2)} GB</span></div>
                          <div className="info-row" style={{ padding: '4px 0', borderBottom: 'none' }}><span>Used Memory</span> <span>{telemetry.ram_used_gb.toFixed(2)} GB</span></div>
                       </div>
                    </div>

                    {telemetry.gpus.length === 0 ? (
                       <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>No NVIDIA GPUs detected.</div>
                    ) : (
                      telemetry.gpus.map((gpu, idx) => (
                        <div key={idx} className="box" style={{ padding: '16px' }}>
                           <h4 style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: 'var(--text-main)' }}><Zap size={16}/> {gpu.name}</h4>
                           
                           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                              <div style={{ background: 'var(--bg-input)', padding: '12px', borderRadius: '8px' }}>
                                 <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>GPU Usage</div>
                                 <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{gpu.gpu_usage_pct}%</div>
                              </div>
                              <div style={{ background: 'var(--bg-input)', padding: '12px', borderRadius: '8px' }}>
                                 <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Temperature</div>
                                 <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{gpu.temp_c} °C</div>
                              </div>
                           </div>

                           <div style={{ background: 'var(--bg-input)', padding: '12px', borderRadius: '8px' }}>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>VRAM Usage</div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                 <span style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--accent-hover)' }}>{gpu.vram_used_mb} MB</span>
                                 <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>/ {gpu.vram_total_mb} MB</span>
                              </div>
                              <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '8px', overflow: 'hidden' }}>
                                 <div style={{ width: `${(gpu.vram_used_mb / gpu.vram_total_mb) * 100}%`, height: '100%', background: 'var(--accent-hover)', transition: 'width 0.3s' }}></div>
                              </div>
                           </div>
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {(activeTab === 'load' || activeTab === 'rpc') && selectedModel && !isModelRunning && (
              <div style={{ padding: '16px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-main)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', cursor: 'pointer', width: 'fit-content' }}>
                  <input 
                    type="checkbox" 
                    checked={rememberSettings}
                    onChange={(e) => setRememberSettings(e.target.checked)}
                  />
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Remember model settings</span>
                </label>
                <button 
                  className="primary-btn" 
                  style={{ width: '100%', padding: '12px' }} 
                  onClick={handleStartServer}
                >
                  Load Model
                </button>
              </div>
          )}

          {(activeTab === 'load' || activeTab === 'rpc') && selectedModel && isModelRunning && isConfigDirty() && (
              <div style={{ padding: '16px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-main)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', cursor: 'pointer', width: 'fit-content' }}>
                  <input 
                    type="checkbox" 
                    checked={rememberSettings}
                    onChange={(e) => setRememberSettings(e.target.checked)}
                  />
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Remember model settings</span>
                </label>
                <button 
                  className="primary-btn" 
                  style={{ width: '100%', padding: '12px', background: 'var(--accent-hover)' }} 
                  onClick={handleStartServer}
                >
                  Reload to Apply Changes
                </button>
              </div>
          )}
        </div>
      </div>

      {isModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="box" style={{ width: '600px', maxHeight: '70vh', background: 'var(--bg-main)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '600' }}>Select a Model</h2>
              <button style={{ background: 'transparent', color: 'var(--text-muted)' }} onClick={() => setIsModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            
            <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {models.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>No models found.</div>
              ) : (
                models.map(model => (
                  <div key={model.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer' }} onClick={() => { handleSelectModel(model); setIsModalOpen(false); setActiveTab('load'); }}>
                    <div>
                      <div style={{ fontWeight: '600', marginBottom: '4px' }}>{model.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{model.quantization} • {model.size_gb.toFixed(2)} GB</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {isServerSettingsOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="box" style={{ width: '450px', background: 'var(--bg-main)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '600' }}>Global Proxy Settings</h2>
              <button style={{ background: 'transparent', color: 'var(--text-muted)' }} onClick={() => setIsServerSettingsOpen(false)}>
                <X size={20} />
              </button>
            </div>
            
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-row">
                <span>Proxy Port</span>
                <input 
                  type="number" 
                  min="1" 
                  max="65535" 
                  className="num-input" 
                  value={serverSettings.port} 
                  onChange={(e) => {
                    let val = e.target.value;
                    if (val !== "") {
                      val = Math.max(1, Math.min(65535, Number(val)));
                    }
                    saveSettings({...serverSettings, port: val === "" ? "" : val});
                  }} 
                />
              </div>

              <div className="form-row" style={{ alignItems: 'flex-start' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span>Host on Local Network</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{serverSettings.networkHost ? '0.0.0.0 (Exposed to network)' : '127.0.0.1 (Localhost only)'}</span>
                </span>
                <div className={`toggle-switch ${serverSettings.networkHost ? 'active' : ''}`} onClick={() => saveSettings({...serverSettings, networkHost: !serverSettings.networkHost})}></div>
              </div>

              <div className="form-row">
                <span>Enable CORS</span>
                <div className={`toggle-switch ${serverSettings.cors ? 'active' : ''}`} onClick={() => saveSettings({...serverSettings, cors: !serverSettings.cors})}></div>
              </div>

              <div className="form-row">
                <span style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span>Just-in-Time Model Loading</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Load model into memory only when first prompt is received</span>
                </span>
                <div className={`toggle-switch ${serverSettings.jitModelLoading ? 'active' : ''}`} onClick={() => saveSettings({...serverSettings, jitModelLoading: !serverSettings.jitModelLoading})}></div>
              </div>

              <div className="form-row">
                <span style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span>Auto-Unload Inactive</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Unload model from VRAM after 5 minutes of inactivity</span>
                </span>
                <div className={`toggle-switch ${serverSettings.autoUnload ? 'active' : ''}`} onClick={() => saveSettings({...serverSettings, autoUnload: !serverSettings.autoUnload})}></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
