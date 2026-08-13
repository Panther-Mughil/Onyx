#!/bin/bash
# build_rpc.sh — Standalone build script for Onyx RPC Agent
# This script compiles the RPC Agent and creates a lightweight release artifact.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
RELEASE_DIR="$PROJECT_ROOT/release/rpc"

# ── Version ──────────────────────────────────────────────────────────────
VERSION=$(cd "$PROJECT_ROOT" && git describe --tags --always 2>/dev/null || date +%Y%m%d-%H%M%S)
echo "RPC Agent build version: $VERSION"

# ── Detect OS / Arch ─────────────────────────────────────────────────────
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
linux) OS="linux" ;;
darwin) OS="macos" ;;
*)
	echo "Unsupported OS: $OS"
	exit 1
	;;
esac

case "$ARCH" in
x86_64) ARCH="x86_64" ;;
aarch64 | arm64) ARCH="aarch64" ;;
*)
	echo "Unsupported arch: $ARCH"
	exit 1
	;;
esac

# ── Build RPC Agent ──────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  Building RPC Agent"
echo "═══════════════════════════════════════════════════"
cd "$PROJECT_ROOT/rpc_agent"
cargo build --release
echo "RPC Agent built."

# ── Package RPC Agent ────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  Packaging RPC Agent for $OS/$ARCH"
echo "═══════════════════════════════════════════════════"

mkdir -p "$RELEASE_DIR"
stage_dir="$RELEASE_DIR/onyx-rpc-${VERSION}-${OS}-${ARCH}"
mkdir -p "$stage_dir"

cp "$PROJECT_ROOT/rpc_agent/target/release/rpc_agent" "$stage_dir/"
chmod +x "$stage_dir/rpc_agent"

if [ "$OS" = "linux" ]; then
	tar_name="onyx-rpc-${VERSION}-linux-${ARCH}.tar.gz"
	tar -czf "$RELEASE_DIR/$tar_name" -C "$RELEASE_DIR" "$(basename "$stage_dir")"
	echo "  ✓ $tar_name"
elif [ "$OS" = "macos" ]; then
	zip_name="onyx-rpc-${VERSION}-macos-${ARCH}.zip"
	(cd "$RELEASE_DIR" && zip -ry "$zip_name" "$(basename "$stage_dir")" 2>/dev/null)
	echo "  ✓ $zip_name"
fi

rm -rf "$stage_dir"

echo ""
echo "  Artifacts saved in release/rpc/"
echo "═══════════════════════════════════════════════════"
