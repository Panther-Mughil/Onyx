#!/bin/bash
# compile.sh — Onyx packaging script (macOS/Linux)
# Produces versioned release artifacts in release/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
RELEASE_DIR="$PROJECT_ROOT/release"

# ── Version ──────────────────────────────────────────────────────────────
VERSION=$(cd "$PROJECT_ROOT" && git describe --tags --always 2>/dev/null || date +%Y%m%d-%H%M%S)
echo "Onyx build version: $VERSION"

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

# ── Download Portable Node ───────────────────────────────────────────────
NODE_VERSION="v20.11.1"
NODE_OS=$OS
[ "$NODE_OS" = "macos" ] && NODE_OS="darwin"
NODE_ARCH=$ARCH
[ "$NODE_ARCH" = "x86_64" ] && NODE_ARCH="x64"
[ "$NODE_ARCH" = "aarch64" ] && NODE_ARCH="arm64"

if [ ! -f "$PROJECT_ROOT/scripts/package/portable_node" ]; then
	echo "Downloading Node.js $NODE_VERSION ($NODE_OS-$NODE_ARCH)..."
	mkdir -p "$PROJECT_ROOT/scripts/package"
	curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-$NODE_OS-$NODE_ARCH.tar.gz" -o "/tmp/node.tar.gz"
	tar -xzf "/tmp/node.tar.gz" -C "/tmp"
	cp "/tmp/node-$NODE_VERSION-$NODE_OS-$NODE_ARCH/bin/node" "$PROJECT_ROOT/scripts/package/portable_node"
	chmod +x "$PROJECT_ROOT/scripts/package/portable_node"
	rm -rf "/tmp/node.tar.gz" "/tmp/node-$NODE_VERSION-$NODE_OS-$NODE_ARCH"
fi

mkdir -p "$RELEASE_DIR"

# ── Build Frontend ───────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  Building Frontend"
echo "═══════════════════════════════════════════════════"
cd "$PROJECT_ROOT/frontend"
if ! npm ci 2>/dev/null; then
	echo "npm ci failed, falling back to npm install..."
	npm install
fi
npm run build
echo "Frontend built."

# ── Build Backend ────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  Building Backend"
echo "═══════════════════════════════════════════════════"
cd "$PROJECT_ROOT/backend"
cargo build --release
echo "Backend built."


# ── Stage Artifacts ──────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  Packaging for $OS/$ARCH"
echo "═══════════════════════════════════════════════════"

if [ "$OS" = "linux" ]; then
	stage_dir="$RELEASE_DIR/onyx-${VERSION}-linux-${ARCH}"
	mkdir -p "$stage_dir"

	cp "$PROJECT_ROOT/backend/target/release/onyx" "$stage_dir/"
	cp -r "$PROJECT_ROOT/scripts" "$stage_dir/scripts"
	mkdir -p "$stage_dir/data" "$stage_dir/models" "$stage_dir/engines"

	# Bundle node
	if [ -f "$PROJECT_ROOT/scripts/package/portable_node" ]; then
		cp "$PROJECT_ROOT/scripts/package/portable_node" "$stage_dir/node"
		chmod +x "$stage_dir/node"
		echo "  ✓ Bundled node from scripts/package/"
	else
		echo "  ⚠ No bundled node found — backend will use PATH node"
	fi

	chmod +x "$stage_dir/onyx"

	# tar.gz
	tar_name="onyx-${VERSION}-linux-${ARCH}.tar.gz"
	tar -czf "$RELEASE_DIR/$tar_name" -C "$RELEASE_DIR" "$(basename "$stage_dir")"
	echo "  ✓ $tar_name"

	# AppImage
	echo ""
	echo "  Building AppImage..."
	appimage_dir="$stage_dir/AppDir"
	mkdir -p "$appimage_dir/usr/bin" "$appimage_dir/usr/share/applications"

	cp "$stage_dir/onyx" "$appimage_dir/AppRun"
	chmod +x "$appimage_dir/AppRun"
	cp -r "$stage_dir/scripts" "$appimage_dir/scripts"
	mkdir -p "$appimage_dir/data" "$appimage_dir/models" "$appimage_dir/engines"

	# Copy desktop file (needed at both AppDir root and usr/share/applications)
	desktop_file="$PROJECT_ROOT/scripts/package/Onyx.desktop"
	if [ -f "$desktop_file" ]; then
		cp "$desktop_file" "$appimage_dir/onyx.desktop"
		mkdir -p "$appimage_dir/usr/share/applications"
		cp "$desktop_file" "$appimage_dir/usr/share/applications/onyx.desktop"
	fi

	# Copy icon if present
	icon_file="$PROJECT_ROOT/scripts/package/onyx.png"
	if [ -f "$icon_file" ]; then
		cp "$icon_file" "$appimage_dir/onyx.png"
	else
		# Create a minimal 1x1 PNG icon
		printf '\\x89PNG\\r\\n\\x1a\\n\\x00\\x00\\x00\\rIHDR\\x00\\x00\\x00\\x01\\x00\\x00\\x00\\x01\\x08\\x02\\x00\\x00\\x00\\x90wS\\xde\\x00\\x00\\x00\\x0cIDATx\\x9cc\\xf8\\x0f\\x00\\x00\\x01\\x01\\x00\\x05\\x18\\xd8N\\x00\\x00\\x00\\x00IEND\\xaeB\\x60\\x82' >"$appimage_dir/onyx.png"
	fi

	# Download and run appimagetool
	appimagetool_path="$SCRIPT_DIR/appimagetool"
	if [ ! -f "$appimagetool_path" ] || [ ! -x "$appimagetool_path" ]; then
		echo "  Downloading appimagetool..."
		# Try .AppImage format first (current AppImageKit releases)
		curl -fsSL "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${ARCH}.AppImage" \
			-o "${appimagetool_path}.AppImage" 2>/dev/null || true
		if [ -f "${appimagetool_path}.AppImage" ]; then
			mv "${appimagetool_path}.AppImage" "$appimagetool_path"
			chmod +x "$appimagetool_path" 2>/dev/null || true
		fi
	fi

	if [ -f "$appimagetool_path" ] && [ -x "$appimagetool_path" ]; then
		appimage_name="onyx-${VERSION}-linux-${ARCH}.AppImage"
		if "$appimagetool_path" "$appimage_dir" "$RELEASE_DIR/$appimage_name" 2>/dev/null; then
			echo "  ✓ $appimage_name"
		else
			echo "  ⚠ AppImage build failed — tar.gz is available"
		fi
	else
		echo "  ⚠ appimagetool not available — AppImage not built"
		echo "     Install: sudo apt install appimagetool  (Debian/Ubuntu)"
		echo "     Or download: https://github.com/AppImage/AppImageKit"
	fi

	echo ""
	echo "═══════════════════════════════════════════════════"
	echo "  Artifacts:"
	echo "  release/$tar_name"
	echo "═══════════════════════════════════════════════════"

elif [ "$OS" = "macos" ]; then
	stage_dir="$RELEASE_DIR/onyx-${VERSION}-macos-${ARCH}"
	mkdir -p "$stage_dir"

	# Build .app bundle
	app_dir="$stage_dir/Onyx.app"
	mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"

	# Replace VERSION_PLACEHOLDER in Info.plist
	info_plist="$PROJECT_ROOT/scripts/package/Info.plist"
	if [ -f "$info_plist" ]; then
		sed "s/VERSION_PLACEHOLDER/$VERSION/g" "$info_plist" \
			>"$app_dir/Contents/Resources/Info.plist"
	fi
	
	icon_icns="$PROJECT_ROOT/scripts/package/icon.icns"
	if [ -f "$icon_icns" ]; then
		cp "$icon_icns" "$app_dir/Contents/Resources/icon.icns"
	fi

	cp "$PROJECT_ROOT/backend/target/release/onyx" "$app_dir/Contents/MacOS/onyx"
	cp -r "$PROJECT_ROOT/scripts" "$app_dir/Contents/MacOS/scripts"
	mkdir -p "$app_dir/Contents/MacOS/data" "$app_dir/Contents/MacOS/models" "$app_dir/Contents/MacOS/engines"

	# Bundle node
	if [ -f "$PROJECT_ROOT/scripts/package/portable_node" ]; then
		cp "$PROJECT_ROOT/scripts/package/portable_node" "$app_dir/Contents/MacOS/node"
		chmod +x "$app_dir/Contents/MacOS/node"
		echo "  ✓ Bundled node"
	else
		echo "  ⚠ No bundled node found — backend will use PATH node"
	fi

	chmod +x "$app_dir/Contents/MacOS/onyx"

	# Ad-hoc codesign (best-effort)
	if command -v codesign &>/dev/null; then
		codesign --force --deep -s - "$app_dir" 2>/dev/null || true
	fi

	# Create zip
	zip_name="onyx-${VERSION}-macos-${ARCH}.zip"
	(cd "$stage_dir" && ditto -c -k --keepParent Onyx.app "${PROJECT_ROOT}/release/$zip_name" 2>/dev/null) ||
		(cd "$stage_dir" && zip -ry "$PROJECT_ROOT/release/$zip_name" Onyx.app 2>/dev/null) ||
		{ echo "  ⚠ Could not create zip — try installing 'zip' or 'ditto'"; }

	echo ""
	echo "═══════════════════════════════════════════════════"
	echo "  Artifacts:"
	echo "  release/$zip_name"
	echo "═══════════════════════════════════════════════════"
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  SUMMARY"
echo "═══════════════════════════════════════════════════"
for f in "$RELEASE_DIR"/*; do
	if [ -f "$f" ]; then
		size=$(du -h "$f" | cut -f1)
		echo "  $f ($size)"
	fi
done
echo ""
echo "═══════════════════════════════════════════════════"
