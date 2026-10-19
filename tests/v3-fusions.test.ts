import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../src/legacy/classic/storage';
import { FUSIONS } from '../src/content/catalog';
import {
  acquireCard,
  advanceMastery,
  availableFusions,
  createRun,
  dealDamage,
  fuseCores,
  getWeaponStats,
  previewFusion,
  refreshFusionReady,
  spawnEnemy,
  step,
  takeDamage,
  TICK,
} from '../src/game/engine';
import type { RunV3, WeaponInstance } from '../src/game/types';
function pair(recipeId: string) {
  const recipe = FUSIONS.find((f) => f.id === recipeId)!;
  const s = createRun(defaultProfile(), 'bastion', 0, 0, 938);
  s.weapons = [];
  s.cards = [];
  s.spawnTimer = s.spawnTotal = 999;
  s.maxHp = s.hp = 100000;
  s.shield = 200;
  for (const kind of recipe.ingredients) {
    expect(
      acquireCard(s, { id: `pick-${kind}`, cardId: `weapon-${kind}`, rarity: 'normal', price: 0 }),
    ).toBe(true);
    advanceMastery(s.weapons[s.weapons.length - 1], 900);
  }
  refreshFusionReady(s);
  return s;
}
function targets(s: RunV3) {
  for (const [x, y] of [
    [650, 400],
    [660, 430],
    [700, 400],
    [580, 410],
    [610, 460],
  ]) {
    const e = spawnEnemy(s, 'armored', x, y, 0);
    e.maxHp = e.hp = 1000000;
    e.armor = e.damage = e.speed = 0;
  }
}
function exercise(s: RunV3) {
  targets(s);
  s.hp -= 100;
  for (let tick = 0; tick < 450; tick++) {
    if (tick % 36 === 0) {
      s.shield = Math.max(s.shield, 40);
      takeDamage(s, 25, 'physical', s.enemies[0]);
    }
    step(s, TICK);
  }
  return Object.values(s.damageByWeapon).reduce((a, b) => a + b, 0);
}
function fuse(s: RunV3, recipeId: string) {
  const [a, b] = s.weapons;
  expect(fuseCores(s, recipeId, a.id, b.id)).toBe(true);
  return s.weapons[0];
}
describe('twelve authored mastered fusions', () => {
  for (const recipe of FUSIONS)
    it(`${recipe.id} preserves both ingredients and mechanically changes their combined behavior`, () => {
      const s = pair(recipe.id),
        control = structuredClone(s),
        before = JSON.stringify(s),
        [a, b] = s.weapons;
      const preview = previewFusion(s, recipe.id, a.id, b.id)!;
      expect(JSON.stringify(s)).toBe(before);
      expect(preview.name).toBe(recipe.name);
      expect(availableFusions(s).some((f) => f.recipeId === recipe.id)).toBe(true);
      const output = fuse(s, recipe.id);
      expect(s.weapons).toHaveLength(1);
      expect(output.kind).toBe(recipe.kind);
      expect(output.fusion?.ingredients.map((w) => w.kind)).toEqual(recipe.ingredients);
      expect(output).toMatchObject({ masteryRank: 6, masteryProgress: 900, fusionReady: false });
      expect(availableFusions(s)).toHaveLength(0);
      expect(s.counters.fusions).toBe(1);
      expect(s.counters['fusion-1-time']).toBe(0);
      expect(s.visuals.some((v) => v.kind === `fusion-${recipe.id}`)).toBe(true);
      const base = exercise(control),
        combined = exercise(s);
      expect(base).toBeGreaterThan(0);
      expect(combined).toBeGreaterThan(base * 1.02);
      expect(
        Object.keys(s.damageByWeapon).every((id) => [output.id, 'burn', 'poison'].includes(id)),
      ).toBe(true);
      expect(s.damageByWeapon[output.id]).toBeGreaterThan(0);
      expect(s.projectiles.every((p) => p.weaponId !== a.id && p.weaponId !== b.id)).toBe(true);
    });
  it('requires a real mastered partner and rejects wrong, duplicate, consumed and fused inputs', () => {
    const s = pair('fusion-lance'),
      [a, b] = s.weapons;
    b.masteryRank = 5;
    refreshFusionReady(s);
    expect(a.fusionReady).toBe(false);
    const snapshot = JSON.stringify(s);
    expect(fuseCores(s, 'fusion-lance', a.id, b.id)).toBe(false);
    expect(JSON.stringify(s)).toBe(snapshot);
    b.masteryRank = 6;
    refreshFusionReady(s);
    expect(a.fusionReady).toBe(true);
    expect(fuseCores(s, 'fusion-prism', a.id, b.id)).toBe(false);
    expect(fuseCores(s, 'fusion-lance', a.id, a.id)).toBe(false);
    fuse(s, 'fusion-lance');
    expect(fuseCores(s, 'fusion-lance', a.id, b.id)).toBe(false);
    expect(availableFusions(s)).toHaveLength(0);
  });
  it('never applies shared global damage or attack-speed bonuses twice', () => {
    const a = pair('fusion-lance'),
      b = structuredClone(a);
    expect(acquireCard(b, { id: 'damage', cardId: 'mod-damage', rarity: 'normal', price: 0 })).toBe(
      true,
    );
    expect(acquireCard(b, { id: 'rate', cardId: 'mod-rate', rarity: 'normal', price: 0 })).toBe(
      true,
    );
    const baselineBefore = getWeaponStats(a, a.weapons[0]),
      boostBefore = getWeaponStats(b, b.weapons[0]);
    const wa = fuse(a, 'fusion-lance'),
      wb = fuse(b, 'fusion-lance');
    const baseline = getWeaponStats(a, wa),
      boost = getWeaponStats(b, wb);
    expect(boost.damage / baseline.damage).toBeCloseTo(
      boostBefore.damage / baselineBefore.damage,
      8,
    );
    expect(boost.cooldown / baseline.cooldown).toBeCloseTo(
      boostBefore.cooldown / baselineBefore.cooldown,
      8,
    );
  });
  it('unions infusions, merges duplicate targeted investment, and previews capped conversion', () => {
    const s = pair('fusion-lance'),
      [a, b] = s.weapons;
    for (const core of [a, b])
      for (let i = 0; i < 12; i++)
        acquireCard(
          s,
          { id: `inf-${core.id}-${i}`, cardId: 'infusion-fire', rarity: 'normal', price: 0 },
          core.id,
        );
    acquireCard(s, { id: 'frost', cardId: 'infusion-frost', rarity: 'rare', price: 0 }, b.id);
    a.masteryRank = 5;
    a.masteryProgress = 600;
    acquireCard(
      s,
      { id: 'focus', cardId: 'utility-apprenticeship', rarity: 'normal', price: 0 },
      a.id,
    );
    advanceMastery(a, 900);
    a.rarity = 'legendary';
    b.rarity = 'rare';
    const preview = previewFusion(s, 'fusion-lance', a.id, b.id)!;
    expect(preview.conversions.join(' ')).toContain('excess');
    expect(preview.conversions.join(' ')).toContain('completed mastery');
    const w = fuse(s, 'fusion-lance');
    expect(w.infusions).toEqual(['fire', 'frost']);
    expect(w.rarity).toBe('legendary');
    const fire = s.cards.filter((c) => c.cardId === 'infusion-fire');
    expect(fire).toHaveLength(1);
    expect(fire[0].stacks).toBe(12);
    expect(fire[0].targetId).toBe(w.id);
    expect(s.cards.some((c) => c.cardId === 'utility-apprenticeship')).toBe(false);
    expect(w.fusion!.overflowPower).toBeLessThanOrEqual(0.15);
    expect(w.fusion!.overflowPower).toBeGreaterThan(0);
  });
  it('retains compatible passive synergies and damage histories without duplicating totals', () => {
    const s = pair('fusion-lance'),
      [a, b] = s.weapons;
    targets(s);
    acquireCard(s, { id: 'solar', cardId: 'infusion-solar', rarity: 'normal', price: 0 }, a.id);
    const before = [...s.synergies];
    dealDamage(s, s.enemies[0], {
      rootId: 1,
      source: 'primary',
      depth: 0,
      weaponId: a.id,
      damage: 20,
      element: 'physical',
    });
    const total = Object.values(s.damageByWeapon).reduce((n, v) => n + v, 0);
    const w = fuse(s, 'fusion-lance');
    for (const id of before) expect(s.synergies).toContain(id);
    expect(Object.values(s.damageByWeapon).reduce((n, v) => n + v, 0)).toBe(total);
    expect(s.damageByWeapon[w.id]).toBe(total);
    expect(s.cards.some((c) => c.cardId === 'weapon-bolt' || c.cardId === 'weapon-rail')).toBe(
      false,
    );
  });
  it('preserves fixed-tick replay after export/resume, including ingredient cadence', () => {
    const a = pair('fusion-citadel');
    fuse(a, 'fusion-citadel');
    targets(a);
    for (let i = 0; i < 150; i++) step(a);
    const b = JSON.parse(JSON.stringify(a)) as RunV3;
    for (let i = 0; i < 150; i++) {
      step(a);
      step(b);
    }
    expect(b).toEqual(a);
  });
  it('restricts forging to modern combat and keeps credits and scrap unchanged', () => {
    const s = pair('fusion-prism'),
      [a, b] = s.weapons;
    s.scrap = 123;
    s.phase = 'victory';
    expect(fuseCores(s, 'fusion-prism', a.id, b.id)).toBe(false);
    s.phase = 'combat';
    fuse(s, 'fusion-prism');
    expect(s.scrap).toBe(123);
    expect(s.counters.protectionShieldGenerated || 0).toBe(0);
  });
});
