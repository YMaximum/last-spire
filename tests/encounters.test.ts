import { historicalCheckpoint } from './historical-checkpoint';
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import {
  ENEMIES,
  ENEMY_BY_ID,
  STAGE_EXCLUSIVES,
  FINAL_BOSSES,
  enemyStats,
  enemyDamageType,
  nextEncounter,
  waveRoster,
  isEncounterBoss,
} from '../src/content/enemies';
import type { EnemyArchetypeId } from '../src/content/enemies';
import {
  createRun,
  spawnEncounter,
  spawnEnemy,
  step,
  TICK,
  dealDamage,
  retire,
  hasEncounters,
} from '../src/game/engine';
import {
  encounterDamage,
  encounterRetaliation,
  encounterValue,
  interruptEncounter,
  stepEncounter,
  cleanEncounterCounters,
} from '../src/game/encounters';
import {
  emptySave,
  parseGame,
  exportGame,
  settleInMemory,
  saveGame,
  loadGame,
  readLegacyBackup,
} from '../src/persistence/storage';
import { snapshotFromSave, saveFromSnapshot } from '../src/account/snapshot';
import type { RunV3, EnemyV2 } from '../src/game/types';
const fresh = (stage = 0, mode: 'normal' | 'quick' | 'endless' = 'normal') =>
  createRun(emptySave().profile, 'bastion', stage, 0, 721, { mode });
function fixture(id: EnemyArchetypeId) {
  const s = fresh(ENEMY_BY_ID[id].stage ?? 0);
  s.wave = 100;
  s.spawned = s.spawnTotal;
  s.spawnTimer = 9999;
  const e = spawnEncounter(s, id, 650, 400);
  e.attackCd = 0;
  const hits: number[] = [],
    summons: EnemyArchetypeId[] = [];
  const actions = {
    hurt: (damage: number) => hits.push(damage),
    summon: (id: EnemyArchetypeId) => {
      summons.push(id);
    },
  };
  const tick = (dt = 0.05) => {
    s.time += dt;
    stepEncounter(s, e, dt, actions);
  };
  const cast = () => {
    e.attackCd = 0;
    tick();
    tick(2);
  };
  return { s, e, hits, summons, actions, tick, cast };
}
const checkpoint = (run: RunV3) => {
  const save = emptySave();
  save.run = run;
  save.progression.active = {
    runId: run.id,
    rulesVersion: 3,
    runes: run.runeSnapshot,
    autocast: save.progression.autocast,
  };
  return save;
};
const hit = (s: RunV3, source: 'primary' | 'dot' | 'retaliation' = 'primary') => ({
  rootId: s.nextId++,
  depth: 0,
  weaponId: s.weapons[0].id,
  damage: 10,
  element: 'physical' as const,
  source,
});

describe('stage encounter catalog and formation contracts', () => {
  it('contains nine exclusive enemies and three distinct final bosses, with immediate counterplay and no immunity', () => {
    expect(ENEMIES).toHaveLength(20);
    expect(new Set(STAGE_EXCLUSIVES.flat()).size).toBe(9);
    expect(new Set(FINAL_BOSSES).size).toBe(3);
    for (const [stage, ids] of STAGE_EXCLUSIVES.entries())
      for (const id of [...ids, FINAL_BOSSES[stage]]) {
        const d = ENEMY_BY_ID[id];
        expect(d.stage).toBe(stage);
        expect(d.attack.length).toBeGreaterThan(10);
        expect(d.telegraph.length).toBeGreaterThan(10);
        expect(d.weakness.length).toBeGreaterThan(10);
        for (const resistance of Object.values(d.resistance ?? {}))
          expect(resistance).toBeLessThanOrEqual(0.2);
      }
  });
  it.each(ENEMIES.map((d) => d.id))(
    '%s has finite scaled stats and valid new-run spawning',
    (id) => {
      for (const mode of ['normal', 'quick', 'endless'] as const)
        for (const wave of [1, 25, 100, 250]) {
          const context = { stage: ENEMY_BY_ID[id].stage ?? 0, wave, difficulty: 5, mode };
          for (const value of Object.values(enemyStats(id, context)))
            expect(Number.isFinite(value)).toBe(true);
          const s = fresh(context.stage, mode);
          s.wave = wave;
          const e = spawnEncounter(s, id);
          expect(e.kind).toBe(ENEMY_BY_ID[id].role);
          expect(e.damageType).toBe(enemyDamageType(id, context));
          expect(['physical', 'fire', 'frost', 'lightning', 'poison', 'solar', 'void']).toContain(
            e.damageType,
          );
          expect(e.hp).toBeGreaterThan(0);
          expect(s.discoveries?.[id]?.encountered).toBe(1);
        }
    },
  );
  it('increases stage pressure, uses exclusive rosters, and replaces elite overlaps with bosses', () => {
    const ctx = { wave: 20, difficulty: 0, mode: 'normal' as const };
    expect(enemyStats('swarmer', { ...ctx, stage: 2 }).hp).toBeGreaterThan(
      enemyStats('swarmer', { ...ctx, stage: 1 }).hp,
    );
    expect(enemyStats('swarmer', { ...ctx, stage: 1 }).damage).toBeGreaterThan(
      enemyStats('swarmer', { ...ctx, stage: 0 }).damage,
    );
    for (let stage = 0; stage < 3; stage++)
      for (const mode of ['normal', 'quick'] as const) {
        const endpoint = mode === 'quick' ? 50 : 100,
          roster = waveRoster({ ...ctx, stage, mode, wave: endpoint });
        expect(roster[0]).toBe(FINAL_BOSSES[stage]);
        expect(roster).not.toContain('elite');
        expect(waveRoster({ ...ctx, stage, mode, wave: 1 })).toEqual(['swarmer']);
        for (const id of waveRoster({ ...ctx, stage, mode, wave: 10 }))
          expect(ENEMY_BY_ID[id].stage ?? stage).toBe(stage);
        expect(isEncounterBoss({ ...ctx, stage, mode, wave: 25 })).toBe(true);
      }
  });
  it('keeps legacy runs on their original encounters and deterministically resumes current formations', () => {
    const a = fresh(1),
      b = structuredClone(a);
    a.wave = b.wave = 14;
    for (let i = 0; i < 30; i++) {
      a.spawned = b.spawned = i;
      expect(spawnEnemy(a)).toEqual(spawnEnemy(b));
    }
    const old = createRun(emptySave().profile, 'bastion', 1, 0, 721, {
      encounterVersion: 1,
      evolutionVersion: 0,
    });
    expect(hasEncounters(old)).toBe(false);
    expect(spawnEnemy(old).archetypeId).toBeUndefined();
    expect(() => spawnEncounter(old, 'plated-crawler')).toThrow('original encounters');
  });
});

describe('exclusive attacks, defenses and bounded control', () => {
  it('retaliates on primary hits only, with a shared per-enemy cooldown and no recursion', () => {
    const { s, e, hits, actions } = fixture('thorn-retaliator');
    for (const source of ['dot', 'retaliation'] as const)
      encounterRetaliation(s, e, hit(s, source), 10, actions);
    expect(hits).toHaveLength(0);
    encounterRetaliation(s, e, hit(s), 10, actions);
    encounterRetaliation(s, e, hit(s), 10, actions);
    expect(hits).toHaveLength(1);
    s.time += 1.4;
    encounterRetaliation(s, e, hit(s), 10, actions);
    expect(hits).toHaveLength(2);
    e.hp = 0;
    s.time += 2;
    encounterRetaliation(s, e, hit(s), 10, actions);
    expect(hits).toHaveLength(2);
  });
  it('heals at most three nearby allies per cast, caps lifetime casts, and exposes the shepherd', () => {
    const { s, e, cast } = fixture('spore-shepherd');
    const allies = Array.from({ length: 4 }, () => spawnEnemy(s, 'swarmer', 660, 400));
    allies.forEach((a) => (a.hp = a.maxHp / 2));
    cast();
    expect(allies.filter((a) => a.hp > a.maxHp / 2)).toHaveLength(3);
    expect(encounterDamage(s, e, 100, 'physical')).toBe(125);
    for (let i = 0; i < 12; i++) cast();
    expect(encounterValue(s, e, 'casts')).toBe(6);
  });
  it('grants non-stacking shields that absorb damage and expire after six seconds', () => {
    const { s, e, cast } = fixture('forge-carrier');
    const ally = spawnEnemy(s, 'swarmer', 660, 400);
    cast();
    expect(encounterDamage(s, ally, 1, 'physical')).toBe(0);
    expect(encounterValue(s, ally, 'barrier')).toBeCloseTo(ally.maxHp * 0.15 - 1);
    s.time += 7;
    expect(encounterDamage(s, ally, 100, 'physical')).toBe(100);
    for (let i = 0; i < 10; i++) cast();
    expect(encounterValue(s, e, 'casts')).toBe(3);
  });
  it.each(['burrower', 'rift-skirmisher'] as const)(
    '%s warns before displacement and can be interrupted',
    (id) => {
      const { s, e, tick } = fixture(id);
      e.x = 800;
      tick();
      expect(encounterValue(s, e, 'windup')).toBeGreaterThan(s.time);
      const before = e.x;
      interruptEncounter(s, e);
      tick(0.1);
      expect(e.x).toBeLessThan(before);
      expect(encounterValue(s, e, 'windup')).toBe(0);
      e.attackCd = 0;
      tick();
      const target = encounterValue(s, e, 'aim-x');
      tick(2);
      expect(e.x).toBeCloseTo(target);
      expect(encounterDamage(s, e, 100, 'physical')).toBeCloseTo(id === 'burrower' ? 125 : 120);
    },
  );
  it('cycles crawler armor without elemental immunity', () => {
    const { s, e, tick } = fixture('plated-crawler');
    s.time = 5 - e.id * 0.17;
    tick(0.01);
    expect(e.armor).toBe(0.45);
    tick(3.1);
    expect(e.armor).toBe(0.05);
    expect(encounterDamage(s, e, 100, 'lightning')).toBeCloseTo(110);
  });
  it('overheats artillery after two telegraphed shots and permits stun interruption', () => {
    const { s, e, cast, hits, tick } = fixture('furnace-artillery');
    cast();
    expect(hits).toHaveLength(1);
    cast();
    expect(hits).toHaveLength(2);
    expect(encounterValue(s, e, 'recovery')).toBeGreaterThan(s.time);
    expect(encounterDamage(s, e, 100, 'physical')).toBe(135);
    s.time += 3;
    e.attackCd = 0;
    tick();
    interruptEncounter(s, e);
    tick(2);
    expect(hits).toHaveLength(2);
  });
  it('limits coordinated caster damage to three casts per six-second window', () => {
    const { s, e, actions, hits } = fixture('pulse-caster');
    const actors = [
      e,
      ...Array.from({ length: 7 }, () => spawnEncounter(s, 'pulse-caster', 650, 400)),
    ];
    for (const actor of actors) {
      actor.attackCd = 0;
      stepEncounter(s, actor, 0.05, actions);
    }
    s.time += 1.2;
    for (const actor of actors) stepEncounter(s, actor, 0.05, actions);
    expect(hits).toHaveLength(3);
  });
  it('creates exactly one delayed echo, canceled by interruption', () => {
    const { s, e, cast, hits, tick } = fixture('echo-attacker');
    cast();
    expect(hits).toHaveLength(1);
    tick(1.5);
    expect(hits).toHaveLength(2);
    tick(0.5);
    expect(hits).toHaveLength(2);
    cast();
    interruptEncounter(s, e);
    tick(1.5);
    expect(hits).toHaveLength(3);
  });
  it.each(FINAL_BOSSES)('%s has bounded phases, recovery and summons', (id) => {
    const { s, e, tick, cast, summons, hits } = fixture(id);
    expect(enemyStats(id, s).control).toBe(0.35);
    e.hp = e.maxHp * 0.65;
    tick();
    e.hp = e.maxHp * 0.3;
    tick();
    expect(summons).toHaveLength(4);
    for (let i = 0; i < 8; i++) {
      e.hp = e.maxHp;
      tick();
      e.hp = e.maxHp * 0.2;
      tick();
    }
    expect(summons).toHaveLength(4);
    cast();
    if (id === 'last-eclipse') tick(0.9);
    expect(hits.length).toBeGreaterThan(0);
    expect(encounterDamage(s, e, 100, 'physical')).toBeGreaterThan(100);
    if (id === 'forge-colossus') {
      tick(0.01);
      expect(e.armor).toBe(0.05);
    }
    if (id === 'elder-root') {
      for (let i = 0; i < 12; i++) {
        s.time += 3;
        cast();
      }
      expect(encounterValue(s, e, 'heals')).toBe(6);
    }
  });
  it('does not farm bounty or XP from phase summons and cleans dead actor counters', () => {
    const s = fresh(1);
    s.wave = 100;
    const boss = spawnEncounter(s, 'forge-colossus', 650, 400);
    boss.hp = boss.maxHp * 0.6;
    s.spawned = s.spawnTotal;
    step(s);
    const adds = s.enemies.filter((e) => e.id !== boss.id);
    expect(adds).toHaveLength(2);
    for (const add of adds) {
      expect(add.bounty).toBe(0);
      expect(add.xpBudget).toBe(0);
    }
    const e = adds[0];
    s.counters[`enc-${e.id}-windup`] = 10;
    e.hp = 0;
    cleanEncounterCounters(s);
    expect(s.counters[`enc-${e.id}-windup`]).toBeUndefined();
  });
});

describe('encounter save compatibility and discovery settlement', () => {
  it('roundtrips warnings, RNG and discoveries locally and through cloud validation', () => {
    const { s, e, tick } = fixture('echo-attacker');
    tick();
    const save = checkpoint(s);
    const restored = parseGame(exportGame(save));
    expect(restored).toEqual(save);
    expect(saveFromSnapshot(snapshotFromSave(save), save.settings)).toEqual(save);
    const resumed = restored.run as RunV3;
    for (let i = 0; i < 80; i++) {
      step(s);
      step(resumed);
    }
    expect(resumed).toEqual(s);
    expect(e.archetypeId).toBe('echo-attacker');
  });
  it('records encounters and defeats once across interrupted/duplicate settlement', async () => {
    const s = fresh();
    const e = spawnEncounter(s, 'thorn-retaliator', 600, 400);
    e.hp = 1;
    e.armor = 0;
    dealDamage(s, e, { ...hit(s), damage: 100 });
    expect(s.discoveries?.['thorn-retaliator']).toEqual({ encountered: 1, defeated: 1 });
    step(s);
    retire(s);
    let save = settleInMemory(checkpoint(s));
    save = settleInMemory(save);
    expect(save.progression.bestiary['thorn-retaliator']).toEqual({ encountered: 1, defeated: 1 });
    await saveGame(save);
    expect((await loadGame()).progression.bestiary).toEqual(save.progression.bestiary);
  });
  it('migrates schema four without changing its active rules and makes a write-once backup', async () => {
    const run = createRun(emptySave().profile, 'bastion', 0, 0, 7, {
      encounterVersion: 1,
      evolutionVersion: 0,
    });
    const save = checkpoint(run);
    const old = JSON.parse(exportGame(save));
    historicalCheckpoint(old);
    old.version = 4;
    delete old.progression.bestiary;
    const migrated = parseGame(old);
    expect(migrated.version).toBe(8);
    expect(migrated.progression.bestiary).toEqual({});
    expect(migrated.run).toEqual(run);
    // Seed only an isolated account scope so this test cannot touch another profile.
    const scope = 'account:00000000-0000-4000-8000-000000000095' as const;
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('last-spire', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('save');
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('save', 'readwrite');
      tx.objectStore('save').put(old, scope);
      tx.oncomplete = () => resolve();
    });
    db.close();
    await loadGame(scope);
    expect(await readLegacyBackup(scope)).not.toBeNull();
  });
  it('rejects unknown content, wrong-stage actors, malformed discovery counts and future formats', () => {
    const s = fresh();
    spawnEncounter(s, 'thorn-retaliator');
    const base = JSON.parse(exportGame(checkpoint(s)));
    const bads = [
      (x: any) => (x.run.enemies[0].archetypeId = 'unknown'),
      (x: any) => (x.run.enemies[0].archetypeId = 'plated-crawler'),
      (x: any) => (x.run.encounterVersion = 3),
      (x: any) => (x.progression.bestiary = { swarmer: { encountered: 1, defeated: 2 } }),
      (x: any) => (x.progression.bestiary = { unknown: { encountered: 1, defeated: 0 } }),
      (x: any) => (x.version = 9),
    ];
    for (const mutate of bads) {
      const x = structuredClone(base);
      mutate(x);
      expect(() => parseGame(x)).toThrow();
    }
  });
});

describe('essential encounter rendering and prolonged-fight safety', () => {
  it('bounds shared keeper healing in current rules without changing the old handler', () => {
    const s = fresh();
    s.hp = s.maxHp = 1e7;
    s.weapons[0].cooldown = 9999;
    s.spawned = s.spawnTotal;
    const keeper = spawnEnemy(s, 'support', 650, 400, 0);
    const ally = spawnEnemy(s, 'armored', 660, 400, 0);
    ally.hp = ally.maxHp / 10;
    for (let i = 0; i < 4500; i++) step(s);
    expect(s.counters[`enc-${keeper.id}-shared-heals`]).toBe(6);
    expect(s.phase).toBe('combat');
  });
  it('rejects cross-stage spawning and respects the simultaneous entity bound', () => {
    const s = fresh();
    expect(() => spawnEncounter(s, 'forge-carrier')).toThrow('another stage');
    for (let i = 0; i < 110; i++) spawnEncounter(s, 'thorn-retaliator');
    expect(s.enemies).toHaveLength(96);
    expect(s.discoveries?.['thorn-retaliator']?.encountered).toBe(96);
  });
});

// The warning pass is deliberately independent of decorative settings.
import { drawEncounterWarnings } from '../src/render/encounters';
it('renders persisted casts, echoes, bars and shared-actor barriers without changing simulation state', () => {
  for (const id of [...STAGE_EXCLUSIVES.flat(), ...FINAL_BOSSES, 'swarmer'] as EnemyArchetypeId[]) {
    const { s, e } = fixture(id);
    s.counters[`enc-${e.id}-windup`] = s.time + 1;
    s.counters[`enc-${e.id}-echo`] = s.time + 2;
    s.counters[`enc-${e.id}-barrier-until`] = s.time + 3;
    s.counters[`enc-${e.id}-barrier`] = 100;
    const before = JSON.stringify(s),
      calls: string[] = [];
    const pen = new Proxy(
      {},
      {
        get:
          (_, name) =>
          (..._args: unknown[]) => {
            calls.push(String(name));
          },
        set: () => true,
      },
    ) as CanvasRenderingContext2D;
    drawEncounterWarnings(pen, s, e);
    expect(calls).toContain('stroke');
    expect(calls).toContain('lineTo');
    expect(JSON.stringify(s)).toBe(before);
  }
});

import { SimulationClock } from '../src/game/clock';
it.each([0, 1, 2])(
  'keeps stage %s encounter outcomes identical across frame rates, speeds and open-tab catch-up',
  (stage) => {
    const base = fresh(stage);
    base.hp = base.maxHp = 100000;
    base.wave = 100;
    base.spawned = base.spawnTotal;
    base.weapons[0].cooldown = 999;
    for (const id of [...STAGE_EXCLUSIVES[stage], FINAL_BOSSES[stage]])
      spawnEncounter(base, id, 650, 400);
    const reference = structuredClone(base);
    for (let i = 0; i < 900; i++) step(reference);
    for (const [fps, speed, background] of [
      [30, 1, false],
      [60, 2, false],
      [90, 3, false],
      [1, 3, true],
    ] as const) {
      const run = structuredClone(base),
        clock = new SimulationClock(TICK, 2000, 1e9, () => 0);
      const work = { speed, background, canStep: () => true, step: () => step(run) };
      clock.advance(0, work);
      for (let frame = 1; frame <= (30 * fps) / speed; frame++)
        clock.advance((frame * 1000) / fps, work);
      expect(run).toEqual(reference);
    }
  },
);

it('previews the next formation and finite/endless final-wave boundary', () => {
  const context = { stage: 1, wave: 24, difficulty: 0, mode: 'normal' as const };
  expect(nextEncounter(context)).toMatchObject({
    wave: 25,
    roster: [
      'guardian',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    ],
  });
  expect(nextEncounter({ ...context, wave: 99 }).roster[0]).toBe('forge-colossus');
  expect(nextEncounter({ ...context, wave: 100 }).wave).toBe(100);
  expect(nextEncounter({ ...context, wave: 100, endless: true }).wave).toBe(101);
  expect(nextEncounter({ ...context, wave: 49, mode: 'quick' }).roster[0]).toBe('forge-colossus');
});

it.each(FINAL_BOSSES)('%s resolves both crossed reinforcement thresholds once', (id) => {
  const { s, e, tick, summons } = fixture(id);
  e.hp = e.maxHp * 0.2;
  tick();
  expect(e.bossPhase).toBe(2);
  expect(summons).toHaveLength(4);
  e.hp = e.maxHp * 0.8;
  tick();
  e.hp = e.maxHp * 0.2;
  tick();
  expect(summons).toHaveLength(4);
  expect(encounterValue(s, e, 'summons')).toBe(4);
});
