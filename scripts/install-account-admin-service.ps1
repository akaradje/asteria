param([switch]$StartNow)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$taskName = 'Asteria Account Dashboard'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$launcher = Join-Path $projectRoot 'scripts\run-account-admin-service.ps1'
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '"') -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Private loopback account dashboard. Independent of Codex and game farms.' -Force | Out-Null
if ($StartNow) {
    $listener = Get-NetTCPConnection -LocalPort 4714 -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        $health = Invoke-RestMethod 'http://127.0.0.1:4714/api/health' -TimeoutSec 3
        if ($health.service -ne 'asteria-account-admin' -or !$health.localOnly) { throw 'Port belongs to another service' }
        $processInfo = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $health.pid)
        $entry = Join-Path $projectRoot 'scripts\account-admin\server.js'
        if (!$processInfo -or $processInfo.CommandLine -notmatch [regex]::Escape($entry)) { throw 'Account service identity mismatch' }
        Stop-Process -Id $processInfo.ProcessId -ErrorAction Stop
        Start-Sleep -Seconds 1
    }
    Start-ScheduledTask -TaskName $taskName
}
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName,State
