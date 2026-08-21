import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react()],
	server: {
		host: "0.0.0.0",
		proxy: {
			"/api": {
				target: "http://127.0.0.1:3001",
				changeOrigin: true,
				configure: (proxy, _options) => {
					proxy.on('error', (err, _req, _res) => {});
				}
			},
			"/health": {
				target: "http://127.0.0.1:3001",
				changeOrigin: true,
				configure: (proxy, _options) => {
					proxy.on('error', (err, _req, _res) => {});
				}
			},
		},
	},
});
