import sys

with open('src/App.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

old_state = '''  const [appliedConfigs, setAppliedConfigs] = useState({});'''

new_state = '''  const [appliedConfigs, setAppliedConfigs] = useState(() => {
    const saved = localStorage.getItem('applied_configs');
    return saved ? JSON.parse(saved) : {};
  });

  useEffect(() => {
    localStorage.setItem('applied_configs', JSON.stringify(appliedConfigs));
  }, [appliedConfigs]);'''

code = code.replace(old_state, new_state)

with open('src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(code)

print('Success')
