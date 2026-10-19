/** Writes isolated, explicitly imported browser-QA checkpoints; never touches browser storage. */
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const fixturePath = (name) => join(tmpdir(), name);
import { emptySave, exportGame } from '../src/legacy/runeforged/storage.ts';
import { createRun, acquireCard, spawnEnemy, step } from '../src/legacy/runeforged/engine.ts';
import { createRun as legacyRun } from '../src/legacy/classic/engine.ts';
import { CARDS } from '../src/content/base-catalog.ts';
const save = emptySave();
save.profile.tutorialDone = true;
save.settings.autoPauseChoices = false;
save.settings.intensity = 'spectacular';
save.settings.sound = false;
const s = createRun(save.profile, 'bastion', 0, 0, 71127);
save.run = s;
s.wave = 70;
s.spawned = s.spawnTotal = 30;
s.hp = s.maxHp = 5000;
s.scrap = 220;
const give = (id, n = 1, target = s.weapons[0].id) => {
  for (let i = 0; i < n; i++) {
    const c = CARDS.find((c) => c.id === id);
    if (!c) throw Error(id);
    acquireCard(s, { id: `qa-${id}-${i}`, cardId: id, rarity: 'mythic', price: 0 }, target);
  }
};
for (const kind of ['meteor', 'singularity', 'chakram', 'tesla', 'drone']) give(`weapon-${kind}`);
for (const effect of ['size', 'count', 'pulse', 'trail', 'lifetime', 'homing', 'pierce'])
  give(`mod-${effect}`, effect === 'size' ? 12 : 2);
for (const id of [
  'def-thorns',
  'def-reflect',
  'def-retaliation',
  'def-shield-break',
  'on-kill-haste',
  'on-kill-fury',
  'skill-meteor-field',
]) {
  const c = CARDS.find((c) => c.id === id);
  if (c) give(id, 2);
}
for (const w of s.weapons)
  for (const e of ['fire', 'frost', 'lightning', 'void']) give(`infusion-${e}`, 1, w.id);
s.weapons[0].lifetimeShots = 15001;
for (let i = 0; i < 46; i++) {
  const a = (i * Math.PI * 2) / 46;
  const e = spawnEnemy(
    s,
    i % 7 === 0 ? 'armored' : i % 9 === 0 ? 'ranged' : 'swarmer',
    500 + Math.cos(a) * (90 + i * 5),
    400 + Math.sin(a) * (80 + i * 4),
    0,
  );
  e.hp = e.maxHp = 12000;
}
for (let i = 0; i < 75; i++) step(s);
writeFileSync(fixturePath('last-spire-v2-effects.json'), exportGame(save));
const victory = emptySave();
victory.profile.tutorialDone = true;
victory.run = createRun(victory.profile, 'bastion', 0, 0, 51);
Object.assign(victory.run, {
  phase: 'victory',
  cleared: true,
  wave: 100,
  time: 2400,
  kills: 1500,
  earned: 714.4,
});
victory.run.weapons[0].lifetimeShots = 15001;
writeFileSync(fixturePath('last-spire-v2-victory.json'), exportGame(victory));
const legacy = emptySave();
legacy.profile.tutorialDone = true;
legacy.run = legacyRun(legacy.profile, 'bastion', 0, 0, 52);
Object.assign(legacy.run, {
  phase: 'ended',
  cleared: true,
  wave: 100,
  time: 2400,
  kills: 1500,
  earned: 350,
});
legacy.run.attacks[0].shots = 15001;
writeFileSync(fixturePath('last-spire-v1-victory.json'), exportGame(legacy));
console.log('Wrote three explicit QA fixtures in the system temporary directory');

const shop = emptySave();
shop.profile.tutorialDone = true;
shop.settings.sound = false;
shop.run = createRun(shop.profile, 'bastion', 0, 0, 1117);
Object.assign(shop.run, { wave: 20, waveTime: 18, spawned: shop.run.spawnTotal, scrap: 70 });
step(shop.run);
writeFileSync(fixturePath('last-spire-v2-shop.json'), exportGame(shop));
if (process.argv.includes('--browser')) {
  mkdirSync('qa-data', { recursive: true });
  for (const [from, to] of [
    ['v2-effects', 'effects'],
    ['v2-victory', 'victory'],
    ['v1-victory', 'legacy'],
    ['v2-shop', 'shop'],
  ])
    copyFileSync(fixturePath(`last-spire-${from}.json`), `qa-data/${to}.json`);
  console.log('Prepared qa.html checkpoints for isolated port 5175.');
}
