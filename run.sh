#!/usr/bin/env bash
set -euo pipefail

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
    npm run dev -- --host 127.0.0.1 --port 5566 --strictPort
    ;;
  -deploy)
    npm run build
    ;;
  *)
    usage
    ;;
esac
