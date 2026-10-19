# Expanded arsenal

New expeditions offer 136 distinct card families, 40 passive synergies and 20 mastered fusion recipes. This expansion adds eight competing recipes and twelve support families. Rarity variants and repeated investments do not count as additional families.

Fusion remains free: both equipped ingredients require mastery six, compatible investments carry forward, and the result frees one socket. Fused cores cannot fuse again. The automatic offer, persistent Forge button and ingredient hints include the new alternatives. The codex searches recipes by name, mechanic and ingredient.

| Ingredients         | Fusion             | Additional interaction                                           |
| ------------------- | ------------------ | ---------------------------------------------------------------- |
| Flame + Singularity | Pyroclasm Engine   | Moving gravity wells leave short burning fields.                 |
| Pulse + Tesla       | Tempest Bell       | Pulses create up to three bounded electrical bridges.            |
| Rail + Mirror       | Reprisal Reliquary | Reflected pressure charges the next rail volley, up to +60%.     |
| Meteor + Gravitic   | Impact Sepulcher   | Warned impacts leave burning scars and delayed implosion fields. |
| Drone + Mending     | Sanctuary Carriers | Actual recovery fuels shared carrier discharges.                 |
| Ricochet + Frost    | Hoarfrost Foundry  | Rebounds shatter and leave short frost tracks.                   |
| Mirror + Gravitic   | Parallax Bastion   | Reflection redirects to two nearby threats with resisted pull.   |
| Echo + Frost        | Rime Choir         | Frost retaliation schedules one delayed, nonrecursive refrain.   |

Each fusion has original SVG geometry, a machinery crest and recognizable projectile, field or retaliation effects. The bundled contact sheet reviews the actual symbols at 24, 40 and 64 pixels. Regenerate both copies with `node --import tsx scripts/icon-contact-sheet.ts`.

| Support family       | Interaction                                                                  |
| -------------------- | ---------------------------------------------------------------------------- |
| Accretion Shell      | Traveling primary projectiles grow in collision radius, without free damage. |
| Rebound Dynamo       | Successful bounces charge later hits, with a per-projectile ceiling.         |
| Homeward Resonator   | Returning projectiles emit pulses with a shared core cooldown.               |
| Sundering Fuse       | Natural expiry releases three fragments sharing one damage budget.           |
| Siegebreaker Etching | Sustained primary hits temporarily erode armor for all damage sources.       |
| Concordance Relay    | Alternating equipped cores earn a bounded coordination bonus.                |
| Aegis Reservoir      | Absorbed shield damage powers one primary or root defensive strike.          |
| Living Rampart       | Effective healing creates shield; overhealing cannot feed it.                |
| Flawless Facets      | Root reflections can critically strike, sharing one roll across infusions.   |
| Briar Inscription    | Thorn retaliation refreshes a capped wound instead of stacking indefinitely. |
| Leyline Intersection | Different active elemental fields amplify overlapping ticks.                 |
| Unbinding Seal       | Expiring control causes a discharge that applies no additional control.      |

These use existing promotion thresholds, rarity floors, investment limits and targeting conventions. Descriptions and upgrade previews state effective values, ceilings and internal cooldowns. Projectile count, range and lifetime remain the existing families rather than duplicates. Secondary fragments, pulses, wounds and echoes cannot restart their own trigger chains. A field tick receives a fresh attack identity; targets and infusions share its charge budget.

## Saves and release order

Save schema **6** adds the optional `arsenalVersion: 2` run flag. New expeditions set it; recovered expeditions do not acquire it during migration. Flagless runs keep their original offer pool, fusion availability, combat behavior and RNG continuation until settlement. Local and cloud validation reject expanded equipment or offers without the flag.

Migration retains scoped, write-once backups of older guest and account checkpoints. Credits, unlocks, stage clears, discoveries, queued choices and unsettled rewards are preserved. The account service uses the same validator and retains downgrade protection: older clients cannot overwrite an unsupported newer checkpoint. Deploy the checked matching API before the browser artifact. Browser-only rollback cannot downgrade a schema-six checkpoint; use a compatible client and preserve the migrated data.

## Reproducible validation

Tested with Node 22.23.3 on Linux. Run batches serially; reports are synthetic and should remain outside Git:

```sh
npm test
npm run build
npm run check:public
npm run check:dependencies
npm run check:secrets
npm run balance -- --tower=all --stage=0,1,2 --mode=normal --policy=competent,random --evolution=off --seeds=1 --seed-start=71 --seconds=5400 --output=/tmp/arsenal-normal.json
npm run balance -- --tower=bastion,monolith --stage=0,1,2 --mode=quick --policy=competent,random --evolution=off --seeds=1 --seed-start=71 --seconds=2700 --output=/tmp/arsenal-quick.json
node --import tsx scripts/arsenal-stress.ts --evolution=off --output=/tmp/arsenal-stress.json
```

The 976-test suite includes all twelve new support mechanics and eight fusion attacks, infusion budget sharing, charge consumption, control-expiration deaths, projectile age, recursion/cooldown limits, previews, original icon coverage, save/resume, scoped migration backups, cloud downgrade protection and idempotent settlement. Seeded compatibility fixtures preserve recovered rules.

The current audit exercises shipped combat, actual XP offers, shop purchases, skills, mastery, fusion, save validation and settlement. It supersedes the old default balance harness. Historical harnesses remain explicitly named `balance:runeforged` and `balance:legacy`. These historical arsenal-only samples disable evolution; the current evolution baseline is documented in EVOLUTION.md.

| Sample                                                    | Build-focused policy | Random policy | Mean successful build-focused combat |
| --------------------------------------------------------- | -------------------- | ------------- | ------------------------------------ |
| Normal: seven towers × three stages, one seed each        | 14/21 clears (66.7%) | 2/21 (9.5%)   | 41.9 minutes                         |
| Quick: Bastion and Monolith × three stages, one seed each | 3/6 clears (50%)     | 0/6           | 19.6 minutes                         |

No cases timed out. Normal build-focused runs bought 1.42 offers per visited shop; Quick bought 1.43. Normal build-focused clears by stage were **7/7 Wilds, 6/7 Foundry, 1/7 Ruins**. Four successful runs exceeded 45 minutes (45.6–48.2 minutes). Most completed builds had two or three fusions, but this policy naturally selected only one of the eight alternative recipes; mechanical and synthetic UI checks cover the others. These small, single-seed strata do not establish player win rates or demonstrate equal viability of every recipe. Ruins difficulty and longer defensive clears remain tuning concerns for the evolution milestone and broader human feedback.

The bounded stress scene uses a synthetic maximized build, 96 high-health enemies at wave 161, four expanded fusions and two defensive cores. It completes 1,800 fixed ticks / 60 simulated seconds, checks the 4,096-projectile ceiling, validates its checkpoint and resumes identically. The measured sample peaked at 565 projectiles, 583 areas and approximately 0.99 MB per checkpoint, averaging about 1.2 ms per simulation tick. This is a short simulation soak, not indefinite Endless certification or normal build acquisition evidence.

## Browser coverage and limitations

In-app Chromium checks used isolated guest progress: all eight alternative fusions across three live combat scenes, healing-linked discharge, expanded card details, fusion search, refresh/resume, defeat/settlement/return, reduced-motion and battery-friendly settings. Original symbols and rarity frames were visually reviewed. Layouts checked at 1280×720, 1920×1200 and 390×844; narrow panels scroll rather than shrink their text. Synthetic screenshots are shared separately, outside Git. Existing player saves were not replaced.

On the available Intel Core i7-13620H Linux desktop, a live 1920×1200 defensive-fusion scene at reduced effects reported 60 FPS, 1.43 ms average draw cost and 0.29 ms simulation cost per frame. This is an observed recent UI sample, not sustained maximum-load certification. Demanding foreground GPU benchmarks, physical mobile/touch performance, Firefox, Safari, longer Endless soaks and complete human campaigns remain unverified. Cosmetic controls do not change the simulation.
