"""Private SSH administration for the explicitly authorized third Asteria host.

Password is read locally, never placed in process arguments or emitted. Existing
host trust is required. Remote commands must come from a reviewed local file.
"""
import argparse
import os
from pathlib import Path
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

sys.path.insert(0, str(Path.home() / '.cache' / 'asteria-ssh-python'))
import paramiko

ROOT = Path(__file__).resolve().parent.parent
HOST = '192.0.2.10'


def password():
    values = []
    for line in (ROOT / '.env').read_text(encoding='utf-8-sig').splitlines():
        match = re.match(r'^\s*VPS_SSH_PASSWORD\s*=\s*(.*)$', line)
        if match:
            value = match.group(1).strip()
            if len(value) >= 2 and value[0] in '\"\'' and value[-1] == value[0]:
                value = value[1:-1]
            values.append(value)
    if len(values) != 1 or not values[0]:
        raise ValueError('Missing or duplicate VPS_SSH_PASSWORD')
    return values[0]


def connect():
    client = paramiko.SSHClient()
    client.load_system_host_keys(str(Path.home() / '.ssh' / 'known_hosts'))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    try:
        client.connect(HOST, username='root', password=password(),
                       look_for_keys=False, allow_agent=False, timeout=15,
                       banner_timeout=15, auth_timeout=20)
    except BaseException:
        client.close()
        raise
    return client


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['run', 'put'])
    parser.add_argument('--file', required=True)
    parser.add_argument('--remote')
    parser.add_argument('--timeout', type=int, default=180)
    args = parser.parse_args()
    local = Path(args.file).resolve(strict=True)
    with connect() as client:
        if args.action == 'put':
            if not args.remote or not args.remote.startswith('/opt/asteria-node-b/asteria/') or '..' in Path(args.remote).parts:
                raise ValueError('Upload must stay inside the third-host project')
            with client.open_sftp() as sftp:
                # Bound a stalled public release transfer instead of hanging the audit indefinitely.
                sftp.get_channel().settimeout(args.timeout)
                sftp.put(str(local), args.remote)
                sftp.chmod(args.remote, 0o600)
            print('Third-host file uploaded (contents omitted)')
            return
        program = local.read_text(encoding='utf-8-sig')
        if len(program.encode()) > 500000:
            raise ValueError('Remote program too large')
        stdin, stdout, stderr = client.exec_command('bash -s', timeout=args.timeout)
        stdin.write(program)
        stdin.flush()
        stdin.channel.shutdown_write()
        # Reviewed programs emit public status only. Never run a credential dump.
        channel = stdout.channel
        while not channel.exit_status_ready() or channel.recv_ready() or channel.recv_stderr_ready():
            if channel.recv_ready():
                sys.stdout.write(channel.recv(4096).decode('utf-8', 'replace'))
                sys.stdout.flush()
            if channel.recv_stderr_ready():
                sys.stderr.write(channel.recv_stderr(4096).decode('utf-8', 'replace'))
                sys.stderr.flush()
            import time
            time.sleep(0.05)
        code = channel.recv_exit_status()
        if code:
            raise RuntimeError('Remote operation exit ' + str(code))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Error type only: no exception may echo connection arguments or secrets.
        print('VPS operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
