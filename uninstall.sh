#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

candidates=()
if node_bin="$(command -v node 2>/dev/null || true)"; then
  if [[ -n "$node_bin" ]]; then
    candidates+=("$node_bin")
  fi
fi
candidates+=(
  "$HOME/Library/Application Support/Antigravity/bin/agy-node"
  "/Applications/Antigravity.app/Contents/Resources/app/bin/agy-node"
  "${XDG_CONFIG_HOME:-$HOME/.config}/Antigravity/bin/agy-node"
  "$HOME/.config/Antigravity/bin/agy-node"
)

runtime=""
for candidate in "${candidates[@]}"; do
  [[ -n "$candidate" && -x "$candidate" ]] || continue
  ok="$("$candidate" -p "const [a,b]=process.versions.node.split('.').map(Number); a>22||(a===22&&b>=13)" 2>/dev/null || true)"
  if [[ "${ok//$'\r'/}" == "true" ]]; then
    runtime="$candidate"
    break
  fi
done

if [[ -z "$runtime" ]]; then
  echo "未找到可用的 Node.js (>=22.13)。请安装 Node.js 或先启动一次 Antigravity。" >&2
  exit 1
fi

exec "$runtime" "$SCRIPT_DIR/scripts/uninstall.mjs" "$@"
