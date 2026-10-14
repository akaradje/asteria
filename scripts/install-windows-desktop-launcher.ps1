$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$desktopPath = [Environment]::GetFolderPath('Desktop')
if (!$desktopPath -or !(Test-Path -LiteralPath $desktopPath)) { throw 'Windows Desktop folder is unavailable' }
$shortcutPath = Join-Path $desktopPath 'Asteria - Run Windows 3.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$launcherPath = Join-Path $projectRoot 'scripts\start-external-team.ps1'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcherPath + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = 'Start Windows 3 and open the external team dashboard. tum runs independently.'
$shortcut.IconLocation = (Join-Path $env:SystemRoot 'System32\shell32.dll') + ',137'
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Output $shortcutPath
