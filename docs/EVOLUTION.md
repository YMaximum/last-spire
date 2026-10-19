# Tower evolution

Every new expedition has two evolution paths for its tower. Evolution is free after clearing waves **25 / 50 / 75** in Normal and direct Endless, or **12 / 25 / 37** in Quick. At the first milestone, preview the three tiers and choose one path for that expedition. Later milestones advance that same path. Bonuses are cumulative.

| Tower    | First path                                                      | Second path                                                        |
| -------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| Bastion  | Citadel: shield storage and empowered fire                      | Vanguard: solar marking and focused attacks                        |
| Pyre     | Furnace: persistent burning territory                           | Crownflare: heat storage and charged bursts                        |
| Tempest  | Stormweaver: bounded lightning networks                         | Thunderhead: counted strikes and boss pressure                     |
| Glacier  | Winterhold: barriers and frost retaliation                      | Shatterspire: chilled-target damage and control-release shattering |
| Verdant  | Rootwarden: effective recovery and brambles                     | Blightbloom: poison fields and non-chaining death blooms           |
| Null     | Event Horizon: containment and close-range collapse             | Rift Engine: piercing power with reduced mitigation                |
| Monolith | Mirror Regent: reflection networks and counted critical returns | Ironbriar: absorption-powered barb retaliation                     |

Tier one transforms the starting core and introduces the path's interaction. Tier two develops the signature, using the same manual/autocast pipeline and cooldown. Tier three completes the interaction. Each tier changes visible machinery: the core housing, signature apparatus, then the completed crown. Reduced motion retains the body geometry. The fourteen original SVG marks are included in the bundled contact sheet at 24, 40 and 64 pixels.

The Evolution button and touch menu open a movable reference window during combat. At a milestone, queued upgrades and shops resolve first, evolution follows, then eligible fusion offers. The milestone pauses simulation even if ordinary shops are set to continue combat. Closing or minimizing the decision banks it; the highlighted button reopens it. Reload restores the pending decision. Only one evolution decision window is presented at a time.

## Starting-core lineage

Evolution remembers the original core's stable ID. Fusion already retains ingredient provenance, so its descendant carries that lineage forward. Only the original component receives core stat bonuses; the other ingredient does not gain a duplicate copy. Bounded path interactions can follow the descendant, sharing their cooldown and infusion budget. Mirror evolution reacts to root Mirror strikes, excluding a fused partner's unrelated defensive strikes and secondary echoes.

Replacement previews identify core-specific benefits that will become dormant. Tower-wide defenses and evolved signatures remain active. Acquiring the original core restores its lineage when no evolved descendant remains. A spare copy cannot duplicate a still-equipped descendant's benefits. Saved lineages must originate from the tower's actual starting core, and cannot identify multiple equipped descendants.

## Combat limits

Descriptions and tier previews state each stat increment, trigger cap and internal cooldown. Secondary chains, barbs, death blooms and signature discharges use bounded proc damage and cannot restart their own primary triggers. Actual emission snapshots determine infusion sharing; adding an infusion while a projectile is airborne cannot multiply its eventual field or charge budget. Effective healing excludes overhealing. Reflection and Crownflare charges are consumed once. Counted reflection criticals share one result across infusions without extra RNG. Bosses resist movement and control, and added slowing never removes stronger existing control.

Mirror Regent's extra branch has a shared 1.2-second cooldown. Blightbloom retains the last full lineage-hit budget for a poisoned target's death bloom, so a tiny final poison tick does not erase its intended damage. Dead targets cannot act or receive duplicate kill settlement after a secondary strike finishes them. Cosmetic quality and frame rate do not alter these rules.

## Saves and publication

Save schema **7** stores optional evolution state: rules version, original core ID, chosen path, earned tier and pending tier. Existing active runs migrate without acquiring this state and retain their prior combat, content and RNG behavior through settlement. New expeditions enable it. Local and cloud validators share the same checks for tower/path ownership, milestone order, provenance and supported versions.

Scoped, write-once pre-evolution backups preserve older guest and account checkpoints. Credits, unlocks, discoveries, queued rewards and idempotent settlement remain intact. Older clients cannot overwrite unsupported newer cloud checkpoints. Deploy the checked matching account API before the browser artifact after review and merge. Preserve schema-seven progress if rolling back; a browser-only downgrade cannot read it.

## Reproduction and measured baseline

Use Node 22 and locked dependencies. Run simulations serially and keep raw synthetic reports outside Git:

```sh
npm test
npm run build
npm run check:public
npm run check:dependencies
npm run check:secrets
npm run balance -- --tower=all --stage=0,1,2 --mode=normal --policy=competent,random --seeds=2 --seed-start=71 --seconds=5400 --output=/tmp/evolution-normal.json
npm run balance -- --tower=bastion,monolith --stage=0,1,2 --mode=quick --policy=competent,random --seeds=1 --seed-start=71 --seconds=2700 --output=/tmp/evolution-quick.json
node --import tsx scripts/arsenal-stress.ts --output=/tmp/evolution-stress.json
```

The audit exercises the shipped simulation, XP offers, mastery, purchases, fusion, evolution, skills, validated checkpoints and settlement. Default path assignment alternates by seed for both policies, giving paired coverage of both paths instead of coupling random path choice to subsequent card-choice RNG. `--evolution=first`, `second`, `random` and `off` support focused comparisons; `random` intentionally samples paths rather than pairing them. The historical arsenal-only baseline uses `off`.

| Paired sample                                     | Build-focused choices | Random card choices | Mean successful build-focused combat |
| ------------------------------------------------- | --------------------- | ------------------- | ------------------------------------ |
| Normal: seven towers × three stages × two seeds   | 21/42 clears (50%)    | 3/42 (7.1%)         | 42.2 minutes                         |
| Quick: Bastion/Monolith × three stages × one seed | 4/6 clears (66.7%)    | 1/6 (16.7%)         | 19.0 minutes                         |

No cases timed out. Normal build-focused purchases averaged 1.31 offers per visited shop. Seven successful build-focused runs exceeded 45 minutes, up to 54.4 minutes. Stage-specific build-focused clears were 9/14 Wilds, 9/14 Foundry and 3/14 Ruins. A prior exploratory random-path sample cleared 5/42 (11.9%), above the 10% target; the small Quick random sample also remains above target. These observations show sampling and policy uncertainty, not a measured human win rate or equal viability for every path. Longer defensive runs, Ruins tuning and broader human playtesting remain concerns.

The maximized synthetic stress build includes tier-three Ironbriar, four expanded fusions, two defensive cores and 96 high-health enemies at wave 161. It completed 1,800 ticks / 60 simulated seconds, peaking at 569 projectiles, 583 areas and approximately 1.00 MB per checkpoint. Mean simulation cost was 1.31 ms/tick on the available desktop; validated save/resume remained identical. This is a short bounded soak, not indefinite Endless certification or an organically acquired build.

The **1,107-test** suite covers every tier's cumulative changes, all fourteen developed signatures through autocast, path-specific mechanisms, shared charge/infusion budgets, boss resistance, lineage/fusion/replacement, milestone decisions, save migration/backups, cloud downgrade protection and reward deduplication. Existing seeded recovered-run contracts remain unchanged.

## Browser coverage

Isolated guest checkpoints exercised all fourteen final-tier builds in in-app Chromium with no console errors, a real wave-25 boundary, automatic reference-to-decision transition, free choice/advancement, locked paths, closing/reopening, reload without duplicate advancement, and Quick milestone previews. Desktop and narrow layouts were checked at 1280×720, 1920×1200 and 390×844, including reduced motion and battery-friendly rendering. All fourteen icon silhouettes were visually reviewed. Synthetic screenshots stay outside Git; player saves were not replaced.

A recent live 1920×1200 Ironbriar scene with sixteen enemies reported 60 FPS, 0.32 ms draw and 0.06 ms simulation per frame on an Intel Core i7-13620H Linux desktop. This light scene is not a sustained maximum-load benchmark. Physical mobile/touch performance, other browser engines, prolonged tab freezing, complete human campaigns and long Endless soaks remain unverified.
