#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR_DIR="$ROOT_DIR/vendor"
AGENT_BROWSER_REPO_DIR="$VENDOR_DIR/agent-browser"
LOCAL_AGENT_BROWSER_BIN="$ROOT_DIR/node_modules/.bin/agent-browser"
AGENT_BROWSER_HOME="$ROOT_DIR/.agent-browser-home"

find_system_chrome() {
  local candidate
  for candidate in google-chrome google-chrome-stable chromium-browser chromium; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

find_managed_chrome() {
  local browsers_dir="$AGENT_BROWSER_HOME/.agent-browser/browsers"
  local version_dir
  if [ ! -d "$browsers_dir" ]; then
    return 1
  fi

  for version_dir in "$browsers_dir"/chrome-*; do
    if [ -x "$version_dir/chrome" ]; then
      printf '%s\n' "$version_dir/chrome"
      return 0
    fi
    if [ -x "$version_dir/chrome-linux64/chrome" ]; then
      printf '%s\n' "$version_dir/chrome-linux64/chrome"
      return 0
    fi
  done

  return 1
}

needs_linux_deps() {
  local browser_bin="${1:-}"
  if [ "$(uname -s)" != "Linux" ] || [ -z "$browser_bin" ] || [ ! -x "$browser_bin" ]; then
    return 1
  fi
  if ! command -v ldd >/dev/null 2>&1; then
    return 1
  fi
  ldd "$browser_bin" 2>/dev/null | grep -q "not found"
}

ensure_browser_ready() {
  local system_chrome=""
  local managed_chrome=""

  mkdir -p "$AGENT_BROWSER_HOME"

  if system_chrome="$(find_system_chrome)"; then
    echo "[agent-browser-sse] system Chrome detected: $system_chrome"
    echo "[agent-browser-sse] skip browser download and use system Chrome."
    return 0
  fi

  if managed_chrome="$(find_managed_chrome)"; then
    echo "[agent-browser-sse] existing managed Chrome detected: $managed_chrome"
  else
    echo "[agent-browser-sse] no system Chrome found. installing managed Chrome ..."
    HOME="$AGENT_BROWSER_HOME" "$LOCAL_AGENT_BROWSER_BIN" install
    managed_chrome="$(find_managed_chrome || true)"
  fi

  if needs_linux_deps "$managed_chrome"; then
    echo "[agent-browser-sse] missing Linux shared libraries detected."
    echo "[agent-browser-sse] trying: agent-browser install --with-deps"
    HOME="$AGENT_BROWSER_HOME" "$LOCAL_AGENT_BROWSER_BIN" install --with-deps || true
  fi

  if managed_chrome="$(find_managed_chrome)"; then
    echo "[agent-browser-sse] managed Chrome ready: $managed_chrome"
  else
    echo "[agent-browser-sse] warning: managed Chrome install was not found after setup." >&2
  fi
}

mkdir -p "$VENDOR_DIR"

if [ ! -d "$AGENT_BROWSER_REPO_DIR/.git" ]; then
  echo "[agent-browser-sse] cloning vercel-labs/agent-browser ..."
  git clone https://github.com/vercel-labs/agent-browser.git "$AGENT_BROWSER_REPO_DIR"
else
  echo "[agent-browser-sse] agent-browser repo already exists at $AGENT_BROWSER_REPO_DIR"
fi

cd "$ROOT_DIR"
npm install

if [ ! -x "$LOCAL_AGENT_BROWSER_BIN" ]; then
  echo "[agent-browser-sse] local agent-browser CLI install failed." >&2
  exit 1
fi

echo "[agent-browser-sse] using CLI: $LOCAL_AGENT_BROWSER_BIN"
echo "[agent-browser-sse] repo mirror: $AGENT_BROWSER_REPO_DIR"
echo "[agent-browser-sse] browser home: $AGENT_BROWSER_HOME"
ensure_browser_ready

HOME="$AGENT_BROWSER_HOME" AGENT_BROWSER_BIN="$LOCAL_AGENT_BROWSER_BIN" npm start
