import { describe, expect, it, vi } from 'vitest';
import { defaultProfile } from '../src/legacy/classic/storage';
import { createRun, dealDamage, spawnEnemy, step, TICK } from '../src/game/engine';
import {
  enableDamageNumbers,
  readDamageNumbers,
  recordDamageNumber,
} from '../src/game/damage-feedback';
import {
  DAMAGE_STYLES,
  drawDamageNumbers,
  formatDamage,
  layoutDamageNumbers,
  type NumberView,
} from '../src/render/damage-numbers';
import { emptySave, exportGame, parseGame } from '../src/persistence/storage';
import type { DamageEvent } from '../src/model/arsenal';

const event = (element: DamageEvent['element'] = 'physical', critical = false): DamageEvent => ({
  rootId: 1,
  source: 'primary',
  depth: 0,
  weaponId: 'weapon-1',
  damage: 40,
  element,
  critical,
});
const view: NumberView = {
  time: 0.1,
  motion: true,
  detail: true,
  width: 1280,
  height: 720,
  scale: 0.9,
  offsetX: 190,
  offsetY: 0,
};
const target = { id: 1, x: 500, y: 400 };

function combat() {
  const run = createRun(defaultProfile(), 'bastion', 0, 0, 371);
  run.spawnTimer = run.spawnTotal = 999;
  const enemy = spawnEnemy(run, 'armored', 610, 400, 0);
  enemy.hp = enemy.maxHp = 100000;
  enemy.speed = enemy.damage = enemy.armor = 0;
  return { run, enemy };
}

describe('damage feedback comes from combat outcomes', () => {
  it('shows actual damage after armor and caps overkill at remaining health', () => {
    const { run, enemy } = combat();
    enableDamageNumbers(run, true);
    enemy.armor = 0.5;
    enemy.hp = 12;
    expect(dealDamage(run, enemy, event('fire', true))).toBe(12);
    expect(readDamageNumbers(run)[0]).toMatchObject({
      amount: 12,
      element: 'fire',
      critical: true,
    });
    dealDamage(run, enemy, event('fire'));
    expect(readDamageNumbers(run)).toHaveLength(1);
  });

  it('propagates an actual projectile critical flag through the hit pipeline', () => {
    const { run, enemy } = combat();
    step(run, TICK);
    const shot = run.projectiles[0];
    expect(shot).toBeDefined();
    shot.x = enemy.x;
    shot.y = enemy.y;
    shot.critical = true;
    shot.damage = 42;
    enableDamageNumbers(run, true);
    step(run, TICK);
    expect(readDamageNumbers(run).some((n) => n.critical && n.targetId === enemy.id)).toBe(true);
  });

  it('keeps elemental, normal, critical, tick and retaliation totals separate', () => {
    const host = { time: 0 };
    enableDamageNumbers(host, true);
    for (const element of Object.keys(DAMAGE_STYLES) as DamageEvent['element'][])
      recordDamageNumber(host, target, 10, event(element));
    recordDamageNumber(host, target, 20, event('fire', true));
    recordDamageNumber(host, target, 2, { ...event('fire', true), source: 'dot' });
    recordDamageNumber(host, target, 3, { ...event('fire'), source: 'retaliation' });
    expect(readDamageNumbers(host)).toHaveLength(10);
    expect(readDamageNumbers(host).filter((n) => n.critical)).toHaveLength(1);
    expect(readDamageNumbers(host).find((n) => n.source === 'dot')?.critical).toBe(false);
  });

  it('combines rapid matching hits, expires old labels, and bounds the queue', () => {
    const host = { time: 0 };
    enableDamageNumbers(host, true);
    for (let i = 0; i < 20; i++) recordDamageNumber(host, target, 2, event());
    expect(readDamageNumbers(host)[0]).toMatchObject({ amount: 40, hits: 20 });
    host.time = 0.13;
    recordDamageNumber(host, target, 2, event());
    expect(readDamageNumbers(host)).toHaveLength(2);
    for (let i = 0; i < 1000; i++) recordDamageNumber(host, { ...target, id: i + 2 }, 5, event());
    expect(readDamageNumbers(host)).toHaveLength(96);
    host.time = 2;
    expect(readDamageNumbers(host)).toHaveLength(0);
  });

  it('retains critical bursts under a flood and ignores non-damage values', () => {
    const host = { time: 0 };
    enableDamageNumbers(host, true);
    recordDamageNumber(host, target, 100, event('void', true));
    for (let i = 0; i < 1000; i++) recordDamageNumber(host, { ...target, id: i + 2 }, 1, event());
    expect(readDamageNumbers(host).some((n) => n.critical)).toBe(true);
    const before = readDamageNumbers(host).length;
    for (const amount of [0, -1, NaN, Infinity]) recordDamageNumber(host, target, amount, event());
    expect(readDamageNumbers(host)).toHaveLength(before);
  });

  it('cannot change combat, random state, or saved state when toggled', () => {
    const { run } = combat(),
      other = structuredClone(run);
    enableDamageNumbers(run, true);
    for (let i = 0; i < 180; i++) {
      step(run, TICK);
      step(other, TICK);
    }
    expect(readDamageNumbers(run).length).toBeGreaterThan(0);
    expect(other).toEqual(run);
    enableDamageNumbers(run, false);
    expect(readDamageNumbers(run)).toHaveLength(0);
    enableDamageNumbers(run, true);
    expect(readDamageNumbers(run)).toHaveLength(0);
    const save = emptySave();
    save.run = run;
    save.progression.active = {
      runId: run.id,
      rulesVersion: 3,
      runes: run.runeSnapshot,
      autocast: save.progression.autocast,
    };
    recordDamageNumber(run, target, 12345, event('void', true));
    expect(parseGame(exportGame(save)).run).toEqual(JSON.parse(JSON.stringify(run)));
  });

  it('identifies real burning and poison status ticks independently', () => {
    const { run, enemy } = combat();
    enemy.burn = enemy.poison = 100;
    enableDamageNumbers(run, true);
    for (let i = 0; i < 5; i++) step(run, TICK);
    const ticks = readDamageNumbers(run).filter((n) => n.source === 'dot');
    expect(new Set(ticks.map((n) => n.element))).toEqual(new Set(['fire', 'poison']));
    expect(ticks.every((n) => !n.critical && n.amount > 0)).toBe(true);
  });
});

describe('damage number presentation and saved preference', () => {
  it('gives all seven damage types distinct colors and sigils', () => {
    expect(new Set(Object.values(DAMAGE_STYLES).map((s) => s.color)).size).toBe(7);
    expect(new Set(Object.values(DAMAGE_STYLES).map((s) => s.sigil)).size).toBe(7);
    expect(formatDamage(0.02)).toBe('<0.1');
    expect(formatDamage(8.5)).toBe('8.5');
    expect(formatDamage(1250)).toBe('1.3k');
    expect(formatDamage(2100000)).toBe('2.1m');
  });

  it('uses readable screen-space lanes, bounded density, and stationary reduced motion', () => {
    const host = { time: 0 };
    enableDamageNumbers(host, true);
    for (let i = 0; i < 96; i++)
      recordDamageNumber(host, { ...target, id: i + 1 }, 20, event('frost', i === 0));
    const entries = readDamageNumbers(host);
    expect(layoutDamageNumbers(entries, view).length).toBeLessThanOrEqual(40);
    expect(layoutDamageNumbers(entries, { ...view, detail: false }).length).toBeLessThanOrEqual(24);
    const mobile = layoutDamageNumbers(entries, { ...view, width: 390, scale: 0.39, offsetX: 0 });
    expect(mobile.length).toBeLessThanOrEqual(16);
    expect(mobile.length).toBeGreaterThan(0);
    expect(mobile.every((n) => n.x > 0 && n.x < 390 && n.y > 0 && n.y < 720)).toBe(true);
    expect(new Set(mobile.map((n) => `${n.x},${n.y}`)).size).toBeGreaterThan(1);
    for (let i = 0; i < mobile.length; i++)
      for (let j = i + 1; j < mobile.length; j++) {
        const a = mobile[i],
          b = mobile[j];
        expect(
          Math.abs(a.x - b.x) >= (a.width + b.width) / 2 ||
            Math.abs(a.y - b.y) >= Math.max(a.height, b.height),
        ).toBe(true);
      }
    const a = layoutDamageNumbers(entries.slice(0, 1), { ...view, motion: false, time: 0.1 })[0];
    const b = layoutDamageNumbers(entries.slice(0, 1), { ...view, motion: false, time: 0.5 })[0];
    expect([a.x, a.y, a.pop]).toEqual([b.x, b.y, 1]);
    expect(layoutDamageNumbers(entries, { ...view, time: 2 })).toHaveLength(0);
  });

  it('paints critical labels and type-specific shapes without screen flashes', () => {
    const host = { time: 0 };
    enableDamageNumbers(host, true);
    for (const [i, element] of (Object.keys(DAMAGE_STYLES) as DamageEvent['element'][]).entries())
      recordDamageNumber(host, { id: i, x: 100 + i * 110, y: 300 }, 42, event(element, true));
    const text = vi.fn(),
      ellipse = vi.fn(),
      curve = vi.fn();
    const noop = () => {};
    const context = {
      save: noop,
      restore: noop,
      translate: noop,
      scale: noop,
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      closePath: noop,
      stroke: noop,
      strokeText: noop,
      fillText: text,
      measureText: () => ({ width: 30 }),
      arc: noop,
      ellipse,
      bezierCurveTo: curve,
      fillRect: noop,
    } as unknown as CanvasRenderingContext2D;
    drawDamageNumbers(context, readDamageNumbers(host), view);
    expect(text.mock.calls.filter(([t]) => t === 'CRIT')).toHaveLength(7);
    expect(ellipse).toHaveBeenCalled();
    expect(curve).toHaveBeenCalled();
  });

  it('preserves the off preference and safely defaults existing saves to on', () => {
    const save = emptySave();
    expect(save.settings.damageNumbers).toBe(true);
    save.settings.damageNumbers = false;
    expect(parseGame(exportGame(save)).settings.damageNumbers).toBe(false);
    const old = JSON.parse(exportGame(save));
    delete old.settings.damageNumbers;
    expect(parseGame(JSON.stringify(old)).settings.damageNumbers).toBe(true);
    for (const invalid of ['yes', null, 1]) {
      old.settings.damageNumbers = invalid;
      expect(() => parseGame(JSON.stringify(old))).toThrow();
    }
  });
});
