# Stage encounters and tactical reference

New expeditions include three exclusive enemies per stage and a final boss at wave 100 (wave 50 in Quick). Shared enemies remain in the pool. Boss encounters replace overlapping elite encounters. Existing expeditions retain their original encounter rules until settlement.

| Stage         | Exclusive encounters                                  | Final boss       | Counterplay                                                                                                          |
| ------------- | ----------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Verdant Wilds | Thorn Retaliator, Spore Shepherd, Gravel Burrower     | The Elder Root   | Use damage over time against thorns, prioritize healers, interrupt burrow warnings, and attack during root recovery. |
| Ember Foundry | Cycling Crawler, Furnace Artillery, Formation Carrier | Forge Colossus   | Time damage against open plates and vents; interrupt artillery and remove shield carriers.                           |
| Void Ruins    | Rift Skirmisher, Concord Caster, Hollow Echo          | The Last Eclipse | Interrupt casts, prepare barriers for delayed echoes, and exploit exposed anchors.                                   |

The Bestiary button (B) and battlefield threat strip open a movable information window without pausing combat. Tactics are available before discovery. Search by name or mechanic, filter stages, and preview scaled health, damage, armor and control strength. Encounter/defeat records accumulate through settlement and optional cloud save synchronization; they are not separate analytics uploads.

New enemy health and damage increase across stages. No enemy has elemental immunity. Shields expire, healing and boss summons have lifetime caps, coordinated pulses have a shared damage cap, and retaliation does not recursively trigger thorns. Stun interrupts pending casts and delayed echoes; bosses retain reduced control strength. The bestiary explains each limit and vulnerability. Essential warnings render independently of cosmetic quality and reduced motion.

## Reproducible baseline

Use Node 22 (tested with 22.23.3), install locked dependencies, then run the current simulation policy audit serially:

```sh
node --import tsx scripts/audit-v3.ts --tower=all --stage=0,1,2 --mode=normal --policy=competent,random --seeds=1 --seed-start=71 --seconds=5400 --output=/tmp/last-spire-encounter-audit.json
```

This exercises current combat, XP choices, shops, skills, mastery, fusion, save validation and settlement. Reports contain synthetic runs; keep raw gameplay reports outside Git. Automated policies approximate player decisions and cannot establish human difficulty by themselves.

The initial finalized sample contained 21 competent-policy and 21 random-policy runs: 12/21 competent clears and 1/21 random clears, with no timeouts. Competent clears by stage were 6/7, 4/7 and 2/7. Mean successful competent duration was 44.6 minutes; ten clears took 35–42.3 minutes, while two Monolith clears took 70.2 and 89.8 minutes. These defensive-build outliers remain a tuning limitation. The single seed per tower/stage is a small baseline, not a population clear-rate estimate or proof that all builds meet the duration target. A smaller Quick sample (Bastion and Monolith, all three stages) cleared 4/6 competent runs and 1/6 random runs, averaging 19.3 minutes for competent clears. The random Quick sample is above the 10% benchmark and too small to infer roster-wide difficulty. Future arsenal/evolution changes require fresh evidence.

Browser checks exercised live combat beneath the bestiary, resize/drag behavior, threat links, stage/search/stat controls, all three synthetic stage scenes, reduced-motion/low-effects warnings, reload and retirement/return navigation. Layouts checked: 1280×720, 1280×800, 1920×1200 and 390×844. Discovery totals and credits remained stable after settlement and reload. Screenshots stay outside Git.

The Normal simulation sample peaked at 29 enemies, 239 projectiles and approximately 222 KB per exported checkpoint; the 96-enemy bound is tested separately. A light in-app Chromium scene measured 60 FPS and 0.47 ms average draw time on the available Linux desktop (Intel Core i7-13620H). This is not a demanding mixed-effects benchmark. Physical-mobile performance, sustained 60/30 FPS under maximum load, other browsers and full human campaign playtesting remain unverified.
