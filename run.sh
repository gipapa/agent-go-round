#!/usr/bin/env bash
set -euo pipefail

WSL_IP="$(hostname -I | awk '{print $1}')"

usage() {
  echo "Usage: $0 -dev | -deploy"
  exit 1
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
    # Kill any process already using port 5566 before starting
    fuser -k 5566/tcp 2>/dev/null || true
    npm run dev -- --host 0.0.0.0 --port 5566 --strictPort
    ;;
  -deploy)
    npm run build
    ;;
  *)
    usage
    ;;
esac
