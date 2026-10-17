#!/usr/bin/env python3
"""Interactive administrative input only; never pass the credential as an argument."""
import getpass
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

if os.geteuid() != 0 or not sys.stdin.isatty():
    sys.exit("Run through sudo in an interactive SSH terminal.")
token = getpass.getpass("Expiring Last Spire fine-grained PAT (Contents read, Actions read): ").strip()
if not token or any(char.isspace() for char in token):
    sys.exit("Credential was empty or invalid; nothing saved.")
try:
    for endpoint in ("commits/main", "actions/artifacts?per_page=1"):
        request = urllib.request.Request(
            "https://api.github.com/repos/YMaximum/last-spire/" + endpoint,
            headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "User-Agent": "last-spire-onboarding"})
        with urllib.request.urlopen(request, timeout=20) as response:
            json.load(response)
except Exception:
    sys.exit("Credential validation failed; nothing saved. Check repository selection, expiry and read permissions.")
directory = Path("/etc/last-spire")
directory.mkdir(mode=0o755, exist_ok=True)
temporary = directory / ".github-token.next"
descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
with os.fdopen(descriptor, "w") as output:
    os.fchmod(output.fileno(), 0o600)
    output.write(token + "\n")
    output.flush()
    os.fsync(output.fileno())
temporary.replace(directory / "github-token")
print("Credential saved with root-only access. No deployment was performed.")
