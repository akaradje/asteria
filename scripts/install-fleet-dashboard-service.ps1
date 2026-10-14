param([switch]$StartNow)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path $PSScriptRoot -Parent
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$taskName = 'Asteria Fleet Dashboard'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$entryPath = Join-Path $projectPath 'src\fleet-dashboard.js'
if (!(Test-Path -LiteralPath $entryPath)) { throw 'Fleet dashboard source is missing' }
$action = New-ScheduledTaskAction -Execute $nodePath -Argument ('"' + $entryPath + '"') -WorkingDirectory $projectPath
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Local six-character dashboard, independent of ChatGPT/Codex. Does not start or stop game farms.' -Force | Out-Null
if ($StartNow) {
    $listener = Get-NetTCPConnection -LocalPort 4712 -State Listen -ErrorAction SilentlyContinue
    if (!$listener) { Start-ScheduledTask -TaskName $taskName }
}
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State
