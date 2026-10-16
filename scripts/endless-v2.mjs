import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { defaultProfile } from '../src/storage.ts';
import { CARDS } from '../src/v2/catalog.ts';
import { createRun, acquireCard, step, useSkill } from '../src/v2/engine.ts';
import { emptySave, exportGame } from '../src/v2/storage.ts';
const s = createRun(defaultProfile(), 'bastion', 2, 0, 84731);
s.endless = s.cleared = true;
s.wave = 101;
for (const id of [
  'weapon-spiral',
  'weapon-tesla',
  'weapon-meteor',
  'weapon-drone',
  'weapon-singularity',
])
  acquireCard(s, { id, cardId: id, price: 0, rarity: 'mythic' });
for (const c of CARDS.filter((c) => c.group !== 'weapon'))
  for (let i = 0; i < 12; i++) {
    if (c.group === 'infusion')
      for (const w of s.weapons)
        acquireCard(s, { id: c.id, cardId: c.id, price: 0, rarity: 'mythic' }, w.id);
    else acquireCard(s, { id: c.id, cardId: c.id, price: 0, rarity: 'mythic' });
  }
let steps = 0,
  peakAreas = 0,
  peakSaveBytes = 0;
const start = performance.now();
while (s.phase === 'combat' && steps < 9000 && performance.now() - start < 15000) {
  step(s);
  steps++;
  useSkill(s, 'signature');
  if (s.hp < s.maxHp * 0.7) useSkill(s, 'secondary');
  s.pendingRewards = [];
  s.notices = [];
  peakAreas = Math.max(peakAreas, s.areas.length);
  if (steps % 3000 === 0) {
    const save = emptySave();
    save.run = s;
    peakSaveBytes = Math.max(peakSaveBytes, exportGame(save).length);
  }
}
const elapsedMs = performance.now() - start;
const report = {
  wallBudgetMs: 15000,
  fixture: 'Explicit maximally upgraded stress build, not a normal player policy',
  seed: s.seed,
  tower: s.tower,
  stage: s.stage,
  wave: s.wave,
  phase: s.phase,
  combatSeconds: s.time,
  steps,
  elapsedMs,
  meanStepMs: elapsedMs / steps,
  peakAreas,
  peakSaveBytes,
  ...s.stats,
  projectiles: s.projectiles.length,
  enemies: s.enemies.length,
  lifetimeShots: s.weapons.reduce((n, w) => n + w.lifetimeShots, 0),
};
writeFileSync('reports/endless-v2.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
