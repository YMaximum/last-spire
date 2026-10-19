import { describe, expect, it } from 'vitest';
import { RECIPES, SYNERGIES } from '../src/content/world';
import {
  activeSynergies,
  applyUpgrade,
  buyUpgrade,
  continueRun,
  createRun,
  makeChoices,
  perks,
  random,
  reroll,
  retire,
  selectDraft,
  shopChoices,
  step,
  syncSynergies,
  TICK,
  useSkill,
} from '../src/legacy/classic/engine';
import { defaultProfile } from '../src/legacy/classic/storage';
import type { Attack, Element, Enemy, RunState, Upgrade } from '../src/model/shared';

const run = (seed = 1729) => createRun(defaultProfile(), 'bastion', 0, 0, seed);
function target(id = 900, x = 650, y = 400): Enemy {
  return {
    id,
    kind: 'armored',
    x,
    y,
    hp: 100000,
    maxHp: 100000,
    speed: 0,
    damage: 0,
    radius: 13,
    armor: 0,
    attackCd: 1000,
    burn: 0,
    poison: 0,
    chill: 0,
    mark: 0,
    stun: 0,
    vx: 0,
    vy: 0,
    reward: 2,
  };
}
function sandbox(): RunState {
  const s = run();
  s.spawned = s.spawnTotal = 1;
  s.enemies = [target()];
  s.nextId = 1000;
  return s;
}
function attack(element: Element = 'solar'): Attack {
  return { pattern: 'beam', element, modifier: 'echo', rank: 1, cooldown: 0, shots: 0 };
}
function upgrade(kind: Upgrade['kind'], value: string, slot = 0): Upgrade {
  return {
    id: `${kind}-${slot}-${value}`,
    kind,
    value,
    slot,
    name: value,
    description: 'test upgrade',
    color: '#ffffff',
    price: 40,
  };
}
const snapshot = (s: RunState) => JSON.stringify({ ...s, id: 'deterministic-id' });
const simulate = (s: RunState, ticks: number) => {
  for (let i = 0; i < ticks; i++) step(s);
};

describe('deterministic fixed-tick combat', () => {
  it('replays seeded RNG, spawns, projectile collisions, statuses and choices identically', () => {
    const a = run(914),
      b = run(914);
    a.attacks[0] = { ...attack('lightning'), pattern: 'volley', modifier: 'rupture' };
    b.attacks = structuredClone(a.attacks);
    for (let i = 0; i < 3600; i++) {
      for (const s of [a, b]) {
        if (s.phase === 'draft') selectDraft(s, 0);
        if (s.phase === 'shop') continueRun(s);
        if (i % 90 === 0) useSkill(s, 'signature');
        step(s);
      }
      if (a.phase === 'ended') break;
    }
    expect(a.kills).toBeGreaterThan(0);
    expect(a.damageByElement.lightning).toBeGreaterThan(0);
    expect(snapshot(a)).toBe(snapshot(b));
    const other = run(915);
    expect(Array.from({ length: 20 }, () => random(a))).not.toEqual(
      Array.from({ length: 20 }, () => random(other)),
    );
  });
  it('keeps speed1/2/3 equivalent when the presentation schedules the same fixed ticks', () => {
    const states = [run(42), run(42), run(42)];
    for (let speed = 1; speed <= 3; speed++)
      for (let frame = 0; frame < 1800 / speed; frame++)
        for (let n = 0; n < speed; n++) step(states[speed - 1], TICK);
    expect(snapshot(states[0])).toBe(snapshot(states[1]));
    expect(snapshot(states[1])).toBe(snapshot(states[2]));
  });
  it('preserves the spawn queue when the enemy cap is full', () => {
    const s = sandbox();
    s.attacks = [];
    s.spawned = 0;
    s.spawnTotal = 5;
    s.spawnTimer = 0;
    s.enemies = Array.from({ length: 220 }, (_, i) => target(2000 + i));
    step(s);
    expect(s.spawned).toBe(0);
    expect(s.enemies.length).toBe(220);
    s.enemies.pop();
    s.spawnTimer = 0;
    step(s);
    expect(s.spawned).toBe(1);
    expect(s.enemies.length).toBe(220);
  });
  it.each(['orbit', 'pulse', 'mine'] as const)(
    '%s reaches a ranged enemy holding at255 units',
    (pattern) => {
      const s = sandbox();
      s.attacks = [{ ...attack('solar'), pattern }];
      s.enemies[0].kind = 'ranged';
      s.enemies[0].x = 755;
      simulate(s, 180);
      expect(s.damageByElement.solar).toBeGreaterThan(0);
    },
  );
  it('does not advance combat while drafting, settled, or after ending', () => {
    const s = sandbox();
    s.phase = 'draft';
    const before = snapshot(s);
    step(s);
    expect(snapshot(s)).toBe(before);
    s.phase = 'combat';
    s.settled = true;
    const settled = snapshot(s);
    step(s);
    expect(snapshot(s)).toBe(settled);
  });
  it('hits once per projectile per enemy and honors spatial grid cell boundaries', () => {
    const s = sandbox();
    s.attacks = [];
    const e = s.enemies[0];
    e.x = 640;
    e.y = 384;
    s.projectiles = [
      {
        id: 1,
        x: 638,
        y: 384,
        vx: 0,
        vy: 0,
        life: 2,
        damage: 10,
        radius: 5,
        element: 'solar',
        modifier: 'echo',
        pattern: 'bolt',
        pierce: 2,
        hit: [],
        surge: false,
      },
    ];
    simulate(s, 5);
    expect(e.hp).toBe(99990);
    expect(s.projectiles[0].hit).toEqual([e.id]);
  });
});

describe('attack grammar and synergy recipes', () => {
  it.each(RECIPES)('$id damages a target inside its attack range', (recipe) => {
    const s = sandbox();
    s.attacks = [{ ...recipe, rank: 1, cooldown: 0, shots: 0 }];
    if (recipe.pattern === 'mine') s.enemies[0].x = 760;
    simulate(s, 240);
    expect(s.damageByElement[recipe.element], recipe.id).toBeGreaterThan(0);
    expect(Number.isFinite(s.enemies[0]?.hp ?? 0)).toBe(true);
    expect(s.projectiles.length).toBeLessThanOrEqual(450);
  });
  it.each(SYNERGIES)('$id activates only with the declared recipe', (synergy) => {
    const s = sandbox();
    s.tower = synergy.tower ?? 'bastion';
    s.attacks = (synergy.elements ?? ['solar']).map((element) => attack(element));
    if (synergy.modifiers) s.attacks[0].modifier = synergy.modifiers[0];
    expect(activeSynergies(s)).toContain(synergy.id);
    syncSynergies(s);
    expect(s.synergies).toContain(synergy.id);
    const notices = s.notices.length;
    syncSynergies(s);
    expect(s.notices.length).toBe(notices);
    if (synergy.elements) s.attacks = s.attacks.filter((a) => a.element !== synergy.elements![0]);
    else s.tower = synergy.tower === 'bastion' ? 'pyre' : 'bastion';
    expect(activeSynergies(s)).not.toContain(synergy.id);
  });
  it('actually amplifies thermal shock, eclipse, and abyssal rot on prepared targets', () => {
    for (const [elements, status] of [
      [['fire', 'frost'], 'chill'],
      [['void', 'solar'], 'mark'],
      [['void', 'poison'], 'poison'],
    ] as const) {
      const plain = sandbox(),
        combo = sandbox();
      plain.attacks = [{ ...attack(elements[0]), modifier: 'surge' }];
      combo.attacks = [
        ...structuredClone(plain.attacks),
        { ...attack(elements[1]), cooldown: 100 },
      ];
      plain.enemies[0][status] = combo.enemies[0][status] = 5;
      step(plain);
      step(combo);
      expect(combo.damageByElement[elements[0]]).toBeGreaterThan(
        plain.damageByElement[elements[0]],
      );
    }
  });
  it('bounds lightning chain and rupture procs instead of recursively fanning out', () => {
    const s = sandbox();
    s.tower = 'tempest';
    s.attacks = [{ ...attack('lightning'), modifier: 'rupture', cooldown: 100 }];
    s.enemies = Array.from({ length: 100 }, (_, i) =>
      target(2000 + i, 650 + (i % 10) * 2, 400 + Math.floor(i / 10) * 2),
    );
    s.projectiles = [
      {
        id: 1,
        x: 650,
        y: 400,
        vx: 0,
        vy: 0,
        life: 1,
        damage: 20,
        radius: 5,
        element: 'lightning',
        modifier: 'rupture',
        pattern: 'bolt',
        pierce: 1,
        hit: [],
        surge: false,
      },
    ];
    step(s);
    const chains = s.visuals.filter((v) => v.kind === 'chain');
    expect(chains.length).toBe(3);
    expect(s.visuals.length).toBeLessThanOrEqual(180);
    expect(s.damageByElement.lightning).toBeGreaterThan(0);
    expect(s.damageByElement.lightning).toBeCloseTo(20 * (1 + 3 * 0.38 + 99 * 0.28));
  });
  it('caps combat arrays and remains finite under a dense mixed-recipe load', () => {
    const s = sandbox();
    s.maxHp = s.hp = 1e6;
    s.wave = 120;
    s.endless = true;
    s.attacks = [
      { ...attack('lightning'), pattern: 'spiral', modifier: 'rupture' },
      { ...attack('fire'), pattern: 'volley' },
      { ...attack('void'), pattern: 'swarm', modifier: 'surge' },
    ];
    s.enemies = Array.from({ length: 200 }, (_, i) =>
      target(i + 2000, 500 + Math.cos(i) * 170, 400 + Math.sin(i) * 170),
    );
    simulate(s, 600);
    expect(s.projectiles.length).toBeLessThanOrEqual(450);
    expect(s.visuals.length).toBeLessThanOrEqual(180);
    expect(s.enemies.length).toBeLessThanOrEqual(220);
    expect(Object.values(s.damageByElement).every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(s.hp)).toBe(true);
  });
});

describe('drafts, shops, skills, and progression boundaries', () => {
  it('offers three distinct choices and installs slots only at wave10 and25', () => {
    const s = run();
    for (const wave of [5, 10, 25]) {
      s.wave = wave;
      s.choices = makeChoices(s);
      expect(new Set(s.choices.map((c) => c.id)).size).toBe(3);
      if (wave >= 10) {
        expect(s.choices.every((c) => c.kind === 'pattern' && c.slot === s.attacks.length)).toBe(
          true,
        );
        applyUpgrade(s, s.choices[0]);
        expect(s.attacks.length).toBe(wave === 10 ? 2 : 3);
      }
    }
    applyUpgrade(s, upgrade('pattern', 'mine', 3));
    expect(s.attacks.length).toBe(3);
  });
  it('transitions draft → shop → next wave, and spends scrap exactly once', () => {
    const s = run();
    s.wave = 10;
    s.phase = 'draft';
    s.pendingShop = true;
    s.choices = makeChoices(s);
    s.scrap = 1000;
    expect(selectDraft(s, 9)).toBe(false);
    expect(selectDraft(s, 0)).toBe(true);
    expect(s.phase).toBe('shop');
    const offered = s.choices[0],
      before = s.scrap;
    expect(buyUpgrade(s, offered.id)).toBe(true);
    expect(s.scrap).toBe(before - offered.price);
    expect(buyUpgrade(s, offered.id)).toBe(false);
    const second = s.choices[0];
    s.scrap = 0;
    expect(buyUpgrade(s, second.id)).toBe(false);
    continueRun(s);
    expect(s.phase).toBe('combat');
    expect(s.wave).toBe(11);
    expect(s.pendingShop).toBe(false);
  });
  it('spends limited rerolls and respects rank/perk caps', () => {
    const s = run();
    s.phase = 'draft';
    for (let i = 0; i < 3; i++) expect(reroll(s)).toBe(true);
    expect(reroll(s)).toBe(false);
    for (let i = 0; i < 30; i++) {
      applyUpgrade(s, upgrade('rank', 'rank'));
      for (const value of ['damage', 'rate', 'armor', 'regen'])
        applyUpgrade(s, upgrade('perk', value));
    }
    expect(s.attacks[0].rank).toBe(5);
    expect(s.perks).toMatchObject({ damage: 1.5, rate: 0.8, armor: 0.4, regen: 2 });
    expect(perks(s).some((u) => u.kind === 'perk')).toBe(false);
    expect(shopChoices(s).every((u) => u.kind !== 'rank')).toBe(true);
  });
  it('uses skills once until cooldown expires and never while paused for a choice', () => {
    const s = sandbox();
    s.hp = s.maxHp * 0.4;
    expect(useSkill(s, 'secondary')).toBe(true);
    expect(s.hp).toBeCloseTo(s.maxHp * 0.7);
    expect(useSkill(s, 'secondary')).toBe(false);
    expect(useSkill(s, 'signature')).toBe(true);
    expect(useSkill(s, 'signature')).toBe(false);
    s.phase = 'draft';
    s.skillCd = 0;
    expect(useSkill(s, 'signature')).toBe(false);
  });
  it('awards wave100 victory, continues endless, and can safely cross wave120', () => {
    const s = run();
    s.wave = 100;
    s.spawned = s.spawnTotal = 1;
    s.enemies = [];
    step(s);
    expect(s.phase).toBe('victory');
    expect(s.cleared).toBe(true);
    expect(s.earned).toBeGreaterThan(200);
    continueRun(s);
    expect(s.endless).toBe(true);
    expect(s.wave).toBe(101);
    expect(s.phase).toBe('combat');
    for (let wave = 101; wave <= 120; wave++) {
      s.wave = wave;
      s.phase = 'combat';
      s.enemies = [];
      s.spawned = s.spawnTotal;
      step(s);
      if (String(s.phase) === 'draft') {
        s.choices = makeChoices(s);
        selectDraft(s, 0);
      }
      if (String(s.phase) === 'shop') continueRun(s);
    }
    expect(s.wave).toBe(121);
    expect(s.phase).toBe('combat');
  });
  it('settles retirement once with an earned reward and stops further simulation', () => {
    const s = sandbox();
    s.wave = 17;
    s.kills = 93;
    retire(s);
    expect(s.phase).toBe('ended');
    expect(s.choices).toEqual([]);
    expect(s.earned).toBeGreaterThan(0);
    const before = snapshot(s);
    retire(s);
    step(s);
    expect(snapshot(s)).toBe(before);
  });
});
