# Endless ledger

Open **Endless rankings** from expedition setup or the main menu. After an Endless defeat or voluntary retirement, **Review Endless score** opens the result preview. Guests can browse and keep personal records. Publishing requires an active Google-backed account checkpoint and a separate public username.

## Publication and privacy

Usernames use 3–20 ASCII letters, digits, or underscores. Uniqueness is case-insensitive and system names are reserved. Google display names and emails are never automatically used. Changing the username also changes the name shown on existing entries.

Every result requires a preview, **Publish score…**, and final **Publish this score** confirmation. The preview lists all public information: username, score, cleared waves, checkpoint time, tower, evolution path, and summarized equipped runes and fusions. The final request asserts the previewed username; if it changed elsewhere, refresh and review again. Syncing, settling rewards, reading rankings, and changing a username never publish a score.

Credits and return navigation do not wait for publication. Completed candidates remain accessible in **My results & username** after returning to expedition setup or reloading. Sync completed results if necessary, then review and explicitly retry. The server retains up to 500 recent retry receipts plus receipts backing currently published entries; the profile response is capped at 500 and prioritizes published entries. Players can withdraw an entry without automatically publishing a replacement. Account deletion removes the username, results, and entries through the existing deletion-journal process. Recovery copies can retain deleted data for up to seven days; recovery reapplies deletion intents before serving.

## Score and boards

Score is **100 × fully cleared waves**. Rank sorts waves descending, then simulation seconds to the last clear ascending. Exact wave/time ties share a rank; username only stabilizes their display order. Partial waves, kills, summons, pause duration, and playback speed add no points. Time comes from fixed simulation ticks, not a wall clock or submission time.

Boards are separate by stage, Normal–Ascension 5 difficulty, balance edition, and pace. Direct Endless and Normal-to-Endless share **Standard**. Quick-to-Endless uses **Quick**. Each account has one best result per board. A weaker result cannot replace it. Reads return the top 100 plus the signed-in player's own rank, including ranks outside the top 100. Refresh is manual, with bounded and rate-limited requests.

The initial balance edition is `spire-e1`. Change the edition for material scoring or combat balance changes; retain older editions separately. Only newly started, current-rule expeditions track eligible results. Existing active runs retain their original rules. Manually imported files retain personal history but disable public eligibility and remove imported publication candidates. Cloud continuation of an eligible account checkpoint preserves eligibility.

These are **Casual · client-reported** rankings, with no prizes or replay verification. Account ownership and strict storage validation prevent publishing another account's result; they cannot establish that a client played honestly. This feature must not be presented as a cheat-proof competition.

## API and storage

- `GET /api/leaderboard?stage=0&difficulty=0&balanceEdition=spire-e1&division=standard` is session-free for guests. A matching expected-account header enables the private own-rank selection. Public rows never contain account IDs, run IDs, Google identifiers, email, full saves, or gameplay logs.
- `GET /api/leaderboard/profile` returns the account's username, bounded retained results, and publication flags.
- `PUT /api/leaderboard/profile` accepts only `{ username }`.
- `POST /api/leaderboard/publish` accepts only `{ runId, confirmation: 'PUBLISH', expectedUsername }`. It derives score from the matching account-owned completed cloud checkpoint or its retained receipt. It never accepts arbitrary score or caller-selected account identity.
- `DELETE /api/leaderboard/entry` accepts only `{ runId }` and withdraws only that account's currently published result. Retries are idempotent.

Private operations retain the existing session, expected-account, Origin, and CSRF protections. Receipt retention happens transactionally with cloud writes; publication is a separate transaction. SQLite database schema 2 adds indexed username, receipt, and entry tables with account-deletion cascades. Save schema 8 adds simulation tracking and bounded completed candidates. Local and cloud validators share the same parser; older clients cannot overwrite schema-8 checkpoints.

## Release and recovery

Deploy the reviewed matching account API **before** the browser build. It migrates database schema 1 to 2 transactionally. Preserve the deployment backup and deletion journal. Old account services reject database schema 2: do not point an old API at the migrated database. Database rollback requires a separately reviewed recovery procedure and may discard newer writes; prefer a forward fix. Never restore a backup casually to undo a UI release. Static-only rollback is separate, and older clients cannot write newer checkpoints.

No production deployment, DNS change, new credential, or account sign-in is implied by merging this feature.
