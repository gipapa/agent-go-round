#!/usr/bin/env bash
set -euo pipefail

if [ ! -d node_modules ]; then
  npm install
fi

npm run dev -- --host 127.0.0.1 --port 5566 --strictPort
