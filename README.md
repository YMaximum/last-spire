# Last Spire — The Runeforged Age

An original single-player browser roguelite about building one ancient arcane machine. TypeScript, Canvas 2D, Vite, and local IndexedDB saves. No account or network service is required.

## Play locally

Use Node.js 22.12+ or 24:

```sh
npm ci
npm run dev
```

Open [the local game](http://localhost:5173/). The Network URL printed by Vite also works on devices on the same LAN when the host firewall permits it.

```sh
npm run build
npm run preview
```

The production output is `dist/`. Serve it over HTTP. All visual assets, icons, fonts, and effects work offline after the files have loaded; there are no external font or asset requests.

## Playing

Your tower fires automatically. Choose targeting, build a loadout, and time two active skills. **Q** uses the signature ability; **E** uses the secondary. **Space** pauses, **1/2/3** change speed, **A** opens the arsenal, **C** opens the codex, and **Esc** closes the top window or pauses. Touch buttons provide the same controls.

All six shared arsenal sockets are available immediately for weapons or defensive cores. New weapon cards fill sockets; duplicates strengthen an existing weapon. Replacement is optional and requires a named target. Global cards remain when replacing a core; its targeted infusions and mastery are released. Infusions combine on a chosen weapon and divide its direct damage budget across the elements.

Defeated enemies grant XP; each level offers three to five cards, depending on selected permanent runes. Shops offer four cards every ten waves; repairs have limited stock and rerolls become more expensive. The wave-100 draft is reserved for endless continuation. Rewards stay queued when their window is closed or minimized.

Normal, Rare, Epic, Legendary, and Mythic cards stack with diminishing returns. Mastery promotes a family at 3/6/9/12 picks. Higher-tier drops never lower an existing tier. Legendary weapon cores gain pierce; Mythic cores emit traveling pulses. The arsenal shows effective projectile values. Acquired skill cards augment casts and can be equipped as an empowered secondary; Mend, Stasis, and Solar Nova are always selectable there.

Information windows leave combat live. Drag their headers, resize their corners, dock, maximize, or minimize them. Focus a header and use **Alt + arrow keys** to move it by keyboard. Choice windows pause by default; their checkbox can keep combat running. Settings provide 100–150% interface scaling, reduced motion, sound, and cosmetic quality controls.

## Content

- Seven towers: Bastion, Pyre, Tempest, Glacier, Verdant, Null, and Monolith.
- Three 50-wave Quick runs, 100-wave Normal runs, and direct Endless expeditions: Verdant Wilds, Ember Foundry, and Void Ruins; stage clears unlock the next environment.
- Sixteen weapons, six infusions, 24 projectile modifiers, 18 defenses, 20 triggers, ten skill families, and six utilities: **100 distinct families** and **40 authored synergies**.
- Bosses at waves 25/50/75/100, elites at other ten-wave milestones, five optional Ascension tiers, and endless continuation.
- Original brass, stone, and luminous-core SVG marks for every family. Inspect the [local icon contact sheet](http://localhost:5173/icon-contact-sheet.html), also bundled in production.

Endless pressure grows beyond a finished build. Proc depth, crowd control, temporary buffs, enemy populations, and attack reservoirs have explicit simulation limits independent of graphics settings. Long sieges advance support formations and build dangerous pressure, preventing indefinite stalemates.

## Saves and recovery

Progress stays in the browser’s `last-spire` IndexedDB database. Checkpoints include random-generator state, stacked cards, fields, projectiles, window settings, and queued rewards. End rewards settle in a transaction with a run-ID ledger to prevent duplicate credits.

Existing v1 saves are backed up before migration. Resumed original runs keep their original combat rules until settlement; new runs use v2. The original 1,000-shot validation bug is removed. Lifetime statistics are separately validated from bounded trigger counters.

Settings can export/import JSON, review pasted JSON, and download the pre-v2 backup. Invalid checkpoints stop automatic writes and expose recovery controls. If storage is unavailable, settlement can remain in memory and be exported before closing. Unsaved memory from a previously closed browser tab cannot be recovered.

## Validation and development

```sh
npm test
npm run build
npm run balance -- --seeds=5
npm run balance -- --seeds=3 --stage=1
npm run balance -- --seeds=3 --stage=2
```

Optional balance filters: `--tower=pyre`, `--difficulty=5`, `--policy=competent`, `--policy=random`, and `--limit=5400`. The policies use the same fixed-tick simulation, actual offered cards, and shop economy as the browser. They are proxies for play skill, not measured human win rates.

For isolated browser regression scenes:

```sh
node --import tsx scripts/qa-fixtures.mjs --browser
npm run dev -- --port 5175 --strictPort
```

Visit `http://localhost:5175/qa.html`. Its explicit checkpoint controls work only on port 5175 and do not touch progress on port 5173. They provide a mixed-effects scene and v1/v2 results with 15,001-shot counters. This development page and generated checkpoints are excluded from the production bundle.

`src/v2/` owns the current catalog, simulation, renderer, interface, window manager, and persistence. Original modules remain for recovered-run compatibility. Raw audits and local development notes are kept outside the public source tree.

Purchased rune levels can be freely dialed down before each run. Autocast runes unlock per-skill presets and advanced conditions. New runs use XP and normalized six-rank equipment mastery; recovered older runs retain their original combat rules.
