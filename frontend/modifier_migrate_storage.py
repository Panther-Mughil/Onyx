import sys

with open('src/App.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Remove appliedConfigs useState and useEffect
old_applied_configs = '''  const [appliedConfigs, setAppliedConfigs] = useState(() => {
    const saved = localStorage.getItem('applied_configs');
    return saved ? JSON.parse(saved) : {};
  });

  useEffect(() => {
    localStorage.setItem('applied_configs', JSON.stringify(appliedConfigs));
  }, [appliedConfigs]);'''

new_applied_configs = '''  const appliedConfigs = serverSettings.appliedConfigs || {};
  const savedModelConfigs = serverSettings.savedModelConfigs || {};'''

code = code.replace(old_applied_configs, new_applied_configs)

# 2. Modify useEffect for selectedModel to use savedModelConfigs
old_selected_model_effect = '''  useEffect(() => {
    if (selectedModel) {
      const savedConfig = localStorage.getItem(`model_config_${selectedModel.id}`);
      if (savedConfig) {
        try {
          setConfig(JSON.parse(savedConfig));
          setRememberSettings(true);
        } catch (e) {
          setConfig(initialConfig);
          setRememberSettings(false);
        }
      } else {
        setConfig(initialConfig);
        setRememberSettings(false);
      }
    }
  }, [selectedModel]);'''

new_selected_model_effect = '''  useEffect(() => {
    if (selectedModel) {
      const savedConfig = serverSettings.savedModelConfigs?.[selectedModel.id];
      if (savedConfig) {
        setConfig(savedConfig);
        setRememberSettings(true);
      } else {
        setConfig(initialConfig);
        setRememberSettings(false);
      }
    }
  }, [selectedModel]); // Do not add serverSettings.savedModelConfigs as a dependency to prevent overwriting ongoing user edits'''

code = code.replace(old_selected_model_effect, new_selected_model_effect)

# 3. Modify handleStartServer to save config and appliedConfigs to serverSettings
old_start_server = '''    const handleStartServer = async () => {
    if (!selectedModel) return;
    try {
      if (rememberSettings) {
        localStorage.setItem(`model_config_${selectedModel.id}`, JSON.stringify(config));
      } else {
        localStorage.removeItem(`model_config_${selectedModel.id}`);
      }

      const response = await fetch('http://127.0.0.1:3001/api/server/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: selectedModel.id, ...config })
      });
      const result = await response.json();
      if (!result.success) {
        alert("Error starting server: " + result.message);
      } else {
        setAppliedConfigs(prev => ({ ...prev, [selectedModel.id]: { ...config } }));
      }
    } catch (err) {
      alert("Failed to reach backend.");
    }
  };'''

new_start_server = '''  const handleStartServer = async () => {
    if (!selectedModel) return;
    try {
      const newSavedConfigs = { ...savedModelConfigs };
      if (rememberSettings) {
        newSavedConfigs[selectedModel.id] = config;
      } else {
        delete newSavedConfigs[selectedModel.id];
      }

      const newAppliedConfigs = { ...appliedConfigs, [selectedModel.id]: config };

      const response = await fetch('http://127.0.0.1:3001/api/server/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: selectedModel.id, ...config })
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
  };'''

code = code.replace(old_start_server, new_start_server)

# 4. Modify handleStopServer to remove appliedConfig from serverSettings
old_stop_server = '''  const handleStopServer = async (modelId) => {
    try {
      await fetch('http://127.0.0.1:3001/api/server/stop', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId })
      });
      setAppliedConfigs(prev => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
    } catch (err) {
      console.error(err);
    }
  };'''

new_stop_server = '''  const handleStopServer = async (modelId) => {
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
    } catch (err) {
      console.error(err);
    }
  };'''

code = code.replace(old_stop_server, new_stop_server)


with open('src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(code)

print('Success')
