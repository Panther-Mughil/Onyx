import { useEffect, useState, useRef } from 'react';
import { Square, Settings, Cpu, MemoryStick, Info, Activity, SlidersHorizontal, Settings2, Trash2, X, Gpu, Network, Plus, Gauge, BookOpen, Power, ChevronLeft, ChevronRight, Eye, ChevronsLeftRightEllipsis, Layers, Box, Download, Search, Database, Wrench } from 'lucide-react';
import EngineManager from './EngineManager';
import './index.css';

const OnyxLogo = ({ size = 20, color = "#22d3ee" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 12l10 10 10-10Z" />
    <path d="M2 12h20" />
    <path d="M12 2v20" />
  </svg>
);

const MemoryEstimator = ({ selectedModel, config, activeDevices, telemetry }) => {
    const [showTooltip, setShowTooltip] = useState(false);
    if (!selectedModel) return null;
    
    // Model weight estimations
    const totalLayers = selectedModel.block_count || 32;
    const layerSizeGb = selectedModel.size_gb / totalLayers;
    
    // KV Cache Estimations
    const nEmbd = totalLayers <= 16 ? 2048 : (totalLayers <= 32 ? 4096 : (totalLayers <= 40 ? 5120 : (totalLayers <= 60 ? 6144 : 8192)));
    const gqaFactor = 0.25; 
    
    const getQuantBytes = (q) => {
       if (q === 'f16' || q === 'f32') return 2.0;
       if (q === 'q8_0') return 1.0;
       if (q.startsWith('q4')) return 0.5;
       if (q.startsWith('q5')) return 0.625;
       return 2.0;
    };
    
    const bpe = (getQuantBytes(config.kCacheQuant) + getQuantBytes(config.vCacheQuant)) / 2;
    const kvSizeBytes = 2 * totalLayers * (nEmbd * gqaFactor) * bpe * config.ctxSize * config.concurrency;
    const kvSizeGb = kvSizeBytes / (1024 * 1024 * 1024);
    
    // Context Compute Buffer (Graph overhead) - scales heavily with ctxSize
    // If Flash Attention is OFF, the QK^T Attention Matrix takes a MASSIVE amount of memory.
    const nHead = nEmbd / 64; // Conservative approximation of attention heads
    let attentionBufferGb = 0;
    if (!config.flashAttention) {
        // Elements = heads * batch_size * context_size. Each is 4 bytes (f32)
        attentionBufferGb = (nHead * config.physicalBatchSize * config.ctxSize * 4) / (1024 * 1024 * 1024);
    }
    const baseGraphGb = (config.ctxSize / 100000) * 0.5; // ~500MB graph logic per 100k tokens
    const computeBufferGb = attentionBufferGb + baseGraphGb;
          
    const hostOverheadGb = 0.40; // Host OS / Llama.cpp base binary overhead
    const cudaOverheadGb = 0.25; // Base CUDA Context initialization overhead per GPU
    
    const allocations = { ...config.layerAllocations };
    const stats = [];
    
    let offloadedLayers = 0;
    activeDevices.forEach(d => {
       if (d.id.startsWith('gpu') || d.id.startsWith('rpc')) {
           offloadedLayers += (allocations[d.id] || 0);
       }
    });
    
    let hasDanger = false;
    let hasWarning = false;

    let totalSavedVram = 0;
    let expertRatio = 0;
    
    if (selectedModel?.architecture?.includes('moe') && config.moeCpuLayers > 0) {
        const d_model = selectedModel.embedding_length || 4096;
        const d_ff_exp = selectedModel.feed_forward_length || 14336;
        const E = selectedModel.expert_count || 8;
        
        const attnParams = 4 * Math.pow(d_model, 2);
        const expertParams = E * 3 * d_model * d_ff_exp;
        const totalLayerParams = attnParams + expertParams;
        expertRatio = expertParams / totalLayerParams; 
        
        totalSavedVram = Math.min(offloadedLayers, config.moeCpuLayers) * (layerSizeGb * expertRatio);
    }

    const computeDevice = (id, name, isRam) => {
        const actualLayers = allocations[id] || 0;
        let baseVram = actualLayers * layerSizeGb;
        
        if (expertRatio > 0 && offloadedLayers > 0 && !isRam) {
            const effectiveOffload = Math.min(1, config.moeCpuLayers / offloadedLayers);
            baseVram -= actualLayers * (layerSizeGb * expertRatio * effectiveOffload);
        }
        let kvPart = config.offloadKv ? (actualLayers / totalLayers * kvSizeGb) : 0;
        
        let initialVram = config.flashAttention ? baseVram : (baseVram + kvPart);
        let maxVram = baseVram + kvPart;
        
        if (id.startsWith('gpu') && actualLayers > 0) {
            initialVram += cudaOverheadGb + computeBufferGb;
            maxVram += cudaOverheadGb + computeBufferGb;
        }
        
        let status = 'ok';
        let freeGb = Infinity;
        
        // --- Crash Check Logic ---
        if (id.startsWith('gpu') && telemetry?.host?.gpus) {
            const idx = parseInt(id.split('_')[1]);
            const gpuTel = telemetry.host.gpus[idx];
            if (gpuTel) freeGb = (gpuTel.vram_total_mb - gpuTel.vram_used_mb) / 1024;
        } else if (id.startsWith('rpc') && telemetry?.rpcs) {
            const idx = parseInt(id.split('_')[1]);
            const rpcTel = telemetry.rpcs[idx];
            if (rpcTel) {
                if (rpcTel.gpus && rpcTel.gpus.length > 0) {
                    freeGb = rpcTel.gpus.reduce((acc, g) => acc + (g.vram_total_mb - g.vram_used_mb) / 1024, 0);
                } else {
                    freeGb = rpcTel.ram_total_gb - rpcTel.ram_used_gb;
                }
            }
        }
        
        if (freeGb !== Infinity) {
            if (initialVram > freeGb) {
                status = 'danger';
                hasDanger = true;
            } else if (maxVram > freeGb) {
                status = 'warning';
                hasWarning = true;
            }
        }
        
        const shortName = id.startsWith('gpu') ? `GPU ${id.split('_')[1]}` : (id.startsWith('rpc') ? `RPC ${id.split('_')[1]}` : name);
        if (maxVram > 0) stats.push({ name: shortName, type: isRam ? 'RAM' : 'VRAM', gb: maxVram, status });
    };
    
    activeDevices.filter(d => d.id.startsWith('gpu')).forEach(d => computeDevice(d.id, d.name, false));
    activeDevices.filter(d => d.id.startsWith('rpc')).forEach(d => computeDevice(d.id, d.name, false));
    
    const cpuActualLayers = Math.max(0, totalLayers - offloadedLayers);
    let hostBaseRam = (cpuActualLayers * layerSizeGb) + hostOverheadGb + totalSavedVram;
    let hostKvPart = !config.offloadKv ? kvSizeGb : (cpuActualLayers / totalLayers * kvSizeGb);
    
    let hostInitialRam = config.flashAttention ? hostBaseRam : (hostBaseRam + hostKvPart);
    let hostMaxRam = hostBaseRam + hostKvPart;
    
    // If no GPU offload, Host bears the Compute Buffer
    if (offloadedLayers === 0) {
        hostInitialRam += computeBufferGb;
        hostMaxRam += computeBufferGb;
    }
    
    let hostStatus = 'ok';
    // Check Host RAM limit
    if (telemetry?.host) {
        const freeRam = telemetry.host.ram_total_gb - telemetry.host.ram_used_gb;
        if (hostInitialRam > freeRam) {
            hostStatus = 'danger';
            hasDanger = true;
        } else if (hostMaxRam > freeRam) {
            hostStatus = 'warning';
            hasWarning = true;
        }
    }
    
    stats.unshift({ name: 'Host', type: 'RAM', gb: hostMaxRam, status: hostStatus });
    
    const isPartialOffload = cpuActualLayers > 0;
    
    // Global Footprint Status Color Logic
    let statusColor = 'var(--ready-green)'; // Green
    if (hasDanger) {
        statusColor = 'var(--danger)'; // Red
    } else if (hasWarning && !isPartialOffload) {
        statusColor = '#f97316'; // Orange
    } else if (hasWarning && isPartialOffload) {
        statusColor = '#78350f'; // Dark Brown (Blue + Orange)
    } else if (!hasWarning && isPartialOffload) {
        statusColor = '#38bdf8'; // Blue
    }
    
    const getDeviceColor = (status) => {
        if (status === 'danger') return 'var(--danger)';
        if (status === 'warning') return '#f97316';
        return '#10b981'; // ok -> green
    };
    
    return (
        <div style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-color)', padding: '16px' }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                 <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Resource Usage Estimator
                 </div>
                 <div 
                    style={{ position: 'relative', display: 'flex', alignItems: 'center', cursor: 'help' }}
                    onMouseEnter={() => setShowTooltip(true)}
                    onMouseLeave={() => setShowTooltip(false)}
                 >
                     <Info size={14} color="var(--text-muted)" />
                     {showTooltip && (
                        <div style={{
                            position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: '8px',
                            background: 'var(--bg-input)', border: '1px solid var(--border-color)',
                            padding: '12px', borderRadius: '8px', width: '280px', zIndex: 100,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                            fontSize: '11px', color: 'var(--text-main)',
                            lineHeight: '1.4'
                        }}>
                            <div style={{ marginBottom: '8px', fontWeight: 'bold', fontSize: '12px' }}>Status Colors</div>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                                <div style={{ width: '10px', height: '10px', background: 'var(--ready-green)', borderRadius: '2px', marginTop: '2px', flexShrink: 0 }}></div>
                                <span><b>Green:</b> Model fits completely with full GPU acceleration.</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                                <div style={{ width: '10px', height: '10px', background: '#38bdf8', borderRadius: '2px', marginTop: '2px', flexShrink: 0 }}></div>
                                <span><b>Blue:</b> Model fits completely, with partial CPU/RAM offloading.</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                                <div style={{ width: '10px', height: '10px', background: '#f97316', borderRadius: '2px', marginTop: '2px', flexShrink: 0 }}></div>
                                <span><b>Orange:</b> Model can load initially, but full context memory will exceed System limits (Warning).</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                                <div style={{ width: '10px', height: '10px', background: '#78350f', borderRadius: '2px', marginTop: '2px', flexShrink: 0 }}></div>
                                <span><b>Brown:</b> Model can load initially with a partial offload to CPU/RAM, but full context memory will exceed System limits (Warning).</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                <div style={{ width: '10px', height: '10px', background: 'var(--danger)', borderRadius: '2px', marginTop: '2px', flexShrink: 0 }}></div>
                                <span><b>Red:</b> Model requires more resources than available. Can't load.</span>
                            </div>
                        </div>
                     )}
                 </div>
             </div>
             <div style={{ display: 'flex', gap: '8px', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: '4px' }} className="custom-scrollbar">
                 {stats.map((s, i) => (
                     <div key={i} style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-input)', padding: '8px 10px', borderRadius: '6px', flexShrink: 0, border: `1px solid ${getDeviceColor(s.status)}` }}>
                         <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', whiteSpace: 'nowrap' }}>{s.name} <span style={{fontSize: '9px', opacity: 0.6}}>{s.type}</span></span>
                         <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-main)', whiteSpace: 'nowrap' }}>{(s.gb * 1024).toFixed(0)} <span style={{fontSize: '11px', fontWeight: 'normal'}}>MB</span></span>
                     </div>
                 ))}
                 <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-input)', padding: '8px 10px', borderRadius: '6px', flexShrink: 0, border: `1px solid ${statusColor}`, opacity: hasDanger ? 0.9 : 1 }}>
                     <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', whiteSpace: 'nowrap' }}>Total Footprint</span>
                     <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-main)', whiteSpace: 'nowrap' }}>{((stats.reduce((a, b) => a + b.gb, 0)) * 1024).toFixed(0)} <span style={{fontSize: '11px', fontWeight: 'normal'}}>MB</span></span>
                 </div>
             </div>
        </div>
    );
};

const getUsageColor = (pct) => {
   if (pct >= 90) return 'var(--danger)';
   if (pct >= 50) return '#f59e0b';
   return '#f8fafc';
};
const getTempColor = (temp) => {
   if (temp >= 85) return 'var(--danger)';
   if (temp >= 75) return '#f59e0b';
   return 'var(--text-main)';
};
const getVramColor = (used, total) => {
   const pct = (used / total) * 100;
   if (pct >= 90) return 'var(--danger)';
   if (pct >= 75) return '#f59e0b';
   return '#10b981'; // Default GPU green
};

const CpuLineGraph = ({ usage, color }) => {
  const [history, setHistory] = useState(Array(60).fill(0));
  const gradientId = `grad-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
  
  useEffect(() => {
    setHistory(prev => [...prev.slice(1), usage]);
  }, [usage]);

  const maxH = 40;
  const mapY = (val) => 38 - (val / 100) * 36;
  const points = history.map((val, i) => `${(i / 59) * 100},${mapY(val)}`).join(' ');

  return (
    <div style={{ width: '100%', height: `${maxH}px`, marginTop: '12px' }}>
      <svg width="100%" height="100%" preserveAspectRatio="none" viewBox={`0 0 100 ${maxH}`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <line x1="0" y1={mapY(25)} x2="100" y2={mapY(25)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="1,2" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1={mapY(50)} x2="100" y2={mapY(50)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="1,2" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1={mapY(75)} x2="100" y2={mapY(75)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="1,2" vectorEffect="non-scaling-stroke" />
        <polygon points={`0,${maxH} ${points} 100,${maxH}`} fill={`url(#${gradientId})`} />
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
};

function App() {
  const [backendStatus, setBackendStatus] = useState({ status: 'checking', message: '' });
  const [activeServers, setActiveServers] = useState([]); // Array of { modelId, port, isReady }
  const [logs, setLogs] = useState([]);
  
  // Modals & Navigation
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null); 
  const [activeTab, setActiveTab] = useState('load');
  // Layout State
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true); 
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [isSidebarDragging, setIsSidebarDragging] = useState(false);
  const [activeLeftTab, setActiveLeftTab] = useState('monitoring');
  const [hfSearchQuery, setHfSearchQuery] = useState('');
  const [hfSearchResults, setHfSearchResults] = useState([]);
  const [hfIsSearching, setHfIsSearching] = useState(false);
  const [hfDownloads, setHfDownloads] = useState({});
  const [hfSelectedRepo, setHfSelectedRepo] = useState(null);
  const [hfRepoFiles, setHfRepoFiles] = useState([]); 
  const [telemetry, setTelemetry] = useState(null);
  const [installedEngines, setInstalledEngines] = useState([]);

  const [isServerSettingsOpen, setIsServerSettingsOpen] = useState(false);
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);
  const [serverSettings, setServerSettings] = useState({
    port: "12057",
    networkHost: false,
    cors: true,
    jitModelLoading: false,
    autoUnload: true,
    autoStartGateway: false,
    localGpus: [],
    rpcServers: []
  });
  
  const [isProxyRunning, setIsProxyRunning] = useState(false);
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
      
      let targetConfig = { ...initialConfig };
      let shouldRemember = false;

      if (applied) {
        targetConfig = { ...targetConfig, ...applied };
        shouldRemember = !!savedConfig;
      } else if (savedConfig) {
        targetConfig = { ...targetConfig, ...savedConfig };
        shouldRemember = true;
      }
      
      setConfig(targetConfig);
      setRememberSettings(shouldRemember);
      
      if (targetConfig.layerAllocations) {
         let newGpus = serverSettings.localGpus ? [...serverSettings.localGpus] : [];
         let newRpcs = serverSettings.rpcServers ? [...serverSettings.rpcServers] : [];
         let settingsChanged = false;

         newGpus = newGpus.map((gpu) => {
             const key = `gpu_${gpu.index}`;
             const used = (targetConfig.layerAllocations[key] || 0) > 0;
             if (gpu.active !== used) { settingsChanged = true; return { ...gpu, active: used }; }
             return gpu;
         });

         newRpcs = newRpcs.map((rpc, idx) => {
             const key = `rpc_${idx}`;
             const used = (targetConfig.layerAllocations[key] || 0) > 0;
             if (rpc.active !== used) { settingsChanged = true; return { ...rpc, active: used }; }
             return rpc;
         });

         if (settingsChanged) {
             saveSettings({ ...serverSettings, localGpus: newGpus, rpcServers: newRpcs });
         }
      }
    }
  };

  const toggleProxy = () => {
    if (isProxyRunning) {
      fetch('http://127.0.0.1:3001/api/server/proxy/stop', { method: 'POST' })
        .then(() => {
          setIsProxyRunning(false);
          saveSettings({ ...serverSettings, autoStartGateway: false });
        })
        .catch(() => {});
    } else {
      fetch('http://127.0.0.1:3001/api/server/network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: parseInt(serverSettings.port), networkHost: serverSettings.networkHost })
      }).then(res => {
        if (!res.ok) throw new Error("Failed to start proxy");
        setIsProxyRunning(true);
        saveSettings({ ...serverSettings, autoStartGateway: true });
      }).catch(() => {});
    }
  };

  const terminalRef = useRef(null);
  const autoScrollEnabled = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const handleTerminalScroll = () => {
    if (!terminalRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    
    autoScrollEnabled.current = isAtBottom;
    setShowScrollButton(!isAtBottom);
  };

  useEffect(() => {
    if (autoScrollEnabled.current && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, systemLogs, selectedModel]);

  const appliedConfigs = serverSettings.appliedConfigs || {};
  const savedModelConfigs = serverSettings.savedModelConfigs || {};
  const [newRpcInput, setNewRpcInput] = useState("");
  const [benchmarkStatus, setBenchmarkStatus] = useState({ isRunning: false, logs: [], pp: null, tg: null });

  const initialConfig = {
    engineId: '',
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
    moeCpuLayers: 0,
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
    let interval;
    if (activeLeftTab === 'huggingface') {
        interval = setInterval(async () => {
            try {
                const res = await fetch(`http://127.0.0.1:3001/api/huggingface/downloads`);
                const data = await res.json();
                setHfDownloads(data);
            } catch (e) {}
        }, 1000);
    }
    return () => clearInterval(interval);
  }, [activeLeftTab]);

  useEffect(() => {
    if (activeLeftTab === 'engines' || activeTab === 'load') {
      fetch('http://127.0.0.1:3001/api/engines')
        .then(res => res.json())
        .then(data => {
            setInstalledEngines(data);
            setConfig(prev => {
                if (!prev.engineId && data.length > 0) {
                    return { ...prev, engineId: data[0] };
                }
                return prev;
            });
        })
        .catch(() => {});
    }
  }, [activeLeftTab, activeTab, isModalOpen]);

  const searchHuggingFace = async (e) => {
    e.preventDefault();
    if (!hfSearchQuery.trim()) return;
    setHfIsSearching(true);
    try {
        const res = await fetch(`http://127.0.0.1:3001/api/huggingface/search?q=${encodeURIComponent(hfSearchQuery)}`);
        const data = await res.json();
        setHfSearchResults(data);
        setHfSelectedRepo(null);
    } catch(err) {
        console.error(err);
    } finally {
        setHfIsSearching(false);
    }
  };

  const fetchRepoFiles = async (repoId) => {
    setHfSelectedRepo(repoId);
    setHfRepoFiles([]);
    try {
        const res = await fetch(`http://127.0.0.1:3001/api/huggingface/model?id=${encodeURIComponent(repoId)}`);
        const data = await res.json();
        if (data.siblings) {
            const ggufs = data.siblings.filter(f => f.rfilename.endsWith('.gguf'));
            setHfRepoFiles(ggufs);
        }
    } catch(err) {
        console.error(err);
    }
  };

  const handleDeleteLocalModel = (modelId) => {
    if (!confirm('Are you sure you want to delete this model?')) return;
    fetch(`http://127.0.0.1:3001/api/models?id=${encodeURIComponent(modelId)}`, { method: 'DELETE' })
      .then(() => fetch('http://127.0.0.1:3001/api/models'))
      .then(res => res.json())
      .then(data => setModels(data))
      .catch(() => {});
  };

  const startHfDownload = async (repoId, filename) => {
    try {
        await fetch(`http://127.0.0.1:3001/api/huggingface/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo_id: repoId, filename })
        });
        const res = await fetch(`http://127.0.0.1:3001/api/huggingface/downloads`);
        const data = await res.json();
        setHfDownloads(data);
    } catch(err) {
        console.error(err);
    }
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
    if (telemetry && telemetry.host) {
        if (telemetry.host.gpus && (!config.localGpus || config.localGpus.length === 0)) {
            const initGpus = telemetry.host.gpus.map((g, i) => ({ index: i, name: g.name, active: true }));
            setConfig(prev => ({ ...prev, localGpus: initGpus }));
        }
        if (telemetry.host.physical_cores && config.threads === (navigator.hardwareConcurrency || 4)) {
            setConfig(prev => ({ ...prev, threads: telemetry.host.physical_cores }));
        }
    }
  }, [telemetry]);
  useEffect(() => {
    fetch('http://127.0.0.1:3001/api/settings')
      .then(res => res.json())
      .then(data => {
        if (Object.keys(data).length > 0) {
          setServerSettings(prev => ({ ...prev, ...data }));
          if (data.autoStartGateway) {
            fetch('http://127.0.0.1:3001/api/server/network', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ port: parseInt(data.port) || 12057, networkHost: data.networkHost || false })
            }).then(res => {
              if (res.ok) setIsProxyRunning(true);
            }).catch(() => {});
          }
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

  // Global drag events for sidebar
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isSidebarDragging) return;
      // Current value is 380. Min is 380, max is 600.
      let newWidth = e.clientX - 60; // 60 is activity bar width
      if (newWidth < 380) newWidth = 380;
      if (newWidth > 600) newWidth = 600;
      setSidebarWidth(newWidth);
    };
    
    const handleMouseUp = () => {
      if (isSidebarDragging) {
        setIsSidebarDragging(false);
      }
    };
    
    if (isSidebarDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isSidebarDragging]);

  useEffect(() => {
    const fetchTelemetry = async () => {
        try {
            const res = await fetch('http://127.0.0.1:3001/api/server/telemetry', { cache: 'no-store' });
            const hostData = await res.json();
            
            // If we have active RPC servers configured, fetch from their telemetry port (port 50053 default)
            const rpcNodes = [];
            if (serverSettings.rpcServers && serverSettings.rpcServers.length > 0) {
                const allRpcs = serverSettings.rpcServers;
                const fetchPromises = allRpcs.map(async (rpc) => {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 1000);
                    try {
                        const ip = rpc.address.split(':')[0];
                        const rpcRes = await fetch(`http://${ip}:50053/telemetry`, { 
                            cache: 'no-store',
                            signal: controller.signal
                        });
                        clearTimeout(timeoutId);
                        const rpcData = await rpcRes.json();
                        rpcData.cpu_name = `[RPC ${ip}] ${rpcData.cpu_name}`;
                        if (rpcData.gpus) {
                            rpcData.gpus = rpcData.gpus.map(g => ({ ...g, name: `[RPC ${ip}] ${g.name}` }));
                        }
                        return rpcData;
                    } catch (e) {
                        clearTimeout(timeoutId);
                        throw e;
                    }
                });

                const results = await Promise.allSettled(fetchPromises);
                for (const result of results) {
                    if (result.status === 'fulfilled') {
                        rpcNodes.push(result.value);
                    } else {
                        rpcNodes.push(null);
                    }
                }
            }
            
            setTelemetry({ host: hostData, rpcs: rpcNodes });
        } catch (e) {
            // Error handling
        }
    };
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 1000);
    return () => clearInterval(interval);
  }, [serverSettings.rpcServers]);

  useEffect(() => {
    let interval;
    if (activeTab === 'benchmark' && benchmarkStatus.isRunning) {
       const fetchBench = () => {
         fetch('http://127.0.0.1:3001/api/server/benchmark/status', { cache: 'no-store' })
           .then(res => res.json())
           .then(data => setBenchmarkStatus(prev => ({ ...prev, isRunning: data.is_running, logs: data.logs, pp: data.pp, tg: data.tg })))
           .catch(() => {});
       };
       fetchBench();
       interval = setInterval(fetchBench, 1000);
    }
    return () => clearInterval(interval);
  }, [activeTab, benchmarkStatus.isRunning]);

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
      let sanitizedConfig = { ...config };
      if (sanitizedConfig.layerAllocations) {
          const cleanAllocs = {};
          if (sanitizedConfig.layerAllocations['cpu']) {
              cleanAllocs['cpu'] = sanitizedConfig.layerAllocations['cpu'];
          }
          activeDevices.forEach(d => {
              if (sanitizedConfig.layerAllocations[d.id]) {
                  cleanAllocs[d.id] = sanitizedConfig.layerAllocations[d.id];
              }
          });
          sanitizedConfig.layerAllocations = cleanAllocs;
      }

      const newSavedConfigs = { ...savedModelConfigs };
      if (rememberSettings) {
        newSavedConfigs[selectedModel.id] = sanitizedConfig;
      } else {
        delete newSavedConfigs[selectedModel.id];
      }

      const newAppliedConfigs = { ...appliedConfigs, [selectedModel.id]: sanitizedConfig };

      const response = await fetch('http://127.0.0.1:3001/api/server/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: selectedModel.id, ...sanitizedConfig, rpcServers: serverSettings.rpcServers || [] })
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

  const maxLayers = selectedModel?.block_count ? selectedModel.block_count : 100;
  const activeDevices = [];
  let displayIndex = 0;
  if (config.localGpus) {
      config.localGpus.forEach(g => {
          if (g.active) {
              activeDevices.push({ id: `gpu_${g.index}`, name: `${displayIndex}: ${g.name || 'GPU ' + g.index}` });
              displayIndex++;
          }
      });
  }
  if (serverSettings.rpcServers) {
      serverSettings.rpcServers.forEach((r, idx) => {
          if (r.active) {
              let displayName = `RPC ${r.address}`;
              if (telemetry && telemetry.rpcs && telemetry.rpcs[idx]) {
                  const rpcTel = telemetry.rpcs[idx];
                  if (rpcTel.gpus && rpcTel.gpus.length > 0) {
                      displayName = rpcTel.gpus.map(g => g.name.replace(/^\[RPC .*?\] /, '')).join(' & ');
                  } else if (rpcTel.cpu_name) {
                      displayName = rpcTel.cpu_name.replace(/^\[RPC .*?\] /, '');
                  }
              }
              activeDevices.push({ id: `rpc_${idx}`, name: `${displayIndex}: ${displayName}` });
              displayIndex++;
          }
      });
  }

  let allocs = config.layerAllocations || {};
  let totalOffloaded = 0;
  activeDevices.forEach(d => {
      totalOffloaded += (allocs[d.id] || 0);
  });
  let cpuLayers = Math.max(0, maxLayers - totalOffloaded);

  const handleAllocationChange = (deviceId, value) => {
      let newVal = parseInt(value, 10) || 0;
      let newAllocs = { ...allocs };
      
      let currentVal = newAllocs[deviceId] || 0;
      let diff = newVal - currentVal;
      
      if (deviceId === 'cpu') {
          if (activeDevices.length > 0) {
              let targetDevice = activeDevices[0].id;
              let targetOld = newAllocs[targetDevice] || 0;
              newAllocs[targetDevice] = Math.max(0, targetOld - diff);
          }
      } else {
          let maxAllowed = currentVal + cpuLayers;
          if (newVal > maxAllowed) newVal = maxAllowed;
          newAllocs[deviceId] = newVal;
      }
      
      setConfig({ ...config, layerAllocations: newAllocs });
  };

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
            + LOAD MODEL
          </button>
        </div>
      </div>

      {/* Main Split View */}
      <div className="main-content">
        
        {/* Activity Bar */}
        <div className="activity-bar">
           <button className={`activity-icon ${(isLeftSidebarOpen && activeLeftTab === 'monitoring') ? 'active' : ''}`} onClick={() => {
               if (isLeftSidebarOpen && activeLeftTab === 'monitoring') setIsLeftSidebarOpen(false);
               else { setIsLeftSidebarOpen(true); setActiveLeftTab('monitoring'); }
           }} title="Monitoring">
              <Activity size={24} />
           </button>
           <button className={`activity-icon ${(isLeftSidebarOpen && activeLeftTab === 'engines') ? 'active' : ''}`} onClick={() => {
               if (isLeftSidebarOpen && activeLeftTab === 'engines') setIsLeftSidebarOpen(false);
               else { setIsLeftSidebarOpen(true); setActiveLeftTab('engines'); }
           }} title="Engine Manager">
              <Wrench size={24} />
           </button>
           <button className={`activity-icon ${(isLeftSidebarOpen && activeLeftTab === 'huggingface') ? 'active' : ''}`} onClick={() => {
               if (isLeftSidebarOpen && activeLeftTab === 'huggingface') setIsLeftSidebarOpen(false);
               else { setIsLeftSidebarOpen(true); setActiveLeftTab('huggingface'); }
           }} title="HuggingFace Hub">
              <Box size={24} />
           </button>
           <button className={`activity-icon ${(isLeftSidebarOpen && activeLeftTab === 'local-models') ? 'active' : ''}`} onClick={() => {
               if (isLeftSidebarOpen && activeLeftTab === 'local-models') setIsLeftSidebarOpen(false);
               else { setIsLeftSidebarOpen(true); setActiveLeftTab('local-models'); }
           }} title="Local Models">
              <Database size={24} />
           </button>
        </div>

        {/* Left Sidebar (Collapsible) */}
        <div 
          className={`left-sidebar ${isLeftSidebarOpen ? 'open' : ''} ${isSidebarDragging ? 'dragging' : ''}`}
          style={{ width: isLeftSidebarOpen ? `${sidebarWidth}px` : '0px' }}
        >
          <div className="sidebar-content" style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px`, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
           {activeLeftTab === 'monitoring' && (
             <>
               <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border-color)' }}>
                 <Eye size={20} color="var(--text-muted)" />
                 <h2 style={{ fontSize: '13px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1.5px', margin: 0, color: 'var(--text-main)' }}>Monitoring</h2>
               </div>
               <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', flex: 1 }}>
                
                {!telemetry || !telemetry.host ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>Fetching telemetry...</div>
                ) : (
                  <>
                    <div className="box" style={{ padding: '16px' }}>
                       <h4 style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: '#f8fafc' }}><Cpu size={16}/> {telemetry.host.cpu_name}</h4>
                       <div style={{ background: 'var(--bg-input)', padding: '12px', borderRadius: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                             <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>CPU Usage</span>
                             <span style={{ fontSize: '16px', fontWeight: 'bold', color: getUsageColor(telemetry.host.cpu_usage_pct) }}>{telemetry.host.cpu_usage_pct.toFixed(1)}%</span>
                          </div>
                          <CpuLineGraph usage={telemetry.host.cpu_usage_pct} color={getUsageColor(telemetry.host.cpu_usage_pct)} />
                       </div>
                       <div style={{ width: '100%', height: '1px', background: 'var(--border-color)', margin: '16px 0' }}></div>
                       <h4 style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: '#06b6d4' }}><MemoryStick size={16}/> System RAM</h4>
                       <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div className="info-row" style={{ padding: '4px 0' }}><span>Total Memory</span> <span>{Math.round(telemetry.host.ram_total_gb * 1024)} MB</span></div>
                          <div className="info-row" style={{ padding: '4px 0' }}><span>Available Memory</span> <span>{Math.round((telemetry.host.ram_total_gb - telemetry.host.ram_used_gb) * 1024)} MB</span></div>
                          <div className="info-row" style={{ padding: '4px 0', borderBottom: 'none' }}><span>Used Memory</span> <span style={{ color: getUsageColor((telemetry.host.ram_used_gb/telemetry.host.ram_total_gb)*100) }}>{Math.round(telemetry.host.ram_used_gb * 1024)} MB</span></div>
                       </div>
                       <div style={{ width: '100%', height: '1px', background: 'var(--border-color)', margin: '16px 0' }}></div>
                    {telemetry.host.gpus.length === 0 ? (
                       <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>No NVIDIA GPUs detected.</div>
                    ) : (
                      <>
                        {telemetry.host.gpus.map((gpu, idx) => (
                          <div key={idx} style={{ marginBottom: idx < telemetry.host.gpus.length - 1 ? '16px' : '0' }}>
                             <h4 style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: '#10b981' }}><Gpu size={16}/> {gpu.name}</h4>
                             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                                <div style={{ background: 'var(--bg-input)', padding: '12px', borderRadius: '8px' }}>
                                   <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>GPU Usage</div>
                                   <div style={{ fontSize: '16px', fontWeight: 'bold', color: getUsageColor(gpu.gpu_usage_pct) }}>{gpu.gpu_usage_pct}%</div>
                                </div>
                                <div style={{ background: 'var(--bg-input)', padding: '12px', borderRadius: '8px' }}>
                                   <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Temperature</div>
                                   <div style={{ fontSize: '16px', fontWeight: 'bold', color: getTempColor(gpu.temp_c) }}>{gpu.temp_c} °C</div>
                                </div>
                             </div>
                             <div style={{ background: 'var(--bg-input)', padding: '12px', borderRadius: '8px' }}>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>VRAM Usage</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                   <span style={{ fontSize: '16px', fontWeight: 'bold', color: getVramColor(gpu.vram_used_mb, gpu.vram_total_mb) }}>{gpu.vram_used_mb} MB</span>
                                   <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>/ {gpu.vram_total_mb} MB</span>
                                </div>
                                <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '8px', overflow: 'hidden' }}>
                                   <div style={{ width: `${(gpu.vram_used_mb / gpu.vram_total_mb) * 100}%`, height: '100%', background: getVramColor(gpu.vram_used_mb, gpu.vram_total_mb), transition: 'width 0.3s' }}></div>
                                </div>
                             </div>
                             {idx < telemetry.host.gpus.length - 1 && <div style={{ width: '100%', height: '1px', background: 'var(--border-color)', margin: '16px 0 0 0' }}></div>}
                          </div>
                        ))}
                      </>
                    )}
                    </div>

                    {telemetry.rpcs && telemetry.rpcs.map((rpc, rpcIdx) => (
                      rpc ? (
                      <div key={`rpc-${rpcIdx}`} className="box" style={{ padding: '16px' }}>
                           <h4 style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', color: '#fb7185', textTransform: 'uppercase', letterSpacing: '0.5px' }}><ChevronsLeftRightEllipsis size={18}/> {serverSettings.rpcServers[rpcIdx]?.address}</h4>
                           <h4 style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: '#f8fafc' }}><Cpu size={16}/> {rpc.cpu_name.replace(/^\[RPC.*?\]\s*/, '')}</h4>
                           <div style={{ background: 'var(--bg-input)', padding: '12px', borderRadius: '8px', marginBottom: '12px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                 <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>CPU Usage</span>
                                 <span style={{ fontSize: '16px', fontWeight: 'bold', color: getUsageColor(rpc.cpu_usage_pct) }}>{rpc.cpu_usage_pct.toFixed(1)}%</span>
                              </div>
                              <CpuLineGraph usage={rpc.cpu_usage_pct} color={getUsageColor(rpc.cpu_usage_pct)} />
                           </div>
                           <div style={{ width: '100%', height: '1px', background: 'var(--border-color)', margin: '16px 0' }}></div>
                           <h4 style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: '#06b6d4' }}><MemoryStick size={16}/> System RAM</h4>
                           <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <div className="info-row" style={{ padding: '4px 0' }}><span>Total Memory</span> <span>{Math.round(rpc.ram_total_gb * 1024)} MB</span></div>
                              <div className="info-row" style={{ padding: '4px 0' }}><span>Available Memory</span> <span>{Math.round((rpc.ram_total_gb - rpc.ram_used_gb) * 1024)} MB</span></div>
                              <div className="info-row" style={{ padding: '4px 0', borderBottom: 'none' }}><span>Used Memory</span> <span style={{ color: getUsageColor((rpc.ram_used_gb/rpc.ram_total_gb)*100) }}>{Math.round(rpc.ram_used_gb * 1024)} MB</span></div>
                           </div>
                        {rpc.gpus && rpc.gpus.map((gpu, idx) => (
                          <div key={`rpc-gpu-${rpcIdx}-${idx}`}>
                             <div style={{ width: '100%', height: '1px', background: 'var(--border-color)', margin: '16px 0' }}></div>
                             <h4 style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: '#10b981' }}><Gpu size={16}/> {gpu.name.replace(/^\[RPC.*?\]\s*/, '')}</h4>
                             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                                <div style={{ background: 'var(--bg-input)', padding: '12px', borderRadius: '8px' }}>
                                   <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>GPU Usage</div>
                                   <div style={{ fontSize: '16px', fontWeight: 'bold', color: getUsageColor(gpu.gpu_usage_pct) }}>{gpu.gpu_usage_pct}%</div>
                                </div>
                                <div style={{ background: 'var(--bg-input)', padding: '12px', borderRadius: '8px' }}>
                                   <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Temperature</div>
                                   <div style={{ fontSize: '16px', fontWeight: 'bold', color: getTempColor(gpu.temp_c) }}>{gpu.temp_c} °C</div>
                                </div>
                             </div>
                             <div style={{ background: 'var(--bg-input)', padding: '12px', borderRadius: '8px' }}>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>VRAM Usage</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                   <span style={{ fontSize: '16px', fontWeight: 'bold', color: getVramColor(gpu.vram_used_mb, gpu.vram_total_mb) }}>{gpu.vram_used_mb} MB</span>
                                   <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>/ {gpu.vram_total_mb} MB</span>
                                </div>
                                <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '8px', overflow: 'hidden' }}>
                                   <div style={{ width: `${(gpu.vram_used_mb / gpu.vram_total_mb) * 100}%`, height: '100%', background: getVramColor(gpu.vram_used_mb, gpu.vram_total_mb), transition: 'width 0.3s' }}></div>
                                </div>
                             </div>
                          </div>
                        ))}
                      </div>
                      ) : (
                        <div key={`rpc-${rpcIdx}`} className="box" style={{ padding: '16px', color: 'var(--danger)', textAlign: 'center', fontSize: '12px' }}>
                            RPC Worker at {serverSettings.rpcServers[rpcIdx]?.address} is currently offline.
                        </div>
                      )
                    ))}
                  </>
                )}
              </div>
             </>
           )}

           {activeLeftTab === 'engines' && (
               <EngineManager apiBase="http://127.0.0.1:3001" />
           )}

           {activeLeftTab === 'huggingface' && (
             <>
               <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border-color)' }}>
                 <Box size={20} color="var(--text-muted)" />
                 <h2 style={{ fontSize: '13px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1.5px', margin: 0, color: 'var(--text-main)' }}>Hugging Face Hub</h2>
               </div>
               
               <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', flex: 1 }}>
                 <form onSubmit={searchHuggingFace} style={{ display: 'flex', gap: '8px' }}>
                   <div style={{ position: 'relative', flex: 1 }}>
                     <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                     <input type="text" value={hfSearchQuery} onChange={e => setHfSearchQuery(e.target.value)} placeholder="Search GGUF models..." style={{ width: '100%', padding: '8px 10px 8px 30px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-main)', fontSize: '13px' }} />
                   </div>
                   <button type="submit" className="primary-btn" style={{ padding: '0 12px' }} disabled={hfIsSearching}>
                     {hfIsSearching ? '...' : 'Go'}
                   </button>
                 </form>

                 {Object.keys(hfDownloads).length > 0 && (
                   <div className="box" style={{ padding: '12px' }}>
                     <h4 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>Active Downloads</h4>
                     {Object.entries(hfDownloads).map(([id, dl]) => (
                       <div key={id} style={{ marginBottom: '12px' }}>
                         <div style={{ fontSize: '12px', color: 'var(--text-main)', marginBottom: '4px', wordBreak: 'break-all' }}>{dl.filename}</div>
                         <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                           <div style={{ flex: 1, height: '4px', background: 'var(--bg-input)', borderRadius: '2px', overflow: 'hidden' }}>
                             <div style={{ width: `${dl.progress}%`, height: '100%', background: dl.status === 'error' ? '#ef4444' : '#10b981', transition: 'width 0.5s ease' }}></div>
                           </div>
                           <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{dl.progress.toFixed(1)}%</span>
                         </div>
                         {dl.status === 'error' && <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>{dl.error}</div>}
                         {dl.status === 'completed' && <div style={{ fontSize: '11px', color: '#10b981', marginTop: '4px' }}>Completed</div>}
                       </div>
                     ))}
                   </div>
                 )}

                 <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                   {hfSearchResults.map(repo => (
                     <div key={repo.id} className="box" style={{ padding: '12px', cursor: 'pointer', border: hfSelectedRepo === repo.id ? '1px solid var(--accent-color)' : '1px solid var(--border-color)' }} onClick={() => hfSelectedRepo === repo.id ? setHfSelectedRepo(null) : fetchRepoFiles(repo.id)}>
                       <div style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)', wordBreak: 'break-all' }}>{repo.id}</div>
                       <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Downloads: {repo.downloads}</div>
                       
                       {hfSelectedRepo === repo.id && (
                         <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                           {hfRepoFiles.length === 0 ? (
                             <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Loading files...</div>
                           ) : (
                             hfRepoFiles.map(f => {
                               const formatBytes = (bytes) => {
                                 if (!bytes) return '0 B';
                                 const k = 1024;
                                 const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
                                 const i = Math.floor(Math.log(bytes) / Math.log(k));
                                 return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
                               };
                               return (
                               <div key={f.rfilename} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--bg-input)' }}>
                                 <div style={{ fontSize: '11px', color: 'var(--text-main)', wordBreak: 'break-all', flex: 1, paddingRight: '8px' }}>{f.rfilename}</div>
                                 <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                   <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{formatBytes(f.size)}</span>
                                   <button className="primary-btn" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={(e) => { e.stopPropagation(); startHfDownload(repo.id, f.rfilename); }}>
                                     <Download size={12} />
                                   </button>
                                 </div>
                               </div>
                               );
                             })
                           )}
                         </div>
                       )}
                     </div>
                   ))}
                 </div>
               </div>
             </>
           )}

           {activeLeftTab === 'local-models' && (
             <>
               <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border-color)' }}>
                 <Database size={20} color="var(--text-muted)" />
                 <h2 style={{ fontSize: '13px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1.5px', margin: 0, color: 'var(--text-main)' }}>Local Models</h2>
               </div>
               <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', flex: 1 }}>
                 {models.map(m => (
                   <div key={m.id} className="box" style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                       <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-main)', wordBreak: 'break-all' }}>{m.id}</div>
                       <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{m.size_gb.toFixed(2)} GB</div>
                     </div>
                     <button className="danger-btn" style={{ padding: '8px' }} onClick={() => handleDeleteLocalModel(m.id)} title="Delete Model">
                       <Trash2 size={16} />
                     </button>
                   </div>
                 ))}
                 {models.length === 0 && (
                   <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', marginTop: '32px' }}>No local models found.</div>
                 )}
               </div>
             </>
           )}
          </div>
          <div 
            className="sidebar-resizer"
            onMouseDown={(e) => { e.preventDefault(); setIsSidebarDragging(true); }}
            style={{
              position: 'absolute', right: 0, top: 0, bottom: 0, width: '4px', minWidth: '4px',
              cursor: 'col-resize', zIndex: 10,
              background: isSidebarDragging ? 'var(--accent)' : 'transparent',
              transition: 'background 0.2s'
            }}
          />
        </div>

        
        {/* LEFT PANE */}
        <div className="left-pane" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ maxWidth: '1000px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', height: '100%', gap: '24px' }}>
            <div style={{ flex: '1 1 60%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <h3 style={{ fontSize: '14px', marginBottom: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', flexShrink: 0 }}>LOADED MODELS</h3>
              <div className="box" style={{ padding: '16px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', borderRadius: 0, marginTop: '-1px' }}>
              {activeServers.length > 0 ? (
                activeServers.map(server => {
                  const modelDetails = models.find(m => m.id === server.modelId);
                  if (!modelDetails) return null;
                  const isSelected = selectedModel && selectedModel.id === server.modelId;
                  
                  return (
                    <div key={server.modelId} style={{ 
                        border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border-color)', 
                        padding: '16px', 
                        borderRadius: 0,
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

          <div style={{ position: 'relative', flex: '1 1 40%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px' }}>Logs {selectedModel ? `(${selectedModel.name})` : ''}</h3>
                <button className="secondary-btn" onClick={handleClearLogs} title="Clear Logs" style={{ padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 0 }}>
                  <Trash2 size={14} color="var(--text-muted)" />
                </button>
              </div>
            <div className="terminal" ref={terminalRef} onScroll={handleTerminalScroll}>
              {!selectedModel ? (
                 systemLogs.length === 0 ? 
                   <div style={{ color: 'var(--text-muted)' }}>System logs empty...</div> :
                   systemLogs.map((l, i) => <div key={i} className={`log-line ${formatLog(l)}`}>{l}</div>)
              ) : (
                 logs.map((l, i) => <div key={i} className={`log-line ${formatLog(l)}`}>{l}</div>)
              )}
            </div>
            {showScrollButton && (
                <button 
                    className="primary-btn" 
                    style={{ position: 'absolute', bottom: '20px', right: '30px', padding: '6px 12px', opacity: 0.8, borderRadius: '4px', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.5)', border: '1px solid var(--border-color)' }}
                    onClick={() => {
                        terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
                        autoScrollEnabled.current = true;
                        setShowScrollButton(false);
                    }}
                >
                    ↓ Jump to Bottom
                </button>
            )}
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="right-pane" style={{ width: '470px', display: 'flex', overflow: 'hidden' }}>
          <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <Settings2 size={20} color="var(--text-muted)" />
            <h2 style={{ fontSize: '13px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1.5px', margin: 0, color: 'var(--text-main)' }}>
              {selectedModel ? selectedModel.name : 'Settings'}
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
            <div className={`tab-btn ${activeTab === 'benchmark' ? 'active' : ''}`} onClick={() => setActiveTab('benchmark')} title="Benchmark">
              <Gauge size={16} /> <span className="tab-label">Benchmark</span>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            
            {activeTab === 'info' && (
              selectedModel ? (
                <div style={{ padding: '16px' }}>
                  <div style={{ marginBottom: '16px', fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}><Info size={16} color="var(--text-main)" /> Model Information</div>
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
                  <MemoryEstimator selectedModel={selectedModel} config={config} activeDevices={activeDevices} telemetry={telemetry} />
                  <div className="form-section">
                    <div style={{ marginBottom: '16px', fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}><Settings size={16} color="var(--text-main)" /> Engine & Context</div>
                    
                    <div style={{ marginBottom: '20px' }}>
                      <div className="form-row" style={{ marginBottom: '12px' }}>
                        <span>Engine</span>
                        <select className="select-input" name="engineId" value={config.engineId || ''} onChange={handleConfigChange}>
                           {installedEngines.map(e => <option key={e} value={e}>{e}</option>)}
                        </select>
                      </div>
                      <div className="form-row">
                        <span>Context Length</span>
                        <input type="number" className="num-input" name="ctxSize" value={config.ctxSize} max={selectedModel?.context_length || 128000} onChange={handleConfigChange} />
                      </div>
                      <input type="range" className="range-slider" min="256" max={selectedModel?.context_length || 128000} step="256" name="ctxSize" value={config.ctxSize} onChange={handleConfigChange} />
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                        Maximum context for this model is {selectedModel?.context_length ? selectedModel.context_length : '128000'}.
                      </div>
                    </div>

                    <div style={{ marginTop: '24px' }}>
                      <div style={{ marginBottom: '16px', fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}><Layers size={16} color="var(--text-main)" /> Device Layer Allocation</div>
                      
                      <div style={{ marginBottom: '16px' }}>
                        <div className="form-row">
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Cpu size={14}/> {telemetry?.host?.cpu_name || 'Host (CPU)'}</span>
                          <input type="number" className="num-input" value={cpuLayers} max={maxLayers} onChange={(e) => handleAllocationChange('cpu', e.target.value)} />
                        </div>
                        <input type="range" className="range-slider" min="0" max={maxLayers} value={cpuLayers} onChange={(e) => handleAllocationChange('cpu', e.target.value)} />
                      </div>

                      {activeDevices.map(d => (
                        <div key={d.id} style={{ marginBottom: '16px' }}>
                          <div className="form-row">
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              {d.name.includes(': ') ? (
                                <>
                                  <span style={{ width: '16px', textAlign: 'left', display: 'inline-block', flexShrink: 0 }}>{d.name.split(': ')[0]}:</span>
                                  <span>{d.name.split(': ').slice(1).join(': ')}</span>
                                </>
                              ) : d.name}
                            </span>
                            <input type="number" className="num-input" value={allocs[d.id] || 0} max={maxLayers} onChange={(e) => handleAllocationChange(d.id, e.target.value)} />
                          </div>
                          <input type="range" className="range-slider" min="0" max={maxLayers} value={allocs[d.id] || 0} onChange={(e) => handleAllocationChange(d.id, e.target.value)} />
                        </div>
                      ))}

                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px', display: 'flex', gap: '8px' }}>
                        <Info size={14}/> <span>Distribute {maxLayers} layers explicitly across your compute devices.</span>
                      </div>
                      
                      {selectedModel?.architecture?.includes('moe') && (
                        <div style={{ marginTop: '24px' }}>
                          <div style={{ marginBottom: '16px', fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Cpu size={16} color="var(--text-main)" /> MoE Expert Offload
                          </div>
                          <div style={{ marginBottom: '8px' }}>
                            <div className="form-row">
                              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>Experts to CPU</span>
                              <input type="number" className="num-input" name="moeCpuLayers" value={config.moeCpuLayers} max={selectedModel.block_count || maxLayers} onChange={handleConfigChange} />
                            </div>
                            <input type="range" className="range-slider" min="0" max={selectedModel.block_count || maxLayers} name="moeCpuLayers" value={config.moeCpuLayers} onChange={handleConfigChange} />
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px', display: 'flex', gap: '8px' }}>
                            <Info size={14}/> <span>Offloads massive expert weights to System RAM to save VRAM, while keeping Attention on the GPU for speed.</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="form-section">
                    <div style={{ marginBottom: '16px', fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}><BookOpen size={16} color="var(--text-main)" /> Advanced</div>
                    
                    <div className="form-row" style={{marginBottom: '16px'}}>
                      <span>CPU Thread Pool Size</span>
                      <input type="number" className="num-input" name="threads" value={config.threads} max={telemetry?.host?.physical_cores || navigator.hardwareConcurrency || 32} onChange={handleConfigChange} />
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
                <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflowY: 'auto' }}>
                  <div className="form-section">
                    <h4 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px', marginTop: '4px', color: 'var(--text-main)' }}>GPUs</h4>
                    {(!config.localGpus || config.localGpus.length === 0) ? (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px', fontSize: '12px' }}>No GPUs detected.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '32px' }}>
                        {config.localGpus.map((gpu, idx) => (
                          <div key={idx} className="form-row" style={{ background: 'var(--bg-input)', padding: '8px 12px', borderRadius: '6px', marginBottom: 0 }}>
                            <span style={{ fontSize: '13px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ width: '16px', textAlign: 'left', display: 'inline-block' }}>{gpu.index}:</span>
                              <span style={{ color: 'var(--text-muted)' }}>{gpu.name}</span>
                            </span>
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
                              <Network size={16} color="var(--text-muted)" />
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
            )}

            {activeTab === 'benchmark' && (
              selectedModel ? (
                <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}><Gauge size={16} color="var(--text-main)" /> Hardware Benchmark</div>
                    <button className="primary-btn" disabled={benchmarkStatus.isRunning} onClick={() => {
                      fetch('http://127.0.0.1:3001/api/server/benchmark/start', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...config, modelId: selectedModel.id, rpcServers: serverSettings.rpcServers || [] })
                      }).then(() => {
                        setBenchmarkStatus(prev => ({ ...prev, isRunning: true, logs: [], pp: null, tg: null }));
                      });
                    }}>
                      {benchmarkStatus.isRunning ? 'Running...' : 'Run Benchmark'}
                    </button>
                  </div>
                  
                  <div className="box" style={{ flex: 1, minHeight: '300px', display: 'flex', flexDirection: 'column', borderRadius: 0 }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', fontSize: '13px', fontWeight: '600', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      Terminal Output
                      <button style={{ background: 'transparent', color: 'var(--text-muted)', display: 'flex', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => {
                        fetch('http://127.0.0.1:3001/api/server/benchmark/clear', { method: 'POST' });
                        setBenchmarkStatus(prev => ({ ...prev, logs: [], pp: null, tg: null }));
                      }} title="Clear Logs">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="terminal" style={{ margin: 0, border: 'none', borderTop: 'none', flex: 1, minHeight: 0 }}>
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

            
          </div>

          {activeTab === 'load' && selectedModel && !isModelRunning && (
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

          {activeTab === 'load' && selectedModel && isModelRunning && isConfigDirty() && (
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
