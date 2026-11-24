param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Arguments
)
$ErrorActionPreference = 'Stop'

$candidates = @()
$nodeCmd = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
if ($nodeCmd) { $candidates += $nodeCmd.Source }
$appData = [Environment]::GetFolderPath('ApplicationData')
$candidates += (Join-Path $appData 'Antigravity\bin\agy-node.cmd')

$runtime = $null
foreach ($candidate in $candidates) {
  if (-not (Test-Path -LiteralPath $candidate)) { continue }
  $ok = & $candidate -p "const [a,b]=process.versions.node.split('.').map(Number); a>22||(a===22&&b>=13)" 2>$null
  if ($LASTEXITCODE -eq 0 -and "$ok".Trim() -eq 'true') {
    $runtime = $candidate
    break
  }
}

if (-not $runtime) {
  throw '未找到可用的 Node.js (>=22.13)。请安装 Node.js 或先启动一次 Antigravity。'
}

$extraArgs = @()
if ($Arguments) { $extraArgs += $Arguments }
if (($env:AGY_ZH_PURGE -eq '1' -or $env:AGY_I18N_PURGE -eq '1') -and ($extraArgs -notcontains '--purge')) {
  $extraArgs += '--purge'
}

$isLocalScript = $false
$localScript = $null
if (-not [string]::IsNullOrEmpty($PSScriptRoot)) {
  $candidateScript = Join-Path $PSScriptRoot 'scripts\uninstall.mjs'
  if (Test-Path -LiteralPath $candidateScript) {
    $isLocalScript = $true
    $localScript = $candidateScript
  }
}

if ($isLocalScript) {
  & $runtime $localScript @extraArgs
  exit $LASTEXITCODE
}

$inlineJs = @'
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
const purge = args.includes('--purge') || process.env.AGY_ZH_PURGE === '1' || process.env.AGY_I18N_PURGE === '1';

const geminiRoot = join(resolve(home), '.gemini');
const destination = join(geminiRoot, 'config', 'plugins', 'agy-zh');
const dataDir = join(geminiRoot, 'antigravity', 'plugin_data', 'agy-zh');
const sidecarDir = join(geminiRoot, 'antigravity', 'sidecar_data', 'agy-zh');
const legacySidecarDir = join(sidecarDir, 'i18n');

let removedPlugin = false;
let purgedData = false;

if (existsSync(destination)) {
  assertOwnedPath(geminiRoot, destination);
  assertNoSymlinks(destination);
  const manifestPath = join(destination, 'plugin.json');
  if (!existsSync(manifestPath)) throw new Error('目标目录缺少 plugin.json，无法确认归属');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest?.name !== 'agy-zh') throw new Error('目标目录不属于 agy-zh，已取消删除');
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
  console.log(removedPlugin ? `已卸载插件目录：${destination}` : '未检测到已安装的 Antigravity 界面汉化 (agy-zh) 插件目录。');
  console.log(purgedData ? '已清理插件配置与本地词典数据。' : '已保留个人设置与自定义词典（如需一并清理请加 --purge 或设置 AGY_ZH_PURGE=1）。');
}
'@

$tmpMjs = Join-Path $env:TEMP ('agy-zh-uninstall-' + [Guid]::NewGuid().ToString('N') + '.mjs')
$exitCode = 0
try {
  [System.IO.File]::WriteAllText($tmpMjs, $inlineJs, [System.Text.UTF8Encoding]::new($false))
  & $runtime $tmpMjs @extraArgs
  $exitCode = $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $tmpMjs -Force -ErrorAction SilentlyContinue
}

if ($exitCode -ne 0) {
  throw "卸载失败 (退出码 $exitCode)"
}
