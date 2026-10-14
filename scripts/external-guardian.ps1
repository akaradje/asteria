$ErrorActionPreference = 'Stop'
$rootPath = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $rootPath
$nodePath = 'C:\Program Files\nodejs\node.exe'
if (!(Test-Path -LiteralPath $nodePath)) { throw 'Installed Node.js is missing' }
$logPath = Join-Path $rootPath 'logs\external-guardian.log'
function Read-Health($port, $route) {
    try { Invoke-RestMethod -Uri "http://127.0.0.1:$port$route" -TimeoutSec 5 } catch { $null }
}
Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) OS guardian started PID=$PID"
while ($true) {
    try {
        $panelHealth = Read-Health 4711 '/api/panel-health'
        if (!$panelHealth) {
            # A slow or authenticated controller still owns its port. Launching
            # --autostart against it would override an intentional farm stop.
            $panelListener = Get-NetTCPConnection -LocalPort 4711 -State Listen -ErrorAction SilentlyContinue
            if ($panelListener) { Start-Sleep -Seconds 15; continue }
            $launchArgs = @('scripts/windows-panel.js', '--no-open')
            if (!(Test-Path -LiteralPath (Join-Path $rootPath 'logs\.stop'))) { $launchArgs += '--autostart' }
            Start-Process -FilePath $nodePath -ArgumentList $launchArgs -WorkingDirectory $rootPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $rootPath 'logs\external-panel.out.log') -RedirectStandardError (Join-Path $rootPath 'logs\external-panel.err.log')
            Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) panel launch requested"
            Start-Sleep -Seconds 10
        } elseif ($panelHealth.service -ne 'asteria-panel') {
            throw 'Unexpected service on port 4711; leaving it untouched'
        }
        & $nodePath scripts/ensure-fleet-dashboard.js 2>> $logPath
    } catch { Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $($_.Exception.Message)" }
    Start-Sleep -Seconds 15
}
