#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIMPLE_DIR="$ROOT_DIR"
AGENT_BROWSER_DIR="$ROOT_DIR/agent-browser-sse"
WSL_IP="$(hostname -I | awk '{print $1}')"
AGENT_BROWSER_HOME="$AGENT_BROWSER_DIR/.agent-browser-home"

usage() {
  cat <<'EOF'
Usage:
  bash run.sh -simple
  bash run.sh -agent_browser
  bash run.sh -uninstall

Options:
  -simple         Install dependencies and start the original echo/time SSE MCP server.
  -agent_browser  Clone agent-browser, install dependencies, and start the browser SSE MCP server.
  -uninstall      Remove local install artifacts for both examples to simulate a first-time setup.
EOF
}

run_simple() {
  cd "$SIMPLE_DIR"
  echo "[mcp-test/simple] localhost: http://127.0.0.1:3333/mcp/sse"
  if [ -n "${WSL_IP}" ]; then
    echo "[mcp-test/simple] WSL IP: http://${WSL_IP}:3333/mcp/sse"
  fi
  npm install
  npm start
}

run_agent_browser() {
  cd "$AGENT_BROWSER_DIR"
  echo "[mcp-test/agent-browser] localhost: http://127.0.0.1:3334/mcp/sse"
  if [ -n "${WSL_IP}" ]; then
    echo "[mcp-test/agent-browser] WSL IP: http://${WSL_IP}:3334/mcp/sse"
  fi
  bash run.sh
}

run_uninstall() {
  echo "[mcp-test] removing local install artifacts ..."
  rm -rf "$ROOT_DIR/node_modules"
  rm -rf "$AGENT_BROWSER_DIR/node_modules"
  rm -rf "$AGENT_BROWSER_DIR/vendor"
  rm -rf "$AGENT_BROWSER_HOME"
  echo "[mcp-test] removed:"
  echo "  - $ROOT_DIR/node_modules"
  echo "  - $AGENT_BROWSER_DIR/node_modules"
  echo "  - $AGENT_BROWSER_DIR/vendor"
  echo "  - $AGENT_BROWSER_HOME"
  echo
  echo "[mcp-test] note: this does not remove any system Chrome / Chromium installation."
  echo "[mcp-test] only project-local agent-browser downloads are removed."
}

case "${1:-}" in
  -simple)
    run_simple
    ;;
  -agent_browser|-agent-browser)
    run_agent_browser
    ;;
  -uninstall)
    run_uninstall
    ;;
  -h|--help|"")
    usage
    ;;
  *)
    echo "Unknown option: ${1}" >&2
    echo >&2
    usage >&2
    exit 1
    ;;
esac
