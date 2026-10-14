$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$desktopPath = [Environment]::GetFolderPath('Desktop')
if (!$desktopPath -or !(Test-Path -LiteralPath $desktopPath)) { throw 'Desktop folder unavailable' }
$shortcutPath = Join-Path $desktopPath 'Asteria - Accounts.lnk'
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $projectRoot 'scripts\open-account-admin.ps1') + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = 'Private Asteria accounts dashboard. Opens in the external browser.'
$shortcut.IconLocation = (Join-Path $env:SystemRoot 'System32\shell32.dll') + ',44'
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Output 'Asteria - Accounts shortcut installed on Desktop'
