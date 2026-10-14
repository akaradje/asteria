$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$entry = Join-Path $projectRoot 'scripts\start-windows-logon.ps1'
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $entry + '"'
$taskName = 'Asteria Windows Logon Start'
$guardian = Get-ScheduledTask -TaskName 'Asteria External Team' -ErrorAction Stop
if ($guardian.Actions.WorkingDirectory -ne $projectRoot -or $guardian.Actions.Arguments -notlike '*asteria\scripts\external-guardian.ps1*') { throw 'Guardian identity mismatch' }
$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $arguments -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
# Only a logon triggers resume. No timer, delayed missed run, wake, or failure retry.
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'At Windows sign-in, resume Windows 3 once through the existing external Asteria controller. Later manual stops remain stopped.' -Force | Out-Null
$installed = Get-ScheduledTask -TaskName $taskName
if (!$installed.Settings.Enabled -or $installed.Actions.Arguments -ne $arguments) { throw 'Task verification failed' }
# Retire only the observed legacy Asteria launcher, keeping a recoverable backup.
$legacy = Join-Path ([Environment]::GetFolderPath('Startup')) 'Asteria Farm (auto).cmd'
if (Test-Path -LiteralPath $legacy) {
    $content = Get-Content -LiteralPath $legacy -Raw
    if (!$content.Contains($projectRoot) -or !$content.Contains('scripts\watchdog.js')) { throw 'Unknown legacy startup entry; leave it untouched' }
    $backupDir = Join-Path $projectRoot '.windows-backups\logon-start'
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $backup = Join-Path $backupDir ('Asteria Farm (auto)-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.cmd')
    Copy-Item -LiteralPath $legacy -Destination $backup -ErrorAction Stop
    Remove-Item -LiteralPath $legacy -ErrorAction Stop
}
$legacyScript = Join-Path $projectRoot 'scripts\watchdog.js'
$legacyProcesses = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($legacyScript) })
foreach ($p in $legacyProcesses) { Stop-Process -Id $p.ProcessId -ErrorAction Stop }
[PSCustomObject]@{TaskName=$installed.TaskName;State=$installed.State.ToString();Trigger='AtLogOn';LegacyGuardiansStopped=$legacyProcesses.Count;StartedNow=$false} | ConvertTo-Json -Compress
