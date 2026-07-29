import urllib.request
import json

url = "http://127.0.0.1:12057/completion"
data = {
    "prompt": "Write a detailed 3-paragraph essay about the history of artificial intelligence.",
    "n_predict": 256,
    "stream": False
}

req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})

try:
    print("Sending prompt to server (this might take a few seconds)...")
    with urllib.request.urlopen(req) as response:
        result = json.loads(response.read().decode('utf-8'))
        
        timings = result.get('timings', {})
        pp_speed = timings.get('prompt_per_second', 0)
        tg_speed = timings.get('predicted_per_second', 0)
        
        print(f"\n--- Benchmark Results ---")
        print(f"Prompt Processing (PP): {pp_speed:.2f} t/s")
        print(f"Text Generation (TG):   {tg_speed:.2f} t/s")
except Exception as e:
    print(f"Failed to connect to server on port 12057. Error: {e}")
