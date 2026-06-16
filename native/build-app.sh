#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="${1:-$ROOT/outputs}"
APP="$OUTPUT/Gesture Arcade.app"
CONTENTS="$APP/Contents"

rm -rf "$APP"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources/Web/assets"

swiftc "$ROOT/native/MacApp.swift" \
  -o "$CONTENTS/MacOS/GestureArcade" \
  -framework AppKit \
  -framework AVFoundation \
  -framework WebKit

cp "$ROOT/native/Info.plist" "$CONTENTS/Info.plist"
cp "$ROOT/index.html" "$ROOT/style.css" "$ROOT/game.js" "$CONTENTS/Resources/Web/"
cp -R "$ROOT/assets/." "$CONTENTS/Resources/Web/assets/"

codesign --force --deep --sign - \
  --entitlements "$ROOT/native/GestureArcade.entitlements" \
  "$APP"

echo "$APP"
