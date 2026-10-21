import { describe, expect, it } from 'vitest';
import {
  createRun,
  spawnEncounter,
  spawnEnemy,
  step,
  TICK,
  getDefenseStats,
  acquireCard,
} from '../src/game/engine';
import { getBossThreat } from '../src/game/boss-threat';
import {
  stepEncounter,
  encounterValue,
  interruptEncounter,
  ENCOUNTER_WINDUP_SECONDS,
} from '../src/game/encounters';
import { FINAL_BOSSES, ENEMY_BY_ID } from '../src/content/enemies';
import { emptySave, exportGame, parseGame } from '../src/persistence/storage';
import { snapshotFromSave, saveFromSnapshot } from '../src/account/snapshot';

function ready(stage = 0) {
  const save = emptySave();
  const s = createRun(save.profile, 'bastion', stage, 0, 937);
  s.wave = 25;
  s.time = 10;
  s.spawned = s.spawnTotal;
  const e = spawnEncounter(s, FINAL_BOSSES[stage], 650, 400);
  e.attackCd = 0;
  const hits: number[] = [];
  const actions = {
    hurt: (amount: number) => {
      hits.push(amount);
    },
    summon: () => {},
  };
  return { save, s, e, hits, actions };
}

describe('read-only boss strike forecasts', () => {
  it.each([0, 1, 2])('matches actual stage %i phase damage and Eclipse follow-up', (stage) => {
    for (const phase of [0, 1, 2]) {
      const { s, e, hits, actions } = ready(stage);
      e.hp = e.maxHp * [1, 0.6, 0.3][phase];
      e.bossPhase = phase;
      stepEncounter(s, e, TICK, actions);
      const forecast = getBossThreat(s)!;
      const duration = ENCOUNTER_WINDUP_SECONDS[ENEMY_BY_ID[FINAL_BOSSES[stage]].mechanic];
      expect(forecast.status).toBe('strike');
      expect(forecast.phase).toBe(phase + 1);
      expect(forecast.impacts[0].seconds).toBeCloseTo(duration);
      s.time = encounterValue(s, e, 'windup');
      stepEncounter(s, e, TICK, actions);
      const factor = 1 - getDefenseStats(s).mitigation[e.damageType];
      expect(forecast.impacts[0].damage).toBeCloseTo(hits[0] * factor);
      expect(forecast.impacts).toHaveLength(stage === 2 ? 2 : 1);
      if (stage === 2) {
        expect(forecast.impacts[1].seconds - forecast.impacts[0].seconds).toBeCloseTo(0.8);
        const followup = getBossThreat(s)!;
        expect(followup.status).toBe('follow-up');
        expect(followup.impacts).toHaveLength(1);
        s.time = encounterValue(s, e, 'echo');
        stepEncounter(s, e, TICK, actions);
        expect(forecast.impacts[1].damage).toBeCloseTo(hits[1] * factor);
        expect(followup.impacts[0].damage).toBeCloseTo(hits[1] * factor);
      }
    }
  });

  it('uses current elemental mitigation and shields, including a lethal combined burst', () => {
    const { s, e, actions } = ready(2);
    e.damageType = 'fire';
    acquireCard(s, {
      cardId: 'def-fire-shield',
      id: 'synthetic-shield',
      rarity: 'normal',
      price: 0,
    });
    stepEncounter(s, e, TICK, actions);
    const threat = getBossThreat(s)!;
    expect(threat.damage).toBeCloseTo(e.damage * 1.3 * (1 - getDefenseStats(s).mitigation.fire));
    s.shield = threat.damage - 2;
    s.hp = 1;
    const lethal = getBossThreat(s)!;
    expect(lethal.hpDamage).toBeCloseTo(2);
    expect(lethal.lethal).toBe(true);
    s.shield = threat.damage + 1;
    expect(getBossThreat(s)).toMatchObject({ hpDamage: 0, lethal: false });
  });

  it('shows preparation before the charge, respects recovery, and clears interrupted casts', () => {
    const { s, e, actions } = ready();
    e.attackCd = 2;
    s.counters[`enc-${e.id}-recovery`] = s.time + 3;
    expect(getBossThreat(s)!.impacts[0].seconds).toBeCloseTo(4.3);
    expect(getBossThreat(s)!.status).toBe('preparing');
    e.attackCd = 0;
    delete s.counters[`enc-${e.id}-recovery`];
    stepEncounter(s, e, TICK, actions);
    e.stun = 1;
    expect(getBossThreat(s)!.impacts).toHaveLength(0);
    interruptEncounter(s, e);
    e.stun = 0;
    expect(getBossThreat(s)!.status).toBe('preparing');
    e.x = 1100;
    expect(getBossThreat(s)!.status).toBe('approaching');
    expect(getBossThreat(s)!.impacts).toHaveLength(0);
    e.hp = 0;
    expect(getBossThreat(s)).toBeNull();
    expect(getBossThreat(null)).toBeNull();
  });

  it('matches a recovered XP boss strike without applying current encounter rules', () => {
    const s = createRun(emptySave().profile, 'bastion', 0, 0, 937, { encounterVersion: 1 });
    s.weapons = [];
    s.wave = 75;
    s.waveTime = 50;
    s.spawned = s.spawnTotal;
    const boss = spawnEnemy(s, 'boss', 650, 400);
    boss.attackCd = 0;
    step(s);
    const threat = getBossThreat(s)!;
    expect(threat.name).toBe('Boss');
    expect(threat.impacts).toHaveLength(1);
    for (let i = 0; i < 70 && s.stats.damageTaken === 0; i++) step(s);
    expect(s.stats.damageTaken).toBeCloseTo(threat.hpDamage, 5);
  });

  it('leaves simulation, RNG, save/resume and cloud checkpoints unchanged', () => {
    const { save, s } = ready(2);
    const control = structuredClone(s);
    for (let i = 0; i < 180; i++) {
      step(s);
      step(control);
      getBossThreat(s);
      expect(s).toEqual(control);
    }
    save.run = s;
    save.progression.active = {
      runId: s.id,
      rulesVersion: 3,
      runes: s.runeSnapshot,
      autocast: save.progression.autocast,
    };
    const original = exportGame(save);
    getBossThreat(s);
    expect(exportGame(save)).toBe(original);
    const local = parseGame(original);
    const cloud = saveFromSnapshot(snapshotFromSave(save), save.settings);
    expect(getBossThreat(local.run as typeof s)).toEqual(getBossThreat(s));
    expect(getBossThreat(cloud.run as typeof s)).toEqual(getBossThreat(s));
  });
});
