import sys

with open('src/App.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Fix settings merge
code = code.replace(
'''      .then(data => {
        if (Object.keys(data).length > 0) {
          setServerSettings(data);
        }
      })''',
'''      .then(data => {
        if (Object.keys(data).length > 0) {
          setServerSettings(prev => ({ ...prev, ...data }));
        }
      })'''
)

# Fix Device heading UI
old_ui = '''                  <div className="form-section">
                    <div className="form-section-title"><Network size={16}/> Device Allocation (Local & RPC)</div>
                    <h4 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px', marginTop: '16px', color: 'var(--text-main)' }}>Local GPUs</h4>
                    {(!config.localGpus || config.localGpus.length === 0) ? (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px', fontSize: '12px' }}>No local GPUs detected yet.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>'''

new_ui = '''                  <div className="form-section">
                    <h4 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px', marginTop: '4px', color: 'var(--text-main)' }}>GPUs</h4>
                    {(!config.localGpus || config.localGpus.length === 0) ? (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px', fontSize: '12px' }}>No GPUs detected.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '32px' }}>'''

code = code.replace(old_ui, new_ui)

with open('src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(code)

print('Success')
