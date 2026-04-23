#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICON_DIR="$ROOT_DIR/electron/assets/app-icons"
USER_AGENT="Mozilla/5.0"

mkdir -p "$ICON_DIR"

download_icon() {
  local url="$1"
  local output="$2"
  curl -fL --max-time 30 -A "$USER_AGENT" "$url" -o "$ICON_DIR/$output"
}

download_icon "https://www.notion.so/front-static/favicon.ico" "notion.ico"
download_icon "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico" "gmail.ico"
download_icon "https://github.githubassets.com/favicons/favicon.svg" "github.svg"
download_icon "https://static.licdn.com/aero-v1/sc/h/al2o9zrvru7aqj8e1x2rzsrca" "linkedin.ico"
download_icon "https://static.cdninstagram.com/rsrc.php/y4/r/QaBlI0OZiks.ico" "instagram.ico"
download_icon "https://www.openpaperdigest.com/opdlogo.svg" "openpaperdigest.svg"
download_icon "https://abs.twimg.com/responsive-web/client-web/icon-svg.ea5ff4aa.svg" "x.svg"
