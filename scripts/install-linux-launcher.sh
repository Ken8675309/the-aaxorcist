#!/usr/bin/env bash
# Adds an app-menu entry and a desktop icon for a source checkout of The AAXorcist.
# Run it from anywhere after `npm install`:  bash scripts/install-linux-launcher.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICON_DIR="$HOME/.local/share/icons/hicolor/scalable/apps"
APPS_DIR="$HOME/.local/share/applications"
BIN_DIR="$HOME/.local/bin"
LAUNCHER="$BIN_DIR/the-aaxorcist"

if [ ! -x "$ROOT/node_modules/.bin/electron" ]; then
  echo "Electron is not installed yet. Run 'npm install' in $ROOT first." >&2
  exit 1
fi

mkdir -p "$ICON_DIR" "$APPS_DIR" "$BIN_DIR"
cp "$ROOT/build/icon.svg" "$ICON_DIR/the-aaxorcist.svg"

cat > "$LAUNCHER" <<LAUNCH
#!/usr/bin/env bash
# If the window fails to open with a sandbox error, run once with:
#   ELECTRON_FLAGS=--no-sandbox $LAUNCHER
cd "$ROOT" || exit 1
exec ./node_modules/.bin/electron . \${ELECTRON_FLAGS:-} "\$@"
LAUNCH
chmod +x "$LAUNCHER"

cat > "$APPS_DIR/the-aaxorcist.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Version=1.0
Name=The AAXorcist
Comment=Convert and transcribe Audible audiobooks
Exec="$LAUNCHER"
Icon=$ICON_DIR/the-aaxorcist.svg
Terminal=false
Categories=AudioVideo;Audio;
StartupNotify=true
DESKTOP
chmod +x "$APPS_DIR/the-aaxorcist.desktop"

DESK="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
[ -n "$DESK" ] || DESK="$HOME/Desktop"
if [ -d "$DESK" ]; then
  cp "$APPS_DIR/the-aaxorcist.desktop" "$DESK/the-aaxorcist.desktop"
  chmod +x "$DESK/the-aaxorcist.desktop"
  gio set "$DESK/the-aaxorcist.desktop" metadata::trusted true >/dev/null 2>&1 || true
  echo "Desktop icon: $DESK/the-aaxorcist.desktop"
fi
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
echo "Done. Look for The AAXorcist in your app menu."
