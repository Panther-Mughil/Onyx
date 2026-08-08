import sys

with open('frontend/src/App.jsx', 'r') as f:
    content = f.read()

# 1. Update imports
import_idx = content.find("from 'lucide-react'")
if import_idx == -1:
    print("lucide-react not found")
    sys.exit(1)
bracket_start = content.rfind('{', 0, import_idx)
bracket_end = content.find('}', bracket_start)
imports_str = content[bracket_start+1:bracket_end]
new_imports = imports_str + ", Box, Download, Search, FileDown, FolderDown"
content = content[:bracket_start+1] + new_imports + content[bracket_end:]

# 2. Add State variables
state_idx = content.find('const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);')
if state_idx == -1:
    print("isLeftSidebarOpen state not found")
    sys.exit(1)

new_state = """  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [activeLeftTab, setActiveLeftTab] = useState('monitoring');
  const [hfSearchQuery, setHfSearchQuery] = useState('');
  const [hfSearchResults, setHfSearchResults] = useState([]);
  const [hfIsSearching, setHfIsSearching] = useState(false);
  const [hfDownloads, setHfDownloads] = useState({});
  const [hfSelectedRepo, setHfSelectedRepo] = useState(null);
  const [hfRepoFiles, setHfRepoFiles] = useState([]);
"""
content = content[:state_idx] + new_state + content[state_idx + len('const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);'):]

# 3. Add useEffect for HF downloads
use_effect_idx = content.find('useEffect(() => {', state_idx)
hf_effect = """
  useEffect(() => {
    let interval;
    if (activeLeftTab === 'huggingface') {
        interval = setInterval(async () => {
            try {
                const res = await fetch(`${API_URL}/api/huggingface/downloads`);
                const data = await res.json();
                setHfDownloads(data);
            } catch (e) {}
        }, 1000);
    }
    return () => clearInterval(interval);
  }, [activeLeftTab]);

  const searchHuggingFace = async (e) => {
    e.preventDefault();
    if (!hfSearchQuery.trim()) return;
    setHfIsSearching(true);
    try {
        const res = await fetch(`${API_URL}/api/huggingface/search?q=${encodeURIComponent(hfSearchQuery)}`);
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
        const res = await fetch(`${API_URL}/api/huggingface/model?id=${encodeURIComponent(repoId)}`);
        const data = await res.json();
        if (data.siblings) {
            const ggufs = data.siblings.filter(f => f.rfilename.endsWith('.gguf'));
            setHfRepoFiles(ggufs);
        }
    } catch(err) {
        console.error(err);
    }
  };

  const startHfDownload = async (repoId, filename) => {
    try {
        await fetch(`${API_URL}/api/huggingface/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo_id: repoId, filename })
        });
        // Immediately fetch to show it
        const res = await fetch(`${API_URL}/api/huggingface/downloads`);
        const data = await res.json();
        setHfDownloads(data);
    } catch(err) {
        console.error(err);
    }
  };

"""
content = content[:use_effect_idx] + hf_effect + content[use_effect_idx:]

# 4. Modify sidebar UI
activity_bar_idx = content.find('<div className="activity-bar">')
activity_end_idx = content.find('</div>', activity_bar_idx) + 6

new_activity_bar = """        <div className="activity-bar">
           <button className={`activity-icon ${(isLeftSidebarOpen && activeLeftTab === 'monitoring') ? 'active' : ''}`} onClick={() => {
               if (isLeftSidebarOpen && activeLeftTab === 'monitoring') setIsLeftSidebarOpen(false);
               else { setIsLeftSidebarOpen(true); setActiveLeftTab('monitoring'); }
           }} title="Monitoring">
              <Activity size={24} />
           </button>
           <button className={`activity-icon ${(isLeftSidebarOpen && activeLeftTab === 'huggingface') ? 'active' : ''}`} onClick={() => {
               if (isLeftSidebarOpen && activeLeftTab === 'huggingface') setIsLeftSidebarOpen(false);
               else { setIsLeftSidebarOpen(true); setActiveLeftTab('huggingface'); }
           }} title="HuggingFace Hub">
              <Box size={24} />
           </button>
        </div>"""
content = content[:activity_bar_idx] + new_activity_bar + content[activity_end_idx:]

# 5. Modify sidebar content rendering
sidebar_idx = content.find('<div className={`left-sidebar ${isLeftSidebarOpen ? \'open\' : \'\'}`}>')
sidebar_content_start = content.find('>', sidebar_idx) + 1
sidebar_end_idx = content.find('</div>\n\n        {/* Center Canvas */}')

sidebar_ui_code = """
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
                        </div>
                        {telemetry.gpus.map((gpu, idx) => (
                           <div key={idx} className="box" style={{ padding: '16px' }}>
                             <h4 style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: '#10b981' }}><Gpu size={16}/> {gpu.name}</h4>
                             <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div className="info-row" style={{ padding: '4px 0' }}><span>VRAM Usage</span> <span style={{ color: getUsageColor((gpu.vram_used_mb/gpu.vram_total_mb)*100) }}>{Math.round(gpu.vram_used_mb)} / {Math.round(gpu.vram_total_mb)} MB</span></div>
                                <div className="info-row" style={{ padding: '4px 0' }}><span>GPU Util</span> <span style={{ color: getUsageColor(gpu.utilization_pct) }}>{gpu.utilization_pct}%</span></div>
                                <div className="info-row" style={{ padding: '4px 0', borderBottom: 'none' }}><span>Temp / Power</span> <span>{gpu.temperature_c}°C / {gpu.power_draw_w}W</span></div>
                             </div>
                           </div>
                        ))}
                      </>
                    )}
               </div>
             </>
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
                     <div key={repo.id} className="box" style={{ padding: '12px', cursor: 'pointer', border: hfSelectedRepo === repo.id ? '1px solid var(--accent-color)' : '1px solid var(--border-color)' }} onClick={() => fetchRepoFiles(repo.id)}>
                       <div style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)', wordBreak: 'break-all' }}>{repo.id}</div>
                       <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Downloads: {repo.downloads}</div>
                       
                       {hfSelectedRepo === repo.id && (
                         <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                           {hfRepoFiles.length === 0 ? (
                             <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Loading files...</div>
                           ) : (
                             hfRepoFiles.map(f => (
                               <div key={f.rfilename} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--bg-input)' }}>
                                 <div style={{ fontSize: '11px', color: 'var(--text-main)', wordBreak: 'break-all', flex: 1, paddingRight: '8px' }}>{f.rfilename}</div>
                                 <button className="primary-btn" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={(e) => { e.stopPropagation(); startHfDownload(repo.id, f.rfilename); }}>
                                   <Download size={12} />
                                 </button>
                               </div>
                             ))
                           )}
                         </div>
                       )}
                     </div>
                   ))}
                 </div>
               </div>
             </>
           )}
"""
content = content[:sidebar_content_start] + sidebar_ui_code + content[sidebar_end_idx:]

with open('frontend/src/App.jsx', 'w') as f:
    f.write(content)

print("Frontend patched successfully")
