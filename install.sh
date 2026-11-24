#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

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

if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/scripts/install.mjs" ]]; then
  exec "$runtime" "$SCRIPT_DIR/scripts/install.mjs" "$@"
fi

REPO="${AGY_I18N_REPO:-Aloira-ai/antigravity-zh-plugin}"
REF="${AGY_I18N_REF:-main}"
if [[ "$REF" =~ ^v[0-9] ]]; then
  REF_PATH="refs/tags/$REF"
else
  REF_PATH="refs/heads/$REF"
fi
ARCHIVE_URL="https://github.com/$REPO/archive/$REF_PATH.tar.gz"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL "$ARCHIVE_URL" | tar -xz -C "$TMP_DIR"

SRC_DIR=""
for candidate_dir in "$TMP_DIR"/*; do
  if [[ -f "$candidate_dir/scripts/install.mjs" ]]; then
    SRC_DIR="$candidate_dir"
    break
  fi
done

if [[ -z "$SRC_DIR" ]]; then
  echo "下载的压缩包缺少 scripts/install.mjs" >&2
  exit 1
fi

"$runtime" "$SRC_DIR/scripts/install.mjs" "$@"
