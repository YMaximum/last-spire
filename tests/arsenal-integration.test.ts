import { describe, expect, it } from 'vitest';
import { FUSION_BY_ID, EXPANSION_FUSION_IDS, EXPANSION_CARD_IDS } from '../src/content/catalog';
import {
  acquireCard,
  advanceMastery,
  availableFusions,
  createRun,
  fuseCores,
  getWeaponStats,
  previewCard,
  spawnEnemy,
  step,
  takeDamage,
  dealDamage,
  TICK,
} from '../src/game/engine';
import { emptySave, exportGame, parseGame } from '../src/persistence/storage';
import { enableDamageNumbers, readDamageNumbers } from '../src/game/damage-feedback';
import type { RunV3 } from '../src/game/types';

function game() {
  const s = createRun(emptySave().profile, 'bastion', 0, 0, 8831);
  s.weapons = [];
  s.cards = [];
  s.maxHp = s.hp = 10000;
  s.spawned = s.spawnTotal = 999;
  s.spawnTimer = 999;
  return s;
}
function pick(s: RunV3, id: string) {
  expect(acquireCard(s, { id: 'test-' + id, cardId: id, price: 0, rarity: 'normal' })).toBe(true);
}
function pair(id: string) {
  const s = game(),
    recipe = FUSION_BY_ID[id];
  for (const kind of recipe.ingredients) {
    pick(s, 'weapon-' + kind);
    advanceMastery(s.weapons.at(-1)!, 900);
  }
  expect(fuseCores(s, id, s.weapons[0].id, s.weapons[1].id)).toBe(true);
  return s;
}
function foe(s: RunV3, x = 610, y = 400) {
  const e = spawnEnemy(s, 'armored', x, y, 0);
  e.hp = e.maxHp = 1e6;
  e.armor = 0;
  e.speed = 0;
  e.damage = 20;
  e.attackCd = 999;
  return e;
}
function ticks(s: RunV3, n: number) {
  for (let i = 0; i < n; i++) step(s, TICK);
}

describe('expanded arsenal runs through the shipped simulation', () => {
  it.each(EXPANSION_FUSION_IDS)(
    '%s attacks with its inherited core identity and round-trips',
    (id) => {
      const s = pair(id),
        e = foe(s);
      s.hp = s.maxHp - 100;
      s.shield = 100;
      takeDamage(s, 40, 'physical', e);
      ticks(s, 90);
      expect(Object.values(s.damageByWeapon).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
      const save = emptySave();
      save.run = s;
      save.progression.active = {
        runId: s.id,
        rulesVersion: 3,
        runes: s.runeSnapshot,
        autocast: save.progression.autocast,
      };
      const resumed = parseGame(exportGame(save)).run as RunV3;
      const a = structuredClone(s),
        b = structuredClone(resumed);
      ticks(a, 20);
      ticks(b, 20);
      expect(b).toEqual(a);
      expect(s.projectiles.length).toBeLessThanOrEqual(4096);
    },
  );
  it('stores reflected pressure once and consumes it on the next piercing rail volley', () => {
    const s = pair('fusion-reliquary'),
      e = foe(s),
      core = s.weapons[0];
    const before = getWeaponStats(s, core).damage;
    takeDamage(s, 100, 'physical', e);
    expect(s.counters[`ars-pressure-${core.id}`]).toBeGreaterThan(0);
    expect(getWeaponStats(s, core).damage).toBeGreaterThan(before);
    step(s);
    expect(s.counters[`ars-pressure-${core.id}`]).toBe(0);
  });
  it('links at most three pulse bridges without recursive chains', () => {
    const s = pair('fusion-tempest');
    s.counters[`fusion-cd-${s.weapons[0].id}-1`] = 100;
    for (let i = 0; i < 6; i++) foe(s, 600 + i * 8, 400);
    step(s);
    expect(s.counters[`ars-bell-${s.weapons[0].id}`]).toBeGreaterThan(s.time);
    expect(s.stats.procCount).toBeLessThanOrEqual(3);
  });
  it('follows a warned meteor impact with a delayed implosion', () => {
    const s = pair('fusion-impact-well');
    foe(s);
    step(s);
    expect(s.areas.some((a) => a.kind === 'meteor' && a.delay > 0)).toBe(true);
    ticks(s, 29);
    const well = s.areas.find((a) => a.kind === 'void');
    expect(well).toBeDefined();
    expect(well!.depth).toBe(1);
    expect(well!.life).toBeLessThanOrEqual(1.5);
  });
  it('redirects Mirror strikes to two nearby threats with resisted gravitational movement', () => {
    const s = pair('fusion-parallax'),
      attacker = foe(s, 600),
      others = [foe(s, 650), foe(s, 690), foe(s, 720)];
    takeDamage(s, 30, 'physical', attacker);
    expect(others.filter((e) => e.hp < e.maxHp)).toHaveLength(2);
    expect(others[0].x).toBeLessThan(650);
    expect(others[2].hp).toBe(others[2].maxHp);
  });
  it('waits before the frost refrain and cannot schedule a recursive refrain', () => {
    const s = pair('fusion-rimechoir'),
      e = foe(s),
      id = s.weapons[0].id;
    takeDamage(s, 20, 'physical', e);
    const first = e.hp;
    expect(s.counters[`ars-refrain-${id}-due`]).toBeCloseTo(0.4);
    ticks(s, 10);
    expect(e.hp).toBe(first);
    ticks(s, 3);
    expect(e.hp).toBeLessThan(first);
    expect(s.counters[`ars-refrain-${id}-due`]).toBeUndefined();
    expect(e.chill).toBeLessThanOrEqual(0.65);
  });
  it('converts shield absorption to only one target even when one root pierces several enemies', () => {
    const s = game();
    pick(s, 'weapon-bolt');
    pick(s, 'defense-absorption-charge');
    s.shield = 100;
    const a = foe(s),
      b = foe(s, 650);
    takeDamage(s, 100, 'physical');
    const event = {
      rootId: 800,
      source: 'primary' as const,
      depth: 0,
      weaponId: s.weapons[0].id,
      damage: 10,
      element: 'physical' as const,
    };
    const first = dealDamage(s, a, event),
      second = dealDamage(s, b, event);
    expect(first).toBeGreaterThan(second);
    expect(second).toBe(10);
    expect(s.counters['ars-reservoir']).toBe(0);
  });
  it('shows critical root reflections and uses one critical roll across infusions', () => {
    const s = game();
    pick(s, 'weapon-core-mirror');
    pick(s, 'defense-critical-mirror');
    // Seed 1 produces a first RNG draw below the 15% reflection threshold.
    s.rng = 1;
    s.weapons[0].infusions = ['fire', 'frost'];
    enableDamageNumbers(s, true);
    const e = foe(s);
    takeDamage(s, 50, 'physical', e);
    const numbers = readDamageNumbers(s);
    expect(numbers.some((n) => n.critical && n.source === 'retaliation')).toBe(true);
  });
  it('spends absorption once per field tick rather than replaying its cached bonus', () => {
    const s = game();
    pick(s, 'weapon-bolt');
    pick(s, 'defense-absorption-charge');
    s.weapons[0].cooldown = 999;
    const e = foe(s);
    s.counters['ars-reservoir'] = 100;
    s.areas.push({
      id: s.nextId++,
      kind: 'fire',
      x: e.x,
      y: e.y,
      radius: 40,
      damage: 10,
      life: 3,
      maxLife: 3,
      tickTimer: 0,
      delay: 0,
      element: 'frost',
      weaponId: s.weapons[0].id,
      depth: 0,
    });
    const hp = e.hp;
    step(s);
    expect(hp - e.hp).toBeCloseTo(45);
    const after = e.hp;
    ticks(s, 16);
    expect(after - e.hp).toBeCloseTo(10);
    expect(s.counters['ars-reservoir']).toBe(0);
  });
  it('does not reuse an alternating-core bonus on the same field’s next tick', () => {
    const s = game();
    pick(s, 'weapon-bolt');
    pick(s, 'weapon-rail');
    pick(s, 'trigger-crossfire');
    for (const w of s.weapons) w.cooldown = 999;
    const e = foe(s);
    dealDamage(s, e, {
      rootId: s.nextId++,
      source: 'primary',
      depth: 0,
      weaponId: s.weapons[0].id,
      damage: 10,
      element: 'physical',
    });
    s.areas.push({
      id: s.nextId++,
      kind: 'fire',
      x: e.x,
      y: e.y,
      radius: 40,
      damage: 10,
      life: 3,
      maxLife: 3,
      tickTimer: 0,
      delay: 0,
      element: 'frost',
      weaponId: s.weapons[1].id,
      depth: 0,
    });
    const hp = e.hp;
    step(s);
    expect(hp - e.hp).toBeCloseTo(11.8);
    const after = e.hp;
    ticks(s, 16);
    expect(after - e.hp).toBeCloseTo(10);
  });
  it('cannot attack after a control-expiration discharge kills it', () => {
    const s = game();
    pick(s, 'trigger-control-release');
    const e = foe(s, 530);
    e.hp = 1;
    e.stun = 0.01;
    e.attackCd = 0;
    const hp = s.hp;
    step(s);
    expect(e.hp).toBeLessThanOrEqual(0);
    expect(s.hp).toBe(hp);
    expect(s.stats.damageTaken).toBe(0);
  });
  it.each([true, false])(
    'tracks flame age correctly without changing recovered rules (%s)',
    (expanded) => {
      const s = game();
      if (!expanded) delete s.arsenalVersion;
      pick(s, 'weapon-flame');
      if (expanded) pick(s, 'modifier-growth');
      foe(s, 750);
      const stats = getWeaponStats(s, s.weapons[0]);
      step(s);
      const p = s.projectiles.find((p) => p.kind === 'flame')!;
      expect(p).toBeDefined();
      if (expanded) {
        expect(p.maxLife).toBeCloseTo(stats.range / stats.speed);
        expect(p.maxLife - p.life).toBeCloseTo(TICK);
        expect(p.radius).toBeGreaterThan(stats.size + 4);
        expect(p.radius).toBeLessThan((stats.size + 4) * 1.02);
      } else expect(p.maxLife).toBe(stats.life);
    },
  );
  it.each(EXPANSION_CARD_IDS)('gives %s a meaningful effective upgrade preview', (id) => {
    const s = game();
    pick(s, 'weapon-bolt');
    const info = previewCard(s, { id: 'preview', cardId: id, price: 0, rarity: 'rare' });
    expect(info.canApply).toBe(true);
    expect(info.summary).toContain('→');
    expect(info.summary).not.toMatch(/Effective [^:]+:/);
  });
  it('does not grant expanded cards or alternate fusions to recovered rules', () => {
    const s = game();
    delete s.arsenalVersion;
    expect(
      acquireCard(s, { id: 'old', cardId: EXPANSION_CARD_IDS[0], price: 0, rarity: 'mythic' }),
    ).toBe(false);
    for (const kind of FUSION_BY_ID['fusion-pyroclasm'].ingredients) {
      pick(s, 'weapon-' + kind);
      advanceMastery(s.weapons.at(-1)!, 900);
    }
    expect(availableFusions(s)).toEqual([]);
    expect(fuseCores(s, 'fusion-pyroclasm', s.weapons[0].id, s.weapons[1].id)).toBe(false);
  });
});
