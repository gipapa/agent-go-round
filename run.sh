#!/usr/bin/env bash
set -euo pipefail

WSL_IP=""
if hostname -I >/dev/null 2>&1; then
  WSL_IP="$(hostname -I | awk '{print $1}')"
fi

usage() {
  echo "Usage: $0 -dev | -deploy"
  exit 1
}

stop_existing_dev_server() {
  if command -v fuser >/dev/null 2>&1; then
    fuser -k 5566/tcp >/dev/null 2>&1 || true
  fi
  if ! command -v lsof >/dev/null 2>&1; then return; fi
  local port_pids
  port_pids="$(lsof -tiTCP:5566 -sTCP:LISTEN 2>/dev/null || true)"
  if [ -z "${port_pids}" ]; then
    return
  fi
  while IFS= read -r pid; do
    if [ -n "${pid}" ]; then
      kill "${pid}" 2>/dev/null || true
    fi
  done <<< "${port_pids}"
}

if [ "$#" -ne 1 ]; then
  usage
fi

case "$1" in
  -dev)
    if [ ! -d node_modules ]; then
      npm install
    fi
    echo "[agent-go-round] localhost: http://127.0.0.1:5566/"
    if [ -n "${WSL_IP}" ]; then
      echo "[agent-go-round] WSL IP: http://${WSL_IP}:5566/"
    fi
    # Kill any process already using port 5566 before starting.
    stop_existing_dev_server
    npm run dev -- --host 0.0.0.0 --port 5566 --strictPort
    ;;
  -deploy)
    npm run build
    ;;
  *)
    usage
    ;;
esac
