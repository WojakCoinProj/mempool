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
# Manual UI only (from frontend/, backend must be on :8999). Use a free --port if 4200 is taken:
#   CI=true NG_CLI_ANALYTICS=false NODE_OPTIONS=--max-old-space-size=8192 node ./node_modules/@angular/cli/bin/ng.js serve -c wojakcoin --host 127.0.0.1 --port 4200
#

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8999}"
REQUESTED_FRONTEND_PORT="${FRONTEND_PORT:-4200}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"

# If the chosen port is busy, pick the next free one (avoids ng's interactive "use another port?" prompt when stdin is not a TTY).
tcp_port_busy() {
  local p=$1
  command -v ss >/dev/null 2>&1 || return 1
  ss -tln 2>/dev/null | grep -qE ":${p}\\b"
}
pick_free_port() {
  local p=$1
  local end=$((p + 100))
  while (( p <= end )); do
    if ! tcp_port_busy "${p}"; then
      echo "${p}"
      return 0
    fi
    p=$((p + 1))
  done
  echo "ERROR: no free TCP port between ${1} and ${end} (stop old ng serve / pick FRONTEND_PORT)." >&2
  exit 1
}
FRONTEND_PORT="$(pick_free_port "${REQUESTED_FRONTEND_PORT}")"
if [[ "${FRONTEND_PORT}" != "${REQUESTED_FRONTEND_PORT}" ]]; then
  echo "    Note: port ${REQUESTED_FRONTEND_PORT} busy → using ${FRONTEND_PORT}"
fi

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

BACK_PID=""
API_URL="http://127.0.0.1:${BACKEND_PORT}/api/v1/backend-info"

# Reuse an already-running mempool API so we do not hit EADDRINUSE (common after a prior run or screen/tmux).
if curl -sf "${API_URL}" >/dev/null 2>&1; then
  echo "==> backend :${BACKEND_PORT} (already running — not starting a second process)"
  echo "    Stop the old server first if you need a fresh backend (e.g. pkill -f 'mempool-wojakcoin/backend.*dist/index.js')."
else
  if tcp_port_busy "${BACKEND_PORT}"; then
    echo "ERROR: port ${BACKEND_PORT} is in use but does not respond like mempool (${API_URL})."
    echo "       Free the port or set BACKEND_PORT=..."
    exit 1
  fi
  echo "==> starting backend :${BACKEND_PORT}"
  (
    cd "${ROOT}/backend"
    export MEMPOOL_CONFIG_FILE="${MEMPOOL_CONFIG_FILE:-${ROOT}/backend/mempool-config.json}"
    exec node --max-old-space-size=2048 dist/index.js
  ) &
  BACK_PID=$!

  for _ in $(seq 1 90); do
    curl -sf "${API_URL}" >/dev/null 2>&1 && break
    kill -0 "${BACK_PID}" 2>/dev/null || { echo "ERROR: backend died"; exit 1; }
    sleep 1
  done
  curl -sf "${API_URL}" >/dev/null || { echo "ERROR: backend not responding on ${BACKEND_PORT}"; exit 1; }
fi
echo "    API http://127.0.0.1:${BACKEND_PORT}/api/v1/"

echo "==> frontend (ng serve, /api proxied to backend) http://127.0.0.1:${FRONTEND_PORT}/"
echo "    Using Angular config 'wojakcoin' (localize off for faster dev compile)."
(
  cd "${ROOT}/frontend"
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
  export CI=true
  export NG_CLI_ANALYTICS=false
  NG_CLI="./node_modules/@angular/cli/bin/ng.js"
  # shellcheck disable=SC2086
  exec node "${NG_CLI}" serve -c wojakcoin --host 127.0.0.1 --port "${FRONTEND_PORT}" ${NG_CLI_ARGS}
) &
FRONT_PID=$!

echo ""
echo "    Open: http://127.0.0.1:${FRONTEND_PORT}/"
echo "    First compile can take 1–3 min. Logs like 'wait until bundle finished' mean webpack is still building — refresh after you see 'Compiled' / 'compiled successfully'."
if [[ -n "${BACK_PID}" ]]; then
  echo "    Ctrl+C stops the dev server and this script’s backend process."
else
  echo "    Ctrl+C stops only the dev server (backend on :${BACKEND_PORT} was already running)."
fi
wait "${FRONT_PID}" 2>/dev/null || true
