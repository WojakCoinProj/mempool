#!/usr/bin/env bash
#
# Wojakcoin Mempool Explorer — backend (Node API) + Angular dev UI (/api proxied to backend).
#
# Prerequisites: WojakCore RPC + wjk-electrs (Electrum). See README-WOJAKCOIN.md
#
# Usage:
#   ./start-wojakcoin.sh                    # foreground: API + ng serve (Ctrl+C stops UI; backend only if this script started it)
#   ./start-wojakcoin.sh daemon             # background: writes PIDs + logs under .run/
#   ./start-wojakcoin.sh stop               # stop daemon processes (reads .run/*.pid)
#   ./start-wojakcoin.sh status             # curl backend + show listeners
#   FRONTEND_PORT=8080 ./start-wojakcoin.sh
#   SKIP_INSTALL=1 ./start-wojakcoin.sh
#   WOJAKCOIN_HOST=0.0.0.0 ./start-wojakcoin.sh   # listen on all interfaces (dev only)
#
# Manual UI only (backend must be on :8999):
#   CI=true NG_CLI_ANALYTICS=false NODE_OPTIONS=--max-old-space-size=8192 \
#     node ./node_modules/@angular/cli/bin/ng.js serve -c wojakcoin --host 127.0.0.1 --port 4200
#

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
RUN_DIR="${RUN_DIR:-${ROOT}/.run}"
BACKEND_PORT="${BACKEND_PORT:-8999}"
REQUESTED_FRONTEND_PORT="${FRONTEND_PORT:-4200}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
# 127.0.0.1 default; set WOJAKCOIN_HOST=0.0.0.0 to expose dev server on LAN
NG_HOST="${WOJAKCOIN_HOST:-127.0.0.1}"
NG_CLI_ARGS="${NG_CLI_ARGS:-}"
BACKEND_PID_FILE="${RUN_DIR}/backend.pid"
FRONTEND_PID_FILE="${RUN_DIR}/frontend.pid"
BACKEND_LOG="${RUN_DIR}/backend.log"
FRONTEND_LOG="${RUN_DIR}/frontend.log"

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

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

ensure_run_dir() {
  mkdir -p "${RUN_DIR}"
}

api_url() {
  echo "http://127.0.0.1:${BACKEND_PORT}/api/v1/backend-info"
}

common_setup() {
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

  if ! (cd "${ROOT}/frontend" && node -e "require('rxjs')" 2>/dev/null); then
    echo "==> frontend: repairing node_modules (rxjs / peer deps incomplete)..."
    rm -rf "${ROOT}/frontend/node_modules"
    (cd "${ROOT}/frontend" && npm ci)
  fi

  if [[ ! -f "${ROOT}/backend/dist/index.js" ]]; then
    echo "==> backend npm run build..."
    (cd "${ROOT}/backend" && npm run build)
  fi

  if [[ ! -f "${ROOT}/frontend/node_modules/@angular/cli/bin/ng.js" ]]; then
    echo "ERROR: Angular CLI missing at frontend/node_modules/@angular/cli/bin/ng.js — run: cd frontend && npm ci"
    exit 1
  fi
}

# Sets FRONTEND_PORT (may differ from REQUESTED if busy)
resolve_frontend_port() {
  FRONTEND_PORT="$(pick_free_port "${REQUESTED_FRONTEND_PORT}")"
  if [[ "${FRONTEND_PORT}" != "${REQUESTED_FRONTEND_PORT}" ]]; then
    echo "    Note: port ${REQUESTED_FRONTEND_PORT} busy → using ${FRONTEND_PORT}"
  fi
}

# Start mempool backend if nothing healthy on API. Sets BACK_PID if we started it.
# Returns 0 always unless fatal error.
start_backend_if_needed() {
  BACK_PID=""
  local API_URL
  API_URL="$(api_url)"

  if curl -sf "${API_URL}" >/dev/null 2>&1; then
    echo "==> backend :${BACKEND_PORT} (already running — not starting a second process)"
    echo "    Stop the old server first if you need a fresh backend (e.g. ${ROOT}/start-wojakcoin.sh stop)."
    return 0
  fi

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

  local _
  for _ in $(seq 1 90); do
    curl -sf "${API_URL}" >/dev/null 2>&1 && break
    kill -0 "${BACK_PID}" 2>/dev/null || { echo "ERROR: backend died"; exit 1; }
    sleep 1
  done
  curl -sf "${API_URL}" >/dev/null || { echo "ERROR: backend not responding on ${BACKEND_PORT}"; exit 1; }
}

run_frontend() {
  # Run in subshell; caller sets cwd and exec policy
  cd "${ROOT}/frontend"
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
  export CI=true
  export NG_CLI_ANALYTICS=false
  NG_CLI="./node_modules/@angular/cli/bin/ng.js"
  # shellcheck disable=SC2086
  exec node "${NG_CLI}" serve -c wojakcoin --host "${NG_HOST}" --port "${FRONTEND_PORT}" ${NG_CLI_ARGS}
}

do_stop() {
  ensure_run_dir
  local pid
  if [[ -f "${FRONTEND_PID_FILE}" ]]; then
    pid="$(cat "${FRONTEND_PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      echo "Stopping frontend pid ${pid}..."
      kill "${pid}" 2>/dev/null || true
      sleep 1
      kill -9 "${pid}" 2>/dev/null || true
    fi
    rm -f "${FRONTEND_PID_FILE}"
  fi
  if [[ -f "${BACKEND_PID_FILE}" ]]; then
    pid="$(cat "${BACKEND_PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      echo "Stopping backend pid ${pid}..."
      kill "${pid}" 2>/dev/null || true
      sleep 1
      kill -9 "${pid}" 2>/dev/null || true
    fi
    rm -f "${BACKEND_PID_FILE}"
  fi
  echo "stop: done (if processes were started by this script’s daemon mode)."
}

do_status() {
  local API_URL
  API_URL="$(api_url)"
  echo "==> Backend ${API_URL}"
  if curl -sf --connect-timeout 3 "${API_URL}" | head -c 500; then
    echo ""
  else
    echo "(not reachable)"
  fi
  echo ""
  echo "==> Listeners (8999 / common frontend ports)"
  ss -tln 2>/dev/null | grep -E ':8999|:4200|:8080' || true
  echo ""
  if [[ -f "${FRONTEND_PID_FILE}" ]]; then
    echo "daemon frontend pid file: $(cat "${FRONTEND_PID_FILE}" 2>/dev/null) (${FRONTEND_PID_FILE})"
  fi
  if [[ -f "${BACKEND_PID_FILE}" ]]; then
    echo "daemon backend pid file: $(cat "${BACKEND_PID_FILE}" 2>/dev/null) (${BACKEND_PID_FILE})"
  fi
}

# Wait until URL returns HTTP 200 or timeout (seconds).
wait_http_200() {
  local url=$1
  local max=${2:-180}
  local i
  for ((i = 0; i < max; i++)); do
    local code
    code=$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 2 "${url}" 2>/dev/null || echo 000)
    if [[ "${code}" == "200" ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

do_daemon() {
  ensure_run_dir
  common_setup
  resolve_frontend_port

  start_backend_if_needed

  if [[ -n "${BACK_PID}" ]]; then
    echo "${BACK_PID}" >"${BACKEND_PID_FILE}"
    echo "    backend pid ${BACK_PID} → ${BACKEND_PID_FILE}"
  else
    rm -f "${BACKEND_PID_FILE}"
  fi

  echo "    API http://127.0.0.1:${BACKEND_PORT}/api/v1/"
  echo "==> frontend (background) → http://${NG_HOST}:${FRONTEND_PORT}/"
  echo "    log: ${FRONTEND_LOG}"

  cd "${ROOT}/frontend"
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
  export CI=true
  export NG_CLI_ANALYTICS=false
  # shellcheck disable=SC2086
  nohup node ./node_modules/@angular/cli/bin/ng.js serve -c wojakcoin --host "${NG_HOST}" --port "${FRONTEND_PORT}" ${NG_CLI_ARGS} >>"${FRONTEND_LOG}" 2>&1 &
  FRONT_PID=$!
  cd "${ROOT}"
  echo "${FRONT_PID}" >"${FRONTEND_PID_FILE}"

  echo "    frontend pid ${FRONT_PID} → ${FRONTEND_PID_FILE}"
  echo "    Waiting for first HTTP 200 (webpack compile; up to 240s)..."
  if wait_http_200 "http://127.0.0.1:${FRONTEND_PORT}/" 240; then
    echo "    UI ready: http://127.0.0.1:${FRONTEND_PORT}/"
  else
    echo "    UI still compiling or failed — tail: ${FRONTEND_LOG}"
    tail -20 "${FRONTEND_LOG}" 2>/dev/null || true
  fi
  echo ""
  echo "Stop with: ${ROOT}/start-wojakcoin.sh stop"
}

do_foreground() {
  common_setup
  resolve_frontend_port

  BACK_PID=""
  FRONT_PID=""

  cleanup() {
    [[ -n "${FRONT_PID}" ]] && kill "${FRONT_PID}" 2>/dev/null || true
    [[ -n "${BACK_PID}" ]] && kill "${BACK_PID}" 2>/dev/null || true
  }
  trap cleanup EXIT INT TERM

  start_backend_if_needed

  echo "    API http://127.0.0.1:${BACKEND_PORT}/api/v1/"

  echo "==> frontend (ng serve, /api proxied to backend) http://${NG_HOST}:${FRONTEND_PORT}/"
  echo "    Using Angular config 'wojakcoin' (localize off for faster dev compile)."
  (
    run_frontend
  ) &
  FRONT_PID=$!

  echo ""
  echo "    Open: http://127.0.0.1:${FRONTEND_PORT}/"
  echo "    First webpack build can take 1–3 min; refresh after logs show Compiled."
  if [[ -n "${BACK_PID}" ]]; then
    echo "    Ctrl+C stops the dev server and this script’s backend process."
  else
    echo "    Ctrl+C stops only the dev server (backend on :${BACKEND_PORT} was already running)."
  fi
  wait "${FRONT_PID}" 2>/dev/null || true
}

# --- main ---
cmd="${1:-}"
case "${cmd}" in
  stop)
    do_stop
    exit 0
    ;;
  status)
    do_status
    exit 0
    ;;
  daemon | background | start-daemon)
    do_daemon
    exit 0
    ;;
  help | -h | --help)
    usage
    exit 0
    ;;
  "")
    do_foreground
    ;;
  *)
    echo "Unknown command: ${cmd}" >&2
    usage >&2
    exit 1
    ;;
esac
