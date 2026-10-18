#!/bin/sh
# Administrator-only installation from a reviewed, merged checkout. Starts no service.
set -eu
if [ "$(id -u)" -ne 0 ] || [ "$#" -ne 2 ]; then
  echo 'Usage: sudo sh hosting/install-accounts.sh node@sha256:<verified-digest> <existing-scheduler-lock>' >&2
  exit 1
fi
image=$1
scheduler_lock=$2
python3 - "$image" "$scheduler_lock" <<'PY'
import os,re,stat,sys
from pathlib import Path
if not re.fullmatch(r'node@sha256:[a-f0-9]{64}',sys.argv[1]): raise SystemExit('Use a reviewed immutable official Node 22 image digest.')
p=Path(sys.argv[2]); st=p.lstat()
if not p.is_absolute() or not stat.S_ISREG(st.st_mode) or p.is_symlink() or st.st_uid!=0 or st.st_mode&0o022 or st.st_nlink!=1: raise SystemExit('Use the existing trusted scheduler lock, not a new lock.')
for path in [*p.parents, Path('/run/lock/last-spire-release.lock')]:
    info=path.lstat()
    sticky_lock=path == Path('/run/lock') and bool(info.st_mode & stat.S_ISVTX)
    if path.is_symlink() or info.st_uid!=0 or (info.st_mode&0o022 and not sticky_lock): raise SystemExit('Untrusted lock path.')
PY
exec 9<>"$scheduler_lock"
flock -n 9 || { echo 'Shared CI dispatcher holds its lifetime lock. Use the reviewed maintenance procedure; nothing installed.' >&2; exit 1; }
exec 8<>/run/lock/last-spire-release.lock
flock -n 8 || { echo 'A release operation is running. Retry when it finishes.' >&2; exit 1; }
/usr/bin/docker image inspect "$image" >/dev/null
if ! id last-spire-accounts >/dev/null 2>&1; then
  /usr/sbin/useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin last-spire-accounts
elif [ ! -f /etc/last-spire/accounts-install.json ]; then
  echo 'An existing service identity needs administrative review; nothing will be reused silently.' >&2
  exit 1
fi
api_uid=$(id -u last-spire-accounts)
api_gid=$(id -g last-spire-accounts)
if [ -f /etc/last-spire/accounts-install.json ] && [ ! -f /var/lib/last-spire/accounts/deletions/deletions.jsonl ]; then
  echo 'The stable deletion journal is missing. Recover it privately; it will not be replaced with an empty journal.' >&2
  exit 1
fi
install -d -o root -g root -m 755 /usr/local/lib/last-spire /etc/last-spire
install -d -o root -g root -m 700 /var/lib/last-spire/accounts /etc/last-spire/accounts
for directory in data deletions; do
  if [ ! -e "/var/lib/last-spire/accounts/$directory" ]; then
    install -d -o "$api_uid" -g "$api_gid" -m 700 "/var/lib/last-spire/accounts/$directory"
  fi
done
if [ ! -e /var/lib/last-spire/accounts/deletions/deletions.jsonl ]; then
  install -o "$api_uid" -g "$api_gid" -m 600 /dev/null /var/lib/last-spire/accounts/deletions/deletions.jsonl
fi
python3 - "$image" "$scheduler_lock" "$api_uid" "$api_gid" <<'PY'
import json,os,sys
from pathlib import Path
p=Path('/etc/last-spire/accounts-install.json')
value={'schema':1,'image':sys.argv[1],'schedulerLock':sys.argv[2],'uid':int(sys.argv[3]),'gid':int(sys.argv[4]),'dataDir':'/var/lib/last-spire/accounts/data'}
if p.exists():
    old=json.loads(p.read_text())
    if old != value: raise SystemExit('Existing account installation differs. Review runtime/configuration migration before replacing it.')
else:
    fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as stream: json.dump(value,stream);stream.flush();os.fsync(stream.fileno())
PY
for file in release.py artifact_contract.py accounts.py; do
  install -o root -g root -m 644 "hosting/$file" "/usr/local/lib/last-spire/$file"
done
install -o root -g root -m 755 hosting/onboard-accounts.py /usr/local/sbin/last-spire-onboard-accounts
for action in deploy rollback backup prepare-restore status; do
  destination="/usr/local/sbin/last-spire-account-$action"
  printf '#!/bin/sh\nexec /usr/bin/python3 /usr/local/lib/last-spire/accounts.py %s "$@"\n' "$action" > "$destination"
  chown root:root "$destination"
  chmod 755 "$destination"
done
echo 'Trusted account tools installed. Existing static configuration/credentials preserved. No API, proxy, collector or deployment was started.'
