$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$logPath = Join-Path $projectRoot 'logs\account-admin'
New-Item -ItemType Directory -Path $logPath -Force | Out-Null
$service = Start-Process -FilePath $nodePath -ArgumentList ('"' + (Join-Path $projectRoot 'scripts\account-admin\server.js') + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logPath 'service.out.log') -RedirectStandardError (Join-Path $logPath 'service.err.log') -PassThru
$service.WaitForExit()
exit $service.ExitCode
