#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer only works on macOS."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
APP_NAME="Loiterly.app"
INSTALL_DIR="/Applications"
OPEN_AFTER_INSTALL=1
BUILDER_BIN="${ROOT_DIR}/node_modules/.bin/electron-builder"

if [[ "${1:-}" == "--no-open" ]]; then
  OPEN_AFTER_INSTALL=0
fi

if [[ ! -x "${BUILDER_BIN}" ]]; then
  echo "electron-builder is missing. Run npm install first."
  exit 1
fi

if [[ ! -w "${INSTALL_DIR}" ]]; then
  INSTALL_DIR="${HOME}/Applications"
fi

mkdir -p "${INSTALL_DIR}"

echo "Building ${APP_NAME}..."
(
  cd "${ROOT_DIR}"
  CSC_IDENTITY_AUTO_DISCOVERY=false "${BUILDER_BIN}" --mac dir --publish never
)

APP_PATH="$(find "${DIST_DIR}" -type d -name "${APP_NAME}" | sort | tail -n 1)"

if [[ -z "${APP_PATH}" ]]; then
  echo "Unable to locate ${APP_NAME} in ${DIST_DIR} after build."
  exit 1
fi

TARGET_PATH="${INSTALL_DIR}/${APP_NAME}"

echo "Installing to ${TARGET_PATH}..."
rm -rf "${TARGET_PATH}"
ditto "${APP_PATH}" "${TARGET_PATH}"
xattr -dr com.apple.quarantine "${TARGET_PATH}" >/dev/null 2>&1 || true

echo "Installed ${APP_NAME} to ${INSTALL_DIR}."

if [[ "${OPEN_AFTER_INSTALL}" -eq 1 ]]; then
  echo "Launching ${APP_NAME}..."
  open -a "${TARGET_PATH}"
fi
