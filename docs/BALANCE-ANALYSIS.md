# Balance analysis

This tooling measures the shipped simulation and explicitly selected local exports.
It does not tune combat, change saves, upload logs, or access a browser profile.
All analysis outputs and findings, including synthetic results and aggregate summaries,
stay in ignored `.private/`. Do not commit them or include them in public PRs.
Public documentation covers tools and methods only. Use Node 22 and serialize batches.

## Synthetic runs

`npm run balance` defaults to two Bastion/Wilds/Normal cases: one build-focused
heuristic and one random-card policy. Every case uses the current engine, real XP,
offers, mastery, shops, repairs, fusions, evolution, and save validation. All permanent
bonuses and runes are absent. Combat/content sources must be committed before an
audit; reports identify that commit and hash the analysis-tool sources separately.

```sh
npm run balance -- --tower=bastion --stage=0 --mode=normal --policy=competent,random --seeds=1 --seconds=5400
npm run balance -- --tower=all --stage=0,1,2 --mode=normal --policy=competent,random --seeds=1 --case-wall-seconds=30 --batch-wall-seconds=300 --output=.private/reports/normal-matrix.json
npm run balance -- --tower=bastion --stage=0 --mode=endless --policy=competent --seconds=7200 --stop-wave=160 --output=.private/reports/endless-pilot.json
```

Use `--seed-start`, `--seeds`, `--difficulty`, and `--evolution=first|second|alternating|random|off`
to define comparisons. Seed index is converted to a 32-bit engine seed; both are
recorded. Tower, stage, mode, and policy labels are validated. Limits are 128 cases,
120 wall seconds per case, 900 per batch, and six simulation hours per case.
Budgets are checked periodically, so a small scheduling overshoot is possible.

Reports checkpoint atomically after each case. Simulation-time, cleared-wave,
and wall-clock caps are **censored observations**, not defeats or wins. Cases not
started are listed separately. A cap with no completed case still writes a report.
Terminal clear fractions and approximate 95% Wilson intervals are grouped by
tower, stage, difficulty, mode, and policy. Unknown averages remain null. The
minimum-sample check is a diagnostic gate, not proof that a policy represents humans.

Per-case details include wave health/damage and duration, final damage attribution,
card offers/picks, price affordability on shop entry, purchases per resolved shop,
repair costs/healing, first observed mastery/eligibility, actual fusion timing,
evolution tiers, entity peaks, and serialized save size. Price affordability does
not imply all offers can be bought together or that every replacement is desirable.
Mastery/evolution observations have up to one simulation second of sampling delay.
Fusion previews remain governed by the same combat eligibility functions.

Step timings sample one engine tick per simulation second and retain at most the
latest 1,200 samples. Their p95 measures headless tick cost, not render time, FPS,
browser catch-up, or certified hardware performance. Cosmetic settings are absent.

### Policy limitations

`competent` is the retained `selection-v1` **build-focused heuristic**, not a
certified competent player. It prioritizes weighted survival/support cards and
selected fusion pairs, tries available fusions, attempts the default 25% repair
below 65% health, and buys
usable shop offers while scrap permits. `fusion` currently shares these selection
rules. `defense` penalizes offensive-core acquisition. `random` shuffles offers,
chooses random targets, buys at most one shop card, and does not strategically
repair or fuse. Both policies attempt signature skills and conditionally use Mend.
Neither rerolls nor models human reaction, positioning, decision time, or skill.
They resolve choices immediately; simulation time excludes those pauses.

The asymmetries are deliberate characteristics of this existing baseline, not a
fair randomized trial of human skill. Compare policies before changing their
rules, give a changed policy a new edition, and do not infer card causality from
the current weights.

## Existing local gameplay exports

In the game, open Settings → Local gameplay data → Export local logs. Select that
file explicitly; no tool reads IndexedDB or cloud saves behind the scenes.

```sh
npm run analyze:logs -- --input=LOCAL_EXPORT.json --output=.private/reports/local-analysis.json
```

The offline analyzer accepts version-one Last Spire exports up to 64 MB. It rejects
future/unavailable formats, bounds collection sizes, refuses reports outside the
private folder or through symlinks, and cannot overwrite its input export.
JSON and Markdown reports aggregate known content IDs rather than copying run IDs,
names, emails, timestamps, filesystem paths, or raw events. Build identifiers are
restricted to commit hashes, numeric release versions, and known local labels.
This is a Last Spire export analyzer, not a universal secret-redaction service.

Groups separate build/resume cohorts, rule versions, balance editions, known
evolution paths, towers, stages, difficulties, original modes, Endless continuations,
and rune loadouts. Missing
metadata stays unknown. Completed records need a terminal outcome; unfinished
records are not defeats. A failed/retired Endless run may still have cleared its
campaign checkpoint. Unknown termination reasons are not labeled as combat deaths.
Unknown-metadata groups can mix incompatible historical rules; do not treat them
as controlled cohorts or use them to certify balance targets.

Repeated offer/choice events after reload are deduplicated. Truncated logs expose
dropped counts and unmatched selections rather than inventing pick rates. Damage
uses the latest cumulative snapshot once per run; removed-core attribution can be
unknown. Performance averages apply to sampled foreground windows only. The worst
sampled frame p95 is not a whole-run p95; background and legacy-context timings are
excluded. Sampling/export retention introduces selection bias.

Analyze player exports only when explicitly provided for that purpose. Optional
shared analytics, additional per-enemy pressure hooks, and browser performance
profiling remain separate work. See [gameplay diagnostics](GAMEPLAY-DIAGNOSTICS.md).
