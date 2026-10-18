# Accounts and cloud saves

The browser supports optional Google sign-in and cloud-save controls alongside guest play. A same-origin account API must be configured separately; merging these files does not expose or deploy a production service. Existing guest saves are never uploaded automatically.

## Identity and data

Google Identity Services supplies an identity token. The service uses Google's supported verification library to check its signature, audience, issuer and expiry, then requires a proof issued within ten minutes and a nonce tied to the browser session. An abandoned sign-in session expires after ten minutes. A successful login consumes that session and creates a new opaque Last Spire session. No Google passwords, access tokens, refresh tokens, email addresses or profile pictures are stored. A Google subject, internal player ID and display name identify the account. Names are untrusted text and are escaped in the account interface.

Sessions use host-only `Secure`, `HttpOnly`, `SameSite=Strict` cookies over HTTPS. A separate CSRF value is returned to same-origin JavaScript and required in `X-CSRF-Token` on every write. Writes require the exact configured `Origin`. No cross-origin read permission is granted. Expired sessions, duplicate cookies and cross-site bootstrap requests are refused. Sign-out revokes the current session; deletion requires a sign-in from the last ten minutes and explicit confirmation, and revokes every session for that account.

The server stores validated full checkpoints: permanent progress, active runs, RNG, pending choices and settlement records. Graphics, audio, window layout and other device settings are excluded. The existing save validator handles current and legacy runs. The service never adds currencies together or awards gameplay rewards itself.

## API contract, version 1

All responses are JSON with `Cache-Control: no-store`. Errors have a fixed `{ "error": "code" }` shape without provider details or save content. Apart from session bootstrap and health, endpoints require an authenticated session. Cookies and account ownership are never supplied inside a save body.

| Method and path                    | Behavior                                                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/healthz`                 | Service health/schema; does not return player data.                                                                                             |
| `GET /api/session`                 | Creates/reuses a session; returns public OAuth client ID, CSRF value, Google nonce, database generation and optional player.                    |
| `POST /api/auth/google`            | `{credential}`; verifies Google identity, consumes nonce/session and rotates credentials.                                                       |
| `POST /api/auth/google/code`       | `{code}`; exact-origin/CSRF-protected popup-code exchange, verified identity and session rotation. Disabled without a private server secret.    |
| `POST /api/auth/logout`            | `{}`; revokes this session.                                                                                                                     |
| `DELETE /api/account`              | `{confirmation:"DELETE"}`; recent sign-in required; deletes the live account, sessions and checkpoint history.                                  |
| `GET /api/save`                    | Current generation, revision, update time, optional snapshot, device-lock status/expiry.                                                        |
| `POST /api/save/lease`             | `{generation,revision,takeover,leaseToken?}`; acquires or renews a 90-second device lock. Taking over an active lock requires `takeover:true`.  |
| `PUT /api/save`                    | `{generation,revision,leaseToken,writeId,snapshot}`; conditional full-checkpoint write. `writeId` is a UUID retained for a lost-response retry. |
| `GET /api/save/history`            | Metadata for up to five previous revisions.                                                                                                     |
| `GET /api/save/history/<revision>` | One previous checkpoint owned by the current account. Recovery still requires a new conditional write.                                          |

The client must fetch cloud state and obtain a device lock before adopting/writing a checkpoint. It must show a comparison before replacing existing local or cloud progress. A `stale_revision`, `lease_lost`, `lease_held`, or `restored_database` response requires reconciliation, never an automatic overwrite/retry with fresh metadata. A retry of the latest accepted write with the same write ID, base revision and payload returns the original result without adding another revision. Reusing that ID for different data is rejected; retrying an older write after further revisions is stale.

Keep the lease alive while actively continuing a run, and retain unsynced local checkpoints during failures. A takeover changes its secret and invalidates the previous device immediately. Requests remain scoped to the authenticated account even if a caller knows another account's ID or lease token. Database restoration rotates a separate generation, so an old client's revision cannot accidentally match an unrelated restored checkpoint.

## Local service development

Use Node.js 22.16+ or 24. The narrow SQLite adapter uses Node's bundled SQLite API and online-backup API; Node 22 documents this API as early development. Do not silently change the production Node major. The service is tested with the repository's Node 22 CI target and the available local runtime before release. There is no native npm SQLite addon or separate database server.

Create a dedicated Google Cloud project and a Web OAuth client using [Google's setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid). Configure exact development/production JavaScript origins and separate clients per environment. The custom button uses Google's supported popup authorization-code flow with only `openid profile`; incremental authorization is disabled. The OAuth client ID is public. Its secret must stay in a private server-only file, never a Vite environment variable, browser bundle, command argument, Git file, or log. Do not attach billing or enable paid storage.

The server exchanges the single-use code at Google's fixed token endpoint using the configured origin as `redirect_uri`, verifies the ID token, discards Google access/refresh tokens, and rotates the app session. Exact-Origin and session-CSRF checks protect the popup POST before exchange, following [Google's code-model guide](https://developers.google.com/identity/oauth2/web/guides/use-code-model). The older ID-token endpoint retains nonce verification for compatibility; the new code route does not accept caller-supplied tokens or redirect URLs.

For local setup, run `python3 scripts/onboard-google-secret.py` directly in your terminal and enter the development web-client secret at its hidden prompt. It writes only an ignored mode-600 file. Set `GOOGLE_CLIENT_SECRET_FILE` to that file's absolute path in the local API environment, then restart the API. Do not paste the value into chat. Production requires separate private onboarding; this helper does not deploy anything. Without the file, the new button explains that configuration is pending and guest play remains available.

Run only one game preview. The service may be run alongside it when testing account integration. Set these environment variables outside Git:

| Variable                    | Purpose                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`          | Web client allowed as token audience.                                                                               |
| `GOOGLE_CLIENT_SECRET_FILE` | Optional absolute path to a mode-600 server-only secret file. Required for the custom code-popup button.            |
| `LAST_SPIRE_ORIGIN`         | Exact browser origin, with no trailing slash. HTTPS by default.                                                     |
| `LAST_SPIRE_DATA_DIR`       | Absolute service-owned private directory outside static output.                                                     |
| `LAST_SPIRE_API_PORT`       | Optional unprivileged loopback port; default 8092.                                                                  |
| `NODE_ENV`                  | Only explicit `development` permits HTTP on localhost/loopback.                                                     |
| `LAST_SPIRE_TRUST_PROXY`    | Default off. Set to `1` only behind a trusted loopback proxy which overwrites `X-Forwarded-For` with one client IP. |

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

## Browser behavior and local development

Each page visit begins with **Play as guest** or **Continue with Google**. Guest play opens the existing browser save immediately, without waiting for Google. A remembered account also offers **Continue as…** to restore its local checkpoint explicitly, including offline recovery. No remembered account is activated merely by opening the page. Combat and battlefield shortcuts remain inactive until the entry screen is dismissed.

Open **Account & cloud saves** from the battlefield toolbar, expedition menu, or Settings. The header reports guest/local, queued, synced, offline, or conflict state. Opening the account sign-in interface prepares our accessible dark **Continue with Google** button, which directly launches Google's supported code popup. Google’s library is not loaded during background gameplay. Connected players only prepare it again when opening verification/account-switching controls. Automatic sign-in prompts are not used.

Guest saves retain the existing `last-spire/save/root` IndexedDB key. Each account uses a separately validated `account:<internal UUID>` key. Every write, import, recovery read, and reward settlement captures its context explicitly. A browser Web Lock prevents two tabs from sharing a writable account cache. If that API is unavailable, guest play and exports remain available. Device presentation preferences are retained across account switches and excluded from cloud payloads. A validated writer token is retained only in that tab’s sessionStorage so refresh can resume its reservation; it is scoped to the account and database generation, cleared on logout/deletion/lost ownership, and still requires the API’s authenticated session and CSRF protection. Login, Google proof, and CSRF tokens are never written to browser persistence.

On first sign-in the player compares guest, cached account, and cloud progress. Copying guest progress leaves the original guest root intact. Neither credits nor reward ledgers are merged across checkpoints. Replacements retain up to five local account recovery copies; the UI exports these and the server’s five previous revisions for reviewed import. A reviewed source which changes during the confirmation must be reviewed again.

Local autosaves continue independently of cloud uploads. Queued cloud writes use a fixed 15-second deadline rather than a debounce that gameplay could postpone forever. Writes reread the remote checkpoint, verify the current account, acquire/renew the 90-second writer lease, and use the accepted generation and revision. Offline or stale branches are kept locally. Reconnection, database restoration, or a lost device lease never silently replaces a checkpoint. The current in-memory pending write can recognize a lost response; after a crash, ambiguous divergence requires comparison rather than guessing.

Signing out requires a successful server revocation and returns to guest progress. **Play as guest** can detach local account play without revoking the session; its checkpoint stays cached. Deletion requires a recent Google sign-in, typed `DELETE`, and a separate confirmation. It removes the live account and current browser’s account cache/recovery copies; other browsers’ offline copies must be cleared on those devices. Earlier server backups can retain deleted data for seven days; operators must honor deletions during restoration.

For local integration, use the dedicated development OAuth client with exact `http://localhost` and `http://localhost:5173` JavaScript origins. The public client ID is passed only to the local API, which supplies it to the browser session. Keep actual configuration outside Git:

```sh
# Terminal one: set GOOGLE_CLIENT_ID to your development client ID in the shell.
NODE_ENV=development LAST_SPIRE_ORIGIN=http://localhost:5173 \
  LAST_SPIRE_DATA_DIR=/absolute/private/account-data npm run account:dev

# Terminal two: run the single game preview with the fixed loopback API proxy.
LAST_SPIRE_API_PROXY=1 npm run dev -- --port 5173 --strictPort
```

The opt-in proxy targets only `http://127.0.0.1:8092`, preserves the browser Origin, and is disabled by default. Open `http://localhost:5173` rather than a different hostname for the registered Google origin. When the API is unavailable or an HTML fallback is returned, account controls explain the failure while guest saves remain usable. Google loads from its official hosted script; there are no OAuth secrets in browser configuration.

## Production enablement still required

Before exposing production sign-in: package/deploy the non-root API through the reviewed artifact contract, route it on the same origin, configure the production OAuth client, allow the minimum Google CSP origins and appropriate popup policy, publish/link the privacy notice in Google branding, and complete actual Google sign-in tests. The bundled `/privacy.html` explains identity data, cloud/local storage, deletion and same-server recovery limits. Synthetic integration tests do not claim a real Google login occurred.

The existing static release pipeline continues to package only `dist/`. No backend is deployed or exposed by merging this interface PR. Cloud saves become available only through a separately reviewed, deliberately deployed API release.
