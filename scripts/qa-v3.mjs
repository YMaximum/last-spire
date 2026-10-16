/** Explicit synthetic checkpoints, never normal player data. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { emptySave, exportGame } from '../src/v3/storage.ts';
import { createRun, grantXp, acquireCard, advanceMastery } from '../src/v3/engine.ts';
import { CARDS } from '../src/v3/catalog.ts';
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
console.log('Prepared four synthetic v3 checkpoints for the isolated QA page.');
