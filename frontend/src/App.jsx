import { useEffect, useState, useRef } from 'react';
import { Server, Activity, Settings, LayoutDashboard, X, Cpu, HardDrive, ArrowLeft, Play, Settings2, Square, Terminal } from 'lucide-react';
import './index.css';

function App() {
  const [backendStatus, setBackendStatus] = useState({ status: 'checking', message: '' });
  const [activeServer, setActiveServer] = useState({ isRunning: false, modelId: null });
  const [logs, setLogs] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const logsEndRef = useRef(null);

  const [config, setConfig] = useState({
    ctxSize: 4096,
    gpuLayers: 99,
    threads: 4,
    evalBatchSize: 512,
    physicalBatchSize: 512,
    concurrency: 1,
    unifiedKv: true,
    offloadKv: true,
    keepInMemory: false,
    mmap: true,
    flashAttention: false,
    kCacheQuant: 'f16',
    vCacheQuant: 'f16',
    cpuMoe: false
  });

  const fetchStatusAndLogs = () => {
    fetch('http://127.0.0.1:3001/api/server/status')
      .then(res => res.json())
      .then(data => setActiveServer({ isRunning: data.is_running, modelId: data.model_id }))
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

  const handleConfigChange = (e) => {
    const { name, value, type, checked } = e.target;
    setConfig(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : (type === 'number' ? Number(value) : value)
    }));
  };

  const handleStartServer = async () => {
    try {
      const response = await fetch('http://127.0.0.1:3001/api/server/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: selectedModel.id, ...config })
      });
      const result = await response.json();
      if (!result.success) alert("Error starting server: " + result.message);
    } catch (err) {
      alert("Failed to reach backend.");
    }
    setIsModalOpen(false);
    setSelectedModel(null);
  };

  const handleStopServer = async () => {
    try {
      await fetch('http://127.0.0.1:3001/api/server/stop', { method: 'POST' });
    } catch(e) { console.error(e); }
  };

  // Helper for log coloring
  const formatLog = (line) => {
    if (line.includes(" W ")) return "log-warn";
    if (line.includes(" E ") || line.includes("error")) return "log-err";
    if (line.includes(" I ")) return "log-info";
    return "";
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      
      {/* Top Navbar */}
      <header className="glass-header" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: 'var(--accent-color)', padding: '8px', borderRadius: '8px' }}>
            <Server size={20} color="white" />
          </div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: '700', letterSpacing: '0.5px' }}>PANTHER LLM</h1>
          
          <div style={{ marginLeft: '24px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', padding: '6px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: '20px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: backendStatus.status === 'ok' ? 'var(--success-color)' : 'var(--danger-color)' }}></div>
            {backendStatus.status === 'ok' ? 'Connected to Rust Daemon' : 'Daemon Offline'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          {activeServer.isRunning && (
            <button onClick={handleStopServer} style={{ padding: '8px 16px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--danger-color)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Square size={16} fill="currentColor" /> Eject Model
            </button>
          )}
          <button onClick={() => setIsModalOpen(true)} style={{ padding: '8px 20px', borderRadius: '8px', background: 'var(--accent-color)', color: 'white', fontWeight: '600', boxShadow: '0 4px 14px 0 rgba(79, 70, 229, 0.39)' }}>
            Load Model
          </button>
        </div>
      </header>

      {/* Main Dashboard Grid */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', padding: '24px', gap: '24px' }}>
        
        {/* Left Column: Active Model & Telemetry */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', minWidth: '400px' }}>
          
          {/* Active Model Card */}
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', color: 'var(--text-muted)' }}>
              <LayoutDashboard size={18} />
              <h2 style={{ fontSize: '0.9rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' }}>Current Model</h2>
            </div>
            
            {activeServer.isRunning && activeServer.modelId ? (
              (() => {
                const model = models.find(m => m.id === activeServer.modelId);
                if (!model) return <div style={{ color: 'var(--text-muted)' }}>Loading details...</div>;
                
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--success-color)', boxShadow: '0 0 12px var(--success-color)' }}></div>
                      <h3 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-main)', margin: 0 }}>{model.name}</h3>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Quantization</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600' }}><Cpu size={16} color="var(--accent-color)"/> {model.quantization}</div>
                      </div>
                      <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>File Size</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600' }}><HardDrive size={16} color="var(--accent-color)"/> {model.size_gb.toFixed(2)} GB</div>
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', color: 'var(--text-muted)', padding: '40px 0' }}>
                <HardDrive size={48} style={{ opacity: 0.2 }} />
                <p style={{ fontWeight: '500' }}>No model currently loaded in memory.</p>
              </div>
            )}
          </div>

          {/* Telemetry Card (Placeholder for now) */}
          <div className="glass-panel" style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', color: 'var(--text-muted)' }}>
              <Activity size={18} />
              <h2 style={{ fontSize: '0.9rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' }}>Hardware Telemetry</h2>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--panel-border)', borderRadius: '8px', color: 'var(--text-muted)' }}>
              Real-time graphs will appear here.
            </div>
          </div>
        </div>

        {/* Right Column: Server Terminal */}
        <div className="glass-panel" style={{ flex: 2, padding: '24px', display: 'flex', flexDirection: 'column', minWidth: '500px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', color: 'var(--text-muted)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Terminal size={18} />
              <h2 style={{ fontSize: '0.9rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' }}>llama-server Output</h2>
            </div>
            {activeServer.isRunning && (
              <span style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--success-color)', animation: 'pulse 2s infinite' }}></span>
                Live Stream
              </span>
            )}
          </div>
          
          <div className="terminal-window">
            {logs.length === 0 ? (
              <div style={{ color: '#525252', fontStyle: 'italic' }}>Waiting for server output...</div>
            ) : (
              logs.map((line, idx) => (
                <div key={idx} className={`log-line ${formatLog(line)}`}>{line}</div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>

      {/* Model Configuration Modal */}
      {isModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div className="glass-panel" style={{ width: '850px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: 'rgba(15, 15, 20, 0.95)', border: '1px solid rgba(255,255,255,0.1)' }}>
            
            {!selectedModel ? (
              <>
                <div style={{ padding: '24px', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: '600' }}>Select a Model</h2>
                  <button onClick={() => setIsModalOpen(false)} style={{ background: 'transparent', color: 'var(--text-muted)' }}><X size={24} /></button>
                </div>
                
                <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {models.map((model) => (
                    <div key={model.id} style={{ padding: '20px', borderRadius: '12px', border: '1px solid var(--panel-border)', background: 'rgba(255,255,255,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', transition: 'all 0.2s' }} onClick={() => setSelectedModel(model)} onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--accent-color)'; e.currentTarget.style.background = 'rgba(79, 70, 229, 0.05)' }} onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--panel-border)'; e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}>
                      <div>
                        <h3 style={{ fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-main)', marginBottom: '8px' }}>{model.name}</h3>
                        <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Cpu size={14}/> {model.quantization}</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><HardDrive size={14}/> {model.size_gb.toFixed(2)} GB</span>
                        </div>
                      </div>
                      <button style={{ padding: '10px 20px', borderRadius: '8px', background: 'var(--accent-color)', color: 'white', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', pointerEvents: 'none' }}>
                        <Settings2 size={16} /> Configure
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div style={{ padding: '24px', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button onClick={() => setSelectedModel(null)} style={{ background: 'transparent', color: 'var(--text-muted)' }}><ArrowLeft size={20} /></button>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: '600' }}>Configure: <span style={{ color: 'var(--accent-color)' }}>{selectedModel.name}</span></h2>
                  </div>
                  <button onClick={() => { setIsModalOpen(false); setSelectedModel(null); }} style={{ background: 'transparent', color: 'var(--text-muted)' }}><X size={24} /></button>
                </div>
                
                <div style={{ padding: '32px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '32px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div><label className="form-label">Context Size</label><input type="number" name="ctxSize" value={config.ctxSize} onChange={handleConfigChange} className="glass-input" /></div>
                    <div><label className="form-label">GPU Offload Layers</label><input type="number" name="gpuLayers" value={config.gpuLayers} onChange={handleConfigChange} className="glass-input" /></div>
                    <div><label className="form-label">CPU Threads</label><input type="number" name="threads" value={config.threads} onChange={handleConfigChange} className="glass-input" /></div>
                    <div><label className="form-label">Concurrency</label><input type="number" name="concurrency" value={config.concurrency} onChange={handleConfigChange} className="glass-input" /></div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', padding: '24px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px solid var(--panel-border)' }}>
                    <div>
                      <label className="form-label">K Cache Quantization</label>
                      <select name="kCacheQuant" value={config.kCacheQuant} onChange={handleConfigChange} className="glass-select">
                        <option value="f16">F16 (Default)</option><option value="q8_0">Q8_0</option><option value="q4_0">Q4_0</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label">V Cache Quantization</label>
                      <select name="vCacheQuant" value={config.vCacheQuant} onChange={handleConfigChange} className="glass-select">
                        <option value="f16">F16 (Default)</option><option value="q8_0">Q8_0</option><option value="q4_0">Q4_0</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    {['unifiedKv', 'offloadKv', 'keepInMemory', 'mmap', 'flashAttention'].map(key => (
                      <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
                        <input type="checkbox" name={key} checked={config[key]} onChange={handleConfigChange} style={{ width: '18px', height: '18px', accentColor: 'var(--accent-color)' }} />
                        <span style={{ color: 'var(--text-main)', fontSize: '0.95rem' }}>{key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</span>
                      </label>
                    ))}
                  </div>

                  <button onClick={handleStartServer} style={{ marginTop: '16px', padding: '16px', borderRadius: '12px', background: 'var(--accent-color)', color: 'white', fontSize: '1.1rem', fontWeight: '600', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', boxShadow: '0 10px 25px -5px rgba(79, 70, 229, 0.4)' }}>
                    <Play size={22} fill="currentColor" /> Initialize Server
                  </button>
                </div>
              </>
            )}
            
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
