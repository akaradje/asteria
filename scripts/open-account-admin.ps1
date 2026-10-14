$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location -LiteralPath $projectRoot
try {
    $task = Get-ScheduledTask -TaskName 'Asteria Account Dashboard' -ErrorAction SilentlyContinue
    if ($task -and $task.State -ne 'Running') {
        Start-ScheduledTask -TaskName $task.TaskName
        Start-Sleep -Seconds 2
    }
    & node (Join-Path $projectRoot 'scripts\ensure-account-admin.js')
    if ($LASTEXITCODE -ne 0) { throw 'Private account dashboard could not start' }
    Start-Process 'http://127.0.0.1:4714/'
} finally { Pop-Location }
