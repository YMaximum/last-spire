import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../src/legacy/classic/storage';
import type {
  AreaEffect,
  DamageEvent,
  EnemyV2,
  ProjectileV2,
  WeaponInstance,
} from '../src/model/arsenal';
import { createRun, spawnEnemy } from '../src/game/engine';
import type { RunV3 } from '../src/game/types';
import {
  arsenalAbsorb,
  arsenalArmor,
  arsenalBounce,
  arsenalControlEnd,
  arsenalDamage,
  arsenalDrone,
  arsenalEnemyTick,
  arsenalExpiry,
  arsenalFieldMultiplier,
  arsenalHealing,
  arsenalMeteor,
  arsenalProjectile,
  arsenalPulse,
  arsenalReflect,
  arsenalThorns,
  cleanupArsenal,
  type ArsenalHooks,
} from '../src/game/arsenal';

function fresh() {
  const s = createRun(defaultProfile(), 'bastion', 0, 0, 90210);
  s.enemies = [];
  s.projectiles = [];
  s.areas = [];
  s.weapons = [];
  return s;
}

function enemy(s: ReturnType<typeof fresh>, x = 520, y = 400): EnemyV2 {
  const e = spawnEnemy(s, 'armored', x, y, 0);
  e.hp = e.maxHp = 100_000;
  e.armor = 0.5;
  e.speed = e.damage = 0;
  return e;
}

function projectile(overrides: Partial<ProjectileV2> = {}): ProjectileV2 {
  return {
    id: 71,
    weaponId: 'w1',
    kind: 'bolt',
    x: 500,
    y: 400,
    vx: 10,
    vy: 0,
    life: 8,
    maxLife: 10,
    damage: 100,
    radius: 10,
    elements: ['fire'],
    pierce: 0,
    bounces: 0,
    homing: 0,
    split: 0,
    hit: [],
    pulseTimer: 0,
    pulseInterval: 0,
    returning: false,
    originX: 500,
    originY: 400,
    critical: false,
    depth: 0,
    seed: 17,
    previousX: 500,
    previousY: 400,
    ...overrides,
  };
}

function weapon(
  id: string,
  recipeId?: string,
  infusions: WeaponInstance['infusions'] = [],
): WeaponInstance {
  return {
    id,
    kind: recipeId === 'fusion-sanctuary' ? 'fused-sanctuary' : 'bolt',
    cooldown: 0,
    shotCycle: 0,
    lifetimeShots: 0,
    mastery: 0,
    rarity: 'normal',
    infusions,
    angle: 0,
    ...(recipeId
      ? {
          fusion: {
            recipeId,
            createdAt: 0,
            ingredients: [] as unknown as [WeaponInstance, WeaponInstance],
          },
        }
      : {}),
  };
}

function hooks(powers: Record<string, number> = {}) {
  const hits: Array<{ enemy: EnemyV2; event: DamageEvent }> = [];
  const areas: Array<{
    kind: AreaEffect['kind'];
    x: number;
    y: number;
    damage: number;
    radius: number;
    life: number;
    element: string;
    owner: string;
    delay?: number;
    depth?: number;
  }> = [];
  const fragments: Array<{ angle: number; damage: number }> = [];
  const visuals: string[] = [];
  const shields: number[] = [];
  const h: ArsenalHooks = {
    power: (_s, effect) => powers[effect] || 0,
    damage: (_s, target, event) => {
      hits.push({ enemy: target, event: { ...event } });
      target.hp -= event.damage;
      return event.damage;
    },
    area: (_s, kind, x, y, damage, radius, life, element, owner, delay, depth) =>
      areas.push({ kind, x, y, damage, radius, life, element, owner, delay, depth }),
    visual: (_s, kind) => visuals.push(kind),
    fragment: (_s, _p, angle, damage) => fragments.push({ angle, damage }),
    shield: (_s, amount) => shields.push(amount),
  };
  return { h, hits, areas, fragments, visuals, shields };
}

const primary = (rootId: number, weaponId: string, damage = 100): DamageEvent => ({
  rootId,
  source: 'primary',
  depth: 0,
  weaponId,
  damage,
  element: 'fire',
});

describe('expanded arsenal effect hooks', () => {
  it('keeps every effect inert on a recovered run without the explicit arsenal flag', () => {
    const s = fresh();
    delete (s as RunV3).arsenalVersion;
    const e = enemy(s),
      p = projectile({ returning: true, life: 2 });
    s.enemies.push(e);
    const { h, hits, areas, fragments, shields } = hooks(
      Object.fromEntries(
        [
          'projectile-growth',
          'return-pulse',
          'expiry-shards',
          'rebound-charge',
          'absorption-charge',
          'crossfire',
          'armor-erosion',
          'healing-barrier',
          'briar-wounds',
          'control-release',
          'field-resonance',
        ].map((key) => [key, 9]),
      ),
    );

    arsenalProjectile(s, p, 0.5, h);
    arsenalExpiry(s, p, h);
    arsenalBounce(s, p, h);
    arsenalAbsorb(s, 100, h);
    arsenalHealing(s, 100, h);
    arsenalThorns(s, e, 100, h);
    arsenalEnemyTick(s, e, 1, h);
    arsenalControlEnd(s, e, 1, 0, h);
    expect(arsenalDamage(s, e, primary(1, 'w1'), h)).toBe(100);
    expect(arsenalArmor(s, e)).toBe(e.armor);
    expect(arsenalFieldMultiplier(s, e, {} as AreaEffect, h)).toBe(1);
    arsenalMeteor(s, {} as AreaEffect, h);
    arsenalDrone(s, p, h);
    arsenalReflect(s, weapon('w1', 'fusion-reliquary'), 100);
    arsenalPulse(s, weapon('w1', 'fusion-tempest'), 100, 500, h);
    cleanupArsenal(s);

    expect({ hits, areas, fragments, shields }).toEqual({
      hits: [],
      areas: [],
      fragments: [],
      shields: [],
    });
    expect(Object.keys(s.counters).filter((key) => key.startsWith('ars-'))).toEqual([]);
  });

  it('grows traveling projectiles deterministically and respects radius and kind limits', () => {
    const a = fresh(),
      b = fresh();
    const pa = projectile(),
      pb = projectile();
    arsenalProjectile(a, pa, 0.5, hooks({ 'projectile-growth': 0.5 }).h);
    arsenalProjectile(b, pb, 0.5, hooks({ 'projectile-growth': 0.5 }).h);
    expect(pa.radius).toBeGreaterThan(10);
    expect(pa.radius).toBe(pb.radius);

    const capped = projectile({ life: 9.99, radius: 74 });
    arsenalProjectile(a, capped, 0.5, hooks({ 'projectile-growth': 8 }).h);
    expect(capped.radius).toBe(75);
    const stationary = projectile({ kind: 'beam' });
    arsenalProjectile(a, stationary, 1, hooks({ 'projectile-growth': 8 }).h);
    expect(stationary.radius).toBe(10);
  });

  it('turns a natural traveling expiry into three bounded fragments and rejects secondary expiry', () => {
    const s = fresh(),
      p = projectile({ vx: 3, vy: 4 });
    const { h, fragments, visuals } = hooks({ 'expiry-shards': 4 });
    arsenalExpiry(s, p, h);
    expect(fragments).toHaveLength(3);
    expect(fragments.reduce((sum, f) => sum + f.damage, 0)).toBeCloseTo(80);
    expect(fragments.map((f) => f.angle)).toEqual(
      fragments.map((f) => expect.closeTo(Math.atan2(4, 3) + (f.angle - Math.atan2(4, 3)), 10)),
    );
    expect(visuals).toContain('ars-shards');

    fragments.length = 0;
    arsenalExpiry(s, projectile({ depth: 1 }), h);
    arsenalExpiry(s, projectile({ kind: 'beam' }), h);
    expect(fragments).toHaveLength(0);
  });

  it('accumulates bounce charge to its cap while hoarfrost shatter stays a bounded proc', () => {
    const s = fresh(),
      target = enemy(s, 550, 400);
    const p = projectile({ fusionId: 'fusion-hoarfrost' });
    const { h, hits } = hooks({ 'rebound-charge': 0.2 });
    for (let i = 0; i < 8; i++) arsenalBounce(s, p, h);
    expect(p.damage).toBeCloseTo(160);
    expect(hits).toHaveLength(1);
    expect(hits[0].event).toMatchObject({ source: 'proc', depth: 2, element: 'frost', damage: 24 });
    expect(s.counters['ars-bounce-71']).toBeCloseTo(0.6);
    arsenalBounce(s, projectile({ id: 99, depth: 1, fusionId: 'fusion-hoarfrost' }), h);
    expect(hits).toHaveLength(1);
  });

  it('pulses returning projectiles on cooldown within range without recursively pulsing', () => {
    const s = fresh(),
      near = enemy(s, 530, 400),
      far = enemy(s, 700, 400);
    const p = projectile({ returning: true, life: 4, maxLife: 10 });
    const { h, hits } = hooks({ 'return-pulse': 4 });
    arsenalProjectile(s, p, 0.1, h);
    arsenalProjectile(s, p, 0.1, h);
    expect(hits.map((hit) => hit.enemy)).toEqual([near]);
    expect(hits[0].event).toMatchObject({ source: 'proc', depth: 2, damage: 65 });
    s.time += 0.71;
    arsenalProjectile(s, projectile({ depth: 1, returning: true, life: 1 }), 0.1, h);
    expect(hits).toHaveLength(1);
  });

  it('alternates crossfire between equipped cores and caps armor erosion with expiry', () => {
    const s = fresh(),
      target = enemy(s);
    s.weapons = [weapon('w1'), weapon('w2')];
    const { h } = hooks({ crossfire: 2, 'armor-erosion': 0.1 });
    expect(arsenalDamage(s, target, primary(1, 'w1'), h)).toBe(100);
    expect(arsenalDamage(s, target, primary(2, 'w2'), h)).toBe(160);
    expect(arsenalDamage(s, target, { ...primary(3, 'w1'), source: 'proc', depth: 2 }, h)).toBe(
      100,
    );
    for (let i = 0; i < 8; i++) {
      s.time += 0.41;
      arsenalDamage(s, target, primary(10 + i, 'w1'), h);
    }
    expect(s.counters[`ars-erode-${target.id}`]).toBeCloseTo(0.3);
    expect(arsenalArmor(s, target)).toBeCloseTo(0.2);
    s.time += 3.01;
    expect(arsenalArmor(s, target)).toBe(target.armor);
  });

  it('caps absorbed charge, spends one shared reservoir per root and divides multi-infusion bonus', () => {
    const s = fresh(),
      target = enemy(s);
    s.weapons = [weapon('w1', undefined, ['fire', 'frost'])];
    const { h } = hooks({ 'absorption-charge': 5 });
    arsenalAbsorb(s, s.maxHp, h);
    arsenalAbsorb(s, s.maxHp, h);
    expect(s.counters['ars-reservoir']).toBeCloseTo(s.maxHp * 0.25);
    const each = arsenalDamage(s, target, primary(44, 'w1'), h);
    expect(each).toBeCloseTo(100 + (s.maxHp * 0.25 * 0.8) / 2);
    expect(arsenalDamage(s, target, { ...primary(44, 'w1'), element: 'frost' }, h)).toBeCloseTo(
      each,
    );
    expect(s.counters['ars-reservoir']).toBe(0);
    expect(arsenalDamage(s, target, primary(45, 'w1'), h)).toBe(100);
  });

  it('converts only effective healing into bounded shield and sanctuary recovery', () => {
    const s = fresh();
    s.weapons = [weapon('sanctuary', 'fusion-sanctuary')];
    const { h, shields } = hooks({ 'healing-barrier': 4 });
    arsenalHealing(s, 20, h);
    arsenalHealing(s, -5, h);
    s.counters['ars-recovery-sanctuary'] = 75;
    arsenalHealing(s, 20, h);
    expect(shields).toEqual([12, 12]);
    expect(s.counters['ars-recovery-sanctuary']).toBe(80);
  });

  it('stores bounded briar wounds, applies deterministic damage while active, then expires', () => {
    const s = fresh(),
      target = enemy(s);
    const { h, hits } = hooks({ 'briar-wounds': 4 });
    arsenalThorns(s, target, 10, h);
    arsenalThorns(s, target, 100, h);
    expect(s.counters[`ars-wound-${target.id}`]).toBe(80);
    arsenalEnemyTick(s, target, 0.25, h);
    expect(hits[0].event).toMatchObject({ source: 'dot', depth: 2, damage: 20 });
    s.time = 3.01;
    arsenalEnemyTick(s, target, 0.25, h);
    expect(hits).toHaveLength(1);
  });

  it('releases a nearby frost discharge once when control ends, with a per-target cooldown', () => {
    const s = fresh(),
      near = enemy(s, 520, 400),
      far = enemy(s, 700, 400);
    const { h, hits } = hooks({ 'control-release': 200 });
    near.stun = 0;
    arsenalControlEnd(s, near, 1, 0, h);
    arsenalControlEnd(s, near, 1, 0, h);
    expect(hits.map((hit) => hit.enemy)).toEqual([near]);
    expect(hits[0].event).toMatchObject({ source: 'proc', depth: 2, damage: 80, element: 'frost' });
    s.time += 3.01;
    arsenalControlEnd(s, near, 0, 0.2, h);
    expect(hits).toHaveLength(2);
  });

  it('resonates only across distinct active nearby elements and caps its stacked bonus', () => {
    const s = fresh(),
      target = enemy(s);
    const area = (
      element: AreaEffect['element'],
      options: Partial<AreaEffect> = {},
    ): AreaEffect => ({
      id: 1,
      kind: 'fire',
      x: 510,
      y: 400,
      radius: 80,
      life: 2,
      maxLife: 2,
      tickTimer: 0,
      damage: 10,
      element,
      weaponId: 'w1',
      delay: 0,
      depth: 0,
      ...options,
    });
    s.areas = [
      area('fire'),
      area('fire'),
      area('frost'),
      area('void', { delay: 0.1 }),
      area('solar', { life: 0 }),
    ];
    const { h } = hooks({ 'field-resonance': 2 });
    expect(arsenalFieldMultiplier(s, target, area('fire'), h)).toBeCloseTo(1.45);
    expect(arsenalFieldMultiplier(s, target, area('fire'), h)).toBeCloseTo(1.45);
    expect(
      arsenalFieldMultiplier(s, target, area('fire'), hooks({ 'field-resonance': 0.1 }).h),
    ).toBeCloseTo(1.1);
  });

  it('adds only a delayed bounded meteor implosion for the matching fusion', () => {
    const s = fresh();
    s.weapons = [weapon('meteor', 'fusion-impact-well')];
    const impact: AreaEffect = {
      id: 4,
      kind: 'meteor',
      x: 600,
      y: 350,
      radius: 40,
      life: 0.1,
      maxLife: 1,
      tickTimer: 0,
      damage: 50,
      element: 'fire',
      weaponId: 'meteor',
      delay: 0,
      depth: 0,
    };
    const { h, areas } = hooks();
    arsenalMeteor(s, impact, h);
    expect(areas).toEqual([
      {
        kind: 'void',
        x: 600,
        y: 350,
        damage: 4,
        radius: 95,
        life: 1.5,
        element: 'void',
        owner: 'meteor',
        delay: 0.35,
        depth: 1,
      },
    ]);
    areas.length = 0;
    arsenalMeteor(s, { ...impact, depth: 1 }, h);
    expect(areas).toHaveLength(1);
    s.weapons = [weapon('other', 'fusion-tempest')];
    arsenalMeteor(s, { ...impact, weaponId: 'other' }, h);
    expect(areas).toHaveLength(1);
  });

  it('spends sanctuary recovery on up to three nearby carrier targets without recursion', () => {
    const s = fresh();
    const a = enemy(s, 510, 400),
      b = enemy(s, 520, 400),
      c = enemy(s, 530, 400),
      far = enemy(s, 900, 400);
    s.counters['ars-recovery-sanctuary'] = 20;
    const p = projectile({ weaponId: 'sanctuary', kind: 'drone', fusionId: 'fusion-sanctuary' });
    const { h, hits } = hooks();
    arsenalDrone(s, p, h);
    arsenalDrone(s, p, h);
    expect(hits).toHaveLength(3);
    expect(hits.every(({ event }) => event.source === 'proc' && event.depth === 2)).toBe(true);
    expect(hits.reduce((sum, hit) => sum + hit.event.damage, 0)).toBeCloseTo(10);
    expect(hits.map((hit) => hit.enemy)).not.toContain(far);
    expect(s.counters['ars-recovery-sanctuary']).toBe(0);
  });

  it('converts reflected pressure into a capped reliquary bonus and chains tempest pulses once', () => {
    const s = fresh(),
      a = enemy(s, 510, 400),
      b = enemy(s, 560, 400),
      c = enemy(s, 610, 400);
    const reliquary = weapon('mirror', 'fusion-reliquary');
    arsenalReflect(s, reliquary, s.maxHp);
    arsenalReflect(s, reliquary, s.maxHp);
    expect(s.counters['ars-pressure-mirror']).toBeCloseTo(0.6);

    const tempest = weapon('tempest', 'fusion-tempest');
    s.weapons = [tempest];
    const { h, hits } = hooks();
    arsenalPulse(s, tempest, 100, 300, h);
    arsenalPulse(s, tempest, 100, 300, h);
    expect(hits).toHaveLength(3);
    expect(hits.map((hit) => hit.event.damage)).toEqual([12, 12, 12]);
    expect(hits.every((hit) => hit.event.source === 'proc' && hit.event.depth === 2)).toBe(true);
  });

  it('cleans mechanic counters after their target projectile or enemy disappears', () => {
    const s = fresh(),
      e = enemy(s);
    s.counters[`ars-wound-${e.id}`] = 12;
    s.counters['ars-wound-999'] = 12;
    s.counters['ars-bounce-71'] = 0.4;
    s.counters['ars-bounce-999'] = 0.4;
    s.projectiles.push(projectile({ id: 71 }));
    cleanupArsenal(s);
    expect(s.counters[`ars-wound-${e.id}`]).toBe(12);
    expect(s.counters['ars-wound-999']).toBeUndefined();
    expect(s.counters['ars-bounce-71']).toBe(0.4);
    expect(s.counters['ars-bounce-999']).toBeUndefined();
  });
});
