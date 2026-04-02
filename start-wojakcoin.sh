#!/usr/bin/env bash
#
# Wojakcoin Mempool Explorer — one script: API backend + UI (Angular dev server proxies /api → backend).
#
# Prerequisites: WojakCore RPC + wjk-electrs (Electrum :50005). See README-WOJAKCOIN.md
#
# Usage:
#   ./start-wojakcoin.sh
#   FRONTEND_PORT=8080 ./start-wojakcoin.sh
#   SKIP_INSTALL=1 ./start-wojakcoin.sh
#

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8999}"
FRONTEND_PORT="${FRONTEND_PORT:-4200}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"

# Extra args for Angular, e.g. NG_CLI_ARGS="--configuration production"
NG_CLI_ARGS="${NG_CLI_ARGS:-}"

BACK_PID=""
FRONT_PID=""

cleanup() {
  [[ -n "${FRONT_PID}" ]] && kill "${FRONT_PID}" 2>/dev/null || true
  [[ -n "${BACK_PID}" ]] && kill "${BACK_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> Wojakcoin Mempool ( ${ROOT} )"

if [[ ! -f "${ROOT}/frontend/mempool-frontend-config.json" ]]; then
  cp "${ROOT}/production/mempool-frontend-config.wojakcoin.json" "${ROOT}/frontend/mempool-frontend-config.json"
  echo "    Created frontend/mempool-frontend-config.json from template."
fi

if [[ ! -f "${ROOT}/backend/mempool-config.json" ]]; then
  echo "ERROR: Copy production/mempool-config.wojakcoin.sample.json to backend/mempool-config.json and set RPC + LEGACY_GETBLOCK."
  exit 1
fi

if [[ "${SKIP_INSTALL}" != "1" ]]; then
  [[ ! -d "${ROOT}/backend/node_modules" ]] && { echo "==> backend npm ci..."; (cd "${ROOT}/backend" && npm ci); }
  [[ ! -d "${ROOT}/frontend/node_modules" ]] && { echo "==> frontend npm ci..."; (cd "${ROOT}/frontend" && npm ci); }
fi

# Corrupted installs can leave node_modules/rxjs without package.json → "Cannot find module 'rxjs'" from Angular CLI
if ! (cd "${ROOT}/frontend" && node -e "require('rxjs')" 2>/dev/null); then
  echo "==> frontend: repairing node_modules (rxjs / peer deps incomplete)..."
  rm -rf "${ROOT}/frontend/node_modules"
  (cd "${ROOT}/frontend" && npm ci)
fi

if [[ ! -f "${ROOT}/backend/dist/index.js" ]]; then
  echo "==> backend npm run build..."
  (cd "${ROOT}/backend" && npm run build)
fi

echo "==> backend :${BACKEND_PORT}"
(
  cd "${ROOT}/backend"
  export MEMPOOL_CONFIG_FILE="${MEMPOOL_CONFIG_FILE:-${ROOT}/backend/mempool-config.json}"
  exec node --max-old-space-size=2048 dist/index.js
) &
BACK_PID=$!

for _ in $(seq 1 90); do
  curl -sf "http://127.0.0.1:${BACKEND_PORT}/api/v1/backend-info" >/dev/null 2>&1 && break
  kill -0 "${BACK_PID}" 2>/dev/null || { echo "ERROR: backend died"; exit 1; }
  sleep 1
done
curl -sf "http://127.0.0.1:${BACKEND_PORT}/api/v1/backend-info" >/dev/null || { echo "ERROR: backend not responding on ${BACKEND_PORT}"; exit 1; }
echo "    API http://127.0.0.1:${BACKEND_PORT}/api/v1/"

echo "==> frontend (ng serve, /api proxied to backend) http://127.0.0.1:${FRONTEND_PORT}/"
(
  cd "${ROOT}/frontend"
  # shellcheck disable=SC2086
  exec npm run ng -- serve -c local --host 127.0.0.1 --port "${FRONTEND_PORT}" ${NG_CLI_ARGS}
) &
FRONT_PID=$!

echo ""
echo "    Open: http://127.0.0.1:${FRONTEND_PORT}/"
echo "    Ctrl+C stops both."
wait "${FRONT_PID}" 2>/dev/null || true
