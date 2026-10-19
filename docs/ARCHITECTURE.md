# Source architecture

The browser entrypoint is `src/ui/app.ts`. Features extend the current modules;
new releases do not get their own source directory. Save and run-rule versions
remain explicit persisted contracts, independent of the directory layout.

| Area                     | Responsibility                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `src/game/`              | Current fixed-tick simulation, run types, runes, autocast and combat feedback      |
| `src/content/`           | World definitions, base card catalog and current equipment/fusions                 |
| `src/model/`             | Shared content, combat and serialized save models                                  |
| `src/render/`            | Cached pixel-art arena, current battle rendering, damage labels and frame sampling |
| `src/ui/`                | Application shell, movable windows, build inspector, icons and styles              |
| `src/persistence/`       | Current save validation, migration, storage and reward settlement                  |
| `src/account/`           | Optional sign-in, scoped device cache and cloud synchronization                    |
| `src/telemetry/`         | Opt-in browser-local gameplay observations                                         |
| `src/legacy/classic/`    | Original run simulation, validator and retained original interface                 |
| `src/legacy/runeforged/` | Pre-XP run simulation, validator and rendering compatibility                       |
| `server/`                | Account API, private SQLite storage, backups and deletion recovery                 |

## Compatibility boundaries

The current simulation delegates recovered pre-XP runs to the runeforged engine.
The application dispatches original runs to the classic engine. The current save
validator reads all supported generations and preserves their rules until settlement.
The base catalog, models and pixel-art renderer are shared foundations, not copies
of a separate application for every release.

Do not change serialized identifiers, RNG order, combat numbers, save keys or
settlement behavior as part of moving modules. Change simulation rules and save
formats deliberately in a separate reviewed feature change. Account snapshots
use the same validator as browser saves, so compatibility work includes the API.

`tests/module-compatibility.test.ts` compares five synthetic seeded checkpoint and
resume hashes against merged main before the module moves. It covers classic,
pre-XP and current rules, all three run modes, multiple stages and a lifetime shot
counter above 1,000. Keep legacy regression suites when extending current rules.
Current-rule hashes can change with intentional gameplay changes; legacy hashes
must stay stable while those saved rules remain supported.

## Development tools

Tests named `v2-*` and `v3-*` refer to persisted rules and compatibility contracts;
they do not imply parallel application trees. `scripts/audit-v3.ts` exercises the
current XP/mastery engine. The older `scripts/balance.ts` and
`scripts/balance-v2.ts` remain legacy policy tools; their results are not evidence
for current gameplay balance. Run audits in small, serialized batches.

Only `index.html` selects the shipped browser application. QA pages and synthetic
checkpoints remain development-only and must not replace a player's save.

## Expedition controls and document lifetime

`src/game/clock.ts` owns bounded fixed-tick catch-up. `src/ui/page-loop.ts` owns one
scheduled callback at a time: animation frames while visible, a timer while hidden.
Visibility changes preserve elapsed open-document time; page exit clears the clock.
No persisted wall timestamp or VPS-side combat simulation is used. Pause/decision
boundaries discard time after the pause, and controls wait while catch-up is pending.

Fusion-offer acknowledgements and the safe-wave marker use bounded, namespaced
numeric entries in existing run counters. The unchanged browser and cloud validators
retain those entries. They do not affect combat, reward generation or RNG. Existing
rewards take priority; minimization or closing a reward window does not bypass the
default pending-decision pause. Presentation settings remain device-local.

## Stage progression and shop compatibility

Save schema 4 adds `progression.stages`: independent access, exact difficulty clears,
and a legacy-clear marker for each stable stage ID. Schema 1–3 checkpoints migrate
without changing active combat/RNG. Access is grandfathered only onto previously
opened stages. Immediate clear handling and transactional settlement share
`src/game/stage-progress.ts`; duplicate settlement cannot advance another stage.

Before a browser checkpoint is migrated, its original is backed up once per guest
or account context in the same IndexedDB transaction. The Settings migration-backup
export supports both contexts. Cloud reads validate/migrate the same format; the
first subsequent write retains the old payload in existing revision history.
An older wire schema cannot overwrite a newer stored cloud checkpoint. Future
unknown schemas fail closed and request an updated client.

New runs carry `shopVersion: 2`, separate from combat rules. Absent markers retain
the original one-option repair; modern shop healing offers share the existing one
repair stock. `src/game/shop-healing.ts` owns prices and quotes. Purchases validate
health, stock, phase, option and funds before mutation, do not activate combat
healing procs, and contribute scrap/healing metrics. Live UI updates preserve
button nodes and keyboard/hover state.

This format requires the matching account API before a new frontend syncs cloud
saves. Older clients cannot read newer schemas; after migration, reload/update the client
instead of attempting a downgrade. Production publication remains a separate step.

## Stage encounters and bestiary

Save schema 5 adds `progression.bestiary`, with bounded encounter and defeat totals. New runs carry `encounterVersion: 2`, per-run discoveries and stable enemy archetype IDs. Absence of that flag preserves the shipped encounter rules through settlement. `src/content/enemies.ts` owns tactical descriptions, stage rosters and new encounter tuning; `src/game/encounters.ts` owns bounded casts, phases, recovery and barriers. Absolute simulation-time counters persist warnings and delayed echoes through resume. Rendering reads these counters without changing combat or RNG.

Run discoveries are added to permanent records only by idempotent settlement. Browser migration stores a write-once original checkpoint separately for each guest/account scope. Local and cloud checkpoints use the same validator. Older wire formats cannot overwrite a newer stored checkpoint; future formats fail closed. The movable bestiary shows tactical information before discovery, and uses only local counts.

## Expanded arsenal

`src/content/arsenal-expansion.ts` defines the twelve support families, eight alternative fusion recipes and effective preview text. `src/game/arsenal.ts` owns their deterministic hooks through a small engine callback interface. It does not import rendering, storage or the application shell. The existing engine dispatches those hooks only for new `arsenalVersion: 2` expeditions. Recovered-run seeded contracts retain their original behavior. Save schema six, browser migrations and the shared cloud validator preserve that boundary. See [ARSENAL.md](ARSENAL.md) for the content, balance sample and coverage limits.

## Tower evolution

`src/content/evolutions.ts` defines fourteen paths and forty-two incremental tiers. `src/model/evolution.ts` is their typed persistence contract. `src/game/evolution.ts` owns deterministic decisions, lineage lookup and bounded combat hooks, using engine callbacks without importing rendering or storage. `src/ui/evolution-panel.ts` and its stylesheet own path previews; the normal movable-window manager handles their lifetime. The simulation freezes on saved pending evolution independently of window visibility. An original core ID survives fusion through existing ingredient provenance, without another equipment schema or source tree. Schema seven and the shared account validator preserve recovered runs without grafting new combat onto them. See [EVOLUTION.md](EVOLUTION.md) for the measured baseline and publication order.
