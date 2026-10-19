import { describe, expect, it } from 'vitest';
import { createRun, acquireCard, advanceMastery, availableFusions, step } from '../src/game/engine';
import {
  acknowledgeFusions,
  fusionOfferKey,
  unseenFusions,
  pendingFusionOffer,
  recordFusionBoundary,
  nextRunDecision,
} from '../src/game/fusion-offers';
import { emptySave, exportGame, parseGame } from '../src/persistence/storage';
import { snapshotFromSave, saveFromSnapshot } from '../src/account/snapshot';
import { defaultProfile } from '../src/legacy/classic/storage';

function ready() {
  const run = createRun(defaultProfile(), 'bastion', 0, 0, 714);
  acquireCard(run, { id: 'test-rail', cardId: 'weapon-rail', rarity: 'normal', price: 0 });
  for (const core of run.weapons) advanceMastery(core, 900);
  return run;
}
function clearWave(run: ReturnType<typeof ready>) {
  const previous = run.wave;
  run.spawned = run.spawnTotal;
  run.enemies = [];
  run.waveTime = 18;
  step(run);
  recordFusionBoundary(run, previous);
}
describe('fusion offers at safe wave boundaries', () => {
  it('makes readiness discoverable immediately but waits for the cleared-wave boundary', () => {
    const run = ready();
    expect(availableFusions(run)).toHaveLength(1);
    expect(pendingFusionOffer(run)).toBe(false);
    clearWave(run);
    expect(pendingFusionOffer(run)).toBe(true);
    expect(nextRunDecision(run)).toBe('fusion');
  });
  it('resolves shops and level-ups before the pending fusion', () => {
    const run = ready();
    run.wave = 10;
    clearWave(run);
    expect(run.pendingRewards[0].kind).toBe('shop');
    expect(nextRunDecision(run)).toBe('reward');
    run.pendingRewards = [];
    expect(nextRunDecision(run)).toBe('fusion');
  });
  it('does not repeat Later but leaves the dedicated forge eligible', () => {
    const run = ready();
    clearWave(run);
    acknowledgeFusions(run, unseenFusions(run));
    expect(pendingFusionOffer(run)).toBe(false);
    expect(availableFusions(run)).toHaveLength(1);
    expect(unseenFusions(run)).toHaveLength(0);
    clearWave(run);
    expect(pendingFusionOffer(run)).toBe(false);
  });
  it('distinguishes replacement cores and keeps ingredient ordering stable', () => {
    const run = ready(),
      offer = availableFusions(run)[0];
    expect(
      fusionOfferKey({
        ...offer,
        ingredientIds: [...offer.ingredientIds].reverse() as [string, string],
      }),
    ).toBe(fusionOfferKey(offer));
    acknowledgeFusions(run, [offer]);
    run.weapons[0].id = 'replacement-core';
    expect(unseenFusions(run)).toHaveLength(1);
    acknowledgeFusions(run, unseenFusions(run));
    expect(
      Object.keys(run.counters).filter((key) => key.startsWith('ui.fusion.seen.')),
    ).toHaveLength(1);
  });
  it('persists offers and acknowledgements through browser export and cloud validation', () => {
    const save = emptySave(),
      run = ready();
    clearWave(run);
    save.run = run;
    save.progression.active = {
      runId: run.id,
      rulesVersion: 3,
      runes: run.runeSnapshot,
      autocast: save.progression.autocast,
    };
    const restored = parseGame(exportGame(save));
    expect(pendingFusionOffer(restored.run as typeof run)).toBe(true);
    acknowledgeFusions(run, availableFusions(run));
    const cloud = saveFromSnapshot(snapshotFromSave(save), save.settings);
    expect(unseenFusions(cloud.run as typeof run)).toHaveLength(0);
    expect(availableFusions(cloud.run as typeof run)).toHaveLength(1);
    expect(cloud.version).toBe(5);
  });
  it('drops the safe-boundary marker once combat advances', () => {
    const run = ready();
    clearWave(run);
    acknowledgeFusions(run, unseenFusions(run));
    const previous = run.wave;
    step(run);
    recordFusionBoundary(run, previous);
    run.weapons[0].id = 'another-core';
    expect(unseenFusions(run)).toHaveLength(1);
    expect(pendingFusionOffer(run)).toBe(false);
  });
});
