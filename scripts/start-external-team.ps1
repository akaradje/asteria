param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$rootPath = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $rootPath
$taskName = 'Asteria External Team'
Start-ScheduledTask -TaskName $taskName
$recoveryTask = Get-ScheduledTask -TaskName 'Asteria Windows Farm Recovery' -ErrorAction SilentlyContinue
if ($recoveryTask -and $recoveryTask.State -ne 'Running') { Start-ScheduledTask -TaskName $recoveryTask.TaskName }
$nodePath = 'C:\Program Files\nodejs\node.exe'
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:4711/api/panel-health' -TimeoutSec 3
        if ($health.service -eq 'asteria-panel') {
            if (!$health.running) {
                & $nodePath (Join-Path $rootPath 'scripts\windows-panel.js') --autostart --no-open
                if ($LASTEXITCODE -ne 0) { throw 'Farm start failed; see logs' }
            }
            & $nodePath (Join-Path $rootPath 'scripts\ensure-fleet-dashboard.js')
            if ($LASTEXITCODE -ne 0) { throw 'Dashboard start failed; see logs' }
            $dashboardHealth = Invoke-RestMethod 'http://127.0.0.1:4712/api/health' -TimeoutSec 3
            if ($dashboardHealth.service -ne 'asteria-fleet-dashboard') { throw 'Unexpected dashboard service' }
            if (!$NoOpen) {
                # Shell opens the user's external default browser, not a chat panel.
                Start-Process 'http://127.0.0.1:4712/'
            }
            exit 0
        }
    } catch { if ($attempt -eq 29) { throw } }
    Start-Sleep -Seconds 2
}
throw 'Panel did not become ready; see logs/external-guardian.log'
