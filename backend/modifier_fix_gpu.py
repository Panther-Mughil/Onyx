import sys

with open('src/main.rs', 'r', encoding='utf-8') as f:
    code = f.read()

old_logic = '''    let mut actual_gpu_layers = payload.gpu_layers;
    let mut dev_arg = None;

    if let Some(gpus) = &payload.local_gpus {
        let active_gpus: Vec<String> = gpus.iter()
            .filter(|g| g.active)
            .map(|g| g.index.to_string())
            .collect();
            
        if active_gpus.is_empty() {
            actual_gpu_layers = 0;
        } else {
            dev_arg = Some(active_gpus.join(","));
        }
    }'''

new_logic = '''    let mut actual_gpu_layers = payload.gpu_layers;
    let mut ts_arg = None;

    if let Some(gpus) = &payload.local_gpus {
        if !gpus.is_empty() {
            let max_index = gpus.iter().map(|g| g.index).max().unwrap_or(0);
            let mut splits = vec!["0"; max_index + 1];
            
            let mut any_active = false;
            let mut all_active = true;
            
            for g in gpus.iter() {
                if g.active {
                    splits[g.index] = "1";
                    any_active = true;
                } else {
                    all_active = false;
                }
            }
            
            if !any_active {
                actual_gpu_layers = 0;
            } else if !all_active {
                ts_arg = Some(splits.join(","));
            }
        }
    }'''

code = code.replace(old_logic, new_logic)

old_push = '''    if let Some(devs) = dev_arg {
        args.push("-dev".to_string());
        args.push(devs);
    }'''

new_push = '''    if let Some(ts) = ts_arg {
        args.push("-ts".to_string());
        args.push(ts);
    }'''

code = code.replace(old_push, new_push)

with open('src/main.rs', 'w', encoding='utf-8') as f:
    f.write(code)

print('Success')
