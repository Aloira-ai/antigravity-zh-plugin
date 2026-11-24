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

& $runtime (Join-Path $PSScriptRoot 'scripts\uninstall.mjs') @Arguments
exit $LASTEXITCODE
