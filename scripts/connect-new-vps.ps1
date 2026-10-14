$ErrorActionPreference = 'Stop'
$taskVpsHost = '192.0.2.10'
$taskVpsUser = 'root'
$taskProjectRoot = Split-Path -Parent $PSScriptRoot
$taskPrivateKey = Join-Path $env:USERPROFILE '.ssh/asteria_example-vps_ed25519'
$taskPublicFile = $taskPrivateKey + '.pub'
$taskProofFile = Join-Path $taskProjectRoot 'logs/system-audit/new-vps-ssh-access.json'

try {
    if (!(Test-Path -LiteralPath $taskPrivateKey) -or !(Test-Path -LiteralPath $taskPublicFile)) {
        throw 'Dedicated Asteria SSH key is missing. No existing keys will be overwritten.'
    }
    $taskPublicKey = (Get-Content -LiteralPath $taskPublicFile -Raw).Trim()
    if ($taskPublicKey -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+(?: [A-Za-z0-9._-]+)?$') {
        throw 'Unexpected public key format.'
    }
    Write-Host 'Connect to Asteria VPS 192.0.2.10 as root.'
    Write-Host 'Enter the server password at the SSH prompt. It will not be displayed or saved.'
    Write-Host 'This only installs a dedicated public key; it does not start bots.'
    # Public-key text is validated above; no password passes through PowerShell.
    $taskInstallCommand = "umask 077; mkdir -p /root/.ssh && touch /root/.ssh/authorized_keys && chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys && { grep -qxF '$taskPublicKey' /root/.ssh/authorized_keys || printf '%s\n' '$taskPublicKey' >> /root/.ssh/authorized_keys; }"
    & ssh -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o PreferredAuthentications=password -o PubkeyAuthentication=no -o NumberOfPasswordPrompts=3 "$taskVpsUser@$taskVpsHost" $taskInstallCommand
    if ($LASTEXITCODE -ne 0) { throw 'SSH public-key installation failed. No successful access is claimed.' }
    $taskOs = & ssh -i $taskPrivateKey -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 "$taskVpsUser@$taskVpsHost" 'uname -s'
    if ($LASTEXITCODE -ne 0 -or ($taskOs -join '').Trim() -ne 'Linux') {
        throw 'Key-based Linux access was not verified.'
    }
    $taskProof = [ordered]@{
        at = [DateTimeOffset]::UtcNow.ToString('o')
        host = $taskVpsHost
        user = $taskVpsUser
        keyPath = $taskPrivateKey
        keyAccessVerified = $true
        os = 'Linux'
        botsStarted = $false
    }
    $taskProofDirectory = Split-Path -Parent $taskProofFile
    [void](New-Item -ItemType Directory -Path $taskProofDirectory -Force)
    $taskProof | ConvertTo-Json | Set-Content -LiteralPath $taskProofFile -Encoding utf8
    Write-Host 'SUCCESS: SSH key access verified. The server is ready for hardware inspection.' -ForegroundColor Green
} catch {
    Write-Host ('FAILED: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
