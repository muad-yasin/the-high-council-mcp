#!/usr/bin/env bash
# Wraps the Linux binary from `npm run build:bin` into dist/council-x86_64.AppImage.
#
# appimagetool is pinned (1.9.1) and checksum-verified, not the moving `continuous` build, so the
# same commit always packages with the same tool. Run with --appimage-extract-and-run so it works
# without FUSE (most CI runners have none). Set APPIMAGETOOL to use an already-downloaded copy.
set -euo pipefail
cd "$(dirname "$0")/.."

BIN=dist/the-high-council-linux
OUT=dist/the-high-council-x86_64.AppImage
TOOL_VERSION=1.9.1
TOOL_SHA256=ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0
[ -x "$BIN" ] || { echo "missing $BIN - run npm run build:bin first" >&2; exit 1; }

TOOL="${APPIMAGETOOL:-dist/.appimagetool-$TOOL_VERSION}"
if [ ! -x "$TOOL" ]; then
  curl -fsSL -o "$TOOL" "https://github.com/AppImage/appimagetool/releases/download/$TOOL_VERSION/appimagetool-x86_64.AppImage"
  chmod +x "$TOOL"
fi
echo "$TOOL_SHA256  $TOOL" | sha256sum -c - >/dev/null || { echo "appimagetool checksum mismatch: $TOOL" >&2; exit 1; }

APPDIR=$(mktemp -d)
trap 'rm -rf "$APPDIR"' EXIT
mkdir -p "$APPDIR/usr/bin"
cp "$BIN" "$APPDIR/usr/bin/council"
cp docs/logo-diamond.png "$APPDIR/council.png"
cat > "$APPDIR/AppRun" <<'EOF'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/bin/council" "$@"
EOF
chmod +x "$APPDIR/AppRun"
# Terminal=true: this is a CLI, not a desktop app; the .desktop file only exists because
# AppImage requires one.
cat > "$APPDIR/council.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=The High Council
Exec=council
Icon=council
Categories=Development;
Terminal=true
EOF

ARCH=x86_64 "$TOOL" --appimage-extract-and-run "$APPDIR" "$OUT"
echo "built $OUT"
