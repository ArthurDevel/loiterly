#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_SVG="$ROOT_DIR/electron/assets/loiterly-icon.svg"
OUTPUT_DIR="$ROOT_DIR/electron/assets"
ICONSET_DIR="$OUTPUT_DIR/loiterly.iconset"

rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"
trap 'rm -rf "$ICONSET_DIR"' EXIT

render_png() {
  local size="$1"
  local output="$2"
  magick -background none "$SOURCE_SVG" -resize "${size}x${size}" "$output"
}

render_png 16 "$ICONSET_DIR/icon_16x16.png"
render_png 32 "$ICONSET_DIR/icon_16x16@2x.png"
render_png 32 "$ICONSET_DIR/icon_32x32.png"
render_png 64 "$ICONSET_DIR/icon_32x32@2x.png"
render_png 128 "$ICONSET_DIR/icon_128x128.png"
render_png 256 "$ICONSET_DIR/icon_128x128@2x.png"
render_png 256 "$ICONSET_DIR/icon_256x256.png"
render_png 512 "$ICONSET_DIR/icon_256x256@2x.png"
render_png 512 "$ICONSET_DIR/icon_512x512.png"
render_png 1024 "$ICONSET_DIR/icon_512x512@2x.png"
render_png 1024 "$OUTPUT_DIR/loiterly.png"

iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_DIR/loiterly.icns"

magick \
  "$ICONSET_DIR/icon_16x16.png" \
  "$ICONSET_DIR/icon_32x32.png" \
  "$ICONSET_DIR/icon_32x32@2x.png" \
  "$ICONSET_DIR/icon_128x128.png" \
  "$ICONSET_DIR/icon_128x128@2x.png" \
  "$ICONSET_DIR/icon_256x256.png" \
  "$OUTPUT_DIR/loiterly.ico"
