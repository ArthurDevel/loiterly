$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'electron\native\companion-input-monitor-win.cs'
$outputDir = Join-Path $root 'electron\native\bin\windows'
$outputPath = Join-Path $outputDir 'companion-input-monitor.exe'

if (-not (Test-Path $source)) {
  throw "Windows helper source not found: $source"
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$candidateCompilers = @()
$command = Get-Command csc.exe -ErrorAction SilentlyContinue
if ($command) {
  $candidateCompilers += $command.Source
}

if ($env:WINDIR) {
  $candidateCompilers += (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe')
  $candidateCompilers += (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
}

$compiler = $candidateCompilers |
  Where-Object { $_ -and (Test-Path $_) } |
  Select-Object -First 1

if (-not $compiler) {
  throw 'Unable to find csc.exe. Install the .NET Framework build tools on Windows before building Loiterly.'
}

& $compiler `
  /nologo `
  /target:winexe `
  /optimize+ `
  /out:$outputPath `
  /r:System.Windows.Forms.dll `
  $source

if ($LASTEXITCODE -ne 0) {
  throw "csc.exe failed with exit code $LASTEXITCODE"
}

Write-Host "Built Windows companion helper: $outputPath"
