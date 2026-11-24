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

args=("$@")
if [[ "${AGY_I18N_PURGE:-}" == "1" ]]; then
  has_purge=0
  for a in "${args[@]+"${args[@]}"}"; do
    if [[ "$a" == "--purge" ]]; then
      has_purge=1
      break
    fi
  done
  if [[ $has_purge -eq 0 ]]; then
    args+=("--purge")
  fi
fi

if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/scripts/uninstall.mjs" ]]; then
  exec "$runtime" "$SCRIPT_DIR/scripts/uninstall.mjs" "${args[@]+"${args[@]}"}"
fi

TMP_JS="$(mktemp /tmp/agy-i18n-uninstall.XXXXXX.mjs)"
trap 'rm -f "$TMP_JS"' EXIT

cat >"$TMP_JS" <<'EOF'
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

function assertOwnedPath(root, target) {
  const rel = relative(resolve(root), resolve(target));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('目标路径越界');
  let cur = resolve(root);
  if (existsSync(cur) && lstatSync(cur).isSymbolicLink()) throw new Error('目标根目录不能是符号链接');
  for (const part of rel.split(/[\\/]/)) {
    cur = join(cur, part);
    if (existsSync(cur) && lstatSync(cur).isSymbolicLink()) throw new Error('目标路径包含符号链接');
  }
}

function assertNoSymlinks(target) {
  if (!existsSync(target)) return;
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error(`禁止包含符号链接: ${target}`);
  if (stat.isDirectory()) {
    for (const name of readdirSync(target)) assertNoSymlinks(join(target, name));
  }
}

const args = process.argv.slice(2);
const homeIdx = args.indexOf('--home');
const home = homeIdx >= 0 ? args[homeIdx + 1] : homedir();
const purge = args.includes('--purge') || process.env.AGY_I18N_PURGE === '1';

const geminiRoot = join(resolve(home), '.gemini');
const destination = join(geminiRoot, 'config', 'plugins', 'agy-i18n');
const dataDir = join(geminiRoot, 'antigravity', 'plugin_data', 'agy-i18n');
const sidecarDir = join(geminiRoot, 'antigravity', 'sidecar_data', 'agy-i18n');
const legacySidecarDir = join(sidecarDir, 'i18n');

let removedPlugin = false;
let purgedData = false;

if (existsSync(destination)) {
  assertOwnedPath(geminiRoot, destination);
  assertNoSymlinks(destination);
  const manifestPath = join(destination, 'plugin.json');
  if (!existsSync(manifestPath)) throw new Error('目标目录缺少 plugin.json，无法确认归属');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest?.name !== 'agy-i18n') throw new Error('目标目录不属于 agy-i18n，已取消删除');
  rmSync(destination, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  removedPlugin = true;
}

if (purge) {
  for (const dir of [dataDir, legacySidecarDir, sidecarDir]) {
    if (existsSync(dir)) {
      assertOwnedPath(geminiRoot, dir);
      assertNoSymlinks(dir);
      rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
      purgedData = true;
    }
  }
}

if (args.includes('--json')) {
  console.log(JSON.stringify({ removedPlugin, purgedData, destination }));
} else {
  console.log(removedPlugin ? `已卸载插件目录：${destination}` : '未检测到已安装的 Agy i18n 插件目录。');
  console.log(purgedData ? '已清理插件配置与本地词典数据。' : '已保留个人设置与自定义词典（如需一并清理请加 --purge 或设置 AGY_I18N_PURGE=1）。');
}
EOF

"$runtime" "$TMP_JS" "${args[@]+"${args[@]}"}"
