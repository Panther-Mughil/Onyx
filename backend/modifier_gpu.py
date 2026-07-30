import sys

with open('src/main.rs', 'r', encoding='utf-8') as f:
    code = f.read()

structs = '''#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct RpcServer {
    address: String,
    active: bool,
}'''

new_structs = '''#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct RpcServer {
    address: String,
    active: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct LocalGpu {
    index: usize,
    active: bool,
}'''

code = code.replace(structs, new_structs)

config_struct = '''    cpu_moe: bool,
    rpc_servers: Option<Vec<RpcServer>>,
}'''

new_config_struct = '''    cpu_moe: bool,
    rpc_servers: Option<Vec<RpcServer>>,
    local_gpus: Option<Vec<LocalGpu>>,
}'''

code = code.replace(config_struct, new_config_struct)

# Modifying start_server
old_args = '''    let mut args = vec![
        "-m".to_string(), model_path.clone(),
        "-c".to_string(), payload.ctx_size.to_string(),
        "-ngl".to_string(), payload.gpu_layers.to_string(),
        "-t".to_string(), payload.threads.to_string(),
        "-b".to_string(), payload.eval_batch_size.to_string(),
        "-ub".to_string(), payload.physical_batch_size.to_string(),
        "-np".to_string(), payload.concurrency.to_string(),
        "--cache-type-k".to_string(), payload.k_cache_quant.clone(),
        "--cache-type-v".to_string(), payload.v_cache_quant.clone(),
        "--host".to_string(), "127.0.0.1".to_string(),
        "--port".to_string(), port.to_string(),
    ];

    if let Some(servers) = &payload.rpc_servers {'''

new_args = '''    let mut actual_gpu_layers = payload.gpu_layers;
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
    }

    let mut args = vec![
        "-m".to_string(), model_path.clone(),
        "-c".to_string(), payload.ctx_size.to_string(),
        "-ngl".to_string(), actual_gpu_layers.to_string(),
        "-t".to_string(), payload.threads.to_string(),
        "-b".to_string(), payload.eval_batch_size.to_string(),
        "-ub".to_string(), payload.physical_batch_size.to_string(),
        "-np".to_string(), payload.concurrency.to_string(),
        "--cache-type-k".to_string(), payload.k_cache_quant.clone(),
        "--cache-type-v".to_string(), payload.v_cache_quant.clone(),
        "--host".to_string(), "127.0.0.1".to_string(),
        "--port".to_string(), port.to_string(),
    ];

    if let Some(devs) = dev_arg {
        args.push("-dev".to_string());
        args.push(devs);
    }

    if let Some(servers) = &payload.rpc_servers {'''

code = code.replace(old_args, new_args)

with open('src/main.rs', 'w', encoding='utf-8') as f:
    f.write(code)

print('Success')
