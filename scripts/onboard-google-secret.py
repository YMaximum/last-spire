#!/usr/bin/env python3
"""Local hidden-input onboarding. Never pass the secret as a command argument."""
import getpass
import os
from pathlib import Path
import re
import sys
import warnings


def main():
    root = Path(__file__).resolve().parent.parent
    directory = root / '.private' / 'account-dev'
    target = directory / 'google-client-secret'
    if not sys.stdin.isatty():
        raise ValueError('Run this directly in your terminal; piped input is refused.')
    if target.exists() or target.is_symlink():
        raise ValueError('A secret file already exists. No existing configuration was changed.')
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        value = getpass.getpass('Local-development Google web-client secret (hidden): ')
    if not re.fullmatch(r'[A-Za-z0-9_-]{16,256}', value):
        raise ValueError('Invalid secret format. Nothing was saved.')
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError('The private configuration directory is invalid.')
    os.chmod(directory, 0o700)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
    print('Private local secret saved. No value was printed or sent to the game.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, EOFError, getpass.GetPassWarning) as error:
        # OSError can include a path; do not expose underlying OS diagnostics.
        print(str(error) if isinstance(error, ValueError) else 'Secret onboarding could not complete. Nothing was published.', file=sys.stderr)
        sys.exit(1)
