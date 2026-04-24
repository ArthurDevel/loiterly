$ErrorActionPreference = 'Stop'

param(
  [switch]$NoOpen
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$distDir = Join-Path $rootDir 'dist'
$builderBin = Join-Path $rootDir 'node_modules\.bin\electron-builder.cmd'

if (-not (Test-Path $builderBin)) {
  Write-Error 'electron-builder is missing. Run npm install first.'
}

Write-Host 'Building Loiterly Windows installer...'
Push-Location $rootDir
try {
  & $builderBin --win nsis --publish never
} finally {
  Pop-Location
}

$installer = Get-ChildItem -Path $distDir -Filter 'Loiterly-Setup-*.exe' -File |
  Sort-Object LastWriteTimeUtc |
  Select-Object -Last 1

if (-not $installer) {
  Write-Error "Unable to locate the Loiterly installer in $distDir after build."
}

Write-Host "Built installer: $($installer.FullName)"

if (-not $NoOpen) {
  Write-Host 'Launching installer...'
  Start-Process -FilePath $installer.FullName
}
