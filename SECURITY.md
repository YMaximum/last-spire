# Security and publication policy

Last Spire is a single-player browser game. The current static game stores progress and gameplay observations in the browser. The repository also contains an optional account/save service foundation, described in [docs/ACCOUNTS.md](docs/ACCOUNTS.md); browser sign-in integration and production service deployment are separate work. Adding this service to the repository does not upload existing browser saves. Treat imported saves as untrusted input. Client-side code and configuration delivered to a browser are readable by players, even if a source repository is private.

For the optional service, Google identity tokens must be verified server-side for signature, audience, issuer, expiry and a session-bound nonce. Store only a stable Google subject, internal account ID and minimal display name. Never log credentials, session cookies, CSRF tokens, complete checkpoints, email addresses or provider errors. Authorize every save request using its session rather than a caller-supplied account ID. Protect writes using exact-origin and CSRF checks. Signed-in accounts and guests must have separate browser storage before the service is connected to the game.

Cloud checkpoints are still client-authored single-player data. Schema validation, ownership and conditional writes protect storage and prevent accidental concurrent replacement; they do not make progress suitable for competitive leaderboards or a trusted economy. No such online features are included here.

Database files and backups must remain outside static output, Git and CI workspaces, in a private service-owned directory. Same-VPS backups are recovery copies, not off-site disaster protection. Restore into a new directory while retaining the current one, revoke sessions/device leases, rotate the database generation, and verify migration/recovery before changing the live service. Keep API deployment separate from static releases until the release contract and host controls explicitly support it.

## What belongs in public source

Game code, original artwork, dependency versions, general architecture, generic deployment tools, and build instructions can be public. A public website's hostname, DNS provider and public IP are normally discoverable information; knowing them does not grant administrative access. Still, omit host-specific details that do not help someone understand or build the game.

Keep these out of Git, PR descriptions, screenshots, logs, build artifacts and browser bundles:

- Tokens, passwords, private keys, session cookies, recovery codes and credential-bearing URLs.
- Actual environment-file values, private host inventories, administrator identities, internal addresses, shared-service details, and real operational/recovery notes.
- Player save files, gameplay logs, private messages and personal files unless the person explicitly authorizes their publication.

Keep actual production configuration and operational runbooks in private storage or a separate private infrastructure repository. Public deployment code may show conventional paths and protective controls; the contents of credential files must remain private. A `.gitignore` rule does not remove something already committed, and deleting a file does not erase its history.

Commit author names and email addresses are public Git metadata. Use GitHub's account-provided no-reply address for future commits if a personal address should stay private; do not rewrite shared history casually.

## Development and release checks

- Development and preview bind to `127.0.0.1` by default. The dev server refuses operational folders, credentials and generated save/log files. Enable LAN access only deliberately on a trusted network; do not expose Vite as a production service.
- Run the public-content and dependency checks, tests and production build before a release, then `npm run check:secrets`. The Linux secret-scan wrapper verifies its pinned upstream binary and redacts output; it checks both fetched Git history and the actual browser bundle. CI fetches full history. Packaging also refuses private-file paths in build output.
- Review dependency and Actions updates as PRs. No automatic merges. Moderate-or-higher dependency advisories block the release checks until fixed or a specific, time-limited exception is reviewed and documented privately.
- Review publication text and generated artifacts as well as source files. Do not attach actual user saves or raw operational reports to a public PR.
- Keep build credentials separate from production access. Never run untrusted fork workflows on the self-hosted runner. Rootless containers reduce risk but share the host kernel; a separate build machine or disposable VM is the stronger boundary for CI and production.
- For any security-sensitive change, state what was tested and what remains unverified. A clean scan is evidence, not a guarantee that software has no vulnerabilities.

## Reporting and responding

Use this repository's **Security → Report a vulnerability** private reporting feature. Do not put a suspected credential or an unpatched exploit in a public issue or PR.

If a secret was exposed, stop further publication, revoke or rotate it, inspect relevant access logs, and then remove the public copy and address history/cached copies as appropriate. Making a repository private or deleting a line alone does not invalidate an exposed credential. Keep incident details private until remediation is complete.
