import sys

with open('src/App.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Fix telemetry fetching to run globally
old_telemetry_fetch = '''  useEffect(() => {
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
  }, [activeTab]);'''

new_telemetry_fetch = '''  useEffect(() => {
    const fetchTelemetry = () => {
        fetch('http://127.0.0.1:3001/api/server/telemetry')
          .then(res => res.json())
          .then(data => setTelemetry(data))
          .catch(() => {});
    };
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 1000);
    return () => clearInterval(interval);
  }, []);'''

code = code.replace(old_telemetry_fetch, new_telemetry_fetch)

# 2. Add API Settings fetch on mount
old_systems_log_fetch = '''  useEffect(() => {
    if (!selectedModel) {
      fetch('http://127.0.0.1:3001/api/system/logs')
        .then(res => res.json())
        .then(data => setSystemLogs(data))
        .catch(() => {});
    }
  }, [selectedModel]);'''

new_systems_log_fetch = '''  useEffect(() => {
    fetch('http://127.0.0.1:3001/api/settings')
      .then(res => res.json())
      .then(data => {
        if (Object.keys(data).length > 0) {
          setServerSettings(prev => ({ ...prev, ...data }));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedModel) {
      fetch('http://127.0.0.1:3001/api/system/logs')
        .then(res => res.json())
        .then(data => setSystemLogs(data))
        .catch(() => {});
    }
  }, [selectedModel]);'''

code = code.replace(old_systems_log_fetch, new_systems_log_fetch)

# 3. Add Server toggle button next to Active Models
old_top_bar = '''          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-input)', padding: '4px 12px', borderRadius: '16px', fontSize: '12px' }}>
            Active Models: {activeServers.length}
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: activeServers.length > 0 ? 'var(--ready-green)' : 'var(--border-color)', marginLeft: '4px' }}></div>
          </div>
          <button className="secondary-btn" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setIsServerSettingsOpen(true)}>'''

new_top_bar = '''          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-input)', padding: '4px 12px', borderRadius: '16px', fontSize: '12px' }}>
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
          <button className="secondary-btn" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setIsServerSettingsOpen(true)}>'''

code = code.replace(old_top_bar, new_top_bar)

with open('src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(code)

print('Success')
