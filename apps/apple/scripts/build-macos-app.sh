#!/usr/bin/env bash
# Builds Oyee.app (macOS menu-bar app) without Xcode:
#   swift build -c release → assemble the bundle → ad-hoc codesign.
# Output: apps/apple/build/Oyee.app
#
#   UNIVERSAL=1        build for Apple Silicon and Intel (used for GitHub Releases)
#   OYEE_VERSION=x   sets CFBundleShortVersionString (default: the Info.plist value)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_NAME="Oyee"
BUILD_DIR="$ROOT/build"
APP="$BUILD_DIR/$APP_NAME.app"
CONFIG="${CONFIG:-release}"

# Prefer the Command Line Tools if Xcode is selected but its license hasn't been accepted.
if [[ -z "${DEVELOPER_DIR:-}" ]] && ! xcrun --find swift >/dev/null 2>&1; then
  export DEVELOPER_DIR=/Library/Developer/CommandLineTools
fi

ARCH_FLAGS=()
if [[ "${UNIVERSAL:-0}" == "1" ]]; then ARCH_FLAGS=(--arch arm64 --arch x86_64); fi

echo "==> swift build -c $CONFIG --product OyeeMac ${ARCH_FLAGS[*]:-}"
swift build -c "$CONFIG" --product OyeeMac ${ARCH_FLAGS[@]+"${ARCH_FLAGS[@]}"}
BIN_DIR="$(swift build -c "$CONFIG" ${ARCH_FLAGS[@]+"${ARCH_FLAGS[@]}"} --show-bin-path)"
EXECUTABLE="$BIN_DIR/OyeeMac"
[[ -x "$EXECUTABLE" ]] || { echo "error: $EXECUTABLE not found" >&2; exit 1; }

echo "==> Assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$EXECUTABLE" "$APP/Contents/MacOS/$APP_NAME"
cp "$ROOT/Resources/OyeeMac-Info.plist" "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

if [[ -n "${OYEE_VERSION:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $OYEE_VERSION" "$APP/Contents/Info.plist"
fi

# Version from git (optional): CFBundleVersion = commit count.
if BUILD_NUMBER="$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null)"; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$APP/Contents/Info.plist"
fi

# Fonts (Figtree, OFL): registered at launch by OyeeFonts.register().
mkdir -p "$APP/Contents/Resources/Fonts"
cp "$ROOT/Resources/Fonts/"*.ttf "$APP/Contents/Resources/Fonts/"

# SwiftPM resource bundles, if any target ever gets resources.
find "$BIN_DIR" -maxdepth 1 -name '*.bundle' -print0 2>/dev/null | while IFS= read -r -d '' bundle; do
  cp -R "$bundle" "$APP/Contents/Resources/"
done

# App icon: use Resources/AppIcon.icns if present, otherwise render a placeholder (non-fatal if it fails).
if [[ -f "$ROOT/Resources/AppIcon.icns" ]]; then
  cp "$ROOT/Resources/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
else
  ICON_TMP="$(mktemp -d)"
  if swift "$ROOT/scripts/make-icon.swift" "$ICON_TMP/AppIcon.iconset" >/dev/null 2>&1 \
    && iconutil -c icns "$ICON_TMP/AppIcon.iconset" -o "$APP/Contents/Resources/AppIcon.icns" 2>/dev/null; then
    echo "==> Rendered placeholder icon"
  else
    echo "warning: couldn't render the app icon; continuing without one" >&2
  fi
  rm -rf "$ICON_TMP"
fi

plutil -lint "$APP/Contents/Info.plist" >/dev/null

echo "==> Ad-hoc signing"
codesign --force --deep --sign - "$APP"
codesign --verify --verbose=1 "$APP"

echo
echo "Built $APP"
echo "Install:  mv \"$APP\" /Applications/   (then open it once; it lives in the menu bar)"
