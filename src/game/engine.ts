import { STAGES } from '../content/world';
import * as legacy from '../legacy/runeforged/engine';
import { TOWERS, isDefensiveKind, isFusedKind, FUSIONS, FUSION_BY_ID } from '../content/catalog';
import type { RunV3, RunOptions } from './types';
import { MASTERY_THRESHOLDS } from './types';
import { recordDamageNumber } from './damage-feedback';
export type { RunV3, RunOptions, RunMode } from './types';
import { CARDS, WEAPONS, SYNERGIES } from '../content/catalog';
import type {
  RunV2,
  Profile,
  TowerId,
  WeaponInstance,
  WeaponKind,
  WeaponStats,
  CardOffer,
  Rarity,
  Element,
  EnemyV2,
  ProjectileV2,
  DamageEvent,
  PendingReward,
} from './types';
export const TICK = 1 / 30;
// Shared launch tuning: identical in browser combat and seeded policy audits.
const ENCOUNTER_BALANCE = {
  normalHealth: 0.9,
  quickHealth: 0.2,
  normalDamage: 1.18,
  quickDamage: 1.9,
};
export const RARITIES: Rarity[] = ['normal', 'rare', 'epic', 'legendary', 'mythic'];
export const isModern = (s: RunV2): s is RunV3 => s.rulesVersion === 3;
export const finalWave = (s: RunV2) => (s.mode === 'quick' ? 50 : 100);
export const bossWave = (s: RunV2, wave: number) =>
  s.mode === 'quick'
    ? [12, 25, 37, 50].includes(wave) || (s.endless && wave > 50 && wave % 12 === 0)
    : wave % 25 === 0;
const ELEMENTS: Element[] = ['fire', 'frost', 'lightning', 'poison', 'solar', 'void'];
const MAX_DEPTH = 2;
const projectilePools = new WeakMap<RunV2, ProjectileV2[]>();
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);
const origin = { x: 500, y: 400 };
const tower = (s: RunV2) => TOWERS.find((t) => t.id === s.tower)!;
const CARD_MAP = new Map(CARDS.map((c) => [c.id, c]));
const card = (id: string) => CARD_MAP.get(id);
const weapon = (kind: WeaponKind) => WEAPONS.find((w) => w.id === kind)!;
export function random(s: RunV2) {
  if (s.rulesVersion !== 3) return legacy.random(s);
  let x = s.rng | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rng = x >>> 0;
  return s.rng / 4294967296;
}
const tier = (r: Rarity) => Math.max(0, RARITIES.indexOf(r));
const rarityPower = (r: Rarity) => 1 + tier(r) * 0.2;
const powers = new WeakMap<
  RunV2,
  {
    revision: number;
    global: Record<string, number>;
    targets: Record<string, Record<string, number>>;
  }
>();
function allPowers(s: RunV2) {
  const revision = s.counters.cardRevision || 0,
    cached = powers.get(s);
  if (cached?.revision === revision) return cached;
  const p = {
    revision,
    global: {} as Record<string, number>,
    targets: {} as Record<string, Record<string, number>>,
  };
  for (const c of s.cards) {
    const d = card(c.cardId);
    if (!d) continue;
    const bucket = c.targetId ? (p.targets[c.targetId] ??= {}) : p.global;
    bucket[d.effect] =
      (bucket[d.effect] || 0) + d.value * (1 + (c.stacks - 1) * 0.32) * rarityPower(c.rarity);
  }
  powers.set(s, p);
  return p;
}
export function effectPower(s: RunV2, effect: string, weaponId?: string) {
  if (s.rulesVersion !== 3) return legacy.effectPower(s, effect, weaponId);
  const p = allPowers(s);
  return (p.global[effect] || 0) + (weaponId ? p.targets[weaponId]?.[effect] || 0 : 0);
}
const ep = effectPower;
function buff(s: RunV2, stat: string) {
  return Math.min(
    2,
    s.buffs.filter((b) => b.stat === stat && b.expires > s.time).reduce((v, b) => v + b.value, 0),
  );
}
function addBuff(s: RunV2, source: string, stat: string, value: number, duration: number) {
  s.buffs.push({
    id: `buff-${s.nextId++}`,
    source,
    stat,
    value,
    expires: s.time + duration,
    stacks: 1,
  });
}
function has(s: RunV2, id: string) {
  return s.synergies.includes(id);
}
const synergyCache = new WeakMap<RunV2, { ids: string[]; effects: Set<string> }>();
const SYNERGY_MAP = new Map(SYNERGIES.map((y) => [y.id, y]));
function synergyEffect(s: RunV2, effect: string) {
  let entry = synergyCache.get(s);
  if (!entry || entry.ids !== s.synergies) {
    entry = {
      ids: s.synergies,
      effects: new Set(s.synergies.map((id) => SYNERGY_MAP.get(id)?.effect || '')),
    };
    synergyCache.set(s, entry);
  }
  return entry.effects.has(effect);
}
function visual(
  s: RunV2,
  kind: string,
  x: number,
  y: number,
  color: string,
  size: number,
  x2?: number,
  y2?: number,
) {
  s.visuals.push({ kind, x, y, x2, y2, color, size, life: 0.35, maxLife: 0.35 });
}
export function createRun(
  profile: Profile,
  towerId: TowerId,
  stage: number,
  difficulty: number,
  seed = Date.now() >>> 0,
  options: RunOptions = {},
): RunV3 {
  const t = TOWERS.find((t) => t.id === towerId) || TOWERS[0],
    maxHp = t.hp * (1 + (options.runes?.vitality ?? profile.upgrades.vitality) * 0.035);
  const s: RunV3 = {
    version: 2,
    rulesVersion: 3,
    mode: options.mode || 'normal',
    level: 1,
    xp: 0,
    xpRequired: 12,
    offerRng: (seed ^ 0x9e3779b9) >>> 0 || 1,
    runeSnapshot: {
      power: profile.upgrades.power,
      vitality: profile.upgrades.vitality,
      fortune: options.runes?.fortune ?? profile.upgrades.fortune,
      experience: 0,
      choices: 0,
      autoSignature: 0,
      autoSecondary: 0,
      ...options.runes,
    },
    id: `v3-${seed}-${towerId}-${Date.now()}`,
    tower: t.id,
    stage: clamp(stage, 0, 2),
    difficulty: clamp(difficulty, 0, 10),
    seed: seed >>> 0,
    rng: seed >>> 0 || 1,
    time: 0,
    wave: 1,
    waveTime: 0,
    spawned: 0,
    spawnTotal: 7,
    spawnTimer: 0.7,
    phase: 'combat',
    hp: maxHp,
    maxHp,
    shield: 0,
    scrap: 0,
    kills: 0,
    earned: 0,
    weapons: [],
    cards: [],
    enemies: [],
    projectiles: [],
    areas: [],
    visuals: [],
    buffs: [],
    pendingRewards: [],
    nextId: 1,
    targeting: 'nearest',
    skillCd: 0,
    secondaryCd: 0,
    secondary: 'repair',
    synergies: [],
    notices: [],
    endless: options.mode === 'endless',
    cleared: false,
    settled: false,
    damageByWeapon: {},
    damageByElement: { physical: 0, fire: 0, frost: 0, lightning: 0, poison: 0, solar: 0, void: 0 },
    counters: {
      profilePower: (options.runes?.power ?? profile.upgrades.power) * 0.025,
      profileExperience: Math.min(10, options.runes?.experience || 0) * 0.025,
      fortune: options.runes?.fortune ?? profile.upgrades.fortune,
      cardRevision: 0,
    },
    stats: {
      spent: 0,
      shopsVisited: 0,
      shopPurchases: 0,
      procCount: 0,
      peakEnemies: 0,
      peakProjectiles: 0,
      damageTaken: 0,
      skillsUsed: 0,
    },
    tutorialStep: profile.tutorialDone ? 99 : 0,
  };
  s.weapons.push({
    id: `weapon-${s.nextId++}`,
    kind: t.id === 'monolith' ? 'core-mirror' : t.pattern,
    cooldown: 0,
    shotCycle: 0,
    lifetimeShots: 0,
    mastery: 1,
    masteryRank: 1,
    masteryProgress: 0,
    masteryRequired: 60,
    fusionReady: false,
    rarity: 'normal',
    infusions: [t.element],
    angle: 0,
  });
  s.synergies = activeSynergies(s);
  return s;
}
export function activeSynergies(s: RunV2): string[] {
  if (s.rulesVersion !== 3) return legacy.activeSynergies(s);
  const tags = new Set<string>([s.tower, `tower:${s.tower}`, `tower-${s.tower}`]);
  for (const w of s.weapons) {
    for (const ingredient of w.fusion?.ingredients || []) {
      tags.add(ingredient.kind);
      tags.add(`weapon:${ingredient.kind}`);
      tags.add(`weapon-${ingredient.kind}`);
    }
    tags.add(w.kind);
    tags.add(`weapon:${w.kind}`);
    tags.add(`weapon-${w.kind}`);
    for (const e of w.infusions) {
      tags.add(e);
      tags.add(`element:${e}`);
      tags.add(`infusion-${e}`);
    }
  }
  for (const c of s.cards) {
    const d = card(c.cardId);
    if (!d) continue;
    tags.add(d.id);
    tags.add(d.effect);
    d.tags.forEach((t) => tags.add(t));
  }
  return SYNERGIES.filter((y) => y.requires.every((r) => tags.has(r))).map((y) => y.id);
}
export function getWeaponStats(s: RunV2, w: WeaponInstance): WeaponStats {
  if (s.rulesVersion !== 3) return legacy.getWeaponStats(s, w);
  if (w.fusion) return fusedStats(s, w);
  const d = weapon(w.kind),
    p = (k: string) => ep(s, k, w.id),
    t = tower(s),
    slow = p('slow') || p('heavy');
  const damage =
    d.damage *
    t.damage *
    (s.tower === 'monolith' && isDefensiveKind(w.kind) ? 1.5 : 1) *
    (1 + s.counters.profilePower + 0.1 * ((w.masteryRank || 1) - 1) + 0.03 * (w.mastery - 1)) *
    rarityPower(w.rarity) *
    (1 + p('damage') + buff(s, 'damage')) *
    (1 + slow * 0.45) *
    (1 - Math.min(0.35, (p('speed') * 0.06) / 0.22)) *
    (1 + p('charge'));
  const b: WeaponStats = {
    damage,
    cooldown: Math.max(
      0.12,
      (d.cooldown * (1 + (p('charge') * 0.16) / 0.35)) /
        (t.rate * (1 + p('rate') + buff(s, 'rate'))),
    ),
    range:
      d.range *
      (1 + p('range')) *
      (isDefensiveKind(w.kind) ? 1 + Math.min(0.5, p('defense-range')) : 1),
    speed: Math.max(35, (d.speed * (1 + p('speed'))) / (1 + slow + p('size') * 0.7)),
    size: Math.min(75, 5 * (1 + p('size'))),
    count: Math.min(12, 1 + Math.floor(p('count'))),
    pierce: Math.min(15, Math.floor(p('pierce'))),
    bounces: Math.min(8, Math.floor(p('bounce'))),
    homing: Math.min(10, p('homing')),
    split: Math.min(4, Math.floor(p('split'))),
    life: Math.min(12, 3 * (1 + p('lifetime')) * (synergyEffect(s, 'range-life') ? 1.3 : 1)),
    pulse: p('pulse'),
    trail: p('trail'),
    crit: Math.min(0.8, 0.05 + p('crit')),
    critDamage: 1.7 + p('crit-damage'),
    knockback: p('knockback'),
    returning: p('return') > 0,
    elements: [...w.infusions],
  };
  if (w.kind === 'volley') b.count = Math.min(12, b.count + 2);
  if (w.kind === 'spiral') b.count = Math.min(16, b.count + 7);
  if (w.kind === 'swarm' || w.kind === 'drone') {
    b.count = Math.min(10, b.count + 2);
    b.homing += 3;
  }
  if (w.kind === 'ricochet') b.bounces += 3;
  if (w.kind === 'rail' || w.kind === 'beam') b.pierce += 8;
  if (w.kind === 'chakram') b.returning = true;
  if (tier(w.rarity) >= 3) b.pierce = Math.min(15, b.pierce + 1);
  if (tier(w.rarity) >= 4) b.pulse = Math.max(b.pulse, 0.12);

  const view = fusionViewMeta.get(w);
  if (view) {
    b.damage *= 1.45 * (1 + (view.parent.fusion?.overflowPower || 0));
    if (view.recipeId === 'fusion-prism') b.bounces = Math.min(8, b.bounces + 1);
    if (view.recipeId === 'fusion-orrery') {
      b.returning = true;
      b.pulse = Math.max(b.pulse, 0.08);
    }
    if (view.recipeId === 'fusion-lance' && w.kind === 'bolt')
      b.pierce = Math.min(15, b.pierce + 2);
  }
  return b;
}
function promote(r: Rarity, mastery: number): Rarity {
  return RARITIES[Math.max(tier(r), Math.min(4, Math.floor(mastery / 3)))];
}
export function acquireCard(s: RunV2, offer: CardOffer, targetId?: string): boolean {
  if (s.rulesVersion !== 3) return legacy.acquireCard(s, offer, targetId);
  const d = card(offer.cardId);
  if (!d) return false;
  targetId = targetId || offer.targetId;
  if (d.group !== 'infusion' && d.group !== 'weapon' && d.effect !== 'mastery-focus')
    targetId = undefined;
  if (
    d.effect === 'mastery-focus' &&
    (!targetId ||
      !s.weapons.some((w) => w.id === targetId && !w.fusion && (w.masteryRank || 1) < 6))
  )
    return false;
  const prior = s.cards.find((c) => c.cardId === d.id && c.targetId === targetId);
  if (prior && prior.stacks >= d.maxStacks && tier(prior.rarity) >= tier(offer.rarity))
    return false;
  if (d.group === 'infusion' && (!targetId || !s.weapons.some((w) => w.id === targetId)))
    return false;
  if (d.group === 'weapon') {
    const w = s.weapons.find((w) => w.kind === d.weapon);
    if (!w && s.weapons.length >= 6) {
      if (!targetId || !s.weapons.some((x) => x.id === targetId)) return false;
      s.weapons = s.weapons.filter((x) => x.id !== targetId);
      s.cards = s.cards.filter((c) => c.targetId !== targetId);
      targetId = undefined;
    }
    if (w) {
      w.mastery = Math.min(24, w.mastery + 1);
      advanceMastery(w, 150);
      w.rarity = promote(tier(w.rarity) > tier(offer.rarity) ? w.rarity : offer.rarity, w.mastery);
    } else if (d.weapon)
      s.weapons.push({
        id: `weapon-${s.nextId++}`,
        kind: d.weapon,
        cooldown: 0,
        shotCycle: 0,
        lifetimeShots: 0,
        mastery: 1,
        masteryRank: 1,
        masteryProgress: 0,
        masteryRequired: 60,
        fusionReady: false,
        rarity: offer.rarity,
        infusions: [],
        angle: 0,
      });
    targetId = undefined;
  }
  const existing = s.cards.find((c) => c.cardId === d.id && c.targetId === targetId);
  if (existing) {
    if (existing.stacks >= d.maxStacks && tier(existing.rarity) >= tier(offer.rarity)) return false;
    existing.stacks = Math.min(d.maxStacks, existing.stacks + 1);
    existing.mastery++;
    existing.rarity = promote(
      tier(existing.rarity) > tier(offer.rarity) ? existing.rarity : offer.rarity,
      existing.mastery,
    );
  } else
    s.cards.push({
      cardId: d.id,
      stacks: 1,
      mastery: 1,
      rarity: offer.rarity,
      ...(targetId ? { targetId } : {}),
    });
  if (d.group === 'infusion' && d.element) {
    const w = s.weapons.find((w) => w.id === targetId)!;
    if (!w.infusions.includes(d.element)) w.infusions.push(d.element);
  }
  s.counters.cardRevision = (s.counters.cardRevision || 0) + 1;
  powers.delete(s);
  if (d.group !== 'weapon' && ep(s, 'mastery-investment'))
    for (const w of s.weapons) advanceMastery(w, Math.min(60, ep(s, 'mastery-investment')));
  if (d.effect === 'max-hp' || d.effect === 'vitality') {
    const gain = d.value * rarityPower(offer.rarity);
    s.maxHp += gain;
    s.hp += gain;
  }
  if (d.group === 'skill' && d.effect.startsWith('secondary-')) s.secondary = d.effect.slice(10);
  const previous = s.synergies;
  s.synergies = activeSynergies(s);
  for (const id of s.synergies.filter((id) => !previous.includes(id))) {
    const synergy = SYNERGY_MAP.get(id)!;
    s.notices.push(`Synergy awakened: ${synergy.name}`);
    s.visuals.push({
      kind: 'synergy',
      x: 500,
      y: 300,
      color: synergy.color,
      size: 95,
      life: 2,
      maxLife: 2,
      text: synergy.name,
    });
    s.visuals.push({
      kind: 'evolution',
      x: 500,
      y: 400,
      color: synergy.color,
      size: 120,
      life: 1.8,
      maxLife: 1.8,
    });
  }
  refreshFusionReady(s);
  return true;
}
export function previewCard(
  s: RunV2,
  offer: CardOffer,
  targetId?: string,
): { summary: string; awaken: string[]; lost: string[]; canApply?: boolean } {
  if (s.rulesVersion !== 3) return legacy.previewCard(s, offer, targetId);
  const copy = JSON.parse(
    JSON.stringify({ ...s, enemies: [], projectiles: [], areas: [], visuals: [] }),
  ) as RunV2;
  const before = activeSynergies(s),
    old = s.weapons.find((w) => w.id === targetId),
    d = card(offer.cardId);
  const ok = acquireCard(copy, offer, targetId);
  const lost = before
    .filter((id) => !activeSynergies(copy).includes(id))
    .map((id) => SYNERGY_MAP.get(id)?.name || id);
  if (
    old &&
    d?.group === 'weapon' &&
    old.kind !== d.weapon &&
    !copy.weapons.some((w) => w.id === old.id)
  )
    lost.push(
      `${weapon(old.kind).name}: mastery ${old.mastery}, ${old.infusions.join(', ') || 'no infusions'}`,
    );
  let summary = '';
  if (!ok)
    summary =
      d?.group === 'infusion'
        ? 'Choose a weapon to preview this infusion.'
        : d?.group === 'weapon'
          ? 'Choose an optional replacement; global cards remain.'
          : 'Family is already at its current cap.';
  else if (d?.group === 'weapon') {
    const w = copy.weapons.find((w) => w.kind === d.weapon)!;
    const st = getWeaponStats(copy, w);
    const prior = s.weapons.find((x) => x.kind === w.kind),
      previous = prior ? getWeaponStats(s, prior) : undefined;
    summary = `${prior ? 'Strengthens' : 'Adds'} ${weapon(w.kind).name} · ${previous ? `${previous.damage.toFixed(1)} → ` : ''}${st.damage.toFixed(1)} damage / ${previous && previous.cooldown !== st.cooldown ? `${previous.cooldown.toFixed(2)} → ` : ''}${st.cooldown.toFixed(2)}s · mastery ${prior ? `${prior.masteryRank || 1} → ` : ''}${w.masteryRank || 1}/6 · investment ${w.mastery} · ${w.rarity}`;
  } else if (d?.group === 'infusion') {
    const w = copy.weapons.find((w) => w.id === targetId)!;
    summary = `${weapon(w.kind).name}: ${w.infusions.join(' + ')} · direct damage shared across ${w.infusions.length} elements.`;
  } else if (d?.scope === 'projectiles') {
    const w = s.weapons[0],
      a = getWeaponStats(s, w),
      b = getWeaponStats(
        copy,
        copy.weapons.find((x) => x.id === w.id)!,
      );
    const changes: string[] = [];
    for (const [key, label] of [
      ['damage', 'Damage'],
      ['cooldown', 'Interval'],
      ['count', 'Count'],
      ['size', 'Radius'],
      ['speed', 'Speed'],
      ['range', 'Range'],
      ['life', 'Lifetime'],
      ['pierce', 'Pierce'],
      ['bounces', 'Bounces'],
      ['homing', 'Homing'],
      ['split', 'Split'],
      ['pulse', 'Pulse'],
      ['trail', 'Trail'],
      ['crit', 'Critical chance'],
      ['critDamage', 'Critical power'],
      ['knockback', 'Knockback'],
    ] as const) {
      if (a[key] !== b[key]) changes.push(`${label} ${a[key].toFixed(2)} → ${b[key].toFixed(2)}`);
    }
    summary = changes.slice(0, 3).join(' · ');
    if (summary) summary += ` (${weapon(w.kind).name}; applies to all eligible weapons)`;
  }
  if (!summary && d) {
    const a = ep(s, d.effect),
      b = ep(copy, d.effect);
    summary = `Effective ${d.effect.replaceAll('-', ' ')}: ${a.toFixed(2)} → ${b.toFixed(2)} · ${copy.cards.find((c) => c.cardId === d.id)?.rarity || offer.rarity}`;
  }
  return {
    canApply: ok,
    summary,
    awaken: activeSynergies(copy)
      .filter((id) => !before.includes(id))
      .map((id) => SYNERGY_MAP.get(id)?.name || id),
    lost,
  };
}
export const REPAIR_COST = 28;
export function rewardRerollCost(s: RunV2, id: string) {
  if (s.rulesVersion !== 3) return legacy.rewardRerollCost(s, id);
  const r = s.pendingRewards.find((r) => r.id === id);
  return Math.ceil((12 + (r?.rerolls || 0) * 12) * (1 - Math.min(0.6, ep(s, 'reroll'))));
}

function offerRandom(s: RunV2) {
  const v = s as RunV3;
  let x = v.offerRng | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  v.offerRng = x >>> 0 || 1;
  return v.offerRng / 4294967296;
}
function eligibleFamily(s: RunV2, c: (typeof CARDS)[number]): boolean {
  const copies = s.cards.filter((x) => x.cardId === c.id);
  if (copies.length && copies.every((x) => x.stacks >= c.maxStacks && x.rarity === 'mythic')) {
    if (c.group !== 'infusion' && c.effect !== 'mastery-focus') return false;
    if (s.weapons.every((w) => copies.some((x) => x.targetId === w.id))) return false;
  }
  if (c.group === 'infusion' && !s.weapons.length) return false;
  const offensive = s.weapons.some((w) => !isDefensiveKind(w.kind));
  if (
    c.scope === 'projectiles' &&
    !offensive &&
    !['damage', 'range', 'rate', 'infusion', 'skill-cooldown'].includes(c.effect)
  )
    return false;
  if (c.effect === 'mastery-focus' && !s.weapons.some((w) => !w.fusion && (w.masteryRank || 1) < 6))
    return false;
  return true;
}
function usableOffer(s: RunV2, offer: CardOffer): boolean {
  const c = card(offer.cardId);
  if (!c || !eligibleFamily(s, c)) return false;
  const applicable = (targetId?: string) => {
    const prior = s.cards.find((x) => x.cardId === c.id && x.targetId === targetId);
    return !prior || prior.stacks < c.maxStacks || tier(prior.rarity) < tier(offer.rarity);
  };
  if (c.group === 'infusion' || c.effect === 'mastery-focus')
    return s.weapons.some(
      (w) =>
        (c.effect !== 'mastery-focus' || (!w.fusion && (w.masteryRank || 1) < 6)) &&
        applicable(w.id),
    );
  return applicable();
}
function rollOffer(s: RunV2, d: (typeof CARDS)[number], shop: boolean): CardOffer | undefined {
  const roll =
    offerRandom(s) + Math.min(0.12, (s.counters.fortune || 0) * 0.008 + ep(s, 'fortune'));
  let rarity: Rarity =
    roll > 0.995
      ? 'mythic'
      : roll > 0.965
        ? 'legendary'
        : roll > 0.86
          ? 'epic'
          : roll > 0.6
            ? 'rare'
            : 'normal';
  const offer = { id: `offer-${s.nextId++}`, cardId: d.id, rarity, price: 0 };
  while (!usableOffer(s, offer) && tier(offer.rarity) < 4)
    offer.rarity = RARITIES[tier(offer.rarity) + 1];
  if (!usableOffer(s, offer)) return undefined;
  offer.price = shop
    ? Math.round((42 + tier(offer.rarity) * 15) * (1 - Math.min(0.3, ep(s, 'discount'))))
    : 0;
  return offer;
}
function makeOffers(s: RunV2, count: number, shop: boolean): CardOffer[] {
  const available = CARDS.filter((c) => eligibleFamily(s, c));
  const offers: CardOffer[] = [];
  const attempted = new Set<string>();
  while (offers.length < count) {
    let options = available.filter((c) => !attempted.has(c.id));
    if (!options.length) break;
    const i = offers.length;
    if (!shop && i === 0) {
      const owned = options.filter(
        (c) =>
          s.cards.some((x) => x.cardId === c.id) ||
          (c.weapon && s.weapons.some((w) => w.kind === c.weapon)),
      );
      if (owned.length) options = owned;
    } else if (!shop && i === 1) {
      const fresh = options.filter((c) => !s.cards.some((x) => x.cardId === c.id));
      if (fresh.length) options = fresh;
      const partners = options.filter(
        (c) =>
          c.weapon &&
          FUSIONS.some(
            (f) =>
              f.ingredients.includes(c.weapon!) &&
              f.ingredients.some(
                (kind) => kind !== c.weapon && s.weapons.some((w) => !w.fusion && w.kind === kind),
              ),
          ) &&
          !s.weapons.some((w) => w.kind === c.weapon),
      );
      if ((s.level || 1) % 4 === 0 && partners.length) options = partners;
      else if (s.weapons.length < 3) {
        const equipment = options.filter(
          (c) => c.weapon && !s.weapons.some((w) => w.kind === c.weapon),
        );
        const defensive = equipment.filter((c) => isDefensiveKind(c.weapon!));
        if (!s.weapons.some((w) => !isDefensiveKind(w.kind)) && defensive.length)
          options = defensive;
        else if (equipment.length) options = equipment;
      }
    }
    const d = options[Math.floor(offerRandom(s) * options.length)];
    attempted.add(d.id);
    const offer = rollOffer(s, d, shop);
    if (offer) offers.push(offer);
  }
  return offers;
}
/** Banked choices adapt when an intervening choice caps or removes their old target. */
export function refreshPendingOffers(s: RunV2): void {
  if (!isModern(s)) return;
  for (const reward of s.pendingRewards) {
    const used = new Set<string>();
    reward.offers = reward.offers.flatMap((offer) => {
      if (!used.has(offer.cardId) && usableOffer(s, offer)) {
        used.add(offer.cardId);
        return [offer];
      }
      const candidates = CARDS.filter(
        (c) =>
          !used.has(c.id) &&
          !reward.offers.some((o) => o !== offer && o.cardId === c.id) &&
          eligibleFamily(s, c),
      );
      while (candidates.length) {
        const index = Math.floor(offerRandom(s) * candidates.length),
          candidate = candidates.splice(index, 1)[0];
        const replacement = rollOffer(s, candidate, reward.kind === 'shop');
        if (replacement) {
          used.add(replacement.cardId);
          return [replacement];
        }
      }
      return [];
    });
  }
}
function queueReward(s: RunV2, kind: 'draft' | 'shop', wave: number) {
  s.pendingRewards.push({
    id: `reward-${s.nextId++}`,
    kind,
    wave,
    offers: makeOffers(
      s,
      kind === 'shop' ? 4 : 3 + Math.min(2, (s as RunV3).runeSnapshot.choices || 0),
      kind === 'shop',
    ),
    rerolls: 0,
    repairStock: kind === 'shop' ? 1 : 0,
  });
  if (kind === 'shop') s.stats.shopsVisited++;
}
export function chooseReward(s: RunV2, rewardId: string, offerId: string, targetId?: string) {
  if (s.rulesVersion !== 3) return legacy.chooseReward(s, rewardId, offerId, targetId);
  if (s.phase !== 'combat') return false;
  const r = s.pendingRewards.find((r) => r.id === rewardId);
  if (!r || r.kind !== 'draft') return false;
  const o = r.offers.find((o) => o.id === offerId);
  if (!o || !acquireCard(s, o, targetId)) return false;
  s.pendingRewards = s.pendingRewards.filter((r) => r.id !== rewardId);
  refreshPendingOffers(s);
  return true;
}
export function buyOffer(s: RunV2, rewardId: string, offerId: string, targetId?: string) {
  if (s.rulesVersion !== 3) return legacy.buyOffer(s, rewardId, offerId, targetId);
  if (s.phase !== 'combat') return false;
  const r = s.pendingRewards.find((r) => r.id === rewardId);
  if (!r || r.kind !== 'shop') return false;
  const o = r.offers.find((o) => o.id === offerId);
  if (!o || s.scrap < o.price || !acquireCard(s, o, targetId)) return false;
  s.scrap -= o.price;
  s.stats.spent += o.price;
  s.stats.shopPurchases++;
  r.offers = r.offers.filter((a) => a.id !== o.id);
  refreshPendingOffers(s);
  return true;
}
export function rerollReward(s: RunV2, id: string) {
  if (s.rulesVersion !== 3) return legacy.rerollReward(s, id);
  if (s.phase !== 'combat') return false;
  const r = s.pendingRewards.find((r) => r.id === id);
  const cost = Math.ceil((12 + (r?.rerolls || 0) * 12) * (1 - Math.min(0.6, ep(s, 'reroll'))));
  if (!r || s.scrap < cost) return false;
  s.scrap -= cost;
  s.stats.spent += cost;
  r.rerolls++;
  r.offers = makeOffers(
    s,
    r.kind === 'shop' ? r.offers.length : 3 + Math.min(2, (s as RunV3).runeSnapshot.choices || 0),
    r.kind === 'shop',
  );
  return true;
}
export function closeShop(s: RunV2, id: string) {
  if (s.rulesVersion !== 3) return legacy.closeShop(s, id);
  s.pendingRewards = s.pendingRewards.filter((r) => r.id !== id || r.kind !== 'shop');
}
export function repair(s: RunV2, id: string) {
  if (s.rulesVersion !== 3) return legacy.repair(s, id);
  if (s.phase !== 'combat') return false;
  const r = s.pendingRewards.find((r) => r.id === id),
    cost = 28;
  if (!r || r.kind !== 'shop' || !r.repairStock || s.scrap < cost || s.hp >= s.maxHp) return false;
  s.scrap -= cost;
  s.stats.spent += cost;
  r.repairStock--;
  s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.3 * (1 + ep(s, 'repair')));
  return true;
}
export function continueEndless(s: RunV2) {
  if (s.rulesVersion !== 3) return legacy.continueEndless(s);
  if (s.phase !== 'victory') return;
  s.endless = true;
  s.phase = 'combat';
  const endpoint = finalWave(s);
  queueReward(s, 'shop', endpoint);
  startWave(s, endpoint + 1);
}
export function retire(s: RunV2) {
  if (s.rulesVersion !== 3) return legacy.retire(s);
  s.phase = 'ended';
}
export function rewardForRun(s: RunV2) {
  if (s.rulesVersion !== 3) return legacy.rewardForRun(s);
  return Math.floor(
    s.time * 0.055 + s.earned * 0.08 + (s.cleared ? (s.mode === 'quick' ? 55 : 110) : 0),
  );
}
export function describeNextThreat(s: RunV2) {
  if (s.rulesVersion !== 3) return legacy.describeNextThreat(s);
  const n = s.wave + (s.phase === 'victory' ? 1 : 0);
  const bossIndex =
    s.mode === 'quick' && [12, 25, 37, 50].includes(n)
      ? [12, 25, 37, 50].indexOf(n)
      : (((Math.floor(n / 25) - 1) % 4) + 4) % 4;
  return bossWave(s, n)
    ? `${STAGES[s.stage].bosses[bossIndex]}: watch the marked strike zones.`
    : n % 10 === 0
      ? 'Elite formation: armor, support and ranged pressure.'
      : n % 7 === 0
        ? 'Splitters divide into two enemies without extra bounty.'
        : n % 5 === 0
          ? 'Ranged attackers telegraph strikes from the outer ring.'
          : 'Mixed advance: prioritize the nearest threats.';
}
function shieldCap(s: RunV2) {
  return s.maxHp * 0.45 + ep(s, 'shield');
}
function grantShield(s: RunV2, n: number) {
  const previous = s.shield;
  s.shield = Math.min(shieldCap(s), s.shield + n);
  s.counters.protectionShieldGenerated =
    (s.counters.protectionShieldGenerated || 0) + Math.max(0, s.shield - previous);
}
function ready(s: RunV2, key: string, seconds: number) {
  if ((s.counters[key] || 0) > s.time) return false;
  s.counters[key] = s.time + seconds;
  return true;
}
function triggeredBuff(
  s: RunV2,
  key: string,
  stat: string,
  value: number,
  duration: number,
  cooldown = 0.25,
) {
  if (value && ready(s, key, cooldown)) addBuff(s, key, stat, value, duration);
}
function makeArea(
  s: RunV2,
  kind: RunV2['areas'][number]['kind'],
  x: number,
  y: number,
  damage: number,
  radius: number,
  life: number,
  element: Element,
  weaponId: string,
  delay = 0,
  depth = 1,
) {
  s.areas.push({
    id: s.nextId++,
    kind,
    x,
    y,
    damage,
    radius,
    life,
    maxLife: life,
    tickTimer: 0,
    element,
    weaponId,
    delay,
    depth,
  });
}
function splash(
  s: RunV2,
  e: EnemyV2,
  damage: number,
  radius: number,
  event: DamageEvent,
  exclude = true,
) {
  if (event.depth >= MAX_DEPTH) return;
  for (const other of s.enemies) {
    if (other.hp > 0 && (!exclude || other.id !== e.id) && dist(other, e) < radius) {
      dealDamage(s, other, { ...event, source: 'proc', damage, depth: event.depth + 1 });
      if (synergyEffect(s, 'knockback-blast')) push(other, ep(s, 'knockback') * 0.4);
    }
  }
}
function push(e: EnemyV2, amount: number) {
  const d = Math.max(1, dist(e, origin)),
    resist = e.kind === 'boss' ? 0.3 : e.kind === 'elite' ? 0.55 : 1;
  e.x += ((e.x - origin.x) / d) * amount * resist;
  e.y += ((e.y - origin.y) / d) * amount * resist;
}
function kill(s: RunV2, e: EnemyV2, event: DamageEvent) {
  if (e.reward < 0) return;
  e.reward = -1;
  const budget = e.xpBudget || 0;
  if (budget > 0) grantXp(s, budget * (e.kind === 'splitter' ? 0.5 : 1), e.kind);
  s.kills++;
  s.scrap += e.bounty * (1 + ep(s, 'bounty'));
  s.earned += e.bounty;
  const duration = 2 + (synergyEffect(s, 'kill-duration') ? 2 : 0);
  if (ep(s, 'kill-fury')) addBuff(s, 'kill-fury', 'damage', ep(s, 'kill-fury'), duration);
  if (ep(s, 'kill-haste')) addBuff(s, 'kill-haste', 'rate', ep(s, 'kill-haste'), duration);
  grantShield(s, ep(s, 'kill-shield'));
  if (s.kills % 5 === 0) {
    s.hp = Math.min(s.maxHp, s.hp + ep(s, 'kill-mend'));
    if (synergyEffect(s, 'kill-bounty')) s.scrap += 3;
  }
  if (e.kind === 'splitter') {
    const known = new Set(s.enemies.map((enemy) => enemy.id));
    const first = spawnEnemy(s, 'swarmer', e.x - 13, e.y, 0);
    if (!known.has(first.id)) {
      first.xpBudget = budget * 0.25;
      known.add(first.id);
    } else grantXp(s, budget * 0.25);
    const second = spawnEnemy(s, 'swarmer', e.x + 13, e.y, 0);
    if (!known.has(second.id)) second.xpBudget = budget * 0.25;
    else grantXp(s, budget * 0.25);
  }
  visual(s, 'hit', e.x, e.y, '#f5d996', e.radius * 1.4);
  void event;
}
export function dealDamage(s: RunV2, e: EnemyV2, event: DamageEvent): number {
  if (s.rulesVersion !== 3) return legacy.dealDamage(s, e, event);
  if (e.hp <= 0 || event.damage <= 0 || event.depth > MAX_DEPTH) return 0;
  let amount = event.damage,
    el = event.element;
  if (event.source === 'primary') {
    if (el !== 'physical') amount *= 1 + ep(s, 'conductivity', event.weaponId);
    if (el === 'fire' && s.tower === 'pyre') amount *= 1.2;
    if (el === 'void' && s.tower === 'null' && dist(e, origin) < 180) amount *= 1.3;
    if (e.burn && e.poison && synergyEffect(s, 'toxic-fire')) amount *= 1.25;

    if (
      ep(s, 'focus', event.weaponId) &&
      !s.enemies.some((o) => o.id !== e.id && o.hp > 0 && dist(e, o) < 70)
    )
      amount *= (1 + ep(s, 'focus', event.weaponId)) * (synergyEffect(s, 'charge-focus') ? 1.2 : 1);
  }
  amount *= e.mark > 0 ? 1.22 : 1;
  amount *= 1 - clamp(e.armor, 0, 0.65);
  const dealt = Math.min(e.hp, amount);
  recordDamageNumber(s, e, dealt, event);
  e.hp -= amount;
  s.damageByWeapon[event.weaponId] = (s.damageByWeapon[event.weaponId] || 0) + dealt;
  s.damageByElement[el] += dealt;
  if (event.source === 'proc') s.stats.procCount++;
  if (event.source === 'primary' && ep(s, 'hit-shield') && ready(s, 'hit-shield', 0.25))
    grantShield(s, Math.min(8, ep(s, 'hit-shield')));
  if (event.source === 'primary') {
    const scale = 1 + ep(s, 'infusion', event.weaponId) * 0.3;
    if (el === 'fire')
      e.burn = Math.min(
        e.maxHp * 0.3,
        e.burn + amount * 0.12 * scale * (s.tower === 'pyre' ? 1.2 : 1),
      );
    if (el === 'poison') e.poison = Math.min(e.maxHp * 0.45, e.poison + amount * 0.1 * scale);
    if (el === 'frost') {
      e.chill = Math.min(
        s.tower === 'glacier' ? 0.78 : 0.68,
        e.chill +
          0.16 *
            scale *
            (s.tower === 'glacier' ? 1.2 : 1) *
            (synergyEffect(s, 'frost-pierce') ? 1.2 : 1),
      );
    }
    if (el === 'solar') {
      e.mark = 3;
      if (s.tower === 'bastion') grantShield(s, dealt * 0.012);
    }
    if (el === 'void') push(e, -7 * scale * (synergyEffect(s, 'void-homing') ? 1.4 : 1));
    const leech =
      ep(s, 'lifesteal') *
        (synergyEffect(s, 'blood-fury') && s.buffs.some((b) => b.source === 'hurt-fury') ? 2 : 1) +
      (el === 'poison' && s.tower === 'verdant' ? 0.012 : 0);
    healTower(s, dealt * leech, event.source === 'primary');
    triggeredBuff(s, 'burn-fury', 'damage', e.burn ? ep(s, 'burn-fury') : 0, 2);
    triggeredBuff(s, 'freeze-crit', 'crit', e.chill ? ep(s, 'freeze-crit') : 0, 2);
    triggeredBuff(s, 'poison-haste', 'rate', e.poison ? ep(s, 'poison-haste') : 0, 2);
    triggeredBuff(s, 'boss-fury', 'damage', e.kind === 'boss' ? ep(s, 'boss-fury') : 0, 3);
    if (ep(s, 'blast', event.weaponId))
      splash(s, e, amount * ep(s, 'blast', event.weaponId), 48, event);
    if (synergyEffect(s, 'steam') && (el === 'fire' || el === 'frost') && e.burn && e.chill)
      splash(s, e, amount * 0.18, 65, event);
    if (el === 'lightning' && event.depth === 0) {
      const targets = s.enemies
        .filter((o) => o.id !== e.id && o.hp > 0 && dist(o, e) < 110)
        .sort((a, b) => dist(a, e) - dist(b, e))
        .slice(0, (s.tower === 'tempest' ? 3 : 1) + (synergyEffect(s, 'storm-bounce') ? 1 : 0));
      for (const other of targets) {
        dealDamage(s, other, { ...event, source: 'proc', depth: 1, damage: amount * 0.35 });
        if (synergyEffect(s, 'plasma')) other.burn += amount * 0.06;
        visual(s, 'chain', e.x, e.y, '#ffe48e', 2, other.x, other.y);
      }
    }
  }
  if (e.hp <= 0) {
    if (el === 'solar') grantShield(s, 1);
    kill(s, e, event);
  }
  return dealt;
}
function hit(s: RunV2, e: EnemyV2, p: ProjectileV2, damage = p.damage) {
  const parts = p.elements.length ? p.elements : ['physical' as const];
  const w = s.weapons.find((w) => w.id === p.weaponId);
  let amount = damage;
  if (w && w.infusions.length > 1 && synergyEffect(s, 'element-resonance')) amount *= 1.2;
  if (
    w &&
    w.infusions.includes('solar') &&
    w.infusions.includes('void') &&
    synergyEffect(s, 'eclipse')
  )
    amount *= 1.25;
  if (w) amount *= 1 + ep(s, 'resonance', w.id) * w.infusions.length;
  for (const el of parts)
    dealDamage(s, e, {
      rootId: p.id,
      source: p.depth ? 'proc' : 'primary',
      depth: p.depth,
      weaponId: p.weaponId,
      damage: amount / parts.length,
      critical: p.critical,
      element: el,
    });
  if (p.depth === 0) {
    push(e, ep(s, 'knockback', p.weaponId));
    if (p.critical) {
      triggeredBuff(s, 'crit-haste', 'rate', ep(s, 'crit-haste'), 2);
      grantShield(s, ep(s, 'crit-shield') + (synergyEffect(s, 'crit-aegis') ? 2 : 0));
      if (ep(s, 'crit-blast'))
        splash(s, e, amount * ep(s, 'crit-blast'), 65, {
          rootId: p.id,
          source: 'proc',
          depth: 0,
          weaponId: p.weaponId,
          damage: amount,
          element: parts[0],
        });
    }
  }
  visual(
    s,
    'hit',
    e.x,
    e.y,
    parts[0] === 'physical' ? '#e2d6ad' : weapon(w?.kind || 'bolt').color,
    4 + p.radius * 0.3,
  );
}
export function takeDamage(
  s: RunV2,
  amount: number,
  element: Element | 'physical' = 'physical',
  attacker?: EnemyV2,
) {
  if (s.rulesVersion !== 3) return legacy.takeDamage(s, amount, element, attacker);
  const defense = getDefenseStats(s),
    rawIncoming = amount;
  amount *= 1 - defense.mitigation[element];
  s.counters.protectionPrevented =
    (s.counters.protectionPrevented || 0) + Math.max(0, rawIncoming - amount);
  const previousShield = s.shield,
    absorbed = Math.min(s.shield, amount);
  s.shield -= absorbed;
  s.hp -= amount - absorbed;
  s.stats.damageTaken += amount - absorbed;
  s.counters.protectionAbsorbed = (s.counters.protectionAbsorbed || 0) + absorbed;
  reactCores(s, amount, absorbed, attacker, element);
  if (ep(s, 'hurt-charge') && ready(s, 'hurt-charge', 0.6))
    addBuff(s, 'hurt-charge', 'damage', Math.min(0.5, ep(s, 'hurt-charge')), 4);
  if (attacker && dist(attacker, origin) < 90 && ep(s, 'thorns')) {
    dealDamage(s, attacker, {
      rootId: s.nextId++,
      source: 'retaliation',
      depth: 1,
      weaponId: 'thorns',
      damage: ep(s, 'thorns') * (synergyEffect(s, 'thorn-reflect') ? 2 : 1),
      element: 'physical',
    });
    visual(s, 'thorns', origin.x, origin.y, '#d8b474', 40, attacker.x, attacker.y);
  }
  if (attacker && ep(s, 'reflect')) {
    dealDamage(s, attacker, {
      rootId: s.nextId++,
      source: 'retaliation',
      depth: 1,
      weaponId: 'reflect',
      damage: amount * ep(s, 'reflect') * (synergyEffect(s, 'solar-reflect') ? 2 : 1),
      element: synergyEffect(s, 'solar-reflect') ? 'solar' : element,
    });
    visual(s, 'reflect', origin.x, origin.y, '#bce8e2', 30, attacker.x, attacker.y);
  }
  if (ep(s, 'retaliation') && ready(s, 'retaliation', 0.6)) {
    const damage =
      ep(s, 'retaliation') *
      (s.hp < s.maxHp * 0.3 && synergyEffect(s, 'emergency-retaliation') ? 2 : 1);
    for (const e of s.enemies)
      if (dist(e, origin) < 160)
        dealDamage(s, e, {
          rootId: s.nextId++,
          source: 'retaliation',
          depth: 1,
          weaponId: 'retaliation',
          damage,
          element: 'physical',
        });
    visual(s, 'retaliation', origin.x, origin.y, '#dfb784', 160);
  }
  if (
    previousShield > 0 &&
    s.shield === 0 &&
    ep(s, 'shield-break') &&
    ready(s, 'shield-break', 2)
  ) {
    for (const e of s.enemies)
      if (dist(e, origin) < 190) {
        e.stun = Math.max(e.stun, ep(s, 'shield-break') * (e.kind === 'boss' ? 0.35 : 1));
        if (synergyEffect(s, 'break-frost'))
          dealDamage(s, e, {
            rootId: s.nextId++,
            source: 'retaliation',
            depth: 1,
            weaponId: 'shield-break',
            damage: 35,
            element: 'frost',
          });
      }
    visual(s, 'shield', origin.x, origin.y, '#8fd9f4', 190);
  }
  triggeredBuff(s, 'hurt-fury', 'damage', ep(s, 'hurt-fury'), 4, 0.6);
  triggeredBuff(s, 'hurt-haste', 'rate', ep(s, 'hurt-haste'), 4, 0.6);
  if (ep(s, 'hurt-freeze') && ready(s, 'hurt-freeze', 0.6))
    for (const e of s.enemies)
      if (dist(e, origin) < 200) e.chill = Math.max(e.chill, ep(s, 'hurt-freeze'));
}
export function spawnEnemy(
  s: RunV2,
  kind?: EnemyV2['kind'],
  x?: number,
  y?: number,
  bounty?: number,
): EnemyV2 {
  if (s.rulesVersion !== 3) return legacy.spawnEnemy(s, kind, x, y, bounty);
  if (s.enemies.length >= 96) return s.enemies[s.enemies.length - 1];
  let encounter =
    (s.seed ^
      Math.imul(s.wave, 73856093) ^
      Math.imul(bounty === 0 ? s.nextId : s.spawned + 1, 19349663)) >>>
    0;
  const draw = () => {
    encounter ^= encounter << 13;
    encounter ^= encounter >>> 17;
    encounter ^= encounter << 5;
    return (encounter >>> 0) / 4294967296;
  };
  const roll = draw(),
    angle = draw() * Math.PI * 2;
  kind =
    kind ||
    (s.wave < 4
      ? 'swarmer'
      : roll < 0.25
        ? 'swarmer'
        : roll < 0.43
          ? 'runner'
          : roll < 0.6
            ? 'armored'
            : roll < 0.76
              ? 'ranged'
              : roll < 0.87
                ? 'support'
                : 'splitter');
  const encounterWave = s.mode === 'quick' ? s.wave * 2 : s.wave;
  const scale =
      (1 + encounterWave * 0.075 + Math.pow(encounterWave / 13, 2)) *
      (s.mode === 'quick' ? ENCOUNTER_BALANCE.quickHealth : ENCOUNTER_BALANCE.normalHealth) *
      (1 + s.stage * 0.03) *
      (1 + s.difficulty * 0.2) *
      (1 + Math.max(0, s.wave - finalWave(s)) * 0.055),
    mult = {
      swarmer: 1,
      runner: 0.65,
      armored: 2.4,
      ranged: 1.2,
      support: 1.7,
      splitter: 1.5,
      elite: 7,
      boss: 24,
    }[kind],
    hp = (s.stage === 0 ? 19 : 18) * scale * mult;
  const e: EnemyV2 = {
    id: s.nextId++,
    kind,
    x: x ?? origin.x + Math.cos(angle) * 440,
    y: y ?? origin.y + Math.sin(angle) * 340,
    hp,
    maxHp: hp,
    speed:
      kind === 'runner'
        ? 43
        : kind === 'boss'
          ? 8
          : kind === 'armored'
            ? 14 + s.wave * 0.12
            : 21 + s.wave * 0.16,
    damage:
      (s.stage === 0
        ? kind === 'boss'
          ? 12.5
          : kind === 'ranged'
            ? 5
            : 3.8
        : kind === 'boss'
          ? 13
          : kind === 'ranged'
            ? 5.2
            : 4) *
      (1 + encounterWave * 0.03) *
      (s.mode === 'quick' ? ENCOUNTER_BALANCE.quickDamage : ENCOUNTER_BALANCE.normalDamage),
    radius: kind === 'boss' ? 29 : kind === 'elite' ? 19 : kind === 'armored' ? 13 : 9,
    armor: kind === 'armored' ? 0.3 : kind === 'boss' ? 0.15 : 0,
    attackCd: 1.5,
    burn: 0,
    poison: 0,
    chill: 0,
    mark: 0,
    stun: 0,
    vx: 0,
    vy: 0,
    reward: 1,
    damageType:
      kind === 'ranged' || kind === 'boss'
        ? ELEMENTS[(s.stage + Math.floor(s.wave / 10)) % 6]
        : 'physical',
    bounty: bounty ?? (kind === 'boss' ? 10 : kind === 'elite' ? 3 : 0.4),
    bossPhase: 0,
    spawnWave: s.wave,
    xpBudget: bounty === 0 ? 0 : kind === 'boss' ? 25 : kind === 'elite' ? 8 : 1,
  };
  s.enemies.push(e);
  return e;
}
function startWave(s: RunV2, wave: number) {
  s.wave = wave;
  s.waveTime = 0;
  s.spawned = 0;
  s.spawnTotal = Math.min(40, 7 + Math.floor(wave * (s.mode === 'quick' ? 0.46 : 0.23)));
  s.spawnTimer = 1;
  grantShield(s, ep(s, 'wave-shield'));
  const duration = 5 + (synergyEffect(s, 'wave-duration') ? 4 : 0);
  if (ep(s, 'wave-haste')) addBuff(s, 'wave-haste', 'rate', ep(s, 'wave-haste'), duration);
  if (ep(s, 'wave-damage')) addBuff(s, 'wave-damage', 'damage', ep(s, 'wave-damage'), duration);
}
function chooseTarget(s: RunV2, range: number, from = origin): EnemyV2 | undefined {
  let best: EnemyV2 | undefined,
    value = Infinity;
  for (const e of s.enemies) {
    if (e.hp <= 0 || dist(e, from) > range) continue;
    const v =
      s.targeting === 'strongest' ? -e.hp : s.targeting === 'weakest' ? e.hp : dist(e, from);
    if (v < value) {
      value = v;
      best = e;
    }
  }
  return best;
}
function projectile(
  s: RunV2,
  w: WeaponInstance,
  st: WeaponStats,
  angle: number,
  kind = w.kind,
  x = origin.x,
  y = origin.y,
  depth = 0,
  scale = 1,
): ProjectileV2 {
  const critical = random(s) < Math.min(0.8, st.crit + buff(s, 'crit'));
  const p: ProjectileV2 = Object.assign(projectilePools.get(s)?.pop() || ({} as ProjectileV2), {
    id: s.nextId++,
    weaponId: w.id,
    fusionId: w.fusion?.recipeId || fusionViewMeta.get(w)?.recipeId,
    kind,
    x,
    y,
    vx: Math.cos(angle) * st.speed,
    vy: Math.sin(angle) * st.speed,
    life: st.life,
    maxLife: st.life,
    damage:
      st.damage *
      (critical ? st.critDamage * (synergyEffect(s, 'crit-execute') ? 1.25 : 1) : 1) *
      scale,
    radius: st.size,
    elements: [...st.elements],
    pierce: st.pierce,
    bounces: st.bounces,
    homing: st.homing,
    split: st.split,
    hit: [],
    pulseTimer: 0.8,
    pulseInterval: st.pulse ? 0.8 : 0,
    returning: st.returning,
    originX: x,
    originY: y,
    critical,
    depth,
    seed: Math.floor(random(s) * 1e9),
    previousX: x,
    previousY: y,
  });
  s.projectiles.push(p);
  return p;
}
function fireWeapon(s: RunV2, w: WeaponInstance) {
  if (w.fusion) return fireFusedWeapon(s, w);
  if (isDefensiveKind(w.kind)) return false;
  if (s.projectiles.length >= 4096) return false;
  const st = getWeaponStats(s, w),
    target = chooseTarget(s, st.range);
  if (!target) return false;
  w.shotCycle = (w.shotCycle + 1) % 12;
  w.lifetimeShots++;
  w.angle += 0.31;
  const a = Math.atan2(target.y - origin.y, target.x - origin.x),
    kind = w.kind;
  if (kind === 'beam' || kind === 'rail') {
    const p = projectile(s, w, st, a);
    p.life = 0.035;
    p.maxLife = 0.035;
    const dx = Math.cos(a),
      dy = Math.sin(a);
    for (const e of s.enemies) {
      const x = e.x - origin.x,
        y = e.y - origin.y,
        along = x * dx + y * dy,
        perp = Math.abs(x * dy - y * dx);
      if (along > 0 && along < st.range && perp < e.radius + st.size) {
        const flightGain = Math.min(
          0.35,
          (p.maxLife - p.life) * ep(s, 'flight-damage', p.weaponId),
        );
        hit(s, e, p, p.damage * (1 + flightGain));
        if (p.depth === 0 && ep(s, 'mass-knockback', p.weaponId))
          push(e, Math.min(80, (ep(s, 'mass-knockback', p.weaponId) * p.radius) / 5));
        if (p.pierce-- <= 0) break;
      }
    }
    p.hit = s.enemies.map((e) => e.id);
    visual(
      s,
      kind,
      origin.x,
      origin.y,
      weapon(kind).color,
      st.size,
      origin.x + dx * st.range,
      origin.y + dy * st.range,
    );
  } else if (kind === 'pulse') {
    const p = projectile(s, w, st, a);
    p.vx = p.vy = 0;
    p.life = 0.04;
    for (const e of s.enemies) if (dist(e, origin) < st.range) hit(s, e, p, st.damage * 0.8);
    p.hit = s.enemies.map((e) => e.id);
    visual(s, 'pulse', origin.x, origin.y, weapon(kind).color, st.range);
  } else if (kind === 'meteor') {
    makeArea(
      s,
      'meteor',
      target.x,
      target.y,
      st.damage * 2,
      70 * (synergyEffect(s, 'meteor-forge') ? 1.3 : 1),
      3.8,
      'fire',
      w.id,
      0.9,
      0,
    );
  } else if (kind === 'mine') {
    const p = projectile(s, w, st, a);
    p.x = target.x;
    p.y = target.y;
    p.vx = p.vy = 0;
    p.life = 5;
    p.maxLife = 5;
    p.radius = st.size * 1.4;
  } else if (kind === 'tesla') {
    const p = projectile(s, w, st, a);
    p.life = 0.04;
    p.vx = p.vy = 0;
    p.elements = st.elements.length ? st.elements : ['lightning'];
    let last = origin;
    for (const e of [
      target,
      ...s.enemies
        .filter((e) => e !== target && e.hp > 0 && dist(e, target) < 150)
        .slice(0, 2 + st.bounces),
    ]) {
      hit(s, e, p, st.damage);
      p.hit.push(e.id);
      visual(s, 'chain', last.x, last.y, weapon(kind).color, 3, e.x, e.y);
      last = e;
    }
  } else if (kind === 'drone') {
    const existing = s.projectiles.filter(
      (p) => p.kind === 'drone' && p.weaponId === w.id && p.life > 0,
    ).length;
    for (let i = existing; i < st.count; i++) {
      const p = projectile(s, w, st, a);
      p.life = p.maxLife = 12;
      p.damage = st.damage;
      p.vx = p.vy = 0;
      p.seed = (i * Math.PI * 2) / st.count;
      p.pulseInterval = 0;
    }
  } else if (kind === 'orbit') {
    for (let i = 0; i < 3 + st.count; i++) {
      const p = projectile(s, w, st, w.angle + (i * Math.PI * 2) / (3 + st.count));
      p.life = 4;
      p.maxLife = 4;
      p.radius = st.size + 4;
      p.pierce = 99;
      p.originX = origin.x;
      p.originY = origin.y;
      p.seed = (i * Math.PI * 2) / (3 + st.count);
    }
  } else {
    const count = kind === 'flame' ? st.count + 4 : st.count;
    for (let i = 0; i < count; i++) {
      const angle =
        kind === 'spiral'
          ? w.angle + (i * Math.PI * 2) / count
          : a + (i - (count - 1) / 2) * (kind === 'flame' ? 0.13 : 0.12);
      const p = projectile(s, w, st, angle);
      if (kind === 'flame') {
        p.life = st.range / st.speed;
        p.radius += 4;
        if (!p.elements.includes('fire')) p.elements.push('fire');
      }
      if (kind === 'singularity') {
        p.vx *= 0.25;
        p.vy *= 0.25;
        p.radius += 14;
        p.pierce = 9;
        p.pulseInterval = 0.65;
        if (!p.elements.includes('void')) p.elements.push('void');
      }
    }
  }
  if (ep(s, 'burst', w.id) && w.shotCycle % 3 === 0)
    projectile(
      s,
      w,
      st,
      a + 0.08,
      'bolt',
      origin.x,
      origin.y,
      0,
      synergyEffect(s, 'rate-burst') ? 1.35 : 1,
    );
  if (ep(s, 'orbit', w.id) && ready(s, `orbit-${w.id}`, 3)) {
    const p = projectile(
      s,
      w,
      st,
      w.angle,
      'orbit',
      origin.x,
      origin.y,
      0,
      synergyEffect(s, 'orbit-thorns') ? 1.4 : 1,
    );
    p.life = 4;
    p.maxLife = 4;
    p.pierce = 20;
    p.seed = w.angle;
  }
  w.cooldown = st.cooldown;
  return true;
}
function segmentDistance(x: number, y: number, p: ProjectileV2) {
  const dx = p.x - p.previousX,
    dy = p.y - p.previousY,
    len = dx * dx + dy * dy,
    t = len ? clamp(((x - p.previousX) * dx + (y - p.previousY) * dy) / len, 0, 1) : 0;
  return Math.hypot(x - p.previousX - dx * t, y - p.previousY - dy * t);
}
class Grid {
  cells = new Map<string, EnemyV2[]>();
  constructor(enemies: EnemyV2[]) {
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      const key = `${Math.floor(e.x / 80)},${Math.floor(e.y / 80)}`;
      const a = this.cells.get(key);
      if (a) a.push(e);
      else this.cells.set(key, [e]);
    }
  }
  near(x: number, y: number, r: number) {
    const found: EnemyV2[] = [];
    for (let ix = Math.floor((x - r) / 80); ix <= Math.floor((x + r) / 80); ix++)
      for (let iy = Math.floor((y - r) / 80); iy <= Math.floor((y + r) / 80); iy++) {
        const a = this.cells.get(`${ix},${iy}`);
        if (a) found.push(...a);
      }
    return found;
  }
}
function stepProjectiles(s: RunV2, dt: number) {
  const grid = new Grid(s.enemies),
    initial = s.projectiles.length;
  for (let i = 0; i < initial; i++) {
    const p = s.projectiles[i];
    p.life -= dt;
    if (p.life <= 0) continue;
    p.previousX = p.x;
    p.previousY = p.y;
    if (p.depth === 0 && ep(s, 'flight-acceleration', p.weaponId)) {
      const age = p.maxLife - p.life,
        rate = ep(s, 'flight-acceleration', p.weaponId);
      const ratio = (1 + Math.min(1, age * rate)) / (1 + Math.min(1, Math.max(0, age - dt) * rate));
      p.vx *= ratio;
      p.vy *= ratio;
    }
    if (p.kind === 'drone') {
      const angle = p.seed + (p.maxLife - p.life) * 0.55;
      p.x = origin.x + Math.cos(angle) * 90;
      p.y = origin.y + Math.sin(angle) * 90;
      const w = s.weapons.find((w) => w.id === p.weaponId),
        target = chooseTarget(s, w ? getWeaponStats(s, w).range : 300, p);
      if (w && target && s.projectiles.length < 4096 && ready(s, `drone-${p.id}`, 0.65)) {
        const st = getWeaponStats(s, w);
        st.damage = p.damage * 0.4;
        const carrier = p.fusionId === 'fusion-citadel';
        if (carrier) {
          for (let launch = -1; launch <= 1; launch++) {
            const shot = projectile(
              s,
              w,
              { ...st, damage: st.damage / 3, homing: Math.max(4, st.homing) },
              Math.atan2(target.y - p.y, target.x - p.x) + launch * 0.1,
              'swarm',
              p.x,
              p.y,
              0,
            );
            shot.fusionId = p.fusionId;
          }
        } else
          projectile(s, w, st, Math.atan2(target.y - p.y, target.x - p.x), 'bolt', p.x, p.y, 0);
        visual(s, 'chain', p.x, p.y, '#a8daca', 1, target.x, target.y);
      }
      continue;
    }
    if (p.kind === 'orbit') {
      const radius = 110 + (p.maxLife - p.life) * 25,
        angle = (p.maxLife - p.life) * 1.8 + p.seed;
      p.x = origin.x + Math.cos(angle) * radius;
      p.y = origin.y + Math.sin(angle) * radius;
    } else if (p.kind === 'mine') {
      if (p.maxLife - p.life < 0.7) continue;
    } else {
      if (p.returning && p.life < p.maxLife * 0.5) {
        const a = Math.atan2(origin.y - p.y, origin.x - p.x),
          speed = Math.hypot(p.vx, p.vy);
        p.vx = Math.cos(a) * speed;
        p.vy = Math.sin(a) * speed;
        if (dist(p, origin) < 15) {
          p.life = 0;
          continue;
        }
      } else if (p.homing) {
        const e = chooseTarget(s, 240, p);
        if (e) {
          const a = Math.atan2(e.y - p.y, e.x - p.x),
            speed = Math.hypot(p.vx, p.vy),
            turn = clamp(p.homing * dt, 0, 0.3);
          p.vx += (Math.cos(a) * speed - p.vx) * turn;
          p.vy += (Math.sin(a) * speed - p.vy) * turn;
        }
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    if (
      p.returning &&
      synergyEffect(s, 'return-pierce') &&
      p.life < p.maxLife * 0.5 &&
      !s.counters[`return-${p.id}`]
    ) {
      p.pierce += 2;
      p.hit = [];
      s.counters[`return-${p.id}`] = s.time + 20;
    }
    if (p.pulseInterval) {
      p.pulseTimer -= dt;
      if (p.pulseTimer <= 0) {
        p.pulseTimer = p.pulseInterval;
        const radius = (45 + p.radius * 2) * (synergyEffect(s, 'size-pulse') ? 1.35 : 1);
        const damage = p.damage * (ep(s, 'pulse', p.weaponId) || 0.25);
        for (const e of grid.near(p.x, p.y, radius + 30))
          if (e.hp > 0 && dist(e, p) < radius) hit(s, e, { ...p, depth: 1 }, damage);
        visual(s, 'pulse', p.x, p.y, '#e6d9b1', radius);
      }
    }
    if (p.kind === 'singularity')
      for (const e of grid.near(p.x, p.y, 120))
        if (dist(e, p) < 100) {
          const distance = Math.max(1, dist(e, p));
          e.x += ((p.x - e.x) / distance) * 15 * dt * (e.kind === 'boss' ? 0.3 : 1);
          e.y += ((p.y - e.y) / distance) * 15 * dt * (e.kind === 'boss' ? 0.3 : 1);
        }
    if (ep(s, 'trail', p.weaponId) && p.depth === 0 && ready(s, `trail-${p.id}`, 0.3)) {
      const element = synergyEffect(s, 'poison-trail') ? 'poison' : p.elements[0] || 'fire';
      makeArea(
        s,
        element === 'lightning' ? 'storm' : element,
        p.x,
        p.y,
        p.damage * ep(s, 'trail', p.weaponId) * (synergyEffect(s, 'count-trail') ? 1.4 : 1),
        18 + p.radius,
        1.1,
        element,
        p.weaponId,
        0,
        1,
      );
    }
    if (p.depth === 0 && ep(s, 'distance-pulse', p.weaponId)) {
      const key = `distance-${p.id}`;
      const traveled = (s.counters[key] || 0) + Math.hypot(p.x - p.previousX, p.y - p.previousY);
      if (Math.floor(traveled / 140) > Math.floor((s.counters[key] || 0) / 140)) {
        const damage = Math.min(40, ep(s, 'distance-pulse', p.weaponId));
        for (const e of grid.near(p.x, p.y, 100))
          if (dist(e, p) < 80) hit(s, e, { ...p, depth: 1 }, damage);
        visual(s, 'pulse', p.x, p.y, '#d4e6c9', 80);
      }
      s.counters[key] = traveled;
    }
    const radius = 30 + p.radius + Math.hypot(p.x - p.previousX, p.y - p.previousY);
    const nearby = grid.near(p.x, p.y, radius).sort((a, b) => dist(a, p) - dist(b, p));
    for (const e of nearby) {
      if (e.hp <= 0 || p.hit.includes(e.id) || segmentDistance(e.x, e.y, p) > e.radius + p.radius)
        continue;
      p.hit.push(e.id);
      const flightGain = Math.min(0.35, (p.maxLife - p.life) * ep(s, 'flight-damage', p.weaponId));
      hit(s, e, p, p.damage * (1 + flightGain));
      if (p.depth === 0 && ep(s, 'mass-knockback', p.weaponId))
        push(e, Math.min(80, (ep(s, 'mass-knockback', p.weaponId) * p.radius) / 5));
      if (p.kind === 'mine') {
        if (p.fusionId === 'fusion-cataclysm')
          makeArea(s, 'meteor', p.x, p.y, p.damage * 0.7, 85, 3.8, 'fire', p.weaponId, 0.65, 0);
        else
          splash(s, e, p.damage, 85, {
            rootId: p.id,
            source: 'proc',
            depth: 0,
            weaponId: p.weaponId,
            damage: p.damage,
            element: p.elements[0] || 'physical',
          });
        p.life = 0;
        visual(s, 'ring', p.x, p.y, '#dab184', 85);
        break;
      }
      if (p.split && p.depth === 0) {
        const w = s.weapons.find((w) => w.id === p.weaponId);
        if (w) {
          const st = getWeaponStats(s, w);
          st.speed *= synergyEffect(s, 'split-speed') ? 1.3 : 1;
          for (let k = 0; k < p.split; k++)
            projectile(
              s,
              w,
              st,
              Math.atan2(p.vy, p.vx) + (k - (p.split - 1) / 2) * 0.7,
              'bolt',
              p.x,
              p.y,
              1,
              0.32,
            );
        }
        p.split = 0;
      }
      if (p.bounces > 0) {
        const next = s.enemies
          .filter((o) => o.hp > 0 && !p.hit.includes(o.id) && dist(o, e) < 220)
          .sort((a, b) => dist(a, e) - dist(b, e))[0];
        if (next) {
          const angle = Math.atan2(next.y - p.y, next.x - p.x),
            speed = Math.hypot(p.vx, p.vy);
          p.vx = Math.cos(angle) * speed;
          p.vy = Math.sin(angle) * speed;
          p.bounces--;
          if (synergyEffect(s, 'bounce-homing')) p.homing += 1.4;
          break;
        }
      }
      if (p.pierce-- <= 0) {
        p.life = 0;
        break;
      }
    }
  }
  const pool = projectilePools.get(s) || [];
  let alive = 0;
  for (const p of s.projectiles) {
    if (p.life > 0) s.projectiles[alive++] = p;
    else if (pool.length < 512) pool.push(p);
  }
  s.projectiles.length = alive;
  projectilePools.set(s, pool);
}
function stepAreas(s: RunV2, dt: number) {
  for (const a of s.areas) {
    if (a.delay > 0) {
      a.delay -= dt;
      continue;
    }
    a.life -= dt;
    a.tickTimer -= dt;
    if (a.tickTimer > 0) continue;
    a.tickTimer = 0.5;
    let targets = s.enemies.filter((e) => e.hp > 0 && dist(e, a) < a.radius);
    if (a.kind === 'storm')
      targets = targets.slice(0, synergyEffect(s, 'storm-field-count') ? 5 : 3);
    for (const e of targets) {
      if (a.kind === 'frost') {
        e.chill = Math.max(e.chill, 0.4);
        e.stun = Math.max(e.stun, 0.06 * (e.kind === 'boss' ? 0.35 : 1));
      }
      if (a.kind === 'void') {
        const d = Math.max(1, dist(e, a)),
          pull =
            8 * (synergyEffect(s, 'void-field-pull') ? 1.6 : 1) * (e.kind === 'boss' ? 0.3 : 1);
        e.x += ((a.x - e.x) / d) * pull;
        e.y += ((a.y - e.y) / d) * pull;
      }
      const sourceWeapon = a.depth === 0 ? s.weapons.find((w) => w.id === a.weaponId) : undefined;
      const elements = sourceWeapon?.infusions.length ? sourceWeapon.infusions : [a.element];
      for (const element of elements)
        dealDamage(s, e, {
          rootId: a.id,
          source: a.depth === 0 ? 'primary' : 'proc',
          depth: a.depth,
          weaponId: a.weaponId,
          damage:
            (a.damage * (a.kind === 'fire' && synergyEffect(s, 'fire-field-power') ? 1.4 : 1)) /
            elements.length,
          element,
        });
      if (a.element === 'poison') e.poison += a.damage * 0.06;
    }
    if (a.kind === 'meteor') {
      visual(s, 'impact', a.x, a.y, '#edab72', a.radius);
      a.kind = 'fire';
      a.damage *= 0.15;
    } else if (a.kind === 'storm')
      for (const e of targets) visual(s, 'chain', a.x, a.y - 70, '#e0d9ff', 3, e.x, e.y);
  }
  s.areas = s.areas.filter((a) => a.life > 0);
}
export function useSkill(s: RunV2, which: 'signature' | 'secondary'): boolean {
  if (s.rulesVersion !== 3) return legacy.useSkill(s, which);
  if (s.phase !== 'combat' || (which === 'signature' ? s.skillCd : s.secondaryCd) > 0) return false;
  s.stats.skillsUsed++;
  if (which === 'signature') s.skillCd = 30 / (1 + ep(s, 'skill-cooldown'));
  else s.secondaryCd = 38 / (1 + ep(s, 'skill-cooldown'));
  const spell = which === 'signature' ? s.tower : s.secondary;
  if (spell === 'monolith') {
    s.counters.monolithOverdrive = s.time + 8;
    grantShield(s, s.maxHp * 0.3);
    visual(s, 'shield', 500, 400, '#d8d4bc', 160);
  }
  const selectedEffect = which === 'secondary' ? card(s.secondary)?.effect : undefined;
  const sp = (effect: string) => ep(s, effect) * (selectedEffect === effect ? 1.5 : 1);
  if (spell === 'bastion') grantShield(s, s.maxHp * 0.45);
  if (spell === 'pyre' || spell === 'tempest') {
    addBuff(s, 'signature', 'damage', 0.35, spell === 'pyre' ? 8 : 7);
    addBuff(s, 'signature', 'rate', 0.3, spell === 'pyre' ? 8 : 7);
    for (const e of s.enemies)
      if (spell === 'tempest' || dist(e, origin) < 270)
        dealDamage(s, e, {
          rootId: s.nextId++,
          source: 'primary',
          depth: 0,
          weaponId: 'signature',
          damage: 60,
          element: spell === 'pyre' ? 'fire' : 'lightning',
        });
  }
  if (spell === 'glacier' || spell === 'stasis') {
    for (const e of s.enemies)
      e.stun = Math.max(e.stun, (spell === 'glacier' ? 6 : 3) * (e.kind === 'boss' ? 0.35 : 1));
    if (spell === 'glacier') grantShield(s, s.maxHp * 0.2);
  }
  if (spell === 'verdant' || spell === 'repair') {
    healTower(s, s.maxHp * 0.25);
    if (spell === 'verdant') for (const e of s.enemies) e.poison += 30;
  }
  if (spell === 'null' || spell === 'nova') {
    for (const e of s.enemies) {
      if (spell === 'null') push(e, -85);
      dealDamage(s, e, {
        rootId: s.nextId++,
        source: 'primary',
        depth: 0,
        weaponId: 'signature',
        damage: 65,
        element: spell === 'null' ? 'void' : 'solar',
      });
    }
  }
  triggeredBuff(
    s,
    'skill-haste',
    'rate',
    ep(s, 'skill-haste'),
    5 + (synergyEffect(s, 'ritual-duration') ? 4 : 0),
    0,
  );
  triggeredBuff(s, 'skill-damage', 'damage', ep(s, 'skill-damage'), 5, 0);
  grantShield(s, ep(s, 'skill-shield'));
  s.hp = Math.min(
    s.maxHp,
    s.hp +
      sp('healing-field') +
      (sp('healing-field') && synergyEffect(s, 'skill-heal-power') ? 10 : 0),
  );
  grantShield(
    s,
    sp('shield-field') + (sp('shield-field') && synergyEffect(s, 'skill-shield-power') ? 15 : 0),
  );
  for (const [effect, element] of [
    ['fire-field', 'fire'],
    ['frost-field', 'frost'],
    ['storm-field', 'lightning'],
    ['void-field', 'void'],
    ['poison-field', 'poison'],
    ['solar-field', 'solar'],
  ] as const) {
    const value = sp(effect);
    if (!value) continue;
    makeArea(
      s,
      element === 'lightning' ? 'storm' : element,
      origin.x,
      origin.y,
      effect === 'frost-field' ? 2 * (selectedEffect === effect ? 1.5 : 1) : value,
      270,
      effect === 'solar-field'
        ? 0.1
        : 6 + (effect === 'frost-field' && synergyEffect(s, 'frost-field-duration') ? 3 : 0),
      element,
      'skill',
      0,
      1,
    );
  }
  if (sp('meteor-field')) {
    for (let i = 0; i < 7; i++) {
      const angle = random(s) * Math.PI * 2,
        range = 80 + random(s) * 220;
      makeArea(
        s,
        'meteor',
        origin.x + Math.cos(angle) * range,
        origin.y + Math.sin(angle) * range,
        sp('meteor-field'),
        90 * (synergyEffect(s, 'meteor-forge') ? 1.3 : 1),
        3,
        'fire',
        'skill',
        0.4 + i * 0.4,
        1,
      );
    }
  }
  if (sp('blade-field')) {
    const w = s.weapons[0],
      st = getWeaponStats(s, w);
    st.damage = sp('blade-field');
    st.elements = [];
    st.returning = synergyEffect(s, 'blade-return');
    for (let i = 0; i < 12; i++)
      projectile(s, w, st, (i * Math.PI) / 6, 'chakram', origin.x, origin.y, 1);
  }
  visual(s, 'ring', origin.x, origin.y, tower(s).color, 240);
  return true;
}
function stepEnemies(s: RunV2, dt: number) {
  for (const e of [...s.enemies]) {
    if (e.hp <= 0) continue;
    if (e.burn > 0) {
      dealDamage(s, e, {
        rootId: e.id,
        source: 'dot',
        depth: 2,
        weaponId: 'burn',
        damage: e.burn * dt,
        element: 'fire',
      });
      e.burn *= Math.exp(-dt * 0.5);
    }
    if (e.poison > 0) {
      dealDamage(s, e, {
        rootId: e.id,
        source: 'dot',
        depth: 2,
        weaponId: 'poison',
        damage: e.poison * dt,
        element: 'poison',
      });
      e.poison *= Math.exp(-dt * 0.25);
    }
    if (e.hp <= 0) continue;
    e.mark = Math.max(0, e.mark - dt);
    e.chill = Math.max(0, e.chill - dt * 0.055);
    e.stun = Math.max(0, e.stun - dt);
    if (e.stun > 0) continue;
    const d = Math.max(1, dist(e, origin)),
      resist = e.kind === 'boss' ? 0.35 : e.kind === 'elite' ? 0.65 : 1,
      speed =
        e.speed *
        (s.mode === 'quick' ? 1.3 : 1.1) *
        (1 - e.chill * resist) *
        (s.stage === 0 && s.time % 18 < 3 ? 1.06 : 1);
    const stop =
      e.kind === 'ranged'
        ? Math.max(100, 235 - Math.max(0, s.waveTime - 35) * 3)
        : e.kind === 'support'
          ? Math.max(90, 285 - Math.max(0, s.waveTime - 25) * 6)
          : 30 + e.radius;
    if (d > stop) {
      e.vx = ((origin.x - e.x) / d) * speed;
      e.vy = ((origin.y - e.y) / d) * speed;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    } else {
      e.vx = e.vy = 0;
    }
    e.attackCd -= dt;
    if (e.kind === 'support' && e.attackCd <= 0) {
      const key = `support-pulse-${e.id}`;
      if (s.counters[key] && s.time >= s.counters[key]) {
        takeDamage(s, e.damage * 0.75, e.damageType, e);
        delete s.counters[key];
        e.attackCd = 3;
      } else if (!s.counters[key]) {
        for (const other of s.enemies)
          if (dist(other, e) < 100)
            other.hp = Math.min(other.maxHp, other.hp + other.maxHp * 0.025);
        visual(s, 'ring', e.x, e.y, '#91d3a6', 100);
        if (s.waveTime >= 12 && d <= 360) {
          s.counters[key] = s.time + 0.8;
          visual(s, 'hazard', e.x, e.y, '#c8b6dd', 14, origin.x, origin.y);
        } else e.attackCd = 3;
      }
    }
    if (e.kind === 'boss') {
      const phase = Math.min(3, Math.floor((1 - e.hp / e.maxHp) * 4));
      if (phase > e.bossPhase) {
        e.bossPhase = phase;
        for (let i = 0; i < 2; i++)
          spawnEnemy(
            s,
            s.stage === 0 ? 'runner' : s.stage === 1 ? 'armored' : 'ranged',
            e.x + (i - 0.5) * 45,
            e.y,
            0,
          );
        visual(s, 'evolution', e.x, e.y, '#eaa67d', 80);
      }
      if (e.attackCd <= 0) {
        const telegraphKey = `boss-${e.id}`;
        if (!s.counters[telegraphKey]) {
          s.counters[telegraphKey] = s.time + 1.1;
          visual(s, 'hazard', origin.x, origin.y, '#e98d79', 85);
          s.visuals[s.visuals.length - 1].life = 1.1;
          s.visuals[s.visuals.length - 1].maxLife = 1.1;
        } else if (s.time >= s.counters[telegraphKey]) {
          const variant =
            s.mode === 'quick' && e.spawnWave <= 50
              ? [12, 25, 37, 50].indexOf(e.spawnWave)
              : Math.floor((e.spawnWave - 1) / 25) % 4;
          takeDamage(
            s,
            e.damage *
              (1 + Math.max(0, s.waveTime - 40) * 0.025) *
              (0.8 + e.bossPhase * 0.15) *
              (variant === 2 ? 1.3 : 1),
            e.damageType,
            e,
          );
          if (variant === 0 && s.enemies.length < 60) spawnEnemy(s, 'runner', e.x + 25, e.y, 0);
          if (variant === 1 && (s.counters[`boss-heals-${e.id}`] || 0) < 3) {
            e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.012);
            s.counters[`boss-heals-${e.id}`] = (s.counters[`boss-heals-${e.id}`] || 0) + 1;
          }
          if (variant === 3)
            for (const other of s.enemies) other.speed = Math.min(65, other.speed * 1.04);
          delete s.counters[telegraphKey];
          e.attackCd = 3.5 - e.bossPhase * 0.25;
        }
      }
    } else if (e.kind !== 'support' && d <= stop + 2 && e.attackCd <= 0) {
      const key = `attack-${e.id}`;
      if (e.kind === 'ranged' && !s.counters[key]) {
        s.counters[key] = s.time + 0.7;
        visual(s, 'hazard', e.x, e.y, '#de987f', 14, origin.x, origin.y);
      } else if (e.kind !== 'ranged' || s.time >= s.counters[key]) {
        takeDamage(s, e.damage * (1 + Math.max(0, s.waveTime - 40) * 0.025), e.damageType, e);
        e.attackCd = e.kind === 'ranged' ? 2.7 : 1.4;
        delete s.counters[key];
      }
    }
  }
}
export function step(s: RunV2, dt = TICK): void {
  if (s.rulesVersion !== 3) return legacy.step(s, dt);
  if (s.phase !== 'combat' || !Number.isFinite(dt) || dt <= 0) return;
  if (dt > TICK * 1.01) {
    for (let left = Math.min(dt, 1); left > 1e-8; left -= TICK) step(s, Math.min(TICK, left));
    return;
  }
  s.time += dt;
  s.waveTime += dt;
  stepMastery(s, dt);
  stepDefensiveCores(s, dt);
  s.skillCd = Math.max(0, s.skillCd - dt);
  s.secondaryCd = Math.max(0, s.secondaryCd - dt);
  s.buffs = s.buffs.filter((b) => b.expires > s.time);
  healTower(s, getDefenseStats(s).healthRegen * dt);
  grantShield(s, getDefenseStats(s).shieldRegen * dt);
  if (ep(s, 'barrier') && ready(s, 'barrier', 12)) grantShield(s, ep(s, 'barrier'));
  if (s.waveTime > 40 && ready(s, `enrage-${s.wave}`, 8)) {
    spawnEnemy(s, 'runner', undefined, undefined, 0);
    visual(s, 'hazard', origin.x, origin.y, '#df9b78', 210);
    if (s.waveTime < 41)
      s.notices.push('Prolonged siege: reinforcements arrive and enemy attacks grow stronger.');
  }
  const siegeStart = s.mode === 'quick' ? 40 : 70;
  if (s.waveTime > siegeStart && ready(s, `siege-pressure-${s.wave}`, s.mode === 'quick' ? 6 : 8)) {
    takeDamage(
      s,
      (6 + (s.waveTime - siegeStart) * (s.mode === 'quick' ? 1.1 : 0.7)) *
        (1 + s.difficulty * 0.15),
      'void',
    );
    visual(s, 'retaliation', origin.x, origin.y, '#d394c7', 280);
    if (s.waveTime < siegeStart + 9)
      s.notices.push('Siege collapse: break the formation before pressure overwhelms the spire.');
  }
  s.spawnTimer -= dt;
  if (s.spawned < s.spawnTotal && s.spawnTimer <= 0) {
    let kind: EnemyV2['kind'] | undefined;
    if (s.spawned === 0 && bossWave(s, s.wave)) kind = 'boss';
    else if (s.spawned === 0 && s.wave % 10 === 0) kind = 'elite';
    spawnEnemy(s, kind);
    s.spawned++;
    s.spawnTimer =
      s.mode === 'quick'
        ? Math.max(0.32, 0.95 - s.wave * 0.008)
        : Math.max(0.32, 1.2 - s.wave * 0.007);
  }
  for (const w of s.weapons) {
    w.cooldown = Math.max(0, w.cooldown - dt);
    if (w.cooldown <= 0) fireWeapon(s, w);
  }
  stepProjectiles(s, dt);
  stepAreas(s, dt);
  stepEnemies(s, dt);
  s.enemies = s.enemies.filter((e) => e.hp > 0);
  if (s.stage === 1 && ready(s, 'stage-hazard', 15)) takeDamage(s, 3 + s.wave * 0.025, 'fire');
  if (s.stage === 2 && ready(s, 'stage-hazard', 20))
    for (const e of s.enemies) if (e.kind === 'ranged') e.attackCd -= 1;
  for (const v of s.visuals) v.life -= dt;
  s.visuals = s.visuals.filter((v) => v.life > 0).slice(-400);
  s.stats.peakEnemies = Math.max(s.stats.peakEnemies, s.enemies.length);
  s.stats.peakProjectiles = Math.max(s.stats.peakProjectiles, s.projectiles.length);
  if (s.hp <= 0) {
    s.hp = 0;
    s.phase = 'ended';
    return;
  }
  if (s.spawned >= s.spawnTotal && !s.enemies.length && s.waveTime >= 18) {
    const cleared = s.wave;
    if (cleared === finalWave(s)) {
      s.cleared = true;
      if (!s.endless) {
        s.phase = 'victory';
        return;
      }
    }
    // Level-up drafts are awarded by XP, independently of waves.
    if (cleared % 10 === 0) queueReward(s, 'shop', cleared);
    startWave(s, cleared + 1);
  }
  if (ready(s, 'cleanup', 15)) {
    const living = new Set(s.enemies.map((e) => e.id));
    for (const key of Object.keys(s.counters)) {
      if (key.startsWith('distance-')) {
        if (!s.projectiles.some((p) => p.id === Number(key.slice(9)))) delete s.counters[key];
      } else if (key.startsWith('boss-heals-')) {
        if (!living.has(Number(key.slice(11)))) delete s.counters[key];
      } else if (
        /^(trail-|return-|boss-|attack-|drone-)/.test(key) &&
        s.counters[key] < s.time - 15
      ) {
        delete s.counters[key];
      }
    }
  }
}

/** Cumulative active participation, independent of firing frequency and render rate. */
export function advanceMastery(w: WeaponInstance, seconds: number): void {
  w.masteryProgress = Math.min(900, Math.max(0, (w.masteryProgress || 0) + Math.max(0, seconds)));
  w.masteryRank = MASTERY_THRESHOLDS.reduce<number>(
    (rank, threshold, index) => (w.masteryProgress! >= threshold ? index + 1 : rank),
    1,
  );
  w.masteryRequired = MASTERY_THRESHOLDS[Math.min(5, w.masteryRank)];
  w.fusionReady = w.masteryRank === 6 && !w.fusion;
}
function stepMastery(s: RunV2, dt: number): void {
  refreshFusionReady(s);
  if (!s.enemies.some((e) => e.hp > 0)) return;
  for (const w of s.weapons) {
    const range = getWeaponStats(s, w).range;
    const active =
      s.enemies.some((e) => e.hp > 0 && dist(e, origin) <= range) ||
      s.projectiles.some((p) => p.weaponId === w.id) ||
      s.areas.some((a) => a.weaponId === w.id);
    if (active && !w.fusion)
      advanceMastery(
        w,
        dt * (s.mode === 'quick' ? 1.5 : 1) * (1 + Math.min(0.5, ep(s, 'mastery-focus', w.id))),
      );
  }
  refreshFusionReady(s);
}
/** XP is paid from a finite spawn budget; procs and summoned entities cannot mint it. */
export function grantXp(s: RunV2, amount: number, kind: EnemyV2['kind'] = 'swarmer'): number {
  if (
    !isModern(s) ||
    s.phase !== 'combat' ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    s.level >= 200
  )
    return 0;
  const chain =
    s.time - (s.counters.lastLearningKill ?? -100) <= 2
      ? Math.min(5, (s.counters.learningChain || 0) + 1)
      : 0;
  s.counters.lastLearningKill = s.time;
  s.counters.learningChain = chain;
  const bonus = Math.min(
    0.5,
    (s.counters.profileExperience || 0) +
      ep(s, 'xp-gain') +
      (kind === 'elite' || kind === 'boss' ? ep(s, 'xp-elite') : 0) +
      chain * ep(s, 'xp-chain') +
      (s.hp <= s.maxHp * 0.35 ? ep(s, 'xp-low-health') : 0),
  );
  const earned = amount * (s.mode === 'quick' ? 0.75 : 1) * (1 + bonus);
  s.xp += earned;
  s.counters.totalXp = (s.counters.totalXp || 0) + earned;
  while (s.xp >= s.xpRequired && s.level < 200) {
    s.xp -= s.xpRequired;
    s.level++;
    s.xpRequired = Math.ceil(12 + 0.9 * (s.level - 1));
    queueReward(s, 'draft', s.wave);
    s.pendingRewards[s.pendingRewards.length - 1].level = s.level;
  }
  if (s.level === 200) s.xp = Math.min(s.xp, s.xpRequired - 1);
  return earned;
}
function corePower(s: RunV2, w: WeaponInstance) {
  const stats = getWeaponStats(s, w);
  return {
    ...stats,
    damage: stats.damage * ((s.counters.monolithOverdrive || 0) > s.time ? 1.8 : 1),
  };
}
/** One root defensive strike and, at most, one depth-two echo. */
function coreStrike(
  s: RunV2,
  w: WeaponInstance,
  enemy: EnemyV2,
  damage: number,
  element: Element | 'physical' = 'physical',
  echo = true,
) {
  if (enemy.hp <= 0) return;
  const parts: (Element | 'physical')[] = w.infusions.length ? w.infusions : [element];
  for (const el of parts) {
    dealDamage(s, enemy, {
      rootId: s.nextId++,
      source: 'retaliation',
      depth: 1,
      weaponId: w.id,
      damage: damage / parts.length,
      element: el,
    });
    if (el === 'fire')
      enemy.burn = Math.min(enemy.maxHp * 0.3, enemy.burn + (damage * 0.1) / parts.length);
    if (el === 'poison')
      enemy.poison = Math.min(enemy.maxHp * 0.45, enemy.poison + (damage * 0.08) / parts.length);
    if (el === 'frost') enemy.chill = Math.min(0.65, enemy.chill + 0.1 / parts.length);
    if (el === 'solar') enemy.mark = Math.max(2, enemy.mark);
    if (el === 'lightning' && echo) {
      const other = s.enemies.find((e) => e.id !== enemy.id && e.hp > 0 && dist(e, enemy) < 110);
      if (other) {
        dealDamage(s, other, {
          rootId: s.nextId++,
          source: 'retaliation',
          depth: 2,
          weaponId: w.id,
          damage: (damage * 0.2) / parts.length,
          element: 'lightning',
        });
        visual(s, 'chain', enemy.x, enemy.y, '#c2dfef', 2, other.x, other.y);
      }
    }
    if (el === 'void') push(enemy, -5);
  }
  visual(
    s,
    w.kind === 'core-mirror' ? 'reflect' : w.kind === 'core-thorn' ? 'thorns' : 'retaliation',
    500,
    400,
    weapon(w.kind).color,
    22,
    enemy.x,
    enemy.y,
  );
  if (echo)
    for (const other of defensiveViews(s)) {
      if (
        other.kind !== 'core-echo' ||
        !ready(s, `echo-core-${coreKey(other)}`, Math.max(0.6, corePower(s, other).cooldown))
      )
        continue;
      dealDamage(s, enemy, {
        rootId: s.nextId++,
        source: 'retaliation',
        depth: 2,
        weaponId: other.id,
        damage: damage * 0.35 + corePower(s, other).damage,
        element: other.infusions[0] || element,
      });
      visual(s, 'chain', 500, 400, '#d6b5ed', 3, enemy.x, enemy.y);
    }
}
function coreBurst(s: RunV2, w: WeaponInstance, damage: number, element: Element | 'physical') {
  const range = corePower(s, w).range;
  for (const enemy of s.enemies)
    if (enemy.hp > 0 && dist(enemy, origin) <= range) coreStrike(s, w, enemy, damage, element);
  visual(s, 'pulse', 500, 400, weapon(w.kind).color, range);
}
function reactCores(
  s: RunV2,
  amount: number,
  absorbed: number,
  attacker: EnemyV2 | undefined,
  element: Element | 'physical',
) {
  for (const w of defensiveViews(s)) {
    if (!isDefensiveKind(w.kind)) continue;
    const st = corePower(s, w),
      inRange = attacker && attacker.hp > 0 && dist(attacker, origin) <= st.range;
    if (w.kind === 'core-capacitor') {
      const key = `charge-core-${coreKey(w)}`;
      s.counters[key] = Math.min(240, (s.counters[key] || 0) + absorbed);
      if (s.counters[key] >= 20 && ready(s, `release-core-${coreKey(w)}`, st.cooldown)) {
        const charge = s.counters[key];
        s.counters[key] = 0;
        const dynamo = fusionViewMeta.get(w)?.recipeId === 'fusion-dynamo';
        coreBurst(s, w, st.damage + charge * (dynamo ? 1.1 : 0.8), dynamo ? 'frost' : 'lightning');
        if (dynamo)
          for (const e of s.enemies)
            if (dist(e, origin) <= st.range) {
              e.chill = Math.max(e.chill, e.kind === 'boss' ? 0.18 : 0.55);
            }
        if (fusionViewMeta.get(w)?.recipeId === 'fusion-thunder')
          s.counters[`thunder-${w.id}`] = Math.min(0.25, charge / 400);
      }
    }
    if (!inRange || !attacker || !ready(s, `react-core-${coreKey(w)}`, st.cooldown)) continue;
    if (w.kind === 'core-mirror') {
      const damage = st.damage + amount * (0.8 + Math.min(1, ep(s, 'reflect')));
      coreStrike(s, w, attacker, damage, element);
      let previous = attacker;
      const count = Math.min(
        4,
        Math.floor(ep(s, 'reflect-bounce')) +
          (fusionViewMeta.get(w)?.recipeId === 'fusion-cathedral' ? 1 : 0),
      );
      const hitIds = new Set([attacker.id]);
      for (let i = 0; i < count; i++) {
        const next = s.enemies
          .filter((e) => e.hp > 0 && !hitIds.has(e.id) && dist(e, previous) <= 150)
          .sort((a, b) => dist(a, previous) - dist(b, previous))[0];
        if (!next) break;
        hitIds.add(next.id);
        coreStrike(
          s,
          w,
          next,
          damage *
            Math.pow(fusionViewMeta.get(w)?.recipeId === 'fusion-cathedral' ? 0.35 : 0.65, i + 1),
          element,
          false,
        );
        previous = next;
      }
      if (ep(s, 'reflect-barbs') && ready(s, 'reflect-barbs', 0.5))
        for (const enemy of s.enemies)
          if (enemy.hp > 0 && dist(enemy, attacker) <= 100)
            coreStrike(s, w, enemy, Math.min(40, ep(s, 'reflect-barbs')), 'physical', false);
    }
    if (w.kind === 'core-thorn') {
      const briar = fusionViewMeta.get(w)?.recipeId === 'fusion-briar';
      coreStrike(s, w, attacker, st.damage + ep(s, 'thorns'), 'physical');
      if (briar) healTower(s, Math.min(6, st.damage * 0.06), false);
      if (fusionViewMeta.get(w)?.recipeId === 'fusion-barbed') {
        const stinger = projectile(
          s,
          w,
          { ...st, damage: st.damage * 0.15, pierce: 1 },
          Math.atan2(attacker.y - 400, attacker.x - 500),
          'bolt',
          500,
          400,
          1,
        );
        stinger.fusionId = 'fusion-barbed';
      }
    }
    if (w.kind === 'core-cinder') {
      coreStrike(s, w, attacker, st.damage, 'fire');
      attacker.burn = Math.min(attacker.maxHp * 0.3, attacker.burn + st.damage * 0.45);
      if (fusionViewMeta.get(w)?.recipeId === 'fusion-crucible')
        makeArea(s, 'fire', attacker.x, attacker.y, st.damage * 0.08, 65, 2.5, 'fire', w.id, 0, 1);
    }
    if (w.kind === 'core-frost') {
      coreStrike(s, w, attacker, st.damage, 'frost');
      attacker.chill = Math.min(attacker.kind === 'boss' ? 0.3 : 0.65, attacker.chill + 0.2);
      grantShield(s, Math.min(10, amount * 0.15));
    }
    if (w.kind === 'core-gravitic') {
      coreStrike(s, w, attacker, st.damage, 'void');
      push(attacker, 20);
    }
    if (w.kind === 'core-echo') coreStrike(s, w, attacker, st.damage * 0.7, element, false);
  }
}
function healTower(s: RunV2, amount: number, allowDischarge = true) {
  if (amount <= 0) return;
  const missing = Math.max(0, s.maxHp - s.hp),
    healed = Math.min(missing, amount),
    overheal = Math.max(0, amount - healed);
  s.hp = Math.min(s.maxHp, s.hp + amount);
  s.counters.totalHealing = (s.counters.totalHealing || 0) + healed;
  s.counters.protectionHealing = (s.counters.protectionHealing || 0) + healed;
  for (const w of defensiveViews(s))
    if (w.kind === 'core-mending')
      s.counters[`recovery-core-${coreKey(w)}`] = Math.min(
        100,
        (s.counters[`recovery-core-${coreKey(w)}`] || 0) + healed,
      );
  if (
    allowDischarge &&
    overheal > 0 &&
    ep(s, 'overheal-discharge') &&
    ready(s, 'overheal-discharge', 1)
  ) {
    const damage = Math.min(80, ep(s, 'overheal-discharge') * Math.min(3, overheal));
    const core = s.weapons.find((w) => isDefensiveKind(w.kind));
    if (core) coreBurst(s, core, damage, 'solar');
    else
      for (const e of s.enemies)
        if (e.hp > 0 && dist(e, origin) < 200)
          dealDamage(s, e, {
            rootId: s.nextId++,
            source: 'retaliation',
            depth: 2,
            weaponId: 'overheal-discharge',
            damage,
            element: 'solar',
          });
  }
}
function stepDefensiveCores(s: RunV2, dt: number) {
  const active = s.enemies.some((e) => e.hp > 0 && dist(e, origin) < 460);
  if (!active) return;
  for (const w of defensiveViews(s)) {
    const st = isDefensiveKind(w.kind) ? corePower(s, w) : undefined;
    if (!st) continue;
    if (w.kind === 'core-mending') {
      // Recovery is applied once by the common regeneration step.
      const key = `recovery-core-${coreKey(w)}`,
        recovery = s.counters[key] || 0;
      if (recovery >= 5 && ready(s, `mending-core-${coreKey(w)}`, st.cooldown)) {
        s.counters[key] = 0;
        coreBurst(s, w, st.damage + recovery * 0.75, 'solar');
      }
    }
    // Capacitor regeneration is included in the common shield step.
    if (w.kind === 'core-frost')
      for (const e of s.enemies)
        if (dist(e, origin) <= st.range)
          e.chill = Math.max(e.chill, e.kind === 'boss' ? 0.06 : 0.18);
    if (w.kind === 'core-gravitic')
      for (const e of s.enemies)
        if (dist(e, origin) <= st.range) {
          e.chill = Math.max(e.chill, e.kind === 'boss' ? 0.05 : 0.12);
          if (dist(e, origin) > 85)
            push(e, -(fusionViewMeta.get(w)?.recipeId === 'fusion-crucible' ? 10 : 6) * dt);
        }
  }
}

/** Effective defenses used by damage resolution, regeneration, and the live statistics panel. */
export function getDefenseStats(s: RunV2) {
  const p = (effect: string) => ep(s, effect);
  const modern = isModern(s),
    active = s.enemies.some((e) => e.hp > 0 && dist(e, origin) < 460);
  const cores = modern ? defensiveViews(s) : [];
  const reduction =
    p('armor') +
    (s.tower === 'bastion' ? 0.1 : s.tower === 'monolith' ? 0.2 : 0) +
    (s.hp < s.maxHp * 0.3 ? p('emergency') : 0) +
    (cores.some((w) => w.kind === 'core-gravitic') ? 0.08 : 0);
  const mitigation = Object.fromEntries(
    (['physical', 'fire', 'frost', 'lightning', 'poison', 'solar', 'void'] as const).map(
      (element) => {
        const resisted = clamp(
          reduction +
            (element === 'physical'
              ? 0
              : p(element === 'lightning' ? 'storm-shield' : `${element}-shield`)),
          0,
          0.8,
        );
        return [element, 1 - (1 - resisted) * (s.tower === 'null' ? 1.12 : 1)];
      },
    ),
  ) as Record<Element | 'physical', number>;
  const mending = active
    ? cores
        .filter((w) => w.kind === 'core-mending')
        .reduce((sum, w) => sum + 1 + corePower(s, w).damage * 0.06, 0)
    : 0;
  const capacitor = active
    ? cores
        .filter((w) => w.kind === 'core-capacitor')
        .reduce((sum, w) => sum + 2 + corePower(s, w).damage * 0.04, 0)
    : 0;
  const mirrors = cores.filter((w) => w.kind === 'core-mirror');
  return {
    maxShield: shieldCap(s),
    mitigation,
    healthRegen: p('regen') * (synergyEffect(s, 'health-renewal') ? 1.6 : 1) + mending,
    shieldRegen: p('shield-regen') * (synergyEffect(s, 'shield-renewal') ? 1.5 : 1) + capacitor,
    reflectMultiplier:
      p('reflect') * (synergyEffect(s, 'solar-reflect') ? 2 : 1) +
      mirrors.length * (0.8 + Math.min(1, p('reflect'))),
    retaliationDamage:
      p('thorns') * (synergyEffect(s, 'thorn-reflect') ? 2 : 1) +
      cores
        .filter((w) => w.kind === 'core-thorn' || w.kind === 'core-mirror')
        .reduce((sum, w) => sum + corePower(s, w).damage, 0),
  };
}

const fusionViewCache = new WeakMap<WeaponInstance, WeaponInstance[]>();
const fusionViewMeta = new WeakMap<WeaponInstance, { recipeId: string; parent: WeaponInstance }>();
function ingredientViews(w: WeaponInstance): WeaponInstance[] {
  if (!w.fusion) return [w];
  let views = fusionViewCache.get(w);
  if (!views) {
    views = w.fusion.ingredients.map((ingredient) => ({
      ...ingredient,
      id: w.id,
      fusion: undefined,
      fusionReady: false,
    }));
    fusionViewCache.set(w, views);
    for (const view of views) fusionViewMeta.set(view, { recipeId: w.fusion.recipeId, parent: w });
  }
  for (const view of views) {
    view.infusions = w.infusions;
    view.rarity = w.rarity;
  }
  return views;
}
function defensiveViews(s: RunV2): WeaponInstance[] {
  return s.weapons.flatMap((w) => ingredientViews(w).filter((view) => isDefensiveKind(view.kind)));
}
function coreKey(w: WeaponInstance): string {
  return fusionViewMeta.has(w) ? `${w.id}:${w.kind}` : w.id;
}
function fusedStats(s: RunV2, w: WeaponInstance): WeaponStats {
  const [a, b] = ingredientViews(w).map((view) => getWeaponStats(s, view));
  const cooldown = Math.min(a.cooldown, b.cooldown);
  // Each view has already received its global multiplier once. This is a summary,
  // not a second damage multiplier and not a claim of measured single-target DPS.
  return {
    ...a,
    damage: (a.damage / a.cooldown + b.damage / b.cooldown) * cooldown,
    cooldown,
    range: Math.max(a.range, b.range),
    speed: Math.max(a.speed, b.speed),
    count: Math.min(16, a.count + b.count),
    pierce: Math.max(a.pierce, b.pierce),
    bounces: Math.max(a.bounces, b.bounces),
    homing: Math.max(a.homing, b.homing),
    split: Math.max(a.split, b.split),
    life: Math.max(a.life, b.life),
    pulse: Math.max(a.pulse, b.pulse),
    trail: Math.max(a.trail, b.trail),
    returning: a.returning || b.returning,
    elements: [...w.infusions],
  };
}
function fireFusedWeapon(s: RunV2, w: WeaponInstance): boolean {
  if (!w.fusion) return false;
  let fired = false;
  for (const [index, view] of ingredientViews(w).entries()) {
    if (isDefensiveKind(view.kind)) continue;
    const key = `fusion-cd-${w.id}-${index}`;
    if ((s.counters[key] || 0) > s.time) continue;
    view.angle = w.angle;
    view.shotCycle = w.shotCycle;
    const before = s.projectiles.length;
    if (!fireWeapon(s, view)) continue;
    fired = true;
    w.angle = view.angle;
    w.shotCycle = view.shotCycle;
    w.lifetimeShots++;
    s.counters[key] = s.time + view.cooldown;
    const st = getWeaponStats(s, view),
      target = chooseTarget(s, st.range);
    if (w.fusion.recipeId === 'fusion-lance' && view.kind === 'rail' && target) {
      const angle = Math.atan2(target.y - 400, target.x - 500);
      for (const offset of [-0.12, 0.12])
        projectile(
          s,
          view,
          { ...st, damage: st.damage * 0.06, homing: Math.max(2, st.homing) },
          angle + offset,
          'bolt',
          500,
          400,
          1,
        );
    }
    if (w.fusion.recipeId === 'fusion-conduit' && view.kind === 'beam' && target) {
      const branch = s.enemies.find((e) => e.id !== target.id && e.hp > 0 && dist(e, target) < 160);
      if (branch) {
        dealDamage(s, branch, {
          rootId: s.nextId++,
          source: 'proc',
          depth: 1,
          weaponId: w.id,
          damage: st.damage * 0.08,
          element: 'lightning',
        });
        visual(s, 'chain', target.x, target.y, '#e8d79a', 3, branch.x, branch.y);
      }
    }
    if (w.fusion.recipeId === 'fusion-thunder' && view.kind === 'pulse') {
      const charge = s.counters[`thunder-${w.id}`] || 0;
      if (charge > 0) {
        s.counters[`thunder-${w.id}`] = 0;
        for (const e of s.enemies)
          if (e.hp > 0 && dist(e, origin) <= st.range)
            dealDamage(s, e, {
              rootId: s.nextId++,
              source: 'proc',
              depth: 1,
              weaponId: w.id,
              damage: st.damage * charge,
              element: 'lightning',
            });
      }
    }
    for (let i = before; i < s.projectiles.length; i++) {
      s.projectiles[i].fusionId = w.fusion.recipeId;
      if (w.fusion.recipeId === 'fusion-cataclysm' && s.projectiles[i].kind === 'mine')
        s.projectiles[i].damage *= 0.5;
    }
  }
  const timers = ingredientViews(w)
    .map((_, i) => s.counters[`fusion-cd-${w.id}-${i}`])
    .filter(Number.isFinite);
  w.cooldown = timers.length ? Math.max(TICK, Math.min(...timers) - s.time) : TICK;
  return fired;
}
function fusionCandidates(s: RunV2) {
  if (!isModern(s) || s.phase !== 'combat') return [];
  const equipped = s.weapons.filter(
    (w) => !w.fusion && !isFusedKind(w.kind) && (w.masteryRank || 1) === 6,
  );
  return FUSIONS.flatMap((recipe) => {
    const a = equipped.find((w) => w.kind === recipe.ingredients[0]),
      b = equipped.find((w) => w.kind === recipe.ingredients[1]);
    return a && b && a.id !== b.id
      ? [{ recipeId: recipe.id, ingredientIds: [a.id, b.id] as [string, string] }]
      : [];
  });
}
export function availableFusions(
  s: RunV2,
): { recipeId: string; ingredientIds: [string, string] }[] {
  return fusionCandidates(s);
}
export function refreshFusionReady(s: RunV2): void {
  if (!isModern(s)) return;
  const ready = new Set(fusionCandidates(s).flatMap((f) => f.ingredientIds));
  for (const w of s.weapons) w.fusionReady = ready.has(w.id);
}
function fusionInputs(s: RunV2, recipeId: string, a: string, b: string) {
  const recipe = FUSION_BY_ID[recipeId];
  if (!recipe || !isModern(s) || s.phase !== 'combat' || a === b) return;
  const first = s.weapons.find((w) => w.id === a),
    second = s.weapons.find((w) => w.id === b);
  if (
    !first ||
    !second ||
    first.fusion ||
    second.fusion ||
    isFusedKind(first.kind) ||
    isFusedKind(second.kind)
  )
    return;
  if (first.masteryRank !== 6 || second.masteryRank !== 6) return;
  if (!(
    (first.kind === recipe.ingredients[0] && second.kind === recipe.ingredients[1]) ||
    (first.kind === recipe.ingredients[1] && second.kind === recipe.ingredients[0])
  ))
    return;
  return { recipe, first, second };
}
function combineEquipment(s: RunV2, recipeId: string, a: string, b: string, record: boolean) {
  const input = fusionInputs(s, recipeId, a, b);
  if (!input) return;
  const { recipe, first, second } = input;
  const ingredients = structuredClone([first, second]) as [WeaponInstance, WeaponInstance];
  const id = `weapon-${s.nextId++}`,
    consumed = new Set([a, b]);
  let overflow = Math.max(0, first.mastery + second.mastery - 24) * 0.005;
  const merged = new Map<string, RunV2['cards'][number]>();
  const conversions: string[] = [];
  for (const c of s.cards.filter((c) => c.targetId && consumed.has(c.targetId))) {
    const d = card(c.cardId);
    if (!d) continue;
    if (d.effect === 'mastery-focus') {
      overflow += c.stacks * 0.02;
      conversions.push(
        `${d.name}: completed mastery acceleration converts to fused damage, within the shared +15% conversion cap.`,
      );
      continue;
    }
    const prior = merged.get(c.cardId);
    if (!prior) {
      merged.set(c.cardId, { ...c, targetId: id });
      continue;
    }
    const excess = Math.max(0, prior.stacks + c.stacks - d.maxStacks);
    overflow += excess * 0.01;
    if (excess)
      conversions.push(
        `${d.name}: ${excess} excess stacks convert to fused damage, within the shared +15% conversion cap.`,
      );
    prior.stacks = Math.min(d.maxStacks, prior.stacks + c.stacks);
    prior.mastery = Math.min(24, prior.mastery + c.mastery);
    prior.rarity = promote(
      tier(prior.rarity) > tier(c.rarity) ? prior.rarity : c.rarity,
      prior.mastery,
    );
  }
  const output: WeaponInstance = {
    id,
    kind: recipe.kind,
    cooldown: 0,
    shotCycle: 0,
    lifetimeShots: Math.min(Number.MAX_SAFE_INTEGER, first.lifetimeShots + second.lifetimeShots),
    mastery: Math.min(24, first.mastery + second.mastery),
    rarity: tier(first.rarity) > tier(second.rarity) ? first.rarity : second.rarity,
    infusions: [...new Set([...first.infusions, ...second.infusions])],
    angle: first.angle,
    masteryRank: 6,
    masteryProgress: 900,
    masteryRequired: 900,
    fusionReady: false,
    fusion: { recipeId, createdAt: s.time, ingredients, overflowPower: Math.min(0.15, overflow) },
  };
  s.weapons = s.weapons.filter((w) => !consumed.has(w.id));
  s.weapons.push(output);
  s.cards = s.cards.filter(
    (c) =>
      !(c.targetId && consumed.has(c.targetId)) &&
      !(
        card(c.cardId)?.group === 'weapon' &&
        [first.kind, second.kind].includes(card(c.cardId)!.weapon!)
      ),
  );
  s.cards.push(...merged.values());
  s.counters.cardRevision = (s.counters.cardRevision || 0) + 1;
  powers.delete(s);
  for (const p of s.projectiles)
    if (consumed.has(p.weaponId)) {
      p.weaponId = id;
      p.fusionId = recipeId;
    }
  for (const area of s.areas) if (consumed.has(area.weaponId)) area.weaponId = id;
  s.damageByWeapon[id] = (s.damageByWeapon[a] || 0) + (s.damageByWeapon[b] || 0);
  delete s.damageByWeapon[a];
  delete s.damageByWeapon[b];
  for (const [index, ingredient] of ingredients.entries()) {
    for (const prefix of ['charge-core', 'recovery-core']) {
      const old = `${prefix}-${ingredient.id}`,
        next = `${prefix}-${id}:${ingredient.kind}`;
      if (s.counters[old] !== undefined) {
        s.counters[next] = s.counters[old];
        delete s.counters[old];
      }
    }
    s.counters[`fusion-cd-${id}-${index}`] = s.time + Math.max(0, ingredient.cooldown);
  }
  s.synergies = activeSynergies(s);
  refreshFusionReady(s);
  refreshPendingOffers(s);
  if (record) {
    s.counters.fusions = (s.counters.fusions || 0) + 1;
    s.counters[`fusion-${s.counters.fusions}-time`] = s.time;
    s.notices.push(`Fusion forged: ${recipe.name}`);
    s.visuals.push({
      kind: `fusion-${recipe.id}`,
      x: 500,
      y: 400,
      color: recipe.color,
      size: 120,
      life: 1.8,
      maxLife: 1.8,
      text: recipe.name,
    });
  }
  return { output, conversions };
}
export function previewFusion(
  s: RunV2,
  recipeId: string,
  a: string,
  b: string,
): import('./types').FusionPreview | undefined {
  const input = fusionInputs(s, recipeId, a, b);
  if (!input) return;
  const copy = structuredClone(s),
    before = activeSynergies(s),
    result = combineEquipment(copy, recipeId, a, b, false);
  if (!result) return;
  const stats = getWeaponStats(copy, result.output),
    after = activeSynergies(copy);
  return {
    name: input.recipe.name,
    description: input.recipe.description,
    ingredients: [weapon(input.first.kind).name, weapon(input.second.kind).name],
    summary: `Consumes two mastered cores; creates one ${result.output.rarity} core and frees one socket. Inherited cadence ${stats.cooldown.toFixed(2)}s; range ${Math.round(stats.range)}. Shared global bonuses apply once per hit.`,
    inherited: [
      `${result.output.infusions.join(', ') || 'Physical'} payload; additional elements share direct damage.`,
      `Both ingredient investments and compatible targeted cards remain. Direct damage history combines under the fused core; shared status buckets remain separate; ingredient provenance remains.`,
      ...(result.output.fusion!.overflowPower
        ? [
            `Converted fused damage +${Math.round(result.output.fusion!.overflowPower! * 100)}% (cap 15%).`,
          ]
        : []),
    ],
    conversions: [
      ...result.conversions,
      'Fused cores cannot be ingredients or gain a seventh mastery rank. Consumed core cards return to the acquisition pool; their investments live in the fused provenance.',
    ],
    awaken: after.filter((id) => !before.includes(id)).map((id) => SYNERGY_MAP.get(id)?.name || id),
    lost: before.filter((id) => !after.includes(id)).map((id) => SYNERGY_MAP.get(id)?.name || id),
  };
}
export function fuseCores(s: RunV2, recipeId: string, a: string, b: string): boolean {
  return !!combineEquipment(s, recipeId, a, b, true);
}
