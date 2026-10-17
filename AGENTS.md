# Last Spire working agreements

## Workflow

- Start focused work from current `main` on a short-lived branch. Do not push directly to `main`.
- Open one coherent pull request per change. Stack branches only when the dependency is explicit and justified.
- The user reviews and merges; prefer squash merges. Do not merge, enable auto-merge, publish, or deploy unless explicitly authorized.
- Describe the player-visible problem and resulting behavior in plain language. Include relevant validation, save compatibility, and screenshots for visible changes. Keep private infrastructure details and actual gameplay logs out of public PRs.
- When work is interrupted, keep a concise private checkpoint with the branch, validation, pending work, and service state.

## Architecture and saves

- Extend the current game through feature modules. Do not create another version-numbered source tree for an update.
- Track software releases with Git tags/releases; version save schemas separately. Isolate legacy compatibility when consolidating existing code.
- Preserve resumable runs, credits, unlocks, clears, RNG state, and unsettled rewards. Settlement must stay idempotent. Test migrations before changing saves.
- Keep simulation deterministic and independent of rendering. Cosmetic settings must not alter damage, timing, RNG, or entity limits.
- Maintain Last Spire's original arcane machinery identity. References inform usability, not copied layouts or artwork.

## Validation and resources

- Use targeted tests while iterating. Before a release, run the public-content guard, automated tests, and production build. Balance changes also need seeded evidence and clearly identified human playtesting.
- Report measured results and coverage honestly. Viewport emulation does not establish physical-mobile performance.
- Keep only one local preview running by default. Reuse it; do not start unrelated containers, duplicate servers, or expensive background simulations without a reason.
- Respect shared VPS limits. Serialize builds across repositories. Never give build workers host mounts, production credentials, or the Docker socket.
- Public fork code must not automatically run on the VPS. A reviewed manual build is distinct from permission to deploy.

## Releases

- Merging and publishing are separate. Production accepts a checked artifact from merged `main`, identified by its full commit SHA and verified checksum.
- The trusted host collects artifacts only after the exact GitHub run attempt succeeds. CI workers never receive a writable host artifact directory. A green workflow alone does not prove collection succeeded; require the immutable host receipt before deployment.
- Use the restricted SSH deployment/rollback commands documented in `docs/RELEASING.md`. Preserve unrelated services and retain a known-good release.
- Never put tokens, SSH credentials, private inventories, or user saves in Git, PRs, logs, artifacts, or chat. Enter credentials only through hidden administrative onboarding.
- Browser saves belong to their origin. Explain export/import when moving between localhost and the public domain; do not imply cloud synchronization.
