/** Explicit synthetic checkpoints, never normal player data. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { emptySave, exportGame } from '../src/persistence/storage.ts';
import {
  createRun,
  grantXp,
  acquireCard,
  advanceMastery,
  fuseCores,
  spawnEnemy,
} from '../src/game/engine.ts';
import { CARDS } from '../src/content/catalog.ts';
const make = (mode = 'normal', tower = 'monolith') => {
  const save = emptySave();
  save.profile.tutorialDone = true;
  save.profile.unlocked.push('monolith');
  save.profile.credits = 1000;
  save.progression.runes.owned = {
    power: 5,
    vitality: 5,
    fortune: 5,
    experience: 10,
    choices: 2,
    autoSignature: 1,
    autoSecondary: 1,
  };
  save.progression.runes.selected = {
    power: 0,
    vitality: 0,
    fortune: 0,
    experience: 0,
    choices: 2,
    autoSignature: 1,
    autoSecondary: 1,
  };
  save.progression.autocast.signature.enabled = true;
  save.progression.autocast.signature.preset = 'boss';
  save.run = createRun(save.profile, tower, 0, 0, 84731, {
    mode,
    runes: save.progression.runes.selected,
  });
  save.progression.active = {
    runId: save.run.id,
    rulesVersion: 3,
    runes: save.run.runeSnapshot,
    autocast: structuredClone(save.progression.autocast),
  };
  save.settings.sound = false;
  return save;
};
mkdirSync('qa-data', { recursive: true });
for (const mode of ['quick', 'normal', 'endless']) {
  const save = make(mode);
  grantXp(save.run, 100);
  writeFileSync(`qa-data/v3-${mode}.json`, exportGame(save));
}
const ready = make();
const s = ready.run;
for (const kind of ['core-echo', 'core-thorn', 'core-mending', 'bolt', 'rail']) {
  const card = CARDS.find((c) => c.weapon === kind);
  acquireCard(s, { id: `fixture-${kind}`, cardId: card.id, rarity: 'rare', price: 0 });
}
for (const w of s.weapons) advanceMastery(w, 900);
s.scrap = 90;
s.wave = 20;
writeFileSync('qa-data/v3-fusion.json', exportGame(ready));
const victory = make('normal', 'bastion');
victory.run.wave = 100;
victory.run.phase = 'victory';
victory.run.cleared = true;
victory.run.earned = 180;
victory.run.weapons[0].lifetimeShots = 15001;
writeFileSync('qa-data/v3-victory.json', exportGame(victory));
const spectacle = make('endless');
const scene = spectacle.run;
for (const [recipe, kinds] of [
  ['cathedral', ['core-echo']],
  ['orrery', ['spiral', 'chakram']],
  ['conduit', ['beam', 'tesla']],
  ['cataclysm', ['mine', 'meteor']],
  ['citadel', ['swarm', 'drone']],
]) {
  for (const kind of kinds) {
    const c = CARDS.find((c) => c.weapon === kind);
    acquireCard(scene, { id: `scene-${kind}`, cardId: c.id, rarity: 'mythic', price: 0 });
  }
  for (const w of scene.weapons) advanceMastery(w, 900);
  const pair = recipe === 'cathedral' ? ['core-mirror', 'core-echo'] : kinds;
  if (
    !fuseCores(
      scene,
      `fusion-${recipe}`,
      ...pair.map((kind) => scene.weapons.find((w) => w.kind === kind).id),
    )
  )
    throw Error('Invalid spectacle fusion');
}
for (const effect of [
  'size',
  'count',
  'pulse',
  'trail',
  'lifetime',
  'regen',
  'shield-regen',
  'armor',
  'lifesteal',
]) {
  const c = CARDS.find((c) => c.effect === effect && c.scope !== 'weapon');
  if (c)
    for (let i = 0; i < Math.min(4, c.maxStacks); i++)
      acquireCard(scene, { id: `scene-${effect}-${i}`, cardId: c.id, rarity: 'mythic', price: 0 });
}
scene.wave = 120;
scene.cleared = true;
scene.spawnTotal = 70;
for (let i = 0; i < 36; i++) {
  const a = (i / 36) * Math.PI * 2;
  spawnEnemy(
    scene,
    i % 3 === 0 ? 'ranged' : 'armored',
    500 + Math.cos(a) * 275,
    400 + Math.sin(a) * 275,
    0,
  );
}
writeFileSync('qa-data/v3-spectacle.json', exportGame(spectacle));
console.log('Prepared six synthetic v3 checkpoints for the isolated QA page.');
