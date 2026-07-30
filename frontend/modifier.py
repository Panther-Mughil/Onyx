import sys

with open('src/App.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Update initial config to include localGpus
code = code.replace(
'''  const initialConfig = {
    ctxSize: 8192,
    gpuLayers: 99,
    threads: 8,
    evalBatchSize: 512,
    physicalBatchSize: 512,
    concurrency: 1,
    unifiedKv: true,
    offloadKv: true,
    keepInMemory: false,
    mmap: true,
    flashAttention: true,
    kCacheQuant: 'fp16',
    vCacheQuant: 'fp16',
    cpuMoe: false,
    rpcServers: []
  };''',
'''  const initialConfig = {
    ctxSize: 8192,
    gpuLayers: 99,
    threads: 8,
    evalBatchSize: 512,
    physicalBatchSize: 512,
    concurrency: 1,
    unifiedKv: true,
    offloadKv: true,
    keepInMemory: false,
    mmap: true,
    flashAttention: true,
    kCacheQuant: 'fp16',
    vCacheQuant: 'fp16',
    cpuMoe: false,
    rpcServers: [],
    localGpus: []
  };'''
)

# 2. Add an effect to populate localGpus from telemetry if empty
gpu_effect = '''  useEffect(() => {
    if (telemetry && telemetry.gpus && config.localGpus.length === 0) {
        const initGpus = telemetry.gpus.map((g, i) => ({ index: i, name: g.name, active: true }));
        setConfig(prev => ({ ...prev, localGpus: initGpus }));
    }
  }, [telemetry]);'''

# We will inject this near the fetchStatusAndLogs effect
code = code.replace('  const activeServersRef = useRef(activeServers);', gpu_effect + '\n  const activeServersRef = useRef(activeServers);')


# 3. Modify the Devices tab UI
old_devices_ui = '''                  <div className="form-section">
                    <div className="form-section-title"><Network size={16}/> Device Allocation (Local & RPC)</div>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>Add remote llama-rpc-server endpoints to distribute inference.</p>
                    
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                      <input 
                        type="text" 
                        className="text-input" 
                        placeholder="e.g. 192.168.1.100:50052" 
                        style={{ flex: 1 }}
                        value={newRpcInput}
                        onChange={(e) => setNewRpcInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddRpc(); }}
                      />
                      <button className="primary-btn" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={handleAddRpc}>
                        <Plus size={16} /> Add
                      </button>
                    </div>

                    {config.rpcServers.length === 0 ? (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px', fontSize: '12px' }}>No RPC workers added yet.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {config.rpcServers.map((server, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-input)', padding: '12px 16px', borderRadius: '8px' }}>
                            <span style={{ fontSize: '13px', fontFamily: 'monospace' }}>{server.address}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                              <label className="switch">
                                <input type="checkbox" checked={server.active} onChange={(e) => {
                                  const newServers = [...config.rpcServers];
                                  newServers[idx].active = e.target.checked;
                                  setConfig({ ...config, rpcServers: newServers });
                                }} />
                                <span className="slider"></span>
                              </label>
                              <button className="icon-btn" onClick={() => {
                                const newServers = config.rpcServers.filter((_, i) => i !== idx);
                                setConfig({ ...config, rpcServers: newServers });
                              }}>
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>'''

new_devices_ui = '''                  <div className="form-section">
                    <div className="form-section-title"><Network size={16}/> Device Allocation (Local & RPC)</div>
                    
                    <h4 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px', marginTop: '16px', color: 'var(--text-main)' }}>Local GPUs</h4>
                    {(!config.localGpus || config.localGpus.length === 0) ? (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px', fontSize: '12px' }}>No local GPUs detected yet.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
                        {config.localGpus.map((gpu, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-input)', padding: '12px 16px', borderRadius: '8px' }}>
                            <span style={{ fontSize: '13px', fontWeight: '500' }}>GPU {gpu.index}: <span style={{ color: 'var(--text-muted)' }}>{gpu.name}</span></span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                              <label className="switch">
                                <input type="checkbox" checked={gpu.active} onChange={(e) => {
                                  const newGpus = [...config.localGpus];
                                  newGpus[idx].active = e.target.checked;
                                  setConfig({ ...config, localGpus: newGpus });
                                }} />
                                <span className="slider"></span>
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <h4 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px', color: 'var(--text-main)' }}>RPC Workers</h4>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>Add remote llama-rpc-server endpoints to distribute inference across the network.</p>
                    
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                      <input 
                        type="text" 
                        className="text-input" 
                        placeholder="e.g. 192.168.1.100:50052" 
                        style={{ flex: 1 }}
                        value={newRpcInput}
                        onChange={(e) => setNewRpcInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddRpc(); }}
                      />
                      <button className="primary-btn" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={handleAddRpc}>
                        <Plus size={16} /> Add
                      </button>
                    </div>

                    {config.rpcServers.length === 0 ? (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px', fontSize: '12px' }}>No RPC workers added yet.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {config.rpcServers.map((server, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-input)', padding: '12px 16px', borderRadius: '8px' }}>
                            <span style={{ fontSize: '13px', fontFamily: 'monospace' }}>{server.address}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                              <label className="switch">
                                <input type="checkbox" checked={server.active} onChange={(e) => {
                                  const newServers = [...config.rpcServers];
                                  newServers[idx].active = e.target.checked;
                                  setConfig({ ...config, rpcServers: newServers });
                                }} />
                                <span className="slider"></span>
                              </label>
                              <button className="icon-btn" onClick={() => {
                                const newServers = config.rpcServers.filter((_, i) => i !== idx);
                                setConfig({ ...config, rpcServers: newServers });
                              }}>
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>'''

code = code.replace(old_devices_ui, new_devices_ui)

with open('src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(code)

print('Success')
