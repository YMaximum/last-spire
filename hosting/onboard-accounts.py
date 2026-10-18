#!/usr/bin/env python3
"""Hidden production-only Google onboarding. No value is passed through argv or CI."""
import fcntl
import getpass
import json
import os
from pathlib import Path
import re
import sys
import warnings
sys.path.insert(0, '/usr/local/lib/last-spire')
import accounts
import release


def main():
    if os.geteuid() != 0 or not sys.stdin.isatty():
        raise ValueError('Use an interactive SSH terminal with sudo.')
    template = json.loads(release.trusted_file(Path('/etc/last-spire/accounts-install.json'), secret=True))
    previous = accounts.CONFIG.exists()
    if previous:
        current = json.loads(release.trusted_file(accounts.CONFIG, secret=True))
        template['dataDir'] = current['dataDir']
        if input('Replace production Google configuration? Type ROTATE to continue: ') != 'ROTATE':
            raise ValueError('No configuration changed.')
    origin = input('Production HTTPS game origin (no trailing slash): ').strip()
    client = input('Production Google Web client ID (not the development client): ').strip()
    if not re.fullmatch(r'https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', origin) or 'localhost' in origin or not re.fullmatch(r'\d+-[\w-]+\.apps\.googleusercontent\.com', client):
        raise ValueError('Invalid production origin/client ID. Nothing saved.')
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        secret = getpass.getpass('Production Google client secret (hidden): ').strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{16,256}', secret):
        raise ValueError('Invalid secret format. Nothing saved.')
    cfg = {**template, 'origin': origin, 'clientId': client}
    with open('/run/lock/last-spire-release.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if (accounts.STATE / 'pending.json').exists():
            raise ValueError('Finish or recover the pending account deployment before onboarding.')
        temp = accounts.SECRET.with_name('.google-client-secret.next')
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, 'w') as stream:
                os.fchown(stream.fileno(), cfg['uid'], cfg['gid'])
                stream.write(secret)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp, accounts.SECRET)
            accounts.atomic_json(accounts.CONFIG, cfg)
        finally:
            temp.unlink(missing_ok=True)
    print('Private production configuration saved. No service started or deployed; run the checked API deploy command explicitly.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.exit('Production onboarding did not complete. No secret value was logged; inspect private configuration before retrying.')
