# Last Spire — The Runeforged Age

Repository agreements are in [AGENTS.md](AGENTS.md). For reviewed PRs, isolated CI, manual publishing, rollback, and moving a localhost save, see [the release runbook](docs/RELEASING.md).

See [SECURITY.md](SECURITY.md) for safe publication, development boundaries, release checks, and private vulnerability reporting.

An original single-player browser roguelite about building one ancient arcane machine. TypeScript, Canvas 2D, Vite, and local IndexedDB saves. No account or network service is required.

## Play locally

Use Node.js 22.16+ or 24:

```sh
npm ci
npm run dev
```

Open [the local game](http://localhost:5173/). Development and preview listen only on this computer by default. For deliberate testing on a trusted LAN, use `npm run dev -- --host 0.0.0.0`; private-file access remains denied. Do not expose the development server to the internet.

```sh
npm run build
npm run preview
```

The production output is `dist/`. Serve it over HTTP. All visual assets, icons, fonts, and effects work offline after the files have loaded; there are no external font or asset requests.

Optional Google sign-in and account-isolated cloud-save controls are available through **Account & cloud saves** when a same-origin account service is configured. Guest play remains local. First adoption, checkpoint conflicts, and device takeovers require a deliberate choice. The service, local development setup, and VPS-only recovery limits are documented in [Accounts and cloud saves](docs/ACCOUNTS.md). Merging source does not deploy the backend or upload existing guest saves. A separately reviewed API release is required before production cloud saving is enabled.

## Playing

Your tower fires automatically. Choose targeting, build a loadout, and time two active skills. **Q** uses the signature ability; **E** uses the secondary. **Space** pauses, **1/2/3** change speed, **A** opens the arsenal, **C** opens the codex, and **Esc** closes the top window or pauses. Touch buttons provide the same controls.

All six shared arsenal sockets are available immediately for weapons or defensive cores. New weapon cards fill sockets; duplicates strengthen an existing weapon. Replacement is optional and requires a named target. Global cards remain when replacing a core; its targeted infusions and mastery are released. Infusions combine on a chosen weapon and divide its direct damage budget across the elements.

Defeated enemies grant XP; each level offers three to five cards, depending on selected permanent runes. Shops offer four cards every ten waves; repairs have limited stock and rerolls become more expensive. XP choices are independent of wave milestones. Rewards stay queued when their window is closed or minimized.

Normal, Rare, Epic, Legendary, and Mythic cards stack with diminishing returns. Repeated investment promotes a family at 3/6/9/12 picks. Separately, equipment earns mastery ranks 1–6 through active use and duplicate training. Higher-tier drops never lower an existing tier. Legendary weapon cores gain pierce; Mythic cores emit traveling pulses. The arsenal shows effective projectile values. Acquired skill cards augment casts and can be equipped as an empowered secondary; Mend, Stasis, and Solar Nova are always selectable there.

Information windows leave combat live. Drag their headers, resize their corners, dock, maximize, or minimize them. Focus a header and use **Alt + arrow keys** to move it by keyboard. Choice windows pause by default; their checkbox can keep combat running. Settings provide 100–150% interface scaling, reduced motion, sound, and cosmetic quality controls.

Settings → **Floating damage numbers** shows or hides damage inscriptions and remembers your preference. Each element has its own color and sigil; critical hits produce larger rune bursts, status damage uses `TICK`, and defensive retaliation uses `RETURN`. Rapid matching hits combine into a total with a hit count. Reduced motion keeps labels stationary while preserving their distinctions.

## Content

- Seven towers: Bastion, Pyre, Tempest, Glacier, Verdant, Null, and Monolith.
- Three environments, each supporting 50-wave Quick, 100-wave Normal, and direct Endless expeditions: Verdant Wilds, Ember Foundry, and Void Ruins; stage clears unlock the next environment.
- **124 card families**: the original 100 plus eight defensive cores and sixteen support families. Sixteen weapons, eight defensive cores, six infusions, projectile modifiers, defenses, triggered buffs, skills, and utilities support offensive, defensive, and mixed builds.
- **40 passive synergies and 12 mastered fusions**. Two equipped ingredients at mastery 6 become one stronger core, freeing a socket. Preview inheritance and capped conversions before forging. Fused cores cannot fuse again. Flame and Singularity retain support-card compatibility but have no fusion recipe in this set.
- Bosses at waves 25/50/75/100 in Normal and 12/25/37/50 in Quick, elites at other ten-wave milestones, five optional Ascension tiers, and endless continuation. Both finite modes unlock stages; records distinguish modes.
- Original brass, stone, and luminous-core SVG marks for every family. Inspect the [local icon contact sheet](http://localhost:5173/icon-contact-sheet.html), also bundled in production.

Endless pressure grows beyond a finished build. Proc depth, crowd control, temporary buffs, enemy populations, and attack reservoirs have explicit simulation limits independent of graphics settings. Long sieges advance support formations and build dangerous pressure, preventing indefinite stalemates.

## Saves and recovery

Progress stays in the browser’s `last-spire` IndexedDB database. Checkpoints include random-generator state, stacked cards, fields, projectiles, window settings, and queued rewards. End rewards settle in a transaction with a run-ID ledger to prevent duplicate credits.

Existing v1 saves are backed up before migration. Resumed original runs keep their original combat rules until settlement; new runs use v2. The original 1,000-shot validation bug is removed. Lifetime statistics are separately validated from bounded trigger counters.

Settings can export/import JSON, review pasted JSON, and download the migration backup. Invalid checkpoints stop automatic writes and expose recovery controls. If storage is unavailable, settlement can remain in memory and be exported before closing. Unsaved memory from a previously closed browser tab cannot be recovered.

## Validation and development

```sh
npm test
npm run check:public
npm run check:dependencies
npm run build
npm run check:secrets
node --import tsx scripts/audit-v3.ts --tower=bastion --stage=0 --mode=normal --policy=competent --seeds=1
```

The current-rule audit supports `--tower=pyre`, `--stage=1`, `--difficulty=5`, `--mode=quick`, `--policy=random`, and `--seconds=5400`. It uses the current fixed-tick simulation, actual offered cards, and shop economy. Policies are proxies for play skill, not measured human win rates. The older `npm run balance` and `npm run balance:legacy` commands exercise legacy rules; do not use their results to claim current balance. Keep audits to small, serialized batches.

For isolated browser regression scenes:

```sh
node --import tsx scripts/qa-fixtures.mjs --browser
npm run dev -- --port 5175 --strictPort
```

Visit `http://localhost:5175/qa.html`. Its explicit checkpoint controls work only on port 5175 and do not touch progress on port 5173. They provide a mixed-effects scene and v1/v2 results with 15,001-shot counters. This development page and generated checkpoints are excluded from the production bundle.

The browser entrypoint is `src/ui/app.ts`. Current combat lives in `src/game/`, content in `src/content/`, graphics in `src/render/`, and save handling in `src/persistence/`. Recovered-run engines and validators live in `src/legacy/`. See [Source architecture](docs/ARCHITECTURE.md) for ownership and compatibility boundaries. Raw audits and local development notes stay outside the public source tree.

Purchased rune levels can be freely dialed down before each run. Autocast runes unlock per-skill presets and advanced conditions. New runs use XP and normalized six-rank equipment mastery; recovered older runs retain their original combat rules.

## Strategy controls

The pinned arsenal shows six sockets, mastery, and fusion readiness. Hover or focus a mark for a summary; click or tap it for details. Collected support cards and activated synergies have matching pinned collections. Linked entities in detail windows also have summaries.

The Ledger exposes effective damage, recent measured DPS, health and shield regeneration, mitigation, equipment statistics, and a recent wall-clock rendering sample. Background-browser throttling affects that sample; it is not a device benchmark. Recent DPS measures combat time and starts a new measurement after resuming a browser session.

Permanent runes separate purchased ownership from selected levels. Lower or restore selected levels freely before starting; purchases buy only the next level. Experience runes improve XP gain, Choice runes add level-up options, and Autocast runes unlock per-skill automation. Presets include every useful cast, boss only, and emergency; advanced rules combine health, shield, nearby-enemy, and boss conditions with All/Any matching. Manual casts remain available.

Monolith starts without a weapon. Its Mirror core, high integrity, mitigation, and stronger defensive cores support reflection and retaliation. Other towers can also equip defensive cores, and Monolith can acquire weapons.

## Local gameplay observations

Settings → Local gameplay data controls optional, browser-local balance observations. Logs include run seed, build decisions, equipment, XP/mastery, economy, damage/protection, performance samples, and outcome. They use a separate IndexedDB database, retain bounded records, and can be exported or cleared without deleting progression. No logs are uploaded. Disabling recording persists across reloads. Exported logs may reveal play history; review before sharing.

For current-rule policy simulations:

```sh
node --import tsx scripts/audit-v3.ts --tower=bastion --stage=0 --mode=normal,quick --policy=competent,random --seeds=1
```

Raw output defaults to ignored `.private/reports/`. Scripted policies are regression and tuning tools, not measured player win rates. For synthetic v3 checkpoints, run `node --import tsx scripts/qa-v3.mjs`, then open `http://localhost:5175/qa-v3.html` on the isolated development server. Import only into a disposable test origin.

Ledger → Combat results shows the focused tab's callback frame rate, simulation and drawing time, and the 95th-percentile frame interval. Sampling resets after focus loss and warms up for three seconds; background samples are excluded from gameplay observations. Browser scheduling, other applications, and automated-preview throttling still affect these readings. They do not establish physical-device performance. Floating stone panels use opaque surfaces to avoid repeatedly blurring live combat.

## Container packaging

```sh
docker build -t last-spire:local .
docker compose up -d
```

The container serves static assets as an unprivileged user. Compose binds only `127.0.0.1:8080`, uses a read-only filesystem with temporary writable storage, and exposes `/healthz` for health checks. An independently managed HTTPS reverse proxy can front that loopback port. Environment-specific infrastructure, certificates, DNS, and deployment credentials are intentionally outside this repository. Building or starting this local container does not publish the game.

## Account service releases

Guests keep browser-local saves. Optional Google sign-in and cloud saves require the separately operated API described in [the account release runbook](docs/ACCOUNT-RELEASING.md). Building or merging this repository does not deploy or enable that service.
