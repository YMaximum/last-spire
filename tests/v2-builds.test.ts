import { describe, it, expect } from 'vitest';
import { defaultProfile } from '../src/legacy/classic/storage';
import {
  createRun,
  acquireCard,
  getWeaponStats,
  step,
  spawnEnemy,
  takeDamage,
  dealDamage,
  TICK,
  previewCard,
  useSkill,
  chooseReward,
  buyOffer,
  rerollReward,
  repair,
} from '../src/legacy/runeforged/engine';
import type { RunV2 } from '../src/model/arsenal';
const fresh = () => {
  const s = createRun(defaultProfile(), 'bastion', 0, 0, 129);
  s.spawnTotal = 999;
  s.spawnTimer = 999;
  return s;
};
function grant(s: RunV2, id: string, n = 1) {
  for (let i = 0; i < n; i++)
    expect(
      acquireCard(
        s,
        { id: `pick-${id}-${i}`, cardId: id, price: 0, rarity: 'normal' },
        s.weapons[0].id,
      ),
    ).toBe(true);
}
const dummy = (s: RunV2, x = 700, y = 400) => {
  const e = spawnEnemy(s, 'armored', x, y, 0);
  e.hp = e.maxHp = 100000;
  e.damage = 0;
  e.speed = 0;
  return e;
};
describe('v2 combined builds and siege regressions', () => {
  it('makes giant traveling pulse cores larger and slower while damaging off-path enemies', () => {
    const s = fresh();
    grant(s, 'mod-size', 12);
    grant(s, 'mod-pulse');
    const stats = getWeaponStats(s, s.weapons[0]);
    expect(stats.size).toBeGreaterThan(20);
    expect(stats.speed).toBeLessThan(150);
    expect(stats.pulse).toBeGreaterThan(0);
    dummy(s);
    const off = dummy(s, 700, 444);
    for (let i = 0; i < 180; i++) step(s);
    expect(off.hp).toBeLessThan(off.maxHp);
    expect(s.synergies).toContain('great-resonance');
    expect(s.notices.join(' ')).toContain('Great Resonance');
  });
  it('stacks kill-driven attack boosts then returns to normal after expiry', () => {
    const s = fresh();
    grant(s, 'on-kill-haste');
    grant(s, 'on-kill-fury');
    const initial = getWeaponStats(s, s.weapons[0]);
    for (let i = 0; i < 4; i++) {
      const e = dummy(s, 520, 400);
      dealDamage(s, e, {
        rootId: i,
        source: 'primary',
        depth: 0,
        weaponId: s.weapons[0].id,
        damage: 1e9,
        element: 'physical',
      });
    }
    const boosted = getWeaponStats(s, s.weapons[0]);
    expect(boosted.cooldown).toBeLessThan(initial.cooldown);
    expect(boosted.damage).toBeGreaterThan(initial.damage);
    s.time = 5;
    step(s);
    expect(getWeaponStats(s, s.weapons[0]).cooldown).toBe(initial.cooldown);
  });
  it('combines solar reflection and frost shield-break offense without recursive retaliation', () => {
    const s = fresh();
    grant(s, 'infusion-solar');
    grant(s, 'def-reflect');
    grant(s, 'def-shield-break');
    grant(s, 'on-hurt-freeze');
    const e = dummy(s, 540, 400);
    s.shield = 1;
    takeDamage(s, 50, 'fire', e);
    expect(s.damageByElement.solar).toBeGreaterThan(0);
    expect(s.damageByElement.frost).toBeGreaterThan(0);
    expect(e.stun).toBeGreaterThan(0);
    expect(s.stats.procCount).toBe(0);
    expect(s.visuals.some((v) => v.kind === 'reflect')).toBe(true);
  });
  it('telegraphs meteors, strikes, and keeps a damaging ground field after impact', () => {
    const s = fresh();
    s.weapons[0].kind = 'meteor';
    const e = dummy(s, 600, 400);
    step(s);
    expect(s.areas[0].delay).toBeGreaterThan(0);
    expect(e.hp).toBe(e.maxHp);
    for (let i = 0; i < 35; i++) step(s);
    const hit = e.hp;
    expect(hit).toBeLessThan(e.maxHp);
    expect(s.areas.some((a) => a.kind === 'fire')).toBe(true);
    for (let i = 0; i < 35; i++) step(s);
    expect(e.hp).toBeLessThan(hit);
  });
  it('gives Legendary cores pierce and Mythic cores traveling pulses without changing their family', () => {
    const s = fresh();
    const w = s.weapons[0];
    w.rarity = 'legendary';
    expect(getWeaponStats(s, w).pierce).toBe(1);
    w.rarity = 'mythic';
    expect(getWeaponStats(s, w).pulse).toBeGreaterThan(0);
    expect(w.kind).toBe('bolt');
  });
  it('previews actual projectile deltas and names synergistic awakenings before acquisition', () => {
    const s = fresh();
    grant(s, 'mod-size');
    const p = previewCard(s, { id: 'preview', cardId: 'mod-pulse', price: 0, rarity: 'rare' });
    expect(p.summary).toContain('Pulse');
    expect(p.awaken).toContain('Great Resonance');
    expect(s.cards.some((c) => c.cardId === 'mod-pulse')).toBe(false);
  });
  it('advances support formations into reach during a prolonged short-range siege', () => {
    const s = fresh();
    s.waveTime = 60;
    const e = spawnEnemy(s, 'support', 785, 400, 0);
    e.hp = e.maxHp = 1e8;
    const x = e.x;
    for (let i = 0; i < 60; i++) step(s);
    expect(e.x).toBeLessThan(x - 20);
  });
  it('forces an ending to a stalled siege instead of granting infinite regeneration', () => {
    const s = fresh();
    s.waveTime = 400;
    s.hp = 100;
    dummy(s, 900, 400);
    step(s);
    expect(s.phase).toBe('ended');
    expect(s.stats.damageTaken).toBeGreaterThanOrEqual(100);
  });
  it('bounds simultaneous enemies independently of presentation', () => {
    const s = fresh();
    for (let i = 0; i < 200; i++) spawnEnemy(s, 'swarmer', 800, 400, 0);
    expect(s.enemies).toHaveLength(96);
  });
  it('reproduces exact combat at one-, two-, and three-tick frame groupings', () => {
    const original = fresh();
    dummy(original);
    const a = structuredClone(original),
      b = structuredClone(original),
      c = structuredClone(original);
    for (let i = 0; i < 300; i++) step(a, TICK);
    for (let i = 0; i < 150; i++) step(b, TICK * 2);
    for (let i = 0; i < 100; i++) step(c, TICK * 3);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
  });
});

it('keeps drone constructs in orbit while they fire independent bolts', () => {
  const s = fresh();
  grant(s, 'weapon-drone');
  const w = s.weapons.find((w) => w.kind === 'drone')!;
  dummy(s);
  for (let i = 0; i < 150; i++) step(s);
  expect(s.projectiles.filter((p) => p.kind === 'drone' && p.weaponId === w.id)).toHaveLength(3);
  expect(s.projectiles.filter((p) => p.kind === 'drone').every((p) => p.life > 6)).toBe(true);
  expect(s.damageByWeapon[w.id]).toBeGreaterThan(0);
});
it('applies chosen frost infusion to meteor impacts and their lingering fields', () => {
  const s = fresh();
  s.weapons[0].kind = 'meteor';
  grant(s, 'infusion-frost');
  const e = dummy(s, 600, 400);
  for (let i = 0; i < 45; i++) step(s);
  expect(s.damageByElement.frost).toBeGreaterThan(0);
  expect(e.chill).toBeGreaterThan(0);
});
it('empowers the selected secondary card while retaining all cast enhancements', () => {
  const s = fresh();
  grant(s, 'skill-healing-field');
  s.hp = 10;
  const copy = structuredClone(s);
  useSkill(s, 'signature');
  copy.secondary = 'skill-healing-field';
  useSkill(copy, 'secondary');
  expect(copy.hp - 10).toBeCloseTo((s.hp - 10) * 1.5);
});

it('retains a living boss heal budget across timed counter cleanup, then releases it after death', () => {
  const s = fresh();
  s.time = 100;
  s.wave = 50;
  s.maxHp = s.hp = 10000;
  s.weapons[0].cooldown = 1000;
  const boss = spawnEnemy(s, 'boss', 750, 400, 0);
  boss.hp = 50000;
  boss.maxHp = 100000;
  boss.speed = 0;
  boss.damage = 0;
  boss.attackCd = 0;
  const key = `boss-heals-${boss.id}`;
  s.counters[key] = 3;
  for (let i = 0; i < 500; i++) step(s);
  expect(s.counters[key]).toBe(3);
  expect(boss.hp).toBe(50000);
  boss.hp = 0;
  s.counters.cleanup = 0;
  step(s);
  expect(s.counters[key]).toBeUndefined();
});

it('rejects queued draft and shop mutations after defeat or at the extraction screen', () => {
  for (const phase of ['ended', 'victory'] as const) {
    const s = fresh();
    s.phase = phase;
    s.hp = 1;
    s.scrap = 100;
    s.pendingRewards = [
      {
        id: 'draft-ended',
        kind: 'draft',
        wave: 2,
        rerolls: 0,
        repairStock: 0,
        offers: [{ id: 'draft-offer', cardId: 'mod-size', price: 0, rarity: 'normal' }],
      },
      {
        id: 'shop-ended',
        kind: 'shop',
        wave: 10,
        rerolls: 0,
        repairStock: 1,
        offers: [{ id: 'shop-offer', cardId: 'mod-count', price: 42, rarity: 'normal' }],
      },
    ];
    const before = JSON.stringify(s);
    expect(chooseReward(s, 'draft-ended', 'draft-offer')).toBe(false);
    expect(buyOffer(s, 'shop-ended', 'shop-offer')).toBe(false);
    expect(rerollReward(s, 'draft-ended')).toBe(false);
    expect(repair(s, 'shop-ended')).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  }
});
