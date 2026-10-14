$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
& 'C:\Program Files\nodejs\node.exe' scripts/run-architecture-acceptance.js 1>> logs/system-audit/architecture-acceptance.out.log 2>> logs/system-audit/architecture-acceptance.err.log
exit $LASTEXITCODE
