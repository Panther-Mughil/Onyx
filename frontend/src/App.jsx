import { useEffect, useState, useRef } from 'react';
import { Server, Settings, X, Cpu, HardDrive, Play, Settings2, Square, Info, Download, Zap, SlidersHorizontal, BookOpen, Activity, Trash2, Network, Plus, Gauge } from 'lucide-react';
import './index.css';

function App() {
  const [backendStatus, setBackendStatus] = useState({ status: 'checking', message: '' });
  const [activeServer, setActiveServer] = useState({ isRunning: false, modelId: null });
  const [logs, setLogs] = useState([]);
  
  // Modals & Navigation
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null); // The model currently selected in the right pane
  const [activeTab, setActiveTab] = useState('load'); // 'info', 'load', 'inference', 'monitoring'
  const [telemetry, setTelemetry] = useState(null);

  const [isServerSettingsOpen, setIsServerSettingsOpen] = useState(false);
  const [serverSettings, setServerSettings] = useState({
    port: 1234,
    networkHost: false,
    cors: true,
    jitModelLoading: false,
    autoUnload: false
  });

  const logsEndRef = useRef(null);

  const [loadingProgress, setLoadingProgress] = useState(0);
  const [appliedConfig, setAppliedConfig] = useState(null);
  const [newRpcInput, setNewRpcInput] = useState("");
  const [benchmarkStatus, setBenchmarkStatus] = useState({ isRunning: false, logs: [], pp: null, tg: null });

  const [config, setConfig] = useState({
    ctxSize: 2048,
    gpuLayers: 28,
    threads: 4,
    evalBatchSize: 4096,
    physicalBatchSize: 1024,
    concurrency: 1,
    unifiedKv: true,
    offloadKv: true,
    keepInMemory: true,
    mmap: true,
    flashAttention: false,
    kCacheQuant: 'f16',
    vCacheQuant: 'f16',
    cpuMoe: false,
    rpcServers: []
  });

  const fetchStatusAndLogs = () => {
    fetch('http://127.0.0.1:3001/api/server/status')
      .then(res => res.json())
      .then(data => {
         setActiveServer({ isRunning: data.is_running, modelId: data.model_id, isReady: data.is_ready });
         if (data.is_running) {
             setAppliedConfig(prev => prev || { ...config });
         } else {
             setAppliedConfig(null);
         }
      })
      .catch(() => {});

    fetch('http://127.0.0.1:3001/api/server/logs')
      .then(res => res.json())
      .then(data => setLogs(data))
      .catch(() => {});
  };

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
  }, [logs]);

  useEffect(() => {
    let interval;
    if (activeServer.isRunning && !activeServer.isReady) {
      setLoadingProgress(0);
      interval = setInterval(() => {
        setLoadingProgress(prev => {
          const remaining = 99 - prev;
          const step = remaining > 20 ? 8 : (remaining > 5 ? 2 : 0.5);
          return Math.min(99.9, prev + step);
        });
      }, 500);
    } else if (activeServer.isReady) {
      setLoadingProgress(100);
    } else {
      setLoadingProgress(0);
    }
    return () => clearInterval(interval);
  }, [activeServer.isRunning, activeServer.isReady]);

  useEffect(() => {
    let interval;
    if (activeTab === 'monitoring') {
       const fetchTelemetry = () => {
           fetch('http://127.0.0.1:3001/api/server/telemetry')
             .then(res => res.json())
             .then(data => setTelemetry(data))
             .catch(() => {});
       };
       fetchTelemetry();
       interval = setInterval(fetchTelemetry, 1000);
    }
    return () => clearInterval(interval);
  }, [activeTab]);

  useEffect(() => {
    let interval;
    if (activeTab === 'benchmark') {
       const fetchBench = () => {
         fetch('http://127.0.0.1:3001/api/server/benchmark/status')
           .then(res => res.json())
           .then(data => setBenchmarkStatus({ isRunning: data.is_running, logs: data.logs, pp: data.pp, tg: data.tg }))
           .catch(() => {});
       };
       fetchBench();
       interval = setInterval(fetchBench, 1000);
    }
    return () => clearInterval(interval);
  }, [activeTab]);

  // Auto-restore selected model on page refresh if a model is currently running
  useEffect(() => {
    if (!selectedModel && activeServer.isRunning && activeServer.modelId && models.length > 0) {
      const model = models.find(m => m.id === activeServer.modelId);
      if (model) {
        setSelectedModel(model);
      }
    }
  }, [selectedModel, activeServer.isRunning, activeServer.modelId, models]);

  // Hot-swap network proxy whenever server settings change
  useEffect(() => {
    fetch('http://127.0.0.1:3001/api/server/network', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serverSettings)
    }).catch(err => console.error("Failed to update network proxy", err));
  }, [serverSettings]);

  const handleConfigChange = (e) => {
    const { name, value, type, checked } = e.target;
    setConfig(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : (type === 'number' || type === 'range' ? Number(value) : value)
    }));
  };

  // Toggle helper
  const handleToggle = (name) => {
    setConfig(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const isConfigDirty = () => {
    if (!appliedConfig) return false;
    return JSON.stringify(config) !== JSON.stringify(appliedConfig);
  };

  const handleAddRpc = () => {
    if (!newRpcInput.trim()) return;
    setConfig(prev => ({
      ...prev,
      rpcServers: [...prev.rpcServers, { address: newRpcInput.trim(), active: false }]
    }));
    setNewRpcInput("");
  };

  const handleStartServer = async () => {
    if (!selectedModel) return;
    try {
      const response = await fetch('http://127.0.0.1:3001/api/server/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: selectedModel.id, ...config })
      });
      const result = await response.json();
      if (!result.success) {
        alert("Error starting server: " + result.message);
      } else {
        setAppliedConfig({ ...config });
      }
    } catch (err) {
      alert("Failed to reach backend.");
    }
  };

  const handleStopServer = async () => {
    try {
      await fetch('http://127.0.0.1:3001/api/server/stop', { method: 'POST' });
      setAppliedConfig(null);
    } catch(e) { console.error(e); }
  };

  const handleClearLogs = async () => {
    setLogs([]);
    try {
      await fetch('http://127.0.0.1:3001/api/server/logs/clear', { method: 'POST' });
    } catch(e) { console.error(e); }
  };

  const formatLog = (line) => {
    if (line.includes(" W ")) return "log-warn";
    if (line.includes(" E ") || line.includes("error")) return "log-err";
    if (line.includes(" I ")) return "log-info";
    return "";
  };

  // Find the details of the active model
  const activeModelDetails = activeServer.isRunning ? models.find(m => m.id === activeServer.modelId) : null;

  return (
    <div className="app-container">
      
      {/* Top Navbar */}
      <div className="top-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-input)', padding: '4px 12px', borderRadius: '16px', fontSize: '12px' }}>
            Status: {activeServer.isRunning ? 'Running' : 'Stopped'}
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: activeServer.isRunning ? 'var(--ready-green)' : 'var(--border-color)', marginLeft: '4px' }}></div>
          </div>
          <button className="secondary-btn" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setIsServerSettingsOpen(true)}>
            <Settings2 size={14} /> Server Settings
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {activeServer.isRunning ? `Server running on ${serverSettings.networkHost ? '0.0.0.0' : '127.0.0.1'}:${serverSettings.port}` : 'Server not running'}
          </span>
          <button className="primary-btn" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setIsModalOpen(true)}>
            + Load Model
          </button>
        </div>
      </div>

      {/* Main Split View */}
      <div className="main-content">
        
        {/* LEFT PANE: Loaded Models & Developer Logs */}
        <div className="left-pane">
          <div>
            <h3 style={{ fontSize: '14px', marginBottom: '12px', fontWeight: '600' }}>Loaded Models</h3>
            <div className="box" style={{ padding: '16px', minHeight: '100px' }}>
              {activeModelDetails ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ 
                        border: `1px solid ${activeServer.isReady ? 'var(--ready-green)' : '#eab308'}`, 
                        color: activeServer.isReady ? 'var(--ready-green)' : '#eab308', 
                        padding: '2px 8px', 
                        borderRadius: '4px', 
                        fontSize: '10px', 
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                      {!activeServer.isReady && (
                         <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                      )}
                      {activeServer.isReady ? 'READY' : 'LOADING...'}
                    </div>

                    {!activeServer.isReady && (
                      <div style={{ fontSize: '11px', color: '#eab308', fontWeight: 'bold', fontFamily: 'monospace' }}>
                        {Math.floor(loadingProgress)}%
                      </div>
                    )}
                  </div>

                  {!activeServer.isReady && (
                    <div style={{ width: '100%', height: '4px', background: 'var(--bg-input)', borderRadius: '2px', overflow: 'hidden', marginTop: '-4px', marginBottom: '4px' }}>
                       <div style={{ width: `${loadingProgress}%`, height: '100%', background: '#eab308', transition: 'width 0.5s ease-out' }}></div>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ color: 'var(--accent)', fontWeight: '600', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>llm</span> {activeModelDetails.name}
                    </div>
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Size <strong style={{color: 'var(--text-main)', marginLeft: '4px'}}>{activeModelDetails.size_gb.toFixed(2)} GB</strong></span>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Parallel <strong style={{color: 'var(--text-main)', marginLeft: '4px'}}>1</strong></span>
                      <button className="secondary-btn" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={handleStopServer}>
                        <Square size={14} /> Eject
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', paddingTop: '24px' }}>No models currently loaded.</div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginTop: '24px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ display: 'flex', gap: '16px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: '600' }}>Developer Logs</h3>
              </div>
              <button className="secondary-btn" onClick={handleClearLogs} style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Trash2 size={12} /> Clear Logs
              </button>
            </div>
            <div className="terminal">
              {logs.map((l, i) => <div key={i} className={`log-line ${formatLog(l)}`}>{l}</div>)}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>

        {/* RIGHT PANE: Side panel for configuration */}
        <div className="right-pane">
          {/* Header */}
          <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <Cpu size={20} color="var(--text-muted)" />
            <h2 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>
              {selectedModel ? selectedModel.name : 'System & Settings'}
            </h2>
          </div>
          
          {/* Tabs */}
          <div className="tab-header">
            <div className={`tab-btn ${activeTab === 'info' ? 'active' : ''}`} onClick={() => setActiveTab('info')} title="Info">
              <Info size={16} /> <span className="tab-label">Info</span>
            </div>
            <div className={`tab-btn ${activeTab === 'load' ? 'active' : ''}`} onClick={() => setActiveTab('load')} title="Options">
              <SlidersHorizontal size={16} /> <span className="tab-label">Options</span>
            </div>
            <div className={`tab-btn ${activeTab === 'rpc' ? 'active' : ''}`} onClick={() => setActiveTab('rpc')} title="RPC Workers">
              <Network size={16} /> <span className="tab-label">RPC</span>
            </div>
            <div className={`tab-btn ${activeTab === 'inference' ? 'active' : ''}`} onClick={() => setActiveTab('inference')} title="Inference">
              <Zap size={16} /> <span className="tab-label">Inference</span>
            </div>
            <div className={`tab-btn ${activeTab === 'monitoring' ? 'active' : ''}`} onClick={() => setActiveTab('monitoring')} title="Monitoring">
              <Activity size={16} /> <span className="tab-label">Monitoring</span>
            </div>
            <div className={`tab-btn ${activeTab === 'benchmark' ? 'active' : ''}`} onClick={() => setActiveTab('benchmark')} title="Benchmark">
              <Gauge size={16} /> <span className="tab-label">Benchmark</span>
            </div>
          </div>

          {/* Tab Contents */}
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
                    <div className="info-row"><span>Domain</span> <span style={{background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '12px'}}>llm</span></div>
                    <div className="info-row"><span>Size on disk</span> <span style={{background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '12px'}}>{selectedModel.size_gb.toFixed(2)} GB</span></div>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Select a model from the top menu to view information.</div>
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
                        <input type="number" className="num-input" name="ctxSize" value={config.ctxSize} onChange={handleConfigChange} />
                      </div>
                      <input type="range" className="range-slider" min="256" max="128000" step="256" name="ctxSize" value={config.ctxSize} onChange={handleConfigChange} />
                    </div>

                    <div>
                      <div className="form-row">
                        <span>GPU Offload</span>
                        <input type="number" className="num-input" name="gpuLayers" value={config.gpuLayers} onChange={handleConfigChange} />
                      </div>
                      <input type="range" className="range-slider" min="0" max="99" name="gpuLayers" value={config.gpuLayers} onChange={handleConfigChange} />
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px', display: 'flex', gap: '8px' }}>
                        <Info size={14}/> <span>Model offload limited to dedicated GPU memory.</span>
                      </div>
                    </div>
                  </div>

                  <div className="form-section">
                    <div className="form-section-title"><BookOpen size={16}/> Advanced</div>
                    
                    <div className="form-row" style={{marginBottom: '16px'}}>
                      <span>CPU Thread Pool Size</span>
                      <input type="number" className="num-input" name="threads" value={config.threads} onChange={handleConfigChange} />
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
                  </div>
                </>
              ) : (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Select a model from the top menu to configure load settings.</div>
              )
            )}

            {activeTab === 'inference' && (
              selectedModel ? (
                <>
                  <div className="form-section">
                    <div className="form-section-title"><Settings size={16}/> Settings</div>
                    <div style={{ marginBottom: '20px' }}>
                      <div className="form-row">
                        <span>Temperature</span>
                        <input type="number" className="num-input" defaultValue="0.1" step="0.1" />
                      </div>
                      <input type="range" className="range-slider" min="0" max="2" step="0.1" defaultValue="0.1" />
                    </div>
                    
                    <div className="form-row" style={{marginBottom: '16px'}}>
                      <span>Limit Response Length</span>
                      <div className="toggle-switch" ></div>
                    </div>
                  </div>

                  <div className="form-section">
                    <div className="form-section-title"><SlidersHorizontal size={16}/> Sampling</div>
                    <div className="form-row" style={{marginBottom: '16px'}}>
                      <span>Top K Sampling</span>
                      <input type="number" className="num-input" defaultValue="40" />
                    </div>
                    <div className="form-row" style={{marginBottom: '16px'}}>
                      <span>Repeat Penalty</span>
                      <input type="number" className="num-input" defaultValue="1.1" step="0.1" />
                    </div>
                    <div className="form-row" style={{marginBottom: '16px'}}>
                      <span>Top P Sampling</span>
                      <input type="number" className="num-input" defaultValue="0.95" step="0.05" />
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Select a model from the top menu to view inference settings.</div>
              )
            )}

            {activeTab === 'rpc' && (
              selectedModel ? (
                <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div className="form-section">
                    <div className="form-section-title"><Network size={16}/> RPC Workers</div>
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

                    {config.rpcServers.length === 0 ? (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px', fontSize: '12px' }}>No RPC workers added yet.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {config.rpcServers.map((server, idx) => (
                          <div key={idx} className="form-row" style={{ background: 'var(--bg-input)', padding: '8px 12px', borderRadius: '6px', marginBottom: 0 }}>
                            <span style={{ color: 'var(--text-main)' }}>{server.address}</span>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                              <div className={`toggle-switch ${server.active ? 'active' : ''}`} onClick={() => {
                                const newServers = [...config.rpcServers];
                                newServers[idx] = { ...newServers[idx], active: !newServers[idx].active };
                                setConfig({ ...config, rpcServers: newServers });
                              }}></div>
                              <button style={{ background: 'transparent', color: 'var(--danger)', display: 'flex' }} onClick={() => {
                                const newServers = config.rpcServers.filter((_, i) => i !== idx);
                                setConfig({ ...config, rpcServers: newServers });
                              }}>
                                <X size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Select a model to configure RPC workers.</div>
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
                        setBenchmarkStatus(prev => ({ ...prev, logs: [] }));
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
                    {/* CPU Card */}
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

                    {/* RAM Card */}
                    <div className="box" style={{ padding: '16px' }}>
                       <h4 style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: 'var(--text-main)' }}><HardDrive size={16}/> System RAM</h4>
                       <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div className="info-row" style={{ padding: '4px 0' }}><span>Total Memory</span> <span>{telemetry.ram_total_gb.toFixed(2)} GB</span></div>
                          <div className="info-row" style={{ padding: '4px 0' }}><span>Available Memory</span> <span>{(telemetry.ram_total_gb - telemetry.ram_used_gb).toFixed(2)} GB</span></div>
                          <div className="info-row" style={{ padding: '4px 0', borderBottom: 'none' }}><span>Used Memory</span> <span>{telemetry.ram_used_gb.toFixed(2)} GB</span></div>
                       </div>
                    </div>

                    {/* GPU Cards */}
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

          {/* Start Server Button */}
          {(activeTab === 'load' || activeTab === 'rpc') && selectedModel && (
            (!activeServer.isRunning) ? (
              <div style={{ padding: '16px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-main)' }}>
                <button className="primary-btn" style={{ width: '100%', padding: '12px' }} onClick={handleStartServer}>
                  Load Model
                </button>
              </div>
            ) : (isConfigDirty() ? (
              <div style={{ padding: '16px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-main)' }}>
                <button className="primary-btn" style={{ width: '100%', padding: '12px', background: 'var(--accent-hover)' }} onClick={handleStartServer}>
                  Reload to Apply Changes
                </button>
              </div>
            ) : null)
          )}
        </div>
      </div>

      {/* Model Selection Modal */}
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
                  <div key={model.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer' }} onClick={() => { setSelectedModel(model); setIsModalOpen(false); setActiveTab('load'); }}>
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

      {/* Server Settings Modal */}
      {isServerSettingsOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="box" style={{ width: '450px', background: 'var(--bg-main)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '600' }}>Server Settings</h2>
              <button style={{ background: 'transparent', color: 'var(--text-muted)' }} onClick={() => setIsServerSettingsOpen(false)}>
                <X size={20} />
              </button>
            </div>
            
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-row">
                <span>Server Port</span>
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
                    setServerSettings({...serverSettings, port: val === "" ? "" : val});
                  }} 
                />
              </div>

              <div className="form-row" style={{ alignItems: 'flex-start' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span>Host on Local Network</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{serverSettings.networkHost ? '0.0.0.0 (Exposed to network)' : '127.0.0.1 (Localhost only)'}</span>
                </span>
                <div className={`toggle-switch ${serverSettings.networkHost ? 'active' : ''}`} onClick={() => setServerSettings({...serverSettings, networkHost: !serverSettings.networkHost})}></div>
              </div>

              <div className="form-row">
                <span>Enable CORS</span>
                <div className={`toggle-switch ${serverSettings.cors ? 'active' : ''}`} onClick={() => setServerSettings({...serverSettings, cors: !serverSettings.cors})}></div>
              </div>

              <div className="form-row">
                <span>Just-in-Time model loading</span>
                <div className={`toggle-switch ${serverSettings.jitModelLoading ? 'active' : ''}`} onClick={() => setServerSettings({...serverSettings, jitModelLoading: !serverSettings.jitModelLoading})}></div>
              </div>

              <div className="form-row">
                <span>Auto unload model when unused</span>
                <div className={`toggle-switch ${serverSettings.autoUnload ? 'active' : ''}`} onClick={() => setServerSettings({...serverSettings, autoUnload: !serverSettings.autoUnload})}></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
