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

$isLocalScript = $false
$localScript = $null
if (-not [string]::IsNullOrEmpty($PSScriptRoot)) {
  $candidateScript = Join-Path $PSScriptRoot 'scripts\install.mjs'
  if (Test-Path -LiteralPath $candidateScript) {
    $isLocalScript = $true
    $localScript = $candidateScript
  }
}

if ($isLocalScript) {
  & $runtime $localScript @Arguments
  exit $LASTEXITCODE
}

$repo = if ($env:AGY_I18N_REPO) { $env:AGY_I18N_REPO } else { 'Aloira-ai/antigravity-zh-plugin' }
$ref = if ($env:AGY_I18N_REF) { $env:AGY_I18N_REF } else { 'main' }
$refPath = if ($ref -match '^v\d') { "refs/tags/$ref" } else { "refs/heads/$ref" }
$archiveUrl = "https://github.com/$repo/archive/$refPath.zip"

$tempRoot = Join-Path $env:TEMP ('agy-i18n-install-' + [Guid]::NewGuid().ToString('N'))
$zipPath = Join-Path $tempRoot 'src.zip'
$extractDir = Join-Path $tempRoot 'src'
$exitCode = 0

try {
  New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
  $curl = Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue
  if ($curl) {
    & $curl.Source -fsSL -o $zipPath $archiveUrl
    if ($LASTEXITCODE -ne 0) { throw "下载插件包失败: $archiveUrl" }
  } else {
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $archiveUrl -OutFile $zipPath -UseBasicParsing
  }

  $tar = Get-Command tar.exe -CommandType Application -ErrorAction SilentlyContinue
  $extracted = $false
  if ($tar) {
    & $tar.Source -xf $zipPath -C $extractDir 2>$null
    if ($LASTEXITCODE -eq 0) { $extracted = $true }
  }
  if (-not $extracted) {
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
  }

  $entry = Get-ChildItem -LiteralPath $extractDir -Filter 'install.mjs' -Recurse -File |
    Where-Object { $_.FullName -like '*\scripts\install.mjs' } |
    Select-Object -First 1
  if (-not $entry) {
    throw '下载的压缩包缺少 scripts/install.mjs'
  }

  & $runtime $entry.FullName @Arguments
  $exitCode = $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

if ($exitCode -ne 0) {
  throw "安装失败 (退出码 $exitCode)"
}
