$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
& $nodePath (Join-Path $PSScriptRoot 'windows-logon-start.js')
exit $LASTEXITCODE
