# Accounts and cloud saves

This is the account-service foundation. The current browser game still plays as a guest and saves locally. Browser sign-in, account-isolated local caches, migration/conflict dialogs, and checked production API deployment are not enabled by this change. Do not represent the service as already available to players.

## Identity and data

Google Identity Services supplies an identity token. The service uses Google's supported verification library to check its signature, audience, issuer and expiry, then requires a proof issued within ten minutes and a nonce tied to the browser session. An abandoned sign-in session expires after ten minutes. A successful login consumes that session and creates a new opaque Last Spire session. No Google passwords, access tokens, refresh tokens, email addresses or profile pictures are stored. A Google subject, internal player ID and display name identify the account. Names are untrusted text and must be rendered as text by the future browser integration.

Sessions use host-only `Secure`, `HttpOnly`, `SameSite=Strict` cookies over HTTPS. A separate CSRF value is returned to same-origin JavaScript and required in `X-CSRF-Token` on every write. Writes require the exact configured `Origin`. No cross-origin read permission is granted. Expired sessions, duplicate cookies and cross-site bootstrap requests are refused. Sign-out revokes the current session; deletion requires a sign-in from the last ten minutes and explicit confirmation, and revokes every session for that account.

The server stores validated full checkpoints: permanent progress, active runs, RNG, pending choices and settlement records. Graphics, audio, window layout and other device settings are excluded. The existing save validator handles current and legacy runs. The service never adds currencies together or awards gameplay rewards itself.

## API contract, version 1

All responses are JSON with `Cache-Control: no-store`. Errors have a fixed `{ "error": "code" }` shape without provider details or save content. Apart from session bootstrap and health, endpoints require an authenticated session. Cookies and account ownership are never supplied inside a save body.

| Method and path | Behavior |
| --- | --- |
| `GET /api/healthz` | Service health/schema; does not return player data. |
| `GET /api/session` | Creates/reuses a session; returns public OAuth client ID, CSRF value, Google nonce, database generation and optional player. |
| `POST /api/auth/google` | `{credential}`; verifies Google identity, consumes nonce/session and rotates credentials. |
| `POST /api/auth/logout` | `{}`; revokes this session. |
| `DELETE /api/account` | `{confirmation:"DELETE"}`; recent sign-in required; deletes the live account, sessions and checkpoint history. |
| `GET /api/save` | Current generation, revision, update time, optional snapshot, device-lock status/expiry. |
| `POST /api/save/lease` | `{generation,revision,takeover,leaseToken?}`; acquires or renews a 90-second device lock. Taking over an active lock requires `takeover:true`. |
| `PUT /api/save` | `{generation,revision,leaseToken,writeId,snapshot}`; conditional full-checkpoint write. `writeId` is a UUID retained for a lost-response retry. |
| `GET /api/save/history` | Metadata for up to five previous revisions. |
| `GET /api/save/history/<revision>` | One previous checkpoint owned by the current account. Recovery still requires a new conditional write. |

The client must fetch cloud state and obtain a device lock before adopting/writing a checkpoint. It must show a comparison before replacing existing local or cloud progress. A `stale_revision`, `lease_lost`, `lease_held`, or `restored_database` response requires reconciliation, never an automatic overwrite/retry with fresh metadata. A retry of the latest accepted write with the same write ID, base revision and payload returns the original result without adding another revision. Reusing that ID for different data is rejected; retrying an older write after further revisions is stale.

Keep the lease alive while actively continuing a run, and retain unsynced local checkpoints during failures. A takeover changes its secret and invalidates the previous device immediately. Requests remain scoped to the authenticated account even if a caller knows another account's ID or lease token. Database restoration rotates a separate generation, so an old client's revision cannot accidentally match an unrelated restored checkpoint.

## Local service development

Use Node.js 22.16+ or 24. The narrow SQLite adapter uses Node's bundled SQLite API and online-backup API; Node 22 documents this API as early development. Do not silently change the production Node major. The service is tested with the repository's Node 22 CI target and the available local runtime before release. There is no native npm SQLite addon or separate database server.

Create a dedicated Google Cloud project and a Web OAuth client using [Google's setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid). Configure the exact development/production origins and use separate client configuration per environment. The OAuth client ID is public configuration; no OAuth client secret is used for this identity-token flow. Do not attach billing or enable paid storage for this feature.

Run only one game preview. The service may be run alongside it when testing account integration. Set these environment variables outside Git:

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Web client allowed as token audience. |
| `LAST_SPIRE_ORIGIN` | Exact browser origin, with no trailing slash. HTTPS by default. |
| `LAST_SPIRE_DATA_DIR` | Absolute service-owned private directory outside static output. |
| `LAST_SPIRE_API_PORT` | Optional unprivileged loopback port; default 8092. |
| `NODE_ENV` | Only explicit `development` permits HTTP on localhost/loopback. |
| `LAST_SPIRE_TRUST_PROXY` | Default off. Set to `1` only behind a trusted loopback proxy which overwrites `X-Forwarded-For` with one client IP. |

Use `npm run account:dev`. The service binds to `127.0.0.1`. This development command is not production deployment guidance. A later reviewed release change must package the service separately from public assets, configure its non-root runtime, exact proxy route, persistent data permissions, health checks and rollback compatibility. Never give CI a production database or session credential.

Limits include an 8 MiB checkpoint, two concurrent buffered request bodies, 32 connections, request/header deadlines, bounded rate-limit buckets, ten sessions per account, a 256 MiB database cap and a 256 MiB free-disk reserve. Capacity refusals must be shown by the client while keeping local progress. These are a hobby-service baseline, not a measured concurrent-player capacity guarantee.

## VPS-only backups and restoration

The service makes a consistent SQLite backup on startup and every 24 hours while running. It retains at most seven snapshots, expiring snapshots older than seven days during backup rotation. Each snapshot has a SHA-256 sidecar; both files are private. Current and up to five prior per-player revisions offer additional recovery from bad writes.

Same-VPS copies can recover failed migrations or accidental writes. They cannot protect against losing the VPS, its disk, or control of the host. Players should retain exported saves on another device when that protection matters. Off-site object storage is deferred.

Operator commands, from a trusted checkout:

```sh
npm run account:backup -- backup /absolute/private/data
npm run account:backup -- verify /absolute/private/data/backups/snapshot-file.sqlite
npm run account:backup -- restore /absolute/private/data/backups/snapshot-file.sqlite /absolute/new-private-data
```

Restore verifies checksum, SQLite integrity and schema, refuses an existing target database, copies into a new private directory, removes sessions/locks and rotates the database generation. Stop the API before switching its configured directory to the restored copy. Retain the old directory for operator recovery; do not overwrite an active database or try to downgrade an unsupported schema. Make and verify a backup before future schema migrations. Older backups can contain deleted-account data until rotation expires them; disclose this retention in the player-facing privacy notice. Backup failures require operator attention and are reported without private payloads.

## Remaining integration work

Before exposing sign-in: finish the account-isolated browser cache and guest-adoption/conflict screens; provide status, export, sign-out and deletion controls; add a clear privacy notice; update the minimum required Google CSP origins; and complete an actual Google sign-in test with the owner-controlled project. Automated local signing-key tests exercise Google's real verifier without claiming a live Google login occurred.

The existing static release pipeline intentionally continues to package only `dist/`. No backend is deployed or exposed by merging this foundation. Cloud saves become available only through a separately reviewed, deliberately deployed integration.
