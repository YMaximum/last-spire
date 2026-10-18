#!/bin/sh
# Run only as a trusted administrator, from the reviewed checkout.
set -eu
if [ "$(id -u)" -ne 0 ] || [ "$#" -ne 1 ]; then
  echo 'Usage: sudo sh hosting/install-release.sh nginxinc/nginx-unprivileged@sha256:<digest>' >&2
  exit 1
fi
image=$1
if ! printf '%s\n' "$image" | /usr/bin/python3 -c 'import re,sys; sys.exit(not re.fullmatch(r"nginxinc/nginx-unprivileged@sha256:[a-f0-9]{64}\n?",sys.stdin.read()))'; then
  echo 'Use a verified nginx-unprivileged digest, not a mutable tag.' >&2
  exit 1
fi
/usr/bin/docker image inspect "$image" >/dev/null
install -d -o root -g root -m 755 /etc/last-spire /usr/local/lib/last-spire /var/lib/last-spire/releases
install -o root -g root -m 644 hosting/release.py /usr/local/lib/last-spire/release.py
install -o root -g root -m 644 hosting/artifact_contract.py /usr/local/lib/last-spire/artifact_contract.py
sed 's@root /usr/share/nginx/html;@root /srv/releases/current/dist;@' hosting/nginx.conf > /etc/last-spire/nginx.conf.next
chown root:root /etc/last-spire/nginx.conf.next
chmod 644 /etc/last-spire/nginx.conf.next
mv /etc/last-spire/nginx.conf.next /etc/last-spire/nginx.conf
printf '{"image":"%s"}\n' "$image" > /etc/last-spire/release.json.next
chown root:root /etc/last-spire/release.json.next
chmod 644 /etc/last-spire/release.json.next
mv /etc/last-spire/release.json.next /etc/last-spire/release.json
for action in deploy rollback; do
  destination="/usr/local/sbin/last-spire-$action"
  printf '#!/bin/sh\nexec /usr/bin/python3 /usr/local/lib/last-spire/release.py %s "$@"\n' "$action" > "$destination"
  chown root:root "$destination"
  chmod 755 "$destination"
done
install -o root -g root -m 755 hosting/onboard-release.py /usr/local/sbin/last-spire-onboard-release
echo 'Installed trusted commands; no game was started or deployed.'
echo 'Enter the dedicated Actions-read/Contents-read credential with: sudo last-spire-onboard-release'
