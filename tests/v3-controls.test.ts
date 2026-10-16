import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../src/storage';
import { acquireCard, createRun, getWeaponStats, spawnEnemy, step, TICK } from '../src/v2/engine';
import {
  defaultAutocastConfig,
  defaultRuneLoadout,
  evaluateAutocast,
  getRecentDps,
  getTowerStats,
  normalizeAutocastConfig,
  normalizeRuneLoadout,
  recordDamageSample,
  runePrice,
  snapshotRunes,
  tickAutocast,
} from '../src/v3/controls';

const fresh = () => {
  const s = createRun(defaultProfile(), 'bastion', 0, 0, 1283);
  s.spawnTotal = s.spawnTimer = 999;
  return s;
};
describe('selectable permanent runes', () => {
  it('preserves legacy ownership and separates freely lowered selections', () => {
    const loadout = normalizeRuneLoadout(
      { owned: { power: 1, experience: 50 }, selected: { power: 0, experience: 50 } },
      { power: 4, vitality: 2, fortune: 0 },
    );
    expect(loadout.owned.power).toBe(4);
    expect(loadout.selected.power).toBe(0);
    expect(loadout.selected.experience).toBe(10);
    expect(loadout.selected.vitality).toBe(2);
    const snapshot = snapshotRunes(loadout);
    loadout.selected.experience = 0;
    expect(snapshot.experience).toBe(10);
  });
  it('allows all historically purchased levels to be selected without rebuying', () => {
    const runes = defaultRuneLoadout({ power: 0, vitality: 10, fortune: 0 });
    runes.selected.vitality = 3;
    expect(snapshotRunes(runes).vitality).toBe(3);
    runes.selected.vitality = 10;
    expect(snapshotRunes(runes).vitality).toBe(10);
    expect(runes.owned.vitality).toBe(10);
  });
  it('rejects malformed levels by safe normalization and preserves prices/caps', () => {
    const loadout = normalizeRuneLoadout({
      owned: { power: NaN, choices: 2, autoSignature: 3 },
      selected: { choices: -2, autoSignature: Infinity },
    });
    expect(loadout.owned.power).toBe(0);
    expect(loadout.owned.autoSignature).toBe(1);
    expect(loadout.selected.choices).toBe(0);
    expect(runePrice('power', 5)).toBe(250);
    expect(runePrice('experience', 10)).toBe(500);
    expect(runePrice('choices', 2)).toBe(500);
    expect(runePrice('autoSecondary', 1)).toBe(150);
    expect(runePrice('power', 6)).toBe(Infinity);
    expect(defaultRuneLoadout().selected.power).toBe(0);
  });
});
describe('fixed-tick conditional autocast', () => {
  it('defaults disabled and normalizes bounded conditions without shared arrays', () => {
    const config = normalizeAutocastConfig({
      signature: {
        enabled: true,
        preset: 'advanced',
        match: 'any',
        conditions: [
          { kind: 'nearby', value: 999, radius: 1 },
          { kind: 'health', value: -5 },
          { kind: 'unknown' },
        ],
      },
    });
    expect(config.signature.conditions).toEqual([
      { kind: 'nearby', value: 96, radius: 50 },
      { kind: 'health', value: 0 },
    ]);
    expect(config.secondary.enabled).toBe(false);
    config.signature.conditions.push({ kind: 'boss', value: 1 });
    expect(config.secondary.conditions).toEqual([]);
  });
  it('avoids wasting repair or barrier skills without useful work', () => {
    const s = fresh(),
      config = defaultAutocastConfig();
    config.signature.enabled = config.secondary.enabled = true;
    expect(evaluateAutocast(s, config)).toEqual({ signature: false, secondary: false });
    s.hp -= 10;
    expect(tickAutocast(s, config)).toEqual({ signature: false, secondary: true });
    expect(s.hp).toBe(s.maxHp);
    expect(s.stats.skillsUsed).toBe(1);
    expect(tickAutocast(s, config).secondary).toBe(false);
    spawnEnemy(s, 'runner', 600, 400, 0);
    expect(tickAutocast(s, config).signature).toBe(true);
    expect(s.shield).toBeGreaterThan(0);
    s.skillCd = 0;
    expect(tickAutocast(s, config).signature).toBe(false);
  });
  it('supports boss and emergency presets and ignores dead bosses', () => {
    const s = fresh(),
      config = defaultAutocastConfig();
    config.secondary = { enabled: true, preset: 'boss', match: 'all', conditions: [] };
    s.secondary = 'nova';
    const enemy = spawnEnemy(s, 'boss', 600, 400, 0);
    expect(evaluateAutocast(s, config).secondary).toBe(true);
    enemy.hp = 0;
    expect(evaluateAutocast(s, config).secondary).toBe(false);
    config.secondary.preset = 'emergency';
    s.secondary = 'repair';
    s.hp = s.maxHp * 0.35;
    expect(evaluateAutocast(s, config).secondary).toBe(true);
    s.hp = s.maxHp * 0.36;
    expect(evaluateAutocast(s, config).secondary).toBe(false);
  });
  it('applies ALL/ANY rules using threshold directions, radius and boss absence', () => {
    const s = fresh(),
      config = defaultAutocastConfig();
    s.hp = s.maxHp / 2;
    spawnEnemy(s, 'runner', 600, 400, 0);
    spawnEnemy(s, 'runner', 900, 400, 0);
    config.secondary = {
      enabled: true,
      preset: 'advanced',
      match: 'all',
      conditions: [
        { kind: 'health', value: 50 },
        { kind: 'nearby', value: 2, radius: 150 },
        { kind: 'boss', value: 0 },
      ],
    };
    expect(evaluateAutocast(s, config).secondary).toBe(false);
    config.secondary.match = 'any';
    expect(evaluateAutocast(s, config).secondary).toBe(true);
    config.secondary.match = 'all';
    config.secondary.conditions[1].value = 1;
    expect(evaluateAutocast(s, config).secondary).toBe(true);
    config.secondary.conditions = [];
    expect(evaluateAutocast(s, config).secondary).toBe(false);
  });
  it('does not cast outside combat and remains idle until caller advances a tick', () => {
    const s = fresh(),
      config = defaultAutocastConfig();
    config.secondary.enabled = true;
    s.hp -= 30;
    const snapshot = JSON.stringify(s);
    evaluateAutocast(s, config);
    expect(JSON.stringify(s)).toBe(snapshot);
    s.phase = 'victory';
    expect(tickAutocast(s, config).secondary).toBe(false);
    s.phase = 'combat';
    step(s, TICK);
    tickAutocast(s, config);
    expect(s.secondaryCd).toBeGreaterThan(0);
    expect(s.stats.skillsUsed).toBe(1);
  });
  it('rechecks usefulness after first skill so simultaneous healing does not double-cast', () => {
    const s = fresh(),
      config = defaultAutocastConfig();
    s.tower = 'verdant';
    s.hp = s.maxHp - 1;
    config.signature.enabled = config.secondary.enabled = true;
    expect(tickAutocast(s, config)).toEqual({ signature: true, secondary: false });
  });
});
describe('effective stats and measured combat DPS', () => {
  it('reports engine-equivalent capacities, mitigation and weapon properties', () => {
    const s = fresh();
    acquireCard(s, { id: 'regen', cardId: 'def-regen', rarity: 'normal', price: 0 });
    acquireCard(s, { id: 'mirror', cardId: 'def-reflect', rarity: 'normal', price: 0 });
    const stats = getTowerStats(s);
    expect(stats.healthRegen).toBeGreaterThan(0);
    expect(stats.mitigation.physical).toBeCloseTo(0.1);
    expect(stats.maxShield).toBe(s.maxHp * 0.45);
    expect(stats.reflectMultiplier).toBeGreaterThan(0);
    expect(stats.equipment[0]).toEqual({
      id: s.weapons[0].id,
      kind: s.weapons[0].kind,
      ...getWeaponStats(s, s.weapons[0]),
    });
    expect(stats.recentDps).toBe(0);
  });
  it('uses damage deltas over ten combat seconds and no paused wall time', () => {
    const s = fresh();
    recordDamageSample(s);
    for (let second = 1; second <= 20; second++) {
      s.time = second;
      s.damageByWeapon.bolt = second <= 10 ? second * 100 : 1000;
      recordDamageSample(s);
      if (second === 10) expect(getRecentDps(s)).toBe(100);
      if (second === 15) expect(getRecentDps(s)).toBe(50);
    }
    expect(getRecentDps(s)).toBe(0);
    expect(getTowerStats(s).runAverageDps).toBe(50);
    recordDamageSample(s);
    recordDamageSample(s);
    expect(getRecentDps(s)).toBe(0);
  });
  it('starts a fresh measurement window on resume without inventing historical DPS', () => {
    const s = fresh();
    s.time = 100;
    s.damageByWeapon.bolt = 10000;
    recordDamageSample(s);
    expect(getRecentDps(s)).toBe(0);
    s.time = 101;
    s.damageByWeapon.bolt += 40;
    recordDamageSample(s);
    expect(getRecentDps(s)).toBe(40);
    s.time = 0;
    s.damageByWeapon.bolt = 0;
    recordDamageSample(s);
    expect(getRecentDps(s)).toBe(0);
  });
});
