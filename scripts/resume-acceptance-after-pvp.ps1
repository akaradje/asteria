$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskCommandPath = Join-Path $taskRoot 'logs/pvp-command.json'
$taskUntil = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 1800000
while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $taskUntil) {
    $taskCommand = $null
    if (Test-Path -LiteralPath $taskCommandPath) { $taskCommand = Get-Content -Raw -LiteralPath $taskCommandPath | ConvertFrom-Json }
    if (-not $taskCommand -or [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -gt ($taskCommand.expiresAt + 90000)) { break }
    Start-Sleep -Seconds 5
}
Start-ScheduledTask -TaskName 'Asteria Architecture Acceptance'
