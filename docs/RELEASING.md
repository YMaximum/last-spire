# Releasing Last Spire

Merging is not publishing. The maintainer reviews and merges PRs, then deliberately publishes a checked commit through SSH. The game is static: there is no production account service, progress database, or gameplay-log upload.

## Development and review

1. Branch from updated `main`; keep each PR focused. Prefer squash merges. Include player-visible changes, meaningful checks, screenshots for UI work, and save compatibility.
2. Run `npm ci`, `npm run check:public`, `npm run check:dependencies`, `npm test -- --maxWorkers=1 --reporter=dot`, `python3 -m unittest discover -s hosting/tests -v`, `npm run build`, then `npm run check:secrets`. Follow `SECURITY.md`; inspect publication text and artifacts too.
3. Have the user review and merge. Neither agents nor CI automatically merge or deploy.

CI runs trusted pushes to `main` on the `last-spire` runner label. The maintainer can manually dispatch **Source checks** against a reviewed branch in this repository, then approve that exact run and context SHA through the host scheduler's SSH approval command. Do not dispatch main and substitute a different checkout SHA. Manual branch checks do not create a deployable release. Fork PRs have no automatic VPS workflow. Do not approve an untrusted workflow that targets the self-hosted runner. Runner labels are routing, not a security boundary; shared-kernel isolation reduces risk but is not a VM boundary. See [GitHub's secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use).

The trusted host scheduler must serialize all repository workers, hold the host-wide lock for registration/job/cleanup, and avoid registering an idle runner indefinitely. Workers need Node 22, Python 3, GNU tar, Git and the Actions runner runtime. Use one Vitest worker, bounded CPU/memory, disposable rootless containers, no host mounts, no Docker socket, and no deployment credentials. Repository-specific credentials remain in the host controller. If resource headroom is insufficient, queue the build; do not stop unrelated services or remove resource limits.

The **Source checks** job runs the checks above and uploads `last-spire-<full-sha>` only for the exact main commit. It contains a deterministic tar archive, its SHA-256 checksum, file hashes, and a served `release.json`. Artifacts expire after 30 days; rerun the checked main workflow if the artifact expires. No hosted-runner fallback or billing change is automatic.

## One-time trusted host setup

Perform these steps as an administrator from a reviewed checkout. Keep actual host inventories and credentials outside Git.

1. Configure the repository-scoped ephemeral runner and shared scheduler. Create an expiring fine-grained PAT restricted to this repository, with Administration write for JIT registration and Actions read for queue inspection. Enter it through hidden SSH onboarding, never command arguments or chat. Confirm that fork jobs are not dispatched.
2. Pull the official `nginxinc/nginx-unprivileged:stable-alpine` image, review its resolved repository digest, and use that immutable digest below. Ensure loopback port 8091 is free and the container fits shared VPS resources.
3. Install the trusted release commands:

   ```sh
   sudo sh hosting/install-release.sh nginxinc/nginx-unprivileged@sha256:<verified-digest>
   sudo last-spire-onboard-release
   ```

   Onboarding prompts invisibly for a separate expiring fine-grained PAT restricted to Last Spire, with **Contents read** and **Actions read**. It validates access and saves it root-only. This credential never reaches a worker. The installer starts no game. Do not rerun initial installation over an existing runtime without reviewing configuration/image changes.

4. Add the game hostname's A record through its DNS provider, pointing to the verified server address. Change only that hostname's records and verify public resolution. Keep actual provider/account inventories and administrative instructions in the private operations runbook.
5. Add `hosting/Caddyfile.example` to the existing Caddy configuration, validate the full configuration, then reload it. Preserve existing routes. Caddy must reach `127.0.0.1:8091`; the game itself must not expose a public port. Verify certificate issuance after the first release is serving.

Do not reuse a broad administrative SSH key as an Actions deployment credential. These commands are deliberately administrative SSH operations. Any future restricted non-admin account must have sudo access only to the two wrappers, not arbitrary Docker or Python commands.

## Publish a reviewed release

After the merged main workflow succeeds, obtain the full commit SHA from GitHub and run on the host:

```sh
sudo last-spire-deploy <full-40-character-sha>
```

The host independently verifies main ancestry, repository/workflow identity, successful run status, artifact expiry, GitHub's artifact digest, the archive checksum, the manifest, and every file hash. It rejects traversal paths, links, special files, unexpected files, oversized archives and QA entrypoints. No repository-provided deployment code executes from the artifact.

The release is installed under a commit-named directory. An isolated candidate nginx container checks health, identity, entrypoint, assets and security headers before the `current` symlink changes atomically. The serving container uses a read-only bind, user 101, no capabilities, no new privileges, 128 MiB RAM, 0.25 CPU, 64 PIDs, and a 16 MiB temporary filesystem. Its only published port is loopback 8091. Failed candidate validation leaves the existing release serving; a failed post-switch health check restores the previous pointer. The previous release is retained. Do not manually alter installed release files.

Verify after publishing:

- HTTPS at `https://last-spire.nyassar.com/`, HTTP redirection, `/healthz`, and `/release.json` matching the intended SHA.
- JS/CSS/assets load, QA pages return 404, CSP and nosniff headers remain present, and no unrelated route regressed.
- Start a run; check upgrades, Arsenal/fusion access, settings, save/resume, and settlement/return navigation using a disposable test profile. Do not overwrite a player's save.
- Record container resources and browser coverage. Do not claim physical-mobile FPS from viewport emulation.

The first release may have no previous production release. Subsequent releases support:

```sh
sudo last-spire-rollback
```

Rollback validates the retained release before switching and preserves the release being replaced as the next rollback target. It does not rewrite browser storage. A successful rollback is not proof that future incompatible save schemas can be downgraded: each gameplay PR must document its compatibility.

## Moving a local save

In the local game, open Settings and export your save. On the public hostname, open Settings and import that file. Keep the export as a backup. Localhost and the public domain have separate browser storage; changing ports or browser profiles also changes the storage boundary. No migration happens automatically and no save is uploaded to the server.

## Bootstrap and recovery

The first infrastructure PR can be checked locally before the self-hosted workflow exists on `main`. After the user merges it, finish hidden credential onboarding, run the main checks, and publish that checked SHA. A workflow that has not started because of missing registration or credentials has not passed validation.

If DNS, credentials, resources, certificate issuance, artifact validation or health checks fail, report the exact blocked step without printing tokens, signed download URLs, or private inventories. Keep the current release and unrelated services running. Save a private checkpoint; never substitute an unchecked local build for the required release artifact.
