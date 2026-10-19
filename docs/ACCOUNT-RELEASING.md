# Releasing the account service

Use this runbook only after reviewing and merging the production-account infrastructure PR. Installation, CI collection, API deployment, frontend deployment, and public routing are separate operations. None happens automatically. Keep actual host paths, configuration values, credential details, and recovery evidence in the private operations notes.

The existing `last-spire-deploy <sha>` and `last-spire-rollback` commands continue to manage the static game. The companion commands below manage the account API. Every deploy still requires a successful exact-main GitHub run and its immutable VPS collection receipt. No GitHub artifact-storage quota is needed.

## What ships

`npm run build` creates the browser game and two standalone Node 22 bundles. The schema-2 release archive contains `dist/` and exactly four `api/` files: the server, recovery CLI, release identity, and third-party notices. Server files are outside nginx's public document root. The new validator also accepts historical schema-1 static artifacts for frontend rollback. A static-only artifact cannot be used as an API release.

No credentials, database, deletion journal, source maps, operational notes, or development fixtures belong in either artifact. Secret scans cover both compiled components. The VPS does not run npm installation during deployment.

Immutable code directories must be traversable by the unprivileged runtimes. The trusted release installer explicitly sets those directories to `0755` even when called with a private `0077` umask; new code files are `0644`. Reusing an identical installed artifact verifies its checksums before repairing its code-directory permissions. This does not change the caller's umask, credential files, account data, or backups, which retain their private permissions.

## Shared CI maintenance window

The current host-wide scheduler holds its build lock for its **entire dispatcher lifetime**, including idle time. An idle queue alone does not make this lock available. Installation, collector changes, API deployment, backup, and restore preparation intentionally refuse while it is held.

Before stopping the dispatcher, check whether systemd owns the lock's parent through `RuntimeDirectory=`. Its [default cleanup](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#RuntimeDirectoryPreserve=) removes that directory on stop. If applicable, configure a narrow root-owned drop-in for that dispatcher containing:

```ini
[Service]
RuntimeDirectoryPreserve=yes
```

Reload the systemd configuration without restarting the running dispatcher. Verify the effective setting is `yes`, the dispatcher remains active, and the lock's device/inode identity is unchanged. Preserve the directory's existing ownership and permissions. Record the setting change in private operations notes. This preserves runtime files across stops; completed-worker cleanup must still run normally, and `/run` remains temporary across host reboots.

Record the existing lock's device/inode before maintenance and verify the same file remains after the idle dispatcher stops. If the lock disappears or changes identity, restore dispatch and investigate. Never recreate or replace the lock to bypass installation checks. After a reboot, let the normal dispatcher startup establish its lock before attempting release maintenance.

Before those operations, use the existing trusted CI administration tools to record each repository's original dispatch-enabled flag and temporarily disable dispatch for all enabled repositories. Let already active workers finish normally, verify that no worker remains active, then stop only the dispatcher service. Do not stop an active dispatcher to interrupt a build, delete its lock file, or substitute a different lock. Repository configuration and credentials remain intact.

Perform the reviewed operation while it holds that same existing lock. Afterwards, including on failure, restart the dispatcher and restore **exactly** the original dispatch flags; leave originally disabled repositories disabled. Verify dispatcher health and the recorded flags. Keep actual service names and commands in private operations notes. No production game, API, or unrelated service needs to stop for the maintenance window. CI checks needed for deployment must already have completed before pausing dispatch.

## Trusted installation

From a reviewed checkout of the merged commit on the VPS:

1. Pull the official `node:22-bookworm-slim` image, inspect its repository digest, and retain an immutable `node@sha256:...` reference. Production startup requires Node 22.16 or newer within Node 22; a wrong runtime fails candidate validation before the live API is stopped. Do not use a mutable tag in the runtime configuration.
2. Identify the existing host-wide scheduler lock from the private CI runbook. Do not invent another lock: account deployment and installation must serialize with existing repository builds. The installer refuses a missing or untrusted lock and never stops an unrelated workload.
3. Run:

```sh
sudo sh hosting/install-accounts.sh node@sha256:<verified-digest> <existing-scheduler-lock>
```

The installer creates a dedicated non-login service identity, private data and deletion directories, trusted host commands, and a configuration template. It preserves the existing static runtime, nginx configuration, release credential, and account configuration. It starts no API, creates no public route, and changes no collector gate. Reinstallation with a different runtime template is refused pending deliberate migration review. A missing journal on an existing installation is not replaced with an empty file.

The stable deletion journal must survive every data restore. It contains only random internal account IDs, never Google identifiers, names, credentials, or checkpoints. Its 1 MiB cap bounds storage; if exhausted, deletion is refused before live data is removed. Preserve the journal and investigate capacity privately rather than dropping markers. Only compact it when an operator has established that no retained recovery source can resurrect those IDs.

## Collector contract upgrade

The old trusted collector intentionally rejects schema-2 artifacts. Upgrade its validator from the reviewed merged source; keep repository credentials, job guards, resource limits, and the collection gate unchanged.

Review the current collector source against the private baseline and record its SHA-256. The upgrade helper changes only the archive-validation function and installs the shared bounded validator alongside it:

```sh
python3 hosting/upgrade-collector.py <collector-directory>/artifact_store.py \
  --expected-sha256 <reviewed-baseline-sha256>

sudo python3 hosting/upgrade-collector.py <collector-directory>/artifact_store.py \
  --expected-sha256 <reviewed-baseline-sha256> \
  --scheduler-lock <existing-scheduler-lock> --apply
```

The first invocation is a dry run. Apply requires root, trusted paths, the exact reviewed baseline, and the existing scheduler lock released through the maintenance procedure above. It saves the old source privately before an atomic replacement. Do not regenerate the expected baseline merely to bypass an unexpected mismatch. The validator retains archive size/time/expansion limits, raw tar metadata limits, duplicate/path/link rejection, exact inventories, and identity/checksum checks. Both static and API files are covered by the same receipt.

Run the controller's existing local tests after installation and restart the paused dispatcher so its next process loads the new validator; then restore the original dispatch flags. If the initial merged-main build was collected before this upgrade, its collection will have failed closed. Rerun **Source checks** for that exact main commit after installation, then require `last-spire-artifacts status` to report `collection: stored` with a verified immutable receipt. Never substitute an unchecked local archive. Portfolio configuration is unchanged.

If installation is interrupted, inspect the root-owned baseline copy and module before retrying under the same lock. Do not delete receipts, weaken the gate, or overwrite an existing artifact to force collection.

## Private production Google onboarding

Use the separate **production** Web client restricted to the public HTTPS game origin. Never copy the local development secret to the VPS or put a value in a command, environment file in Git, workflow secret, Docker environment value, screenshot, or chat.

Run in an interactive SSH terminal:

```sh
sudo last-spire-onboard-accounts
```

Enter the exact production origin and public client ID, then enter the secret at the hidden prompt. Input without a secure terminal is refused. If Google shows only a masked secret, create an additional secret for that production client while leaving the previous one enabled until the new configuration has passed a real sign-in test. Do not delete or reset the client. The helper requires explicit confirmation before replacing an existing production configuration and does not start or restart a service.

The secret is an app-owned mode-600 file beneath a root-only directory, mounted read-only into the API. Its value is never placed in Docker arguments or environment values. CI workers receive neither this file nor the database, deletion journal, Docker socket, or deployment credential.

## Deliberate deployment

Wait for successful exact-main checks **and** the host receipt. Then:

```sh
sudo last-spire-account-deploy <full-main-commit-sha>
sudo last-spire-account-status
sudo last-spire-deploy <full-main-commit-sha>
```

The API command checks the artifact and database/runtime compatibility, installs immutable code, validates a candidate using disposable data and a fake secret, and takes a private backup before replacing an existing API. It refuses insufficient memory headroom or a busy shared scheduler. A failed candidate leaves production running; failed live health recovers the prior runtime. Durable pending state permits recovery after an interrupted switch. An interrupted switch requiring manual intervention retains its pending record and prior container; inspect those privately, without deleting them to bypass recovery.

The API has a read-only root filesystem, dedicated UID/GID and bridge network, no capabilities or privilege escalation, loopback-only host port 8092, a 384 MiB memory limit, 0.5 CPU, 96 PIDs, and a bounded temporary filesystem. The browser never connects directly to this port. Candidate/recovery processes are temporary; recovery helpers have no network and receive no Google secret. These limits are an initial operational budget, not a concurrency or mobile-performance certification.

## Public routing and Google policy

Merge only the game's handlers from `hosting/Caddyfile.accounts.example` into the existing Caddy configuration. Never replace a shared configuration with that example. Back up the real configuration privately, validate the complete candidate, and reload Caddy deliberately only after the API and static release are healthy.

The example routes `/api` and `/api/*` to loopback 8092 and keeps static traffic on 8091. It caps API request bodies and overwrites forwarded-client addresses. The API trusts only its explicitly configured Docker gateway and loopback peers. Google’s supported script/frame/connection/style origins are allowed on static responses, with `same-origin-allow-popups` for the code popup. API responses retain their restrictive JSON policy. Do not enable request-body, cookie, CSRF, or authorization logging. Existing unrelated sites and DNS records stay unchanged.

Review Google consent branding, the public `/privacy.html` URL, support contact, and audience/publishing status. Keep owner testing limited until production end-to-end verification succeeds. Only basic identity scopes are used; additional Google API scopes are outside this release.

Verify HTTPS, `/release.json`, and `/api/healthz` match the intended commit; the API must report protocol/database 1 and Node runtime 22. Verify private/backend files are not served, security headers, session cookies, rejected foreign-Origin/CSRF requests, and actual Google sign-in. Use synthetic progress to test opt-in adoption, save/resume, device conflicts, sign-out, deletion, and a recovery drill. Never replace an actual player's save for QA without specific permission. Guest saves are not transferred from localhost automatically: export locally, retain the backup, and explicitly import or adopt it on the public origin.

## Backup, recovery, and rollback

```sh
sudo last-spire-account-backup
sudo last-spire-account-prepare-restore <snapshot-basename.sqlite>
```

Preparation verifies the snapshot/checksum and canonical deletion journal, writes a new private directory, reapplies deletions, revokes sessions and device leases, and changes the database generation. It neither overwrites current data nor activates the recovered directory. Keep the original directory. After privately checking the prepared recovery, an administrator can deliberately change `dataDir` in the root-owned account configuration to the reported directory and run the checked API deploy command. The configuration accepts only the managed data/recovery locations. Retain the stable deletion directory unchanged. Clients must sign in again and review their local/cloud branches after restoration.

```sh
sudo last-spire-account-rollback
sudo last-spire-rollback
```

API rollback uses a retained compatible code release with the **current** credentials, data directory and deletion journal. It never silently restores an older database. The first API release has no earlier API rollback target. Future protocol/database migrations need another reviewed host-contract change. Frontend rollback can return to a static-only release while retaining account data privately.

Automatic daily/startup backups retain at most seven same-VPS snapshots. They cannot protect against total VPS or disk loss. Preserve private permissions and free-space reserves; do not automatically delete another project's data or erase deletion markers to make an operation succeed. Off-site backup remains a future opt-in improvement.

## Arsenal checkpoint compatibility

The arsenal expansion writes save schema 6. Install the matching checked account API before publishing its browser bundle. Local and cloud validators must agree on cards, fusion recipes, archetypes, discovery records and active rules. New expeditions record `arsenalVersion: 2`; resumed expeditions without this field retain their original arsenal and offers. Migration preserves active runs, RNG, credits, unlocks and unsettled rewards, and keeps a write-once original checkpoint per local guest/account scope before the arsenal migration. Cloud revision history retains the original stored checkpoint when the migrated checkpoint is written.

Older clients, including schema-5 encounter clients, cannot overwrite a newer cloud checkpoint; ask players to reload/update after migration. Retain the previous checked API and static artifacts for recovery, and preserve original migration backups. A static rollback is not permission to downgrade a migrated save. This save-schema change does not change the account protocol or database schema, which remain version 1.

## Evolution checkpoint compatibility

Tower evolution writes save schema 7. Install the matching checked account API before publishing its browser bundle; both validators must understand the same evolution paths and state. New expeditions with the expanded arsenal receive evolution state version 1. Migrated active expeditions retain their existing rules and do not gain evolution state. Credits, unlocks, pending rewards, RNG and settlement identity remain intact. Local migration keeps a write-once `backup-before-evolution` checkpoint separately for each guest/account scope, preferred when recovering the latest migration backup. Cloud revision history preserves the original stored checkpoint when the migrated checkpoint is written.

Schema-6 and older clients cannot overwrite a newer cloud checkpoint and must reload/update. Retain the previous checked API/static artifacts and original migration backups for recovery; rolling back the browser does not authorize downgrading schema-7 saves. The account protocol and database schema remain version 1.
