# Gameplay observations and improvement

Last Spire records bounded local diagnostics in a separate browser IndexedDB database.
These logs are not a central analytics service, are not included in cloud checkpoints,
and are never automatically uploaded. Google sign-in and publishing a score do not
share these logs. Settings → Local gameplay data offers disable, export, and delete
controls. Deleting logs does not delete progress. Keep actual exports private.

## What existing observations can answer

- Offers versus selected cards: which choices players skip, subject to rarity,
  prerequisites, replacement, and affordability. Event caps can remove early offers;
  account for dropped-event counts rather than treating absent offers as rejections.
- Damage and defensive counters over simulation time: damage contribution and
  survival patterns for offensive, defensive, and mixed builds. Cumulative differences
  are observations, not causal proof that a single card caused the outcome.
- Equipment, investment, and mastery: whether useful pairs become available early
  enough, and which fusions are actually completed.
- Shop prices, spending, and repairs: whether saving and purchasing remain meaningful.
- Outcomes: wave reached and success by tower, stage, difficulty, mode, and rune loadout.
  A successful campaign clear is distinct from later Endless defeat or retirement.

Logs retain at most 30 runs / 30 MB, with 5,000 events and 1,000 samples per run.
Samples are spaced by at least ten simulation seconds; they are not per-hit traces.
They can miss short-lived effects. A run with no final outcome is incomplete, not a
defeat. Resuming a run preserves its original build and records the new client build.

## Additional context in this build

New observations add maximum health, wave time, current entity counts, simulation
rule versions, balance edition, evolution path/tier, and campaign/Endless flags.
Foreground performance samples include simulation and render milliseconds per
callback, frame-interval p95, measured window duration, speed, effects settings,
and catch-up backlog. These are recent-window measurements sampled periodically,
not a whole-run frame distribution. Simulation cost per callback depends on catch-up
work and playback speed; compare them together. Background and warming-up samples
omit FPS/timing values so browser throttling cannot look like a device benchmark.

CI embeds only the public commit SHA as the client build identity. A local build
without CI metadata is labeled `development`; no host inventory or environment
dump enters the client. Existing logs remain readable without migration, but missing
new fields mean unknown, not zero. Detailed identity or account information is not
needed for balance analysis. No API or database migration is required.

Evolution events use a `pathId` content field. Earlier events using the reserved
`path` field could be rejected by the privacy filter; missing historical events
cannot be reconstructed. Snapshot metadata remains separately useful. Filesystem
path fields remain forbidden.

## Next analysis

The [balance analysis tools](BALANCE-ANALYSIS.md) produce private JSON/Markdown
reports from current-engine seeded runs or an explicitly selected local export.
They distinguish unknown/incomplete data from defeats and keep source data local.

Use exported observations alongside the current deterministic policy harness. Compare
like rules, stages, modes, difficulties, and rune bonuses. Report sample size, missing
data, completed versus abandoned sessions, and human versus automated results.
Inspect fusion timing, shop affordability, defensive survival, and late-Endless load
before choosing balance changes. Small voluntary samples identify hypotheses; they
do not establish population-wide clear rates or certify physical-mobile performance.

Possible later instrumentation includes per-wave enemy pressure, effective healing
versus overheal, and eligible-but-deferred fusion/evolution choices. Those require
separately tested combat/event hooks. Any shared analytics service needs a separate
decision about consent, retention, deletion, and operational cost; this change does
not add one.
