$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
& 'C:\Program Files\nodejs\node.exe' scripts/windows-farm-recovery.js 1>> logs/system-audit/windows-farm-recovery.out.log 2>> logs/system-audit/windows-farm-recovery.err.log
exit $LASTEXITCODE
