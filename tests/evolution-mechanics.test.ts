import { describe, expect, it } from 'vitest';
import { EVOLUTION_PATHS, EVOLUTION_BY_ID } from '../src/content/evolutions';
import {
  acquireCard,
  advanceMastery,
  createRun,
  dealDamage,
  fuseCores,
  getDefenseStats,
  getWeaponStats,
  previewCard,
  previewFusion,
  spawnEnemy,
  step,
  takeDamage,
  TICK,
  useSkill,
} from '../src/game/engine';
import {
  chooseEvolution,
  evolutionBonuses,
  evolutionMilestones,
  evolutionOwner,
  evolutionState,
  queueEvolution,
} from '../src/game/evolution';
import { emptySave, exportGame, parseGame } from '../src/persistence/storage';
import type { EvolutionPathId } from '../src/model/evolution';
import type { RunV3 } from '../src/game/types';
import { nextRunDecision } from '../src/game/fusion-offers';
import { defaultAutocastConfig, tickAutocast } from '../src/game/controls';
import { enableDamageNumbers, readDamageNumbers } from '../src/game/damage-feedback';

function game(id: EvolutionPathId, tier = 0, mode: 'quick' | 'normal' | 'endless' = 'normal') {
  const s = createRun(emptySave().profile, EVOLUTION_BY_ID[id].tower, 0, 0, 8831, { mode });
  s.spawned = s.spawnTotal = 999;
  s.spawnTimer = 999;
  for (let i = 0; i < tier; i++) advance(s, id);
  return s;
}
function advance(s: RunV3, id: EvolutionPathId) {
  const wave = evolutionMilestones(s)[s.evolution!.tier];
  s.wave = wave + 1;
  queueEvolution(s, wave);
  expect(chooseEvolution(s, id)).toBe(true);
}
function foe(s: RunV3, x = 610, y = 400) {
  const e = spawnEnemy(s, 'armored', x, y, 0);
  e.hp = e.maxHp = 1e6;
  e.armor = 0;
  e.speed = 0;
  e.attackCd = 999;
  return e;
}
function hit(s: RunV3, e: ReturnType<typeof foe>, damage = 100, root = s.nextId++) {
  return dealDamage(s, e, {
    rootId: root,
    weaponId: s.weapons[0].id,
    source: s.tower === 'monolith' ? 'retaliation' : 'primary',
    depth: s.tower === 'monolith' ? 1 : 0,
    damage,
    element: 'physical',
    partCount: 1,
    coreKind: s.tower === 'monolith' ? 'core-mirror' : undefined,
  });
}
function pick(s: RunV3, cardId: string, target?: string) {
  expect(acquireCard(s, { id: cardId, cardId, rarity: 'normal', price: 0 }, target)).toBe(true);
}

describe('tower evolution milestones and lineage', () => {
  it.each(['normal', 'quick', 'endless'] as const)(
    'queues free, ordered decisions and freezes %s combat',
    (mode) => {
      const s = game('citadel', 0, mode);
      s.enemies = [];
      s.wave = evolutionMilestones(s)[0];
      s.waveTime = 18;
      step(s);
      expect(s.evolution!.pending).toBe(1);
      expect(s.wave).toBe(evolutionMilestones(s)[0] + 1);
      const time = s.time;
      step(s);
      expect(s.time).toBe(time);
      expect(useSkill(s, 'signature')).toBe(false);
      // Milestone shops precede evolution; neither decision can be skipped by hiding a window.
      s.pendingRewards = [];
      expect(nextRunDecision(s)).toBe('evolution');
      expect(chooseEvolution(s, 'furnace')).toBe(false);
      expect(chooseEvolution(s, 'citadel')).toBe(true);
      expect(chooseEvolution(s, 'vanguard')).toBe(false);
      expect(chooseEvolution(s, 'citadel')).toBe(false);
      for (let tier = 2; tier <= 3; tier++) advance(s, 'citadel');
      expect(s.evolution!.tier).toBe(3);
      queueEvolution(s, 999);
      expect(s.evolution!.pending).toBe(0);
    },
  );
  it.each(EVOLUTION_PATHS.flatMap((path) => [1, 2, 3].map((tier) => ({ path, tier }))))(
    '$path.id tier $tier adds a real cumulative change',
    ({ path, tier }) => {
      const s = game(path.id, tier - 1),
        before = { weapon: getWeaponStats(s, s.weapons[0]), defense: getDefenseStats(s) };
      advance(s, path.id);
      expect({ weapon: getWeaponStats(s, s.weapons[0]), defense: getDefenseStats(s) }).not.toEqual(
        before,
      );
      expect(s.evolution!.path).toBe(path.id);
      expect(s.evolution!.tier).toBe(tier);
      expect(path.tiers).toHaveLength(3);
    },
  );
  it('keeps evolution on only the original fused component and restores a lost core only once', () => {
    const s = game('citadel', 1),
      starter = s.weapons[0];
    pick(s, 'weapon-rail');
    for (const w of s.weapons) advanceMastery(w, 900);
    const before = getWeaponStats(s, starter).damage;
    expect(
      previewFusion(s, 'fusion-lance', starter.id, s.weapons[1].id)!.inherited.join(' '),
    ).toContain('lineage');
    expect(fuseCores(s, 'fusion-lance', starter.id, s.weapons[1].id)).toBe(true);
    expect(evolutionOwner(s)!.id).toBe(s.weapons[0].id);
    const withEvolution = getWeaponStats(s, s.weapons[0]).damage;
    const old = structuredClone(s);
    delete old.evolution;
    expect(withEvolution / getWeaponStats(old, old.weapons[0]).damage).toBeGreaterThan(1);
    expect(withEvolution / getWeaponStats(old, old.weapons[0]).damage).toBeLessThan(1.08);
    pick(s, 'weapon-bolt');
    expect(s.evolution!.coreId).toBe(starter.id);
    for (const id of ['weapon-beam', 'weapon-orbit', 'weapon-mine', 'weapon-swarm']) pick(s, id);
    const fused = s.weapons.find((w) => w.fusion)!;
    const offer = {
      id: 'replacement',
      cardId: 'weapon-tesla',
      rarity: 'normal' as const,
      price: 0,
    };
    expect(previewCard(s, offer, fused.id).lost.join(' ')).toContain('core-specific evolution');
    expect(acquireCard(s, offer, fused.id)).toBe(true);
    // A previously reacquired original is now the only valid lineage.
    expect(evolutionOwner(s)?.kind).toBe('bolt');
    expect(s.evolution!.coreId).not.toBe(starter.id);
    expect(before).toBeGreaterThan(0);
  });
  it('preserves absent evolution and old combat on recovered runs', () => {
    const s = createRun(emptySave().profile, 'bastion', 0, 0, 1, { evolutionVersion: 0 });
    s.wave = 25;
    s.waveTime = 18;
    s.spawned = s.spawnTotal;
    s.enemies = [];
    step(s);
    expect(evolutionState(s)).toBeUndefined();
    expect(chooseEvolution(s, 'citadel')).toBe(false);
    expect(s.wave).toBe(26);
  });
});

describe('evolution combat identities use bounded real simulation hooks', () => {
  it('finishes the shield and marked-target branches without multiplying charge through infusions', () => {
    const citadel = game('citadel', 3),
      a = foe(citadel);
    citadel.shield = 1;
    expect(hit(citadel, a)).toBeCloseTo(110);
    const vanguard = game('vanguard', 3),
      b = foe(vanguard);
    expect(hit(vanguard, b)).toBeCloseTo(146.4);
    expect(b.mark).toBe(4);
  });
  it('empowers Furnace fields and bounds Stormweaver completion links', () => {
    const furnace = game('furnace', 3),
      a = foe(furnace);
    furnace.weapons[0].cooldown = 999;
    furnace.areas.push({
      id: furnace.nextId++,
      kind: 'fire',
      x: a.x,
      y: a.y,
      radius: 60,
      life: 2,
      maxLife: 2,
      tickTimer: 0,
      damage: 40,
      element: 'fire',
      weaponId: 'field',
      delay: 0,
      depth: 1,
    });
    step(furnace);
    expect(a.maxHp - a.hp).toBeCloseTo(50);
    const storm = game('stormweaver', 3),
      b = foe(storm),
      c = foe(storm, 650);
    hit(storm, b, 100);
    expect(c.maxHp - c.hp).toBeCloseTo(24);
    hit(storm, b, 100);
    expect(c.maxHp - c.hp).toBeCloseTo(24);
  });
  it('retaliates on Winterhold absorption without reducing stronger existing control', () => {
    const s = game('winterhold', 3),
      e = foe(s, 550);
    s.shield = 100;
    e.chill = 0.75;
    takeDamage(s, 50);
    expect(s.damageByWeapon['evolution-winterhold']).toBeCloseTo(20);
    hit(s, e, 10);
    expect(e.chill).toBeGreaterThanOrEqual(0.75);
  });
  it('shatters a released target before it can attack and never reapplies control', () => {
    const s = game('shatterspire', 3),
      e = foe(s, 530);
    s.weapons[0].cooldown = 999;
    e.hp = 1;
    e.stun = 0.01;
    e.attackCd = 0;
    e.damage = 20;
    const hp = s.hp;
    step(s);
    expect(s.kills).toBe(1);
    expect(s.hp).toBe(hp);
    expect(e.stun).toBe(0);
  });
  it('requires effective Rootwarden healing and shares the bramble cooldown', () => {
    const s = game('rootwarden', 3);
    foe(s, 550);
    s.weapons[0].cooldown = 999;
    step(s);
    expect(s.damageByWeapon['evolution-rootwarden']).toBeUndefined();
    s.hp -= 1;
    step(s);
    expect(s.damageByWeapon['evolution-rootwarden']).toBeCloseTo(20);
    step(s);
    expect(s.damageByWeapon['evolution-rootwarden']).toBeCloseTo(20);
  });
  it('uses the last full lineage hit for poison-death blooms and prohibits secondary death chains', () => {
    const s = game('blightbloom', 3),
      a = foe(s),
      b = foe(s, 640);
    hit(s, a, 100);
    a.poison = 10;
    a.hp = 0.1;
    dealDamage(s, a, {
      rootId: s.nextId++,
      source: 'dot',
      depth: 2,
      weaponId: 'poison',
      damage: 0.2,
      element: 'poison',
    });
    expect(s.damageByWeapon['evolution-blightbloom']).toBeCloseTo(20);
    s.time = 1;
    b.hp = 1;
    b.poison = 10;
    foe(s, 660);
    dealDamage(s, b, {
      rootId: s.nextId++,
      source: 'proc',
      depth: 2,
      weaponId: 'child',
      damage: 100,
      element: 'poison',
    });
    expect(s.damageByWeapon['evolution-blightbloom']).toBeCloseTo(20);
  });
  it('contains nearby threats with boss resistance and rewards Rift Engine isolation', () => {
    const s = game('event-horizon', 3),
      a = foe(s, 550),
      b = foe(s, 600),
      boss = foe(s, 620);
    boss.kind = 'boss';
    hit(s, a);
    expect(b.x).toBe(590);
    expect(boss.x).toBe(617);
    const rift = game('rift-engine', 3),
      target = foe(rift);
    expect(hit(rift, target)).toBe(125);
    foe(rift, 630);
    expect(hit(rift, target)).toBe(100);
    expect(getDefenseStats(rift).mitigation.physical).toBeLessThan(
      getDefenseStats(game('event-horizon', 0)).mitigation.physical,
    );
  });
  it('spends Ironbriar absorption on one bounded barb and excludes non-mirror fused retaliation', () => {
    const s = game('ironbriar', 3),
      e = foe(s, 610);
    s.shield = 100;
    takeDamage(s, 100);
    hit(s, e);
    expect(s.counters['evo-charge']).toBe(0);
    expect(s.damageByWeapon['evolution-ironbriar']).toBeCloseTo(65);
    hit(s, e);
    expect(s.damageByWeapon['evolution-ironbriar']).toBeCloseTo(65);
    s.time = 2;
    dealDamage(s, e, {
      rootId: s.nextId++,
      source: 'retaliation',
      depth: 1,
      coreKind: 'core-gravitic',
      partCount: 1,
      weaponId: s.weapons[0].id,
      damage: 100,
      element: 'void',
    });
    expect(s.damageByWeapon['evolution-ironbriar']).toBeCloseTo(65);
  });
  it.each(EVOLUTION_PATHS)(
    '$id develops its signature through the same autocast skill pipeline',
    (path) => {
      const s = game(path.id, 2);
      s.hp = s.maxHp * 0.5;
      s.shield = 0;
      foe(s, 560);
      foe(s, 590);
      s.counters['evo-heat'] = 10;
      const rules = defaultAutocastConfig();
      rules.signature.enabled = true;
      const result = tickAutocast(s, rules);
      expect(result.signature).toBe(true);
      expect(s.skillCd).toBeGreaterThan(0);
      expect(s.stats.skillsUsed).toBe(1);
      if (['citadel', 'winterhold', 'mirror-regent'].includes(path.id))
        expect(s.shield).toBeGreaterThan(s.maxHp * 0.3);
      if (['furnace', 'blightbloom', 'event-horizon'].includes(path.id))
        expect(s.areas.some((a) => a.weaponId === `evolution-${path.id}`)).toBe(true);
      if (path.id === 'rootwarden') expect(s.hp).toBeGreaterThan(s.maxHp * 0.75);
      if (
        [
          'vanguard',
          'crownflare',
          'stormweaver',
          'shatterspire',
          'rift-engine',
          'ironbriar',
        ].includes(path.id)
      )
        expect(Object.keys(s.damageByWeapon)).toContain(`evolution-${path.id}`);
      if (path.id === 'thunderhead') expect(s.enemies.every((e) => e.mark >= 4)).toBe(true);
      expect(useSkill(s, 'signature')).toBe(false);
    },
  );
  it('shares a field trigger across infusions and uses the original projectile emission allocation', () => {
    const s = game('furnace', 1),
      e = foe(s),
      w = s.weapons[0];
    w.infusions = ['fire', 'frost'];
    const root = s.nextId++;
    for (const element of w.infusions)
      dealDamage(s, e, {
        rootId: root,
        partCount: 2,
        weaponId: w.id,
        source: 'primary',
        depth: 0,
        damage: 50,
        element,
      });
    expect(s.areas).toHaveLength(1);
    expect(s.areas[0].damage).toBeCloseTo(12);
    s.time += 2;
    s.areas = [];
    // A one-part shot already in flight does not double because the core now has two infusions.
    dealDamage(s, e, {
      rootId: s.nextId++,
      partCount: 1,
      weaponId: w.id,
      source: 'primary',
      depth: 0,
      damage: 100,
      element: 'physical',
    });
    expect(s.areas[0].damage).toBeCloseTo(12);
  });
  it('consumes absorbed charge once and does not copy it through later field ticks', () => {
    const s = game('citadel', 1),
      e = foe(s);
    s.shield = 100;
    takeDamage(s, 100);
    const charge = s.counters['evo-charge'];
    expect(charge).toBeGreaterThan(0);
    expect(hit(s, e, 100)).toBeCloseTo(120);
    expect(s.counters['evo-charge']).toBe(0);
    expect(hit(s, e, 100)).toBeCloseTo(100);
  });
  it('caps heat and consumes it as one empowered multi-part hit', () => {
    const s = game('crownflare', 3),
      e = foe(s);
    s.weapons[0].infusions = [];
    for (let i = 0; i < 10; i++) hit(s, e, 100);
    expect(s.counters['evo-heat']).toBe(10);
    expect(hit(s, e, 100)).toBe(140);
    expect(s.counters['evo-heat']).toBe(0);
  });
  it('never records negative damage or duplicate kills when a charged side strike kills its root target', () => {
    const s = game('thunderhead', 1),
      e = foe(s);
    e.hp = 1;
    s.counters['evo-hits'] = 4;
    hit(s, e, 100);
    expect(e.hp).toBeLessThanOrEqual(0);
    expect(s.kills).toBe(1);
    expect(Object.values(s.damageByWeapon).every((n) => n >= 0)).toBe(true);
  });
  it('rewards chilled targets and gives completed Thunderhead strikes their boss bonus', () => {
    const shatter = game('shatterspire', 1),
      a = foe(shatter);
    a.chill = 0.2;
    expect(hit(shatter, a)).toBeCloseTo(115);
    const thunder = game('thunderhead', 3),
      boss = foe(thunder);
    boss.kind = 'boss';
    expect(hit(thunder, boss)).toBeCloseTo(120);
  });
  it('shows deterministic fifth-reflection critical feedback without consuming RNG', () => {
    const s = game('mirror-regent', 3),
      e = foe(s);
    s.weapons[0].infusions = [];
    enableDamageNumbers(s, true);
    const rng = s.rng;
    for (let i = 0; i < 5; i++) hit(s, e, 100);
    expect(readDamageNumbers(s).some((n) => n.critical)).toBe(true);
    expect(s.rng).toBe(rng);
  });
  it('shares the Mirror Regent branch cooldown across rapid roots and all infusions', () => {
    const s = game('mirror-regent', 1),
      a = foe(s),
      b = foe(s, 650);
    s.weapons[0].infusions = [];
    hit(s, a, 100);
    expect(b.maxHp - b.hp).toBe(20);
    s.time = 1;
    hit(s, a, 100);
    expect(b.maxHp - b.hp).toBe(20);
    s.time = 1.21;
    hit(s, a, 100);
    expect(b.maxHp - b.hp).toBe(40);
  });
  it('keeps pending decisions and core provenance across validated save/resume', () => {
    const s = game('ironbriar', 1);
    s.wave = 51;
    queueEvolution(s, 50);
    const save = emptySave();
    save.run = s;
    save.progression.active = {
      runId: s.id,
      rulesVersion: 3,
      runes: s.runeSnapshot,
      autocast: save.progression.autocast,
    };
    const restored = parseGame(exportGame(save)).run as RunV3;
    expect(restored.evolution).toEqual(s.evolution);
    expect(chooseEvolution(restored, 'mirror-regent')).toBe(false);
    expect(chooseEvolution(restored, 'ironbriar')).toBe(true);
    expect(evolutionBonuses(restored).coreDamage).toBeGreaterThan(0);
    const before = structuredClone(restored);
    step(restored, TICK);
    step(before, TICK);
    expect(restored).toEqual(before);
  });
});
