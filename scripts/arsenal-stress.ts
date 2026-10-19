import { chooseEvolution, queueEvolution } from '../src/game/evolution';
/** Bounded synthetic soak, not an organically acquired build or a browser FPS test. */
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { CARDS, FUSION_BY_ID } from '../src/content/catalog';
import {
  acquireCard,
  advanceMastery,
  createRun,
  fuseCores,
  spawnEnemy,
  step,
  TICK,
  useSkill,
} from '../src/game/engine';
import { emptySave, exportGame, parseGame } from '../src/persistence/storage';

const save = emptySave();
save.profile.tutorialDone = true;
const evolved = !process.argv.includes('--evolution=off');
const run = createRun(save.profile, 'monolith', 2, 0, 84731, {
  mode: 'endless',
  evolutionVersion: evolved ? 1 : 0,
});
run.weapons = [];
run.wave = 161;
run.maxHp = run.hp = 1e8;
run.spawned = run.spawnTotal = 96;
run.spawnTimer = 999;
function pick(id: string, target?: string) {
  return acquireCard(run, { id: `stress-${id}`, cardId: id, rarity: 'mythic', price: 0 }, target);
}
for (const id of ['fusion-pyroclasm', 'fusion-tempest', 'fusion-impact-well', 'fusion-hoarfrost']) {
  for (const kind of FUSION_BY_ID[id].ingredients) {
    if (!pick(`weapon-${kind}`)) throw new Error(`Could not acquire ${kind}`);
    advanceMastery(run.weapons.at(-1)!, 900);
  }
  const [a, b] = run.weapons.slice(-2);
  if (!fuseCores(run, id, a.id, b.id)) throw new Error(`Could not fuse ${id}`);
}
pick('weapon-core-mirror');
pick('weapon-core-thorn');
for (const card of CARDS.filter((c) => c.group !== 'weapon'))
  for (let i = 0; i < card.maxStacks; i++)
    if (card.scope === 'weapon') for (const core of run.weapons) pick(card.id, core.id);
    else pick(card.id);
if (evolved)
  for (let i = 0; i < 3; i++) {
    queueEvolution(run, run.wave - 1);
    if (!chooseEvolution(run, 'ironbriar')) throw new Error('Could not evolve stress build');
  }
for (let i = 0; i < 96; i++) {
  const angle = (i * Math.PI * 2) / 96,
    radius = 80 + (i % 5) * 35;
  const enemy = spawnEnemy(
    run,
    i % 4 ? 'armored' : 'ranged',
    500 + Math.cos(angle) * radius,
    400 + Math.sin(angle) * radius,
    0,
  );
  enemy.hp = enemy.maxHp = 1e8;
  enemy.speed = 0;
  enemy.damage = 100;
}
save.run = run;
save.progression.active = {
  runId: run.id,
  rulesVersion: 3,
  runes: run.runeSnapshot,
  autocast: save.progression.autocast,
};
let ticks = 0,
  peakProjectiles = 0,
  peakAreas = 0,
  peakBytes = 0;
const started = performance.now();
while (ticks < 1800 && performance.now() - started < 15000 && run.phase === 'combat') {
  step(run);
  useSkill(run, 'signature');
  useSkill(run, 'secondary');
  run.pendingRewards = [];
  peakProjectiles = Math.max(peakProjectiles, run.projectiles.length);
  peakAreas = Math.max(peakAreas, run.areas.length);
  ticks++;
  if (ticks % 300 === 0) peakBytes = Math.max(peakBytes, Buffer.byteLength(exportGame(save)));
}
const wallMs = performance.now() - started;
const checkpoint = exportGame(save),
  resumed = parseGame(checkpoint).run!;
if (!resumed || !('weapons' in resumed)) throw new Error('Stress checkpoint lost its arsenal');
step(run);
step(resumed);
if (JSON.stringify(run) !== JSON.stringify(resumed)) throw new Error('Stress resume diverged');
if (peakProjectiles > 4096) throw new Error('Projectile limit exceeded');
const result = {
  evolution: run.evolution?.path,
  evolutionTier: run.evolution?.tier,
  seed: 84731,
  startWave: 161,
  ticks,
  simulatedSeconds: ticks * TICK,
  wallMs,
  meanMsPerTick: wallMs / ticks,
  peakProjectiles,
  peakAreas,
  peakSaveBytes: Math.max(peakBytes, Buffer.byteLength(checkpoint)),
  resumedIdentically: true,
};
const output =
  process.argv.find((arg) => arg.startsWith('--output='))?.slice(9) ||
  '.private/reports/arsenal-stress.json';
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
