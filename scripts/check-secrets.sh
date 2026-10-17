#!/bin/sh
# Linux CI: verified upstream binary, local/redacted scan, no artifact upload.
set -eu
umask 077
if [ ! -f dist/index.html ]; then
  echo 'Build the game first: secret checks cover both Git history and the actual browser bundle.' >&2
  exit 1
fi
if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then
  echo 'This pinned scanner wrapper supports Linux x86_64. Use a verified Gitleaks installation on other development platforms.' >&2
  exit 1
fi
scan_work=$(mktemp -d)
trap 'rm -rf "$scan_work"' EXIT HUP INT TERM
curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location --silent --show-error \
  --retry 2 --max-time 60 --max-filesize 33554432 \
  --output "$scan_work/gitleaks.tar.gz" \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz
printf '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb  %s\n' "$scan_work/gitleaks.tar.gz" | sha256sum --check --status
tar -xzf "$scan_work/gitleaks.tar.gz" -C "$scan_work" gitleaks
"$scan_work/gitleaks" git . --log-opts=--all --redact=100 --no-banner
"$scan_work/gitleaks" dir dist --redact=100 --no-banner
