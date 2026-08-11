#!/bin/bash
# helpers.sh — utility functions for compile.sh packaging
set -euo pipefail

# Download portable node from official releases if not already present
# Usage: ensure_node_bundle <dest_dir> <os> <arch>
ensure_node_bundle() {
	local dest_dir="$1"
	local os="$2"
	local arch="$3"
	local node_path=""

	if [ "$os" = "linux" ]; then
		case "$arch" in
		x86_64) node_path="node-v20.11.0-linux-x64" ;;
		aarch64) node_path="node-v20.11.0-linux-arm64" ;;
		*) node_path="node-v20.11.0-linux-x64" ;;
		esac
	elif [ "$os" = "macos" ]; then
		case "$arch" in
		arm64) node_path="node-v20.11.0-darwin-arm64" ;;
		x86_64) node_path="node-v20.11.0-darwin-x64" ;;
		*) node_path="node-v20.11.0-darwin-x64" ;;
		esac
	fi

	if [ -n "$node_path" ]; then
		local candidate="$dest_dir/$node_path/bin/node"
		if [ -f "$candidate" ]; then
			cp "$candidate" "$dest_dir/node"
			chmod +x "$dest_dir/node"
			echo "Using bundled node from scripts/portable-node/"
			return 0
		fi
	fi

	echo "Portable node not found in scripts/portable-node/ — will skip bundling"
	echo "To bundle node, place it in scripts/portable-node/"
	return 1
}

# Download appimagetool if missing
ensure_appimagetool() {
	local tool_dir="$1"
	local tool_path="$tool_dir/appimagetool"

	if [ -f "$tool_path" ] && [ -x "$tool_path" ]; then
		echo "Using existing appimagetool"
		return 0
	fi

	echo "Downloading appimagetool..."
	local arch
	arch=$(uname -m)
	local url="https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-${arch}"

	curl -fsSL "$url" -o "$tool_path" 2>/dev/null || {
		echo "Warning: Could not download appimagetool — AppImage will not be built"
		return 1
	}
	chmod +x "$tool_path"
	return 0
}
