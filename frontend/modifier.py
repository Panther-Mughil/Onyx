import sys

with open('src/App.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Fetch settings on mount
mount_effect = '''  useEffect(() => {
    fetch('http://127.0.0.1:3001/api/settings')
      .then(res => res.json())
      .then(data => {
        if (Object.keys(data).length > 0) {
          setServerSettings(data);
        }
      })
      .catch(() => {});
      
    fetchStatusAndLogs();
    const interval = setInterval(fetchStatusAndLogs, 1000);
    return () => clearInterval(interval);
  }, []);'''

code = code.replace(
'''  useEffect(() => {
    fetchStatusAndLogs();
    const interval = setInterval(fetchStatusAndLogs, 1000);
    return () => clearInterval(interval);
  }, []);''',
mount_effect
)


# 2. Save settings helper and proxy state
save_helper = '''  const [isProxyRunning, setIsProxyRunning] = useState(true);
  const [systemLogs, setSystemLogs] = useState([]);

  const saveSettings = (newSettings) => {
    setServerSettings(newSettings);
    fetch('http://127.0.0.1:3001/api/settings/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings)
    }).catch(() => {});
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
'''

code = code.replace('  const logsEndRef = useRef(null);', save_helper + '\n  const logsEndRef = useRef(null);')

# 3. Fetch system logs
fetch_sys_logs = '''
  useEffect(() => {
    if (!selectedModel) {
      fetch('http://127.0.0.1:3001/api/system/logs')
        .then(res => res.json())
        .then(data => setSystemLogs(data))
        .catch(() => {});
    }
  }, [selectedModel, activeServers]);
'''

code = code.replace(
'''  useEffect(() => {
    if (selectedModel) {
      fetch(`http://127.0.0.1:3001/api/server/logs?modelId=${selectedModel.id}`)
        .then(res => res.json())
        .then(data => setLogs(data))
        .catch(() => {});
    } else {
      setLogs([]);
    }
  }, [selectedModel, activeServers]);''',
'''  useEffect(() => {
    if (selectedModel) {
      fetch(`http://127.0.0.1:3001/api/server/logs?modelId=${selectedModel.id}`)
        .then(res => res.json())
        .then(data => setLogs(data))
        .catch(() => {});
    } else {
      setLogs([]);
    }
  }, [selectedModel, activeServers]);''' + fetch_sys_logs
)

# 4. Master Gateway Toggle UI
gateway_ui = '''        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-input)', padding: '6px 12px', borderRadius: '20px' }}>
             <button 
                onClick={toggleProxy}
                style={{ 
                  background: isProxyRunning ? 'var(--ready-green)' : '#ef4444', 
                  color: '#fff',
                  border: 'none',
                  borderRadius: '50%',
                  width: '12px',
                  height: '12px',
                  padding: 0,
                  cursor: 'pointer',
                  boxShadow: `0 0 8px ${isProxyRunning ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`
                }}
             />
             <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-main)' }}>
                Gateway: {isProxyRunning ? 'Running' : 'Stopped'}
             </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--bg-input)', padding: '6px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: '500' }}>
            <span style={{ color: 'var(--accent)' }}>Active Models: {activeServers.length}</span>
          </div>'''

code = code.replace(
'''        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--bg-input)', padding: '6px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: '500' }}>
            <span style={{ color: 'var(--accent)' }}>Active Models: {activeServers.length}</span>
          </div>''',
gateway_ui
)

# 5. Developer Logs (System logs fallback)
sys_logs_ui = '''            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 style={{ fontSize: '14px', fontWeight: '600' }}>{selectedModel ? `Developer Logs (${selectedModel.name})` : 'System Logs'}</h2>
              {selectedModel && (
                <button className="secondary-btn" style={{ padding: '6px 12px', fontSize: '11px' }} onClick={handleClearLogs}>
                  <Trash2 size={12} style={{ marginRight: '6px' }} /> Clear Logs
                </button>
              )}
            </div>
            <div className="terminal" style={{ flex: 1 }}>
              {(selectedModel ? logs : systemLogs).map((log, i) => (
                <div key={i} className="log-line">
                  {log.includes('W ') || log.includes('warning') || log.includes('error') ? (
                    <span style={{ color: '#eab308' }}>{log}</span>
                  ) : log.includes('model loaded') || log.includes('HTTP server listening') || log.includes('[System]') ? (
                    <span style={{ color: 'var(--accent)' }}>{log}</span>
                  ) : (
                    log
                  )}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>'''

code = code.replace(
'''            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 style={{ fontSize: '14px', fontWeight: '600' }}>Developer Logs {selectedModel ? `(${selectedModel.name})` : ''}</h2>
              <button className="secondary-btn" style={{ padding: '6px 12px', fontSize: '11px' }} onClick={handleClearLogs}>
                <Trash2 size={12} style={{ marginRight: '6px' }} /> Clear Logs
              </button>
            </div>
            <div className="terminal" style={{ flex: 1 }}>
              {logs.map((log, i) => (
                <div key={i} className="log-line">
                  {log.includes('W ') || log.includes('warning') || log.includes('error') ? (
                    <span style={{ color: '#eab308' }}>{log}</span>
                  ) : log.includes('model loaded') || log.includes('HTTP server listening') ? (
                    <span style={{ color: 'var(--accent)' }}>{log}</span>
                  ) : (
                    log
                  )}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>''',
sys_logs_ui
)

# 6. Physical Loading Bar
physical_bar = '''                      {!server.isReady && (
                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)' }}>
                            <span>Loading weights into VRAM...</span>
                            <span>{Math.floor(server.progress || 0)}%</span>
                          </div>
                          <div style={{ width: '100%', height: '4px', background: 'var(--bg-main)', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{ width: `${server.progress || 0}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.5s ease-out' }}></div>
                          </div>
                        </div>
                      )}'''

code = code.replace(
'''                      {!server.isReady && (
                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)' }}>
                            <span>Loading weights...</span>
                            <span>{loadingProgresses[server.modelId] || 0}%</span>
                          </div>
                          <div style={{ width: '100%', height: '4px', background: 'var(--bg-main)', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{ width: `${loadingProgresses[server.modelId] || 0}%`, height: '100%', background: '#eab308', transition: 'width 0.1s' }}></div>
                          </div>
                        </div>
                      )}''',
physical_bar
)

# 7. Devices Tab Rename
code = code.replace(
'''              <button className={`tab-btn ${activeTab === 'rpc' ? 'active' : ''}`} onClick={() => setActiveTab('rpc')}>
                <Network size={16} /> RPC
              </button>''',
'''              <button className={`tab-btn ${activeTab === 'rpc' ? 'active' : ''}`} onClick={() => setActiveTab('rpc')}>
                <Network size={16} /> Devices
              </button>'''
)

code = code.replace(
'''              <div className="tab-pane">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: '600' }}>RPC Workers</h3>''',
'''              <div className="tab-pane">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: '600' }}>Device Allocation (Local & RPC)</h3>'''
)

# 8. Save Settings usage
code = code.replace('setServerSettings({...serverSettings,', 'saveSettings({...serverSettings,')
code = code.replace('setServerSettings({...serverSettings, port:', 'saveSettings({...serverSettings, port:')

with open('src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(code)

print('Success')
