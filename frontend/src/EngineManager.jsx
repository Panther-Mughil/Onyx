import React, { useState, useEffect } from 'react';
import { Download, Terminal, Wrench, Settings, Search, CheckCircle } from 'lucide-react';

export default function EngineManager({ apiBase }) {
    const [sysInfo, setSysInfo] = useState(null);
    const [releases, setReleases] = useState([]);
    const [installed, setInstalled] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeAction, setActiveAction] = useState(null); 

    useEffect(() => {
        fetchSysInfo();
        fetchInstalled();
        fetchReleases();
    }, []);

    const fetchSysInfo = async () => {
        try {
            const res = await fetch(`${apiBase}/api/system/info`);
            if (res.ok) setSysInfo(await res.json());
        } catch (e) {
            console.error(e);
        }
    };

    const fetchInstalled = async () => {
        try {
            const res = await fetch(`${apiBase}/api/engines`);
            if (res.ok) setInstalled(await res.json());
        } catch (e) {
            console.error(e);
        }
    };

    const fetchReleases = async () => {
        try {
            const res = await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest');
            if (res.ok) {
                const data = await res.json();
                setReleases(data.assets || []);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const pollInstallStatus = (id) => {
        const interval = setInterval(async () => {
            try {
                const res = await fetch(`${apiBase}/api/engines`);
                if (res.ok) {
                    const data = await res.json();
                    setInstalled(data);
                    if (data.includes(id)) {
                        clearInterval(interval);
                        setActiveAction(null);
                    }
                }
            } catch (e) {}
        }, 5000);
    };

    const downloadEngine = async (engineId, url) => {
        setActiveAction(engineId);
        try {
            await fetch(`${apiBase}/api/engines/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ engine_id: engineId, url_or_flags: url })
            });
            pollInstallStatus(engineId);
        } catch (e) {
            console.error(e);
            setActiveAction(null);
        }
    };

    const compileEngine = async (engineId, flags) => {
        setActiveAction(engineId);
        try {
            await fetch(`${apiBase}/api/engines/compile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ engine_id: engineId, url_or_flags: flags })
            });
            pollInstallStatus(engineId);
        } catch (e) {
            console.error(e);
            setActiveAction(null);
        }
    };

    if (loading) return <div style={{ padding: '20px', color: 'var(--text-muted)' }}>Loading Engines...</div>;

    const isWin = sysInfo?.os === 'windows';
    const isMac = sysInfo?.os === 'macos';
    const isLinux = sysInfo?.os === 'linux';
    const hasNvidia = sysInfo?.has_nvidia;

    const findAsset = (includes) => releases.find(a => includes.every(i => a.name.includes(i)) && a.name.endsWith('.zip') && !a.name.includes('rpc'));

    const options = [];

    if (isWin) {
        if (hasNvidia) {
            options.push({ id: 'llama.cpp (CUDA 12)', label: 'llama.cpp (CUDA 12)', asset: findAsset(['bin-win-cuda-cu12']) });
            options.push({ id: 'llama.cpp (CUDA 11)', label: 'llama.cpp (CUDA 11)', asset: findAsset(['bin-win-cuda-cu11']) });
        }
        options.push({ id: 'llama.cpp (Vulkan)', label: 'llama.cpp (Vulkan)', asset: findAsset(['bin-win-vulkan-x64']) });
        options.push({ id: 'llama.cpp (CPU)', label: 'llama.cpp (CPU AVX2)', asset: findAsset(['bin-win-avx2-x64']) });
    } else if (isMac) {
        options.push({ id: 'llama.cpp (Metal Silicon)', label: 'llama.cpp (Metal Silicon)', compile: 'mac-silicon' });
        options.push({ id: 'llama.cpp (Metal Intel)', label: 'llama.cpp (Metal Intel)', compile: 'mac-intel' });
    } else if (isLinux) {
        options.push({ id: 'llama.cpp (CUDA)', label: 'llama.cpp (CUDA)', compile: 'linux-cuda' });
        options.push({ id: 'llama.cpp (Vulkan)', label: 'llama.cpp (Vulkan)', compile: 'linux-vulkan' });
        options.push({ id: 'llama.cpp (CPU)', label: 'llama.cpp (CPU)', compile: 'linux-cpu' });
    }

    return (
        <div style={{ padding: '24px', color: 'var(--text-main)', height: '100%', overflowY: 'auto' }}>
            <h2 style={{ fontSize: '18px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px', fontWeight: '600' }}>
                <Wrench size={24} color="#6366f1" /> Engine Manager
            </h2>
            
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', padding: '16px', borderRadius: '12px', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '13px', marginBottom: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Detected System</h3>
                <div style={{ display: 'flex', gap: '24px', fontSize: '14px' }}>
                    <div><span style={{color: 'var(--text-muted)'}}>OS:</span> {sysInfo?.os || 'Unknown'}</div>
                    <div><span style={{color: 'var(--text-muted)'}}>Architecture:</span> {sysInfo?.arch || 'Unknown'}</div>
                    <div><span style={{color: 'var(--text-muted)'}}>NVIDIA GPU:</span> {sysInfo?.has_nvidia ? 'Yes' : 'No'}</div>
                </div>
            </div>

            {isLinux && (
                <div style={{ background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)', padding: '16px', borderRadius: '12px', marginBottom: '24px' }}>
                    <h4 style={{ margin: '0 0 8px 0', color: '#eab308', fontSize: '14px' }}>Linux Dependencies Required</h4>
                    <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: 'rgba(255,255,255,0.8)' }}>Before compiling, please run the following command in your terminal to ensure you have the required build tools:</p>
                    <code style={{ background: 'rgba(0,0,0,0.5)', padding: '12px', display: 'block', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace', color: '#a78bfa' }}>
                        {sysInfo?.distro === 'arch' ? `sudo pacman -S --needed cmake base-devel ${hasNvidia ? 'cuda' : ''}`
                         : sysInfo?.distro === 'fedora' ? `sudo dnf install -y cmake gcc gcc-c++ ${hasNvidia ? 'cuda-toolkit' : ''}`
                         : `sudo apt-get update && sudo apt-get install -y cmake build-essential ${hasNvidia ? 'nvidia-cuda-toolkit' : ''}`}
                    </code>
                </div>
            )}

            <h3 style={{ fontSize: '15px', marginBottom: '16px', fontWeight: '500' }}>Recommended Engines</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {options.map(opt => {
                    const isInstalled = installed.includes(opt.id);
                    const isActive = activeAction === opt.id;
                    
                    return (
                        <div key={opt.id} style={{ 
                            background: 'rgba(255,255,255,0.02)', 
                            border: '1px solid rgba(255,255,255,0.08)',
                            padding: '16px 20px',
                            borderRadius: '12px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            transition: 'all 0.2s ease'
                        }}>
                            <div>
                                <div style={{ fontWeight: '600', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    {opt.label}
                                    {isInstalled && <span style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#10b981', fontSize: '10px', padding: '3px 8px', borderRadius: '12px', fontWeight: 'bold' }}>INSTALLED</span>}
                                </div>
                                {opt.asset && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>Asset: {opt.asset.name}</div>}
                            </div>
                            
                            <div style={{ display: 'flex', gap: '8px' }}>
                                {isActive ? (
                                    <button className="secondary-btn" disabled style={{ opacity: 0.7 }}>Working...</button>
                                ) : isInstalled ? (
                                    <button className="secondary-btn" disabled style={{ color: '#10b981' }}><CheckCircle size={16} /> Ready</button>
                                ) : opt.compile ? (
                                    <button className="primary-btn" onClick={() => compileEngine(opt.id, opt.compile)}><Terminal size={16} /> Compile</button>
                                ) : opt.asset ? (
                                    <button className="primary-btn" onClick={() => downloadEngine(opt.id, opt.asset.browser_download_url)}><Download size={16} /> Download</button>
                                ) : (
                                    <span style={{ fontSize: '13px', color: '#ef4444' }}>Release Not Found</span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
            
            <div style={{ marginTop: '32px', fontSize: '13px', color: 'var(--text-muted)', padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                <p style={{ margin: 0 }}><strong>Note:</strong> Download and compilation progress is logged directly to the System Console. Click the <strong style={{color: '#fff'}}>Onyx Logo</strong> in the top left of the dashboard to view the live logs.</p>
            </div>
        </div>
    );
}
