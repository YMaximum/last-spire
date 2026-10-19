import { recordDamageNumber } from '../../game/damage-feedback';
import type {
  Projectile,
  Attack,
  Element,
  Enemy,
  EnemyKind,
  Modifier,
  Pattern,
  Profile,
  RunState,
  Secondary,
  Targeting,
  Upgrade,
  Visual,
} from '../../model/shared';
import {
  ELEMENTS,
  ELEMENT_COLORS,
  MODIFIERS,
  PATTERNS,
  STAGES,
  SYNERGIES,
  TOWERS,
} from '../../content/world';
export const CENTER = { x: 500, y: 400 };
export const TICK = 1 / 30;
export function random(s: RunState): number {
  let x = s.rng | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rng = x >>> 0;
  return s.rng / 4294967296;
}
function choose<T>(s: RunState, a: readonly T[]): T {
  return a[Math.floor(random(s) * a.length)]!;
}
export function createRun(
  profile: Profile,
  tower: RunState['tower'],
  stage: number,
  difficulty: number,
  seed = Date.now() >>> 0,
): RunState {
  const t = TOWERS.find((x) => x.id === tower)!;
  const maxHp = t.hp * (1 + profile.upgrades.vitality * 0.04);
  return {
    version: 1,
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${seed}`,
    tower,
    stage,
    difficulty,
    seed,
    rng: seed || 1,
    time: 0,
    wave: 1,
    waveTime: 0,
    spawned: 0,
    spawnTotal: 10,
    spawnTimer: 0.3,
    phase: 'combat',
    hp: maxHp,
    maxHp,
    shield: 0,
    scrap: 30,
    kills: 0,
    earned: 0,
    attacks: [
      {
        pattern: t.pattern,
        element: t.element,
        modifier: 'echo',
        rank: 1,
        cooldown: 0.2,
        shots: 0,
      },
    ],
    enemies: [],
    projectiles: [],
    visuals: [],
    nextId: 1,
    targeting: 'nearest',
    skillCd: 0,
    secondaryCd: 0,
    secondary: 'repair',
    buff: 0,
    stasis: 0,
    rerolls: 3,
    pendingShop: false,
    endless: false,
    cleared: false,
    settled: false,
    damageByElement: { fire: 0, frost: 0, lightning: 0, poison: 0, solar: 0, void: 0 },
    synergies: [],
    notices: [],
    perks: {
      damage: profile.upgrades.power * 0.04,
      rate: 0,
      armor: 0,
      regen: 0,
      fortune: profile.upgrades.fortune * 0.04,
    },
    choices: [],
    tutorialStep: profile.tutorialDone ? 4 : 0,
  };
}
export function activeSynergies(s: RunState): string[] {
  const elems = new Set(s.attacks.map((a) => a.element)),
    mods = new Set(s.attacks.map((a) => a.modifier));
  return SYNERGIES.filter(
    (y) =>
      (!y.elements || y.elements.every((e) => elems.has(e))) &&
      (!y.modifiers || y.modifiers.every((m) => mods.has(m))) &&
      (!y.tower || y.tower === s.tower),
  ).map((y) => y.id);
}
export function syncSynergies(s: RunState) {
  const next = activeSynergies(s);
  for (const id of next)
    if (!s.synergies.includes(id)) {
      const y = SYNERGIES.find((x) => x.id === id)!;
      s.notices.push(`SYNERGY · ${y.name}`);
      effect(s, 'synergy', 500, 400, y.color, 200, 2, y.name);
    }
  s.synergies = next;
}
const pools = new WeakMap<RunState, { visuals: Visual[]; projectiles: Projectile[] }>();
function pool(s: RunState) {
  let p = pools.get(s);
  if (!p) {
    p = { visuals: [], projectiles: [] };
    pools.set(s, p);
  }
  return p;
}
const has = (s: RunState, a: Element, b: Element) =>
  s.attacks.some((x) => x.element === a) && s.attacks.some((x) => x.element === b);
function effect(
  s: RunState,
  kind: Visual['kind'],
  x: number,
  y: number,
  color: string,
  size = 18,
  life = 0.35,
  text?: string,
  x2?: number,
  y2?: number,
) {
  const p = pool(s);
  if (s.visuals.length >= 180) {
    const old = s.visuals.shift();
    if (old) p.visuals.push(old);
  }
  const v = p.visuals.pop() ?? ({} as Visual);
  Object.assign(v, { kind, x, y, color, size, life, maxLife: life, text, x2, y2 });
  s.visuals.push(v);
}
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);
function nearest(
  s: RunState,
  x: number,
  y: number,
  range: number,
  except: number[] = [],
): Enemy | undefined {
  let best: Enemy | undefined,
    score = Infinity;
  for (const e of s.enemies) {
    if (e.hp <= 0 || except.includes(e.id)) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d > range) continue;
    let v = d;
    if (s.targeting === 'strongest') v = -e.hp;
    if (s.targeting === 'weakest') v = e.hp;
    if (v < score) {
      score = v;
      best = e;
    }
  }
  return best;
}
// Grid is rebuilt once per fixed tick. It bounds collision candidates without changing hit rules.
class SpatialGrid {
  cells = new Map<number, Enemy[]>();
  constructor(es: Enemy[]) {
    for (const e of es) {
      if (e.hp <= 0) continue;
      const key = Math.floor(e.x / 64) + Math.floor(e.y / 64) * 32;
      let c = this.cells.get(key);
      if (!c) this.cells.set(key, (c = []));
      c.push(e);
    }
  }
  nearby(x: number, y: number, r: number): Enemy[] {
    const out: Enemy[] = [];
    for (let cy = Math.floor((y - r) / 64); cy <= Math.floor((y + r) / 64); cy++)
      for (let cx = Math.floor((x - r) / 64); cx <= Math.floor((x + r) / 64); cx++) {
        const c = this.cells.get(cx + cy * 32);
        if (c) out.push(...c);
      }
    return out;
  }
}
function damage(s: RunState, e: Enemy, amount: number, element: Element, ignoreArmor = false) {
  if (e.hp <= 0) return;
  const dealt = Math.max(0, amount) * (ignoreArmor ? 1 : 1 - e.armor) * (e.mark > 0 ? 1.22 : 1);
  recordDamageNumber(s, e, Math.min(dealt, e.hp), {
    rootId: e.id,
    source: 'primary',
    depth: 0,
    weaponId: 'legacy',
    damage: dealt,
    element,
  });
  e.hp -= dealt;
  s.damageByElement[element] += Math.min(dealt, Math.max(0, e.hp + dealt));
}
function aoe(
  s: RunState,
  x: number,
  y: number,
  r: number,
  dmg: number,
  el: Element,
  ignore?: number,
) {
  for (const e of s.enemies)
    if (e.id !== ignore && e.hp > 0 && Math.hypot(e.x - x, e.y - y) < r + e.radius)
      damage(s, e, dmg, el);
  effect(s, 'ring', x, y, ELEMENT_COLORS[el], r, 0.4);
}
function hit(s: RunState, e: Enemy, dmg: number, el: Element, mod: Modifier, proc = true) {
  const boss = e.kind === 'boss',
    control = boss ? 0.35 : 1;
  let amount = dmg;
  if (s.tower === 'pyre' && el === 'fire') amount *= 1.2;
  if (s.tower === 'null' && el === 'void' && dist(e, CENTER) < 170) amount *= 1.3;
  if (has(s, 'fire', 'frost') && e.chill > 0 && el === 'fire') {
    amount *= 1.3;
    effect(s, 'hit', e.x, e.y, '#e5fff4', 32);
  }
  if (has(s, 'solar', 'void') && el === 'void' && e.mark > 0) amount *= 1.35;
  if (has(s, 'poison', 'void') && el === 'void' && e.poison > 0) amount *= 1.25;
  damage(s, e, amount, el);
  if (el === 'fire') e.burn = Math.max(e.burn, amount * (s.tower === 'pyre' ? 0.9 : 0.65));
  if (el === 'poison') e.poison = Math.min(e.maxHp * 0.65, e.poison + amount * 0.38);
  if (el === 'frost') e.chill = Math.min(5, e.chill + 2 * control);
  if (el === 'solar') e.mark = Math.max(e.mark, 3);
  if (el === 'void') {
    const d = dist(e, CENTER) || 1;
    e.x -= ((e.x - 500) / d) * 12 * control;
    e.y -= ((e.y - 400) / d) * 12 * control;
  }
  if (mod === 'mark') e.mark = 5;
  if (s.tower === 'glacier' && e.chill > 0) e.chill = Math.min(6, e.chill + 0.2 * control);
  if (s.tower === 'verdant' && el === 'poison') s.hp = Math.min(s.maxHp, s.hp + amount * 0.012);
  if (s.tower === 'bastion' && mod === 'mark')
    s.shield = Math.min(s.maxHp * 0.35, s.shield + amount * 0.012);
  effect(s, 'hit', e.x, e.y, ELEMENT_COLORS[el], 10 + Math.min(12, amount / 30));
  // Secondary procs are direct damage and never re-enter this function.
  if (!proc) return;
  if (el === 'lightning') {
    const visited = [e.id];
    let from = e;
    const count = s.tower === 'tempest' ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const target = nearest(s, from.x, from.y, has(s, 'lightning', 'void') ? 160 : 105, visited);
      if (!target) break;
      visited.push(target.id);
      damage(s, target, amount * 0.38, 'lightning');
      effect(s, 'chain', from.x, from.y, '#8be4ed', 4, 0.2, undefined, target.x, target.y);
      if (has(s, 'lightning', 'frost'))
        target.stun = Math.max(target.stun, 0.22 * (target.kind === 'boss' ? 0.35 : 1));
      if (has(s, 'lightning', 'poison')) target.poison += amount * 0.12;
      from = target;
    }
  }
  if (mod === 'rupture') aoe(s, e.x, e.y, 48, amount * 0.28, el, e.id);
  if (has(s, 'fire', 'poison') && e.poison > 0 && el === 'fire')
    aoe(s, e.x, e.y, 65, amount * 0.18, 'fire', e.id);
  if (has(s, 'fire', 'lightning') && el === 'lightning' && e.burn > 0)
    damage(s, e, amount * 0.32, 'fire');
  if (has(s, 'fire', 'solar') && el === 'solar' && e.burn > 0) {
    e.burn *= 1.15;
    damage(s, e, amount * 0.15, 'solar');
  }
  if (has(s, 'fire', 'void') && el === 'void' && e.burn > 0)
    aoe(s, e.x, e.y, 72, amount * 0.2, 'fire', e.id);
  if (has(s, 'frost', 'poison') && el === 'poison' && e.chill > 0)
    e.poison = Math.min(e.maxHp * 0.8, e.poison + amount * 0.2);
  if (has(s, 'frost', 'solar') && el === 'solar' && e.chill > 0)
    s.shield = Math.min(s.maxHp * 0.35, s.shield + 1.5);
  if (has(s, 'frost', 'void') && el === 'void' && e.chill > 0)
    e.stun = Math.max(e.stun, 0.3 * control);
  if (has(s, 'lightning', 'solar') && el === 'lightning' && e.mark > 0)
    damage(s, e, amount * 0.28, 'solar');
  if (has(s, 'poison', 'solar') && el === 'solar' && e.poison > 0)
    s.hp = Math.min(s.maxHp, s.hp + amount * 0.015);
}
function spawn(s: RunState, kind?: EnemyKind, x?: number, y?: number) {
  if (s.enemies.length >= 220) return false;
  const angle = random(s) * Math.PI * 2,
    rad = 420 + random(s) * 45;
  if (!kind) {
    const r = random(s);
    kind =
      s.wave < 5
        ? 'swarmer'
        : r < 0.26
          ? 'swarmer'
          : r < 0.43
            ? 'runner'
            : r < 0.6
              ? 'armored'
              : r < 0.74
                ? 'ranged'
                : r < 0.86
                  ? 'support'
                  : 'splitter';
    if (s.stage === 1 && r < 0.2) kind = 'armored';
    if (s.stage === 2 && r > 0.8) kind = 'ranged';
  }
  const w = s.wave,
    scale =
      (1 + w * 0.068 + w * w * 0.00095) *
      (1 + s.stage * 0.27) *
      (1 + s.difficulty * (0.035 + Math.min(w, 200) * 0.005)) *
      (1 + Math.pow(Math.max(0, w - 100) / 45, 2));
  const mult = {
    swarmer: 1,
    runner: 0.68,
    armored: 2.3,
    ranged: 1.1,
    support: 1.5,
    splitter: 1.45,
    elite: 7,
    boss: 28,
  }[kind];
  const hp = 18 * scale * mult;
  s.enemies.push({
    id: s.nextId++,
    kind,
    x: x ?? 500 + Math.cos(angle) * rad,
    y: y ?? 400 + Math.sin(angle) * rad * 0.8,
    hp,
    maxHp: hp,
    speed:
      (kind === 'runner' ? 53 : kind === 'boss' ? 13 : kind === 'armored' ? 20 : 28) + w * 0.075,
    damage:
      (kind === 'boss' ? 14 : kind === 'elite' ? 8 : 3) *
      (1 + w * 0.014) *
      (1 + s.difficulty * (0.03 + Math.min(w, 200) * 0.001)),
    radius: kind === 'boss' ? 27 : kind === 'elite' ? 18 : kind === 'armored' ? 13 : 9,
    armor: kind === 'armored' ? 0.38 : kind === 'boss' ? 0.15 : 0,
    attackCd: 1 + random(s) * 2,
    burn: 0,
    poison: 0,
    chill: 0,
    mark: 0,
    stun: 0,
    vx: 0,
    vy: 0,
    reward: kind === 'boss' ? 35 : kind === 'elite' ? 12 : kind === 'armored' ? 3 : 2,
  });
  if (kind === 'boss') {
    const names = STAGES[s.stage].bosses;
    s.notices.push(`GUARDIAN · ${names[(Math.floor(s.wave / 25) - 1) % names.length]}`);
    effect(
      s,
      'text',
      500,
      230,
      STAGES[s.stage].color,
      24,
      2,
      names[(Math.floor(s.wave / 25) - 1) % names.length],
    );
  }
  return true;
}
function projectile(
  s: RunState,
  a: Attack,
  angle: number,
  dmg: number,
  x = 500,
  y = 400,
  surge = false,
  target?: number,
) {
  const speed = a.pattern === 'mine' ? 95 : a.pattern === 'swarm' ? 270 : 390;
  const p = pool(s).projectiles.pop() ?? ({} as Projectile);
  Object.assign(p, {
    id: s.nextId++,
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: a.pattern === 'mine' ? 6 : 2,
    damage: dmg,
    radius: a.pattern === 'mine' ? 13 : 5,
    element: a.element,
    modifier: a.modifier,
    pattern: a.pattern,
    pierce: a.pattern === 'bolt' ? 2 : 1,
    hit: [],
    surge,
    targetId: target,
  });
  s.projectiles.push(p);
}
function fire(s: RunState, a: Attack) {
  const target = nearest(s, 500, 400, 360);
  if (!target) return;
  const tower = TOWERS.find((t) => t.id === s.tower)!;
  const growth = 1 + s.wave * 0.052 + s.wave * s.wave * 0.0009;
  const surge = a.modifier === 'surge' && a.shots % 4 === 3;
  let dmg =
    20 *
    tower.damage *
    (1 + (a.rank - 1) * 0.3) *
    (1 + s.perks.damage) *
    growth *
    (s.buff > 0 ? 1.45 : 1) *
    (surge ? 2 : 1);
  if (s.tower === 'null' && surge) dmg *= 1.3;
  const count = a.modifier === 'echo' ? 2 : 1,
    echo = s.tower === 'tempest' ? 0.68 : 0.56;
  const angle = Math.atan2(target.y - 400, target.x - 500);
  for (let copy = 0; copy < count; copy++) {
    const d = dmg * (copy ? echo : 1),
      offset = copy ? 0.08 : 0;
    if (a.pattern === 'beam') {
      hit(s, target, d * 1.5, a.element, a.modifier);
      effect(
        s,
        'beam',
        500,
        400,
        ELEMENT_COLORS[a.element],
        surge ? 10 : 5,
        0.18,
        undefined,
        target.x,
        target.y,
      );
      for (const e of s.enemies) {
        if (e.id === target.id || e.hp <= 0) continue;
        const ex = e.x - 500,
          ey = e.y - 400;
        const along = ex * Math.cos(angle) + ey * Math.sin(angle),
          side = Math.abs(-ex * Math.sin(angle) + ey * Math.cos(angle));
        if (along > 0 && along < 360 && side < 14)
          hit(s, e, d * 0.75, a.element, a.modifier, false);
      }
    } else if (a.pattern === 'pulse') {
      const radius = 290;
      for (const e of s.enemies)
        if (dist(e, CENTER) < radius) hit(s, e, d * 0.68, a.element, a.modifier);
      effect(s, 'ring', 500, 400, ELEMENT_COLORS[a.element], radius, 0.6);
    } else if (a.pattern === 'orbit') {
      const phase = s.time * 1.8;
      for (const e of s.enemies)
        if (dist(e, CENTER) < 290) hit(s, e, d * 0.85, a.element, a.modifier);
      for (let i = 0; i < 4; i++) {
        const t = phase + (i * Math.PI) / 2;
        effect(
          s,
          'beam',
          500 + Math.cos(t) * 70,
          400 + Math.sin(t) * 70,
          ELEMENT_COLORS[a.element],
          7,
          0.4,
          undefined,
          500 + Math.cos(t + 0.7) * 290,
          400 + Math.sin(t + 0.7) * 290,
        );
      }
    } else if (a.pattern === 'volley')
      for (let i = -2; i <= 2; i++)
        projectile(s, a, angle + i * 0.15 + offset, d * 0.55, 500, 400, surge);
    else if (a.pattern === 'spiral')
      for (let i = 0; i < 8; i++)
        projectile(s, a, s.time * 1.9 + (i * Math.PI) / 4 + offset, d * 0.5, 500, 400, surge);
    else if (a.pattern === 'swarm')
      for (let i = 0; i < 3; i++)
        projectile(s, a, angle + (i - 1) * 0.5 + offset, d * 0.53, 500, 400, surge, target.id);
    else if (a.pattern === 'mine') {
      for (let i = 0; i < 3; i++) {
        const theta = angle + (i - 1) * 0.65 + offset;
        projectile(
          s,
          a,
          theta,
          d * 1.05,
          500 + Math.cos(theta) * 250,
          400 + Math.sin(theta) * 250,
          surge,
        );
      }
    } else projectile(s, a, angle + offset, d, 500, 400, surge);
  }
  a.shots++;
}
export function useSkill(s: RunState, which: 'signature' | 'secondary'): boolean {
  if (s.phase !== 'combat') return false;
  if (which === 'secondary') {
    if (s.secondaryCd > 0) return false;
    s.secondaryCd = s.secondary === 'repair' ? 35 : 28;
    if (s.secondary === 'repair') {
      s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.3);
      effect(s, 'ring', 500, 400, '#a2de9e', 180, 1);
    }
    if (s.secondary === 'nova') aoe(s, 500, 400, 390, 60 * (1 + s.wave * 0.08), 'solar');
    if (s.secondary === 'stasis') {
      s.stasis = 5;
      effect(s, 'ring', 500, 400, '#b0eaf1', 370, 1);
    }
  } else {
    if (s.skillCd > 0) return false;
    s.skillCd = 30;
    if (s.tower === 'bastion') {
      s.shield = Math.min(s.maxHp * 0.6, s.shield + s.maxHp * 0.45);
      effect(s, 'ring', 500, 400, '#f4d69c', 90, 1);
    }
    if (s.tower === 'pyre') {
      s.buff = 8;
      aoe(s, 500, 400, 230, 30 * (1 + s.wave * 0.08), 'fire');
    }
    if (s.tower === 'tempest') {
      s.buff = 7;
      for (const e of s.enemies) {
        damage(s, e, 35 * (1 + s.wave * 0.08), 'lightning');
        effect(s, 'chain', 500, 400, '#9eeafa', 3, 0.5, undefined, e.x, e.y);
      }
    }
    if (s.tower === 'glacier') {
      s.stasis = 6;
      s.shield += s.maxHp * 0.2;
      effect(s, 'ring', 500, 400, '#a3e6ef', 380, 1.2);
    }
    if (s.tower === 'verdant') {
      s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.25);
      for (const e of s.enemies) e.poison += 40 * (1 + s.wave * 0.05);
      effect(s, 'ring', 500, 400, '#b9dc8c', 350, 1);
    }
    if (s.tower === 'null') {
      for (const e of s.enemies) {
        e.x += (500 - e.x) * 0.25;
        e.y += (400 - e.y) * 0.25;
        damage(s, e, 50 * (1 + s.wave * 0.08), 'void');
      }
      effect(s, 'synergy', 500, 400, '#c8a4f0', 340, 1.2, 'SINGULARITY');
    }
  }
  return true;
}
export function setTargeting(s: RunState, t: Targeting) {
  s.targeting = t;
}
export function creditReward(s: RunState) {
  return (
    Math.max(0, Math.floor((s.wave - 1) * 1.45 + s.kills * 0.035 + (s.cleared ? 90 : 0))) *
    (1 + s.difficulty * 0.12)
  );
}
function finish(s: RunState) {
  s.phase = 'ended';
  s.earned = Math.floor(creditReward(s));
  s.choices = [];
}
export function retire(s: RunState) {
  if (s.phase !== 'ended') finish(s);
}
function nextWave(s: RunState) {
  s.wave++;
  s.waveTime = 0;
  s.spawned = 0;
  s.spawnTotal = Math.min(150, 9 + Math.floor(s.wave * 0.8 + s.difficulty * s.wave * 0.08));
  s.spawnTimer = 0.1;
  s.phase = 'combat';
  s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.018);
  s.projectiles = [];
  if (s.wave === 10 || s.wave === 25)
    s.notices.push('A new attack slot is available. Choose an attack in the next draft.');
}
export function continueRun(s: RunState) {
  if (s.phase === 'victory') {
    s.endless = true;
    nextWave(s);
  } else if (s.phase === 'shop') {
    s.pendingShop = false;
    nextWave(s);
  }
}
function waveComplete(s: RunState) {
  if (s.wave === 100 && !s.endless) {
    s.cleared = true;
    s.phase = 'victory';
    s.earned = Math.floor(creditReward(s));
    return;
  }
  if (s.wave % 5 === 0) {
    s.phase = 'draft';
    s.pendingShop = s.wave % 10 === 0;
    s.choices = makeChoices(s);
  } else nextWave(s);
}
export function makeChoices(s: RunState): Upgrade[] {
  const choices: Upgrade[] = [];
  const slots = s.wave >= 25 ? 3 : s.wave >= 10 ? 2 : 1;
  if (s.attacks.length < slots) {
    const existing = s.attacks.map((a) => a.pattern);
    for (const p of PATTERNS.filter((p) => !existing.includes(p.id))) {
      choices.push({
        id: `new-${p.id}`,
        kind: 'pattern',
        name: p.name,
        description: `Install in empty slot ${s.attacks.length + 1}. ${p.description} Starts with ${s.attacks[0].element} + Echo.`,
        color: '#dbbd80',
        slot: s.attacks.length,
        value: p.id,
        price: 60,
      });
    }
  } else {
    for (let slot = 0; slot < s.attacks.length; slot++) {
      const a = s.attacks[slot];
      if (a.rank < 5)
        choices.push({
          id: `rank-${slot}`,
          kind: 'rank',
          name: `${PATTERNS.find((p) => p.id === a.pattern)!.name} +1`,
          description: `Slot ${slot + 1} · Rank ${a.rank} → ${a.rank + 1}. +30% base attack damage.`,
          color: ELEMENT_COLORS[a.element],
          slot,
          value: 'rank',
          price: 45 + a.rank * 10,
        });
      for (const e of ELEMENTS)
        if (e.id !== a.element)
          choices.push({
            id: `el-${slot}-${e.id}`,
            kind: 'element',
            name: `${e.name} infusion`,
            description: `Slot ${slot + 1} · Replaces ${a.element}. ${e.description}`,
            color: e.color,
            slot,
            value: e.id,
            price: 45,
          });
      for (const m of MODIFIERS)
        if (m.id !== a.modifier)
          choices.push({
            id: `mod-${slot}-${m.id}`,
            kind: 'modifier',
            name: m.name,
            description: `Slot ${slot + 1} · Replaces ${a.modifier}. ${m.description}`,
            color: '#c8b1ee',
            slot,
            value: m.id,
            price: 45,
          });
      for (const p of PATTERNS)
        if (!s.attacks.some((a) => a.pattern === p.id))
          choices.push({
            id: `swap-${slot}-${p.id}`,
            kind: 'pattern',
            name: p.name,
            description: `Slot ${slot + 1} · Replaces ${a.pattern}; retains element, modifier, and rank. ${p.description}`,
            color: '#dbbd80',
            slot,
            value: p.id,
            price: 65,
          });
    }
    choices.push(...perks(s));
  }
  // Guarantee a rank or empty-slot option, then two contextual transformations.
  const primary = choices.filter((c) => c.kind === 'rank');
  const first = choose(s, primary.length ? primary : choices.filter((c) => c.kind === 'pattern'));
  const rest = choices.filter((c) => c.id !== first.id);
  const elemental = rest.filter((c) => c.kind === 'element');
  const second = choose(s, elemental.length ? elemental : rest);
  const behavioral = rest.filter(
    (c) =>
      c.id !== second.id && (c.kind === 'modifier' || c.kind === 'perk' || c.kind === 'secondary'),
  );
  const third = choose(s, behavioral.length ? behavioral : rest.filter((c) => c.id !== second.id));
  return [first, second, third];
}
export function perks(s: RunState): Upgrade[] {
  return [
    {
      id: 'perk-damage',
      kind: 'perk',
      name: 'Runic amplifier',
      description: '+15% global damage this run. Caps at +150%.',
      color: '#e7ba81',
      value: 'damage',
      price: 65,
    },
    {
      id: 'perk-rate',
      kind: 'perk',
      name: 'Clockwork heart',
      description: '+10% attack speed this run. Caps at +80%.',
      color: '#c0dcc7',
      value: 'rate',
      price: 65,
    },
    {
      id: 'perk-armor',
      kind: 'perk',
      name: 'Living bulwark',
      description: '+8% incoming damage reduction. Caps at 40%.',
      color: '#a4b5d7',
      value: 'armor',
      price: 60,
    },
    {
      id: 'perk-regen',
      kind: 'perk',
      name: 'Restoration rune',
      description: 'Recover 0.4 health per second. Caps at 2 per second.',
      color: '#afd69d',
      value: 'regen',
      price: 55,
    },
    {
      id: 'repair',
      kind: 'secondary',
      name: 'Mend',
      description: 'Secondary skill: restore 30% max health. Replaces current secondary.',
      color: '#a7d59d',
      value: 'repair',
      price: 45,
    },
    {
      id: 'nova',
      kind: 'secondary',
      name: 'Solar nova',
      description: 'Secondary skill: blast the entire arena. Replaces current secondary.',
      color: '#ead7a0',
      value: 'nova',
      price: 45,
    },
    {
      id: 'stasis',
      kind: 'secondary',
      name: 'Time fracture',
      description: 'Secondary skill: slow all enemies for 5 seconds. Replaces current secondary.',
      color: '#b7dfe2',
      value: 'stasis',
      price: 45,
    },
  ].filter(
    (c) =>
      c.kind !== 'perk' ||
      s.perks[c.value as keyof RunState['perks']] <
        ({ damage: 1.5, rate: 0.8, armor: 0.4, regen: 2 }[c.value as 'damage'] ?? 1),
  ) as Upgrade[];
}
export function applyUpgrade(s: RunState, u: Upgrade) {
  const a = s.attacks[u.slot ?? 0];
  if (u.kind === 'rank' && a) a.rank = Math.min(5, a.rank + 1);
  if (u.kind === 'element' && a) a.element = u.value as Element;
  if (u.kind === 'modifier' && a) a.modifier = u.value as Modifier;
  if (u.kind === 'pattern') {
    if (a) a.pattern = u.value as Pattern;
    else if (s.attacks.length < (s.wave >= 25 ? 3 : s.wave >= 10 ? 2 : 1))
      s.attacks.push({
        pattern: u.value as Pattern,
        element: s.attacks[0].element,
        modifier: 'echo',
        rank: 1,
        cooldown: 0,
        shots: 0,
      });
  }
  if (u.kind === 'perk') {
    const k = u.value as keyof RunState['perks'];
    s.perks[k] = Math.min(
      { damage: 1.5, rate: 0.8, armor: 0.4, regen: 2, fortune: 0.5 }[k],
      s.perks[k] + { damage: 0.15, rate: 0.1, armor: 0.08, regen: 0.4, fortune: 0.05 }[k],
    );
  }
  if (u.kind === 'secondary') s.secondary = u.value as Secondary;
  syncSynergies(s);
}
export function selectDraft(s: RunState, index: number): boolean {
  if (s.phase !== 'draft' || !s.choices[index]) return false;
  applyUpgrade(s, s.choices[index]);
  s.choices = [];
  if (s.pendingShop) {
    s.phase = 'shop';
    s.choices = shopChoices(s);
  } else nextWave(s);
  return true;
}
export function reroll(s: RunState): boolean {
  if (s.phase !== 'draft' || s.rerolls <= 0) return false;
  s.rerolls--;
  s.choices = makeChoices(s);
  return true;
}
export function shopChoices(s: RunState): Upgrade[] {
  return [...makeChoices(s), ...perks(s).filter((p) => p.kind === 'perk')].filter(
    (u, i, a) => a.findIndex((x) => x.id === u.id) === i,
  );
}
export function buyUpgrade(s: RunState, id: string): boolean {
  if (s.phase !== 'shop') return false;
  const u = s.choices.find((x) => x.id === id);
  if (!u || s.scrap < u.price) return false;
  s.scrap -= u.price;
  applyUpgrade(s, u);
  s.choices = s.choices.filter((x) => x.id !== id);
  return true;
}
function takeDamage(s: RunState, n: number) {
  const defense = s.perks.armor + (s.tower === 'bastion' ? 0.1 : 0);
  let amount = n * (1 - Math.min(0.55, defense)) * (s.tower === 'null' ? 1.12 : 1);
  const absorb = Math.min(s.shield, amount);
  s.shield -= absorb;
  amount -= absorb;
  s.hp -= amount;
  if (amount > 1) effect(s, 'hit', 500, 400, '#ed907c', 35);
}
export function step(s: RunState, dt = TICK) {
  if (s.phase !== 'combat' || s.settled) return;
  s.time += dt;
  s.waveTime += dt;
  s.skillCd = Math.max(0, s.skillCd - dt);
  s.secondaryCd = Math.max(0, s.secondaryCd - dt);
  s.buff = Math.max(0, s.buff - dt);
  s.stasis = Math.max(0, s.stasis - dt);
  s.hp = Math.min(s.maxHp, s.hp + s.perks.regen * dt);
  s.shield = Math.max(0, s.shield - dt * 0.25);
  s.spawnTimer -= dt;
  if (s.spawned < s.spawnTotal && s.spawnTimer <= 0) {
    let kind: EnemyKind | undefined;
    if (s.spawned === s.spawnTotal - 1) {
      if (s.wave % 25 === 0) kind = 'boss';
      else if (s.wave % 10 === 0) kind = 'elite';
    }
    if (spawn(s, kind)) {
      s.spawned++;
      s.spawnTimer = 18 / s.spawnTotal;
    } else s.spawnTimer = 0.2;
  }
  // Environment hazards are time telegraphed and never erase an elemental build.
  const hazardCycle = s.stage === 0 ? 18 : s.stage === 1 ? 15 : 20;
  if (Math.floor(s.waveTime / hazardCycle) !== Math.floor((s.waveTime - dt) / hazardCycle)) {
    effect(s, 'hazard', 500, 400, STAGES[s.stage].color, 280, 2, 'INCOMING');
    if (s.stage === 0) {
      for (const e of s.enemies) e.speed *= 1.06;
      s.notices.push('Wild surge · enemies accelerate');
    }
    if (s.stage === 1) s.notices.push('Furnace pulse · barrier strain in 2 seconds');
    if (s.stage === 2) {
      for (const e of s.enemies)
        if (e.kind === 'ranged') e.attackCd = Math.max(0.6, e.attackCd - 1);
      s.notices.push('Void tide · ranged enemies charge');
    }
  }
  if (
    s.stage === 1 &&
    s.waveTime > 2 &&
    Math.floor((s.waveTime - 2) / hazardCycle) !== Math.floor((s.waveTime - 2 - dt) / hazardCycle)
  )
    takeDamage(s, 8 + s.wave * 0.08);
  const tower = TOWERS.find((t) => t.id === s.tower)!;
  for (const a of s.attacks) {
    a.cooldown -= dt;
    if (a.cooldown <= 0) {
      fire(s, a);
      const base = {
        bolt: 0.64,
        volley: 0.95,
        spiral: 1.1,
        beam: 1.05,
        orbit: 1.15,
        pulse: 1.55,
        swarm: 0.9,
        mine: 1.25,
      }[a.pattern];
      a.cooldown = base / (tower.rate * (1 + s.perks.rate) * (s.buff > 0 ? 1.4 : 1));
    }
  }
  for (const e of s.enemies) {
    e.chill = Math.max(0, e.chill - dt);
    e.mark = Math.max(0, e.mark - dt);
    e.stun = Math.max(0, e.stun - dt);
    if (e.burn > 0) {
      damage(s, e, e.burn * 0.45 * dt, 'fire', true);
      e.burn = Math.max(0, e.burn * (1 - 0.32 * dt) - 0.05 * dt);
    }
    if (e.poison > 0) {
      damage(s, e, e.poison * 0.3 * dt, 'poison', true);
      e.poison = Math.max(0, e.poison * (1 - 0.13 * dt) - 0.03 * dt);
    }
    if (e.hp <= 0) continue;
    const d = dist(e, CENTER) || 1;
    const slow =
      (e.chill > 0 ? (e.kind === 'boss' ? 0.8 : 0.55) : 1) *
      (s.stasis > 0 ? (e.kind === 'boss' ? 0.65 : 0.18) : 1) *
      (e.stun > 0 ? 0.15 : 1);
    const stop = e.kind === 'ranged' ? 255 : 39;
    if (d > stop) {
      e.vx = ((500 - e.x) / d) * e.speed * slow;
      e.vy = ((400 - e.y) / d) * e.speed * slow;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    }
    e.attackCd -= dt;
    if (e.kind === 'boss' && e.attackCd <= 0) {
      const variant = (Math.floor(s.wave / 25) - 1) % 4;
      if (s.stage === 0) {
        if (variant === 0 || variant === 3) {
          for (let j = 0; j < 3; j++) spawn(s, 'runner', e.x + (j - 1) * 24, e.y + 20);
        }
        if (variant === 1) {
          e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.035);
          effect(s, 'ring', e.x, e.y, '#9dce88', 85, 0.7);
        }
        if (variant === 2) {
          for (const ally of s.enemies)
            if (ally.id !== e.id) ally.hp = Math.min(ally.maxHp, ally.hp + ally.maxHp * 0.08);
          effect(s, 'ring', e.x, e.y, '#aace86', 160, 0.8);
        }
      } else if (s.stage === 1) {
        if (variant === 0) e.armor = Math.min(0.4, e.armor + 0.025);
        if (variant === 1 || variant === 3) {
          takeDamage(s, 6 + s.wave * 0.035);
          effect(s, 'beam', e.x, e.y, '#e6a264', 8, 0.6, undefined, 500, 400);
        }
        if (variant === 2) spawn(s, 'armored', e.x, e.y + 30);
      } else {
        if (variant === 0 || variant === 3) {
          e.x += (500 - e.x) * 0.12;
          e.y += (400 - e.y) * 0.12;
          effect(s, 'ring', e.x, e.y, '#bca0e6', 70, 0.6);
        }
        if (variant === 1) {
          s.shield = Math.max(0, s.shield - 12);
          takeDamage(s, 4 + s.wave * 0.025);
        }
        if (variant === 2 || variant === 3) {
          takeDamage(s, 5 + s.wave * 0.035);
          effect(s, 'beam', e.x, e.y, '#b797e6', 6, 0.6, undefined, 500, 400);
        }
      }
      if (d <= stop + 5) takeDamage(s, e.damage);
      e.attackCd = 6;
    }
    if (e.kind !== 'boss' && d <= stop + 5 && e.attackCd <= 0) {
      takeDamage(s, e.damage);
      e.attackCd = e.kind === 'ranged' ? 3 : 1.2;
      if (e.kind === 'ranged') effect(s, 'beam', e.x, e.y, '#d68189', 2, 0.25, undefined, 500, 400);
    }
    if (e.kind === 'support' && e.attackCd <= 0) {
      for (const near of s.enemies)
        if (near.id !== e.id && dist(near, e) < 100)
          near.hp = Math.min(near.maxHp, near.hp + near.maxHp * 0.025);
      effect(s, 'ring', e.x, e.y, '#a5dba6', 95, 0.5);
      e.attackCd = 3;
    }
  }
  const grid = new SpatialGrid(s.enemies);
  for (const p of s.projectiles) {
    p.life -= dt;
    if (p.pattern === 'swarm') {
      const e = s.enemies.find((e) => e.id === p.targetId && e.hp > 0) ?? nearest(s, p.x, p.y, 400);
      if (e) {
        p.targetId = e.id;
        const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
        p.vx += (((e.x - p.x) / d) * 310 - p.vx) * Math.min(1, dt * 7);
        p.vy += (((e.y - p.y) / d) * 310 - p.vy) * Math.min(1, dt * 7);
      }
    }
    if (p.pattern === 'mine') {
      p.vx *= Math.max(0, 1 - dt * 2);
      p.vy *= Math.max(0, 1 - dt * 2);
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const radius = p.pattern === 'mine' ? 42 : p.radius;
    for (const e of grid.nearby(p.x, p.y, radius + 28)) {
      if (e.hp <= 0 || p.hit.includes(e.id) || Math.hypot(e.x - p.x, e.y - p.y) > radius + e.radius)
        continue;
      p.hit.push(e.id);
      hit(s, e, p.damage, p.element, p.modifier);
      if (p.pattern === 'mine') {
        aoe(s, p.x, p.y, 78, p.damage * 0.65, p.element, e.id);
        p.life = 0;
        break;
      }
      if (--p.pierce <= 0) {
        p.life = 0;
        break;
      }
    }
  }
  const live: Projectile[] = [];
  for (const p of s.projectiles) {
    if (p.life > 0 && p.x > -50 && p.x < 1050 && p.y > -100 && p.y < 900 && live.length < 450)
      live.push(p);
    else if (pool(s).projectiles.length < 500) pool(s).projectiles.push(p);
  }
  s.projectiles = live;
  const dead = s.enemies.filter((e) => e.hp <= 0);
  s.enemies = s.enemies.filter((e) => e.hp > 0);
  for (const e of dead) {
    s.kills++;
    s.scrap += Math.round(e.reward * (1 + s.perks.fortune));
    effect(s, 'hit', e.x, e.y, ELEMENT_COLORS[s.attacks[0].element], 22, 0.45);
    if (e.kind === 'splitter' && s.enemies.length < 200) {
      spawn(s, 'swarmer', e.x + 12, e.y);
      spawn(s, 'swarmer', e.x - 12, e.y);
    }
    if (has(s, 'lightning', 'void')) {
      for (const near of s.enemies)
        if (dist(e, near) < 85) {
          near.x += (e.x - near.x) * 0.05;
          near.y += (e.y - near.y) * 0.05;
        }
    }
  }
  const visible: Visual[] = [];
  for (const v of s.visuals) {
    v.life -= dt;
    if (v.life > 0) visible.push(v);
    else if (pool(s).visuals.length < 200) pool(s).visuals.push(v);
  }
  s.visuals = visible;
  if (s.hp <= 0) {
    s.hp = 0;
    finish(s);
    return;
  }
  if (s.spawned >= s.spawnTotal && s.enemies.length === 0) waveComplete(s);
}
