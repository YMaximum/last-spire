import { TOWERS, STAGES } from '../content';
import { CARDS, WEAPONS, SYNERGIES } from './catalog';
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
export const RARITIES: Rarity[] = ['normal', 'rare', 'epic', 'legendary', 'mythic'];
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
): RunV2 {
  const t = TOWERS.find((t) => t.id === towerId) || TOWERS[0],
    maxHp = t.hp * (1 + profile.upgrades.vitality * 0.035);
  const s: RunV2 = {
    version: 2,
    id: `v2-${seed}-${towerId}-${Date.now()}`,
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
    endless: false,
    cleared: false,
    settled: false,
    damageByWeapon: {},
    damageByElement: { physical: 0, fire: 0, frost: 0, lightning: 0, poison: 0, solar: 0, void: 0 },
    counters: {
      profilePower: profile.upgrades.power * 0.025,
      fortune: profile.upgrades.fortune,
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
    kind: t.pattern,
    cooldown: 0,
    shotCycle: 0,
    lifetimeShots: 0,
    mastery: 1,
    rarity: 'normal',
    infusions: [t.element],
    angle: 0,
  });
  s.synergies = activeSynergies(s);
  return s;
}
export function activeSynergies(s: RunV2): string[] {
  const tags = new Set<string>([s.tower, `tower:${s.tower}`, `tower-${s.tower}`]);
  for (const w of s.weapons) {
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
  const d = weapon(w.kind),
    p = (k: string) => ep(s, k, w.id),
    t = tower(s),
    slow = p('slow') || p('heavy');
  const damage =
    d.damage *
    t.damage *
    (1 + s.counters.profilePower + 0.16 * (w.mastery - 1)) *
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
    range: d.range * (1 + p('range')),
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

  return b;
}
function promote(r: Rarity, mastery: number): Rarity {
  return RARITIES[Math.max(tier(r), Math.min(4, Math.floor(mastery / 3)))];
}
export function acquireCard(s: RunV2, offer: CardOffer, targetId?: string): boolean {
  const d = card(offer.cardId);
  if (!d) return false;
  targetId = targetId || offer.targetId;
  if (d.group !== 'infusion' && d.group !== 'weapon') targetId = undefined;
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
      w.rarity = promote(tier(w.rarity) > tier(offer.rarity) ? w.rarity : offer.rarity, w.mastery);
    } else if (d.weapon)
      s.weapons.push({
        id: `weapon-${s.nextId++}`,
        kind: d.weapon,
        cooldown: 0,
        shotCycle: 0,
        lifetimeShots: 0,
        mastery: 1,
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
  return true;
}
export function previewCard(s: RunV2, offer: CardOffer, targetId?: string) {
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
    summary = `${s.weapons.some((x) => x.kind === w.kind) ? 'Strengthens' : 'Adds'} ${weapon(w.kind).name} · ${st.damage.toFixed(1)} damage / ${st.cooldown.toFixed(2)}s · mastery ${w.mastery} · ${w.rarity}`;
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
    summary,
    awaken: activeSynergies(copy)
      .filter((id) => !before.includes(id))
      .map((id) => SYNERGY_MAP.get(id)?.name || id),
    lost,
  };
}
export const REPAIR_COST = 28;
export function rewardRerollCost(s: RunV2, id: string) {
  const r = s.pendingRewards.find((r) => r.id === id);
  return Math.ceil((12 + (r?.rerolls || 0) * 12) * (1 - Math.min(0.6, ep(s, 'reroll'))));
}

function makeOffers(s: RunV2, count: number, shop: boolean): CardOffer[] {
  const available = CARDS;
  const offers: CardOffer[] = [];
  for (let i = 0; i < count; i++) {
    const options = available.filter((c) => !offers.some((o) => o.cardId === c.id));
    const d = options[Math.floor(random(s) * options.length)];
    const roll = random(s) + Math.min(0.12, (s.counters.fortune || 0) * 0.008 + ep(s, 'fortune'));
    const rarity: Rarity =
      roll > 0.995
        ? 'mythic'
        : roll > 0.965
          ? 'legendary'
          : roll > 0.86
            ? 'epic'
            : roll > 0.6
              ? 'rare'
              : 'normal';
    offers.push({
      id: `offer-${s.nextId++}`,
      cardId: d.id,
      rarity,
      price: shop
        ? Math.round((42 + tier(rarity) * 15) * (1 - Math.min(0.3, ep(s, 'discount'))))
        : 0,
    });
  }
  return offers;
}
function queueReward(s: RunV2, kind: 'draft' | 'shop', wave: number) {
  s.pendingRewards.push({
    id: `reward-${s.nextId++}`,
    kind,
    wave,
    offers: makeOffers(s, kind === 'shop' ? 4 : 3, kind === 'shop'),
    rerolls: 0,
    repairStock: kind === 'shop' ? 1 : 0,
  });
  if (kind === 'shop') s.stats.shopsVisited++;
}
export function chooseReward(s: RunV2, rewardId: string, offerId: string, targetId?: string) {
  if (s.phase !== 'combat') return false;
  const r = s.pendingRewards.find((r) => r.id === rewardId);
  if (!r || r.kind !== 'draft') return false;
  const o = r.offers.find((o) => o.id === offerId);
  if (!o || !acquireCard(s, o, targetId)) return false;
  s.pendingRewards = s.pendingRewards.filter((r) => r.id !== rewardId);
  return true;
}
export function buyOffer(s: RunV2, rewardId: string, offerId: string, targetId?: string) {
  if (s.phase !== 'combat') return false;
  const r = s.pendingRewards.find((r) => r.id === rewardId);
  if (!r || r.kind !== 'shop') return false;
  const o = r.offers.find((o) => o.id === offerId);
  if (!o || s.scrap < o.price || !acquireCard(s, o, targetId)) return false;
  s.scrap -= o.price;
  s.stats.spent += o.price;
  s.stats.shopPurchases++;
  r.offers = r.offers.filter((a) => a.id !== o.id);
  return true;
}
export function rerollReward(s: RunV2, id: string) {
  if (s.phase !== 'combat') return false;
  const r = s.pendingRewards.find((r) => r.id === id);
  const cost = Math.ceil((12 + (r?.rerolls || 0) * 12) * (1 - Math.min(0.6, ep(s, 'reroll'))));
  if (!r || s.scrap < cost) return false;
  s.scrap -= cost;
  s.stats.spent += cost;
  r.rerolls++;
  r.offers = makeOffers(s, r.kind === 'shop' ? r.offers.length : 3, r.kind === 'shop');
  return true;
}
export function closeShop(s: RunV2, id: string) {
  s.pendingRewards = s.pendingRewards.filter((r) => r.id !== id || r.kind !== 'shop');
}
export function repair(s: RunV2, id: string) {
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
  if (s.phase !== 'victory') return;
  s.endless = true;
  s.phase = 'combat';
  queueReward(s, 'draft', 100);
  queueReward(s, 'shop', 100);
  startWave(s, 101);
}
export function retire(s: RunV2) {
  s.phase = 'ended';
}
export function rewardForRun(s: RunV2) {
  return Math.floor(s.earned * 0.16 + Math.max(0, s.wave - 1) * 1.8 + (s.cleared ? 120 : 0));
}
export function describeNextThreat(s: RunV2) {
  const n = s.wave + (s.phase === 'victory' ? 1 : 0);
  return n % 25 === 0
    ? `${STAGES[s.stage].bosses[Math.floor(n / 25 - 1) % 4]}: watch the marked strike zones.`
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
  s.shield = Math.min(shieldCap(s), s.shield + n);
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
    spawnEnemy(s, 'swarmer', e.x - 13, e.y, 0);
    spawnEnemy(s, 'swarmer', e.x + 13, e.y, 0);
  }
  visual(s, 'hit', e.x, e.y, '#f5d996', e.radius * 1.4);
  void event;
}
export function dealDamage(s: RunV2, e: EnemyV2, event: DamageEvent): number {
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
  e.hp -= amount;
  s.damageByWeapon[event.weaponId] = (s.damageByWeapon[event.weaponId] || 0) + dealt;
  s.damageByElement[el] += dealt;
  if (event.source === 'proc') s.stats.procCount++;
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
    s.hp = Math.min(s.maxHp, s.hp + dealt * leech);
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
  let reduction =
    ep(s, 'armor') +
    (s.tower === 'bastion' ? 0.1 : 0) +
    (s.hp < s.maxHp * 0.3 ? ep(s, 'emergency') : 0);
  if (element !== 'physical')
    reduction += ep(s, element === 'lightning' ? 'storm-shield' : `${element}-shield`);
  amount *= 1 - clamp(reduction, 0, 0.8);
  if (s.tower === 'null') amount *= 1.12;
  const previousShield = s.shield,
    absorbed = Math.min(s.shield, amount);
  s.shield -= absorbed;
  s.hp -= amount - absorbed;
  s.stats.damageTaken += amount - absorbed;
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
  const scale =
      (1 + s.wave * 0.075 + Math.pow(s.wave / 13, 2)) *
      (1 + s.stage * 0.03) *
      (1 + s.difficulty * 0.2) *
      (1 + Math.max(0, s.wave - 100) * 0.055),
    mult = {
      swarmer: 1,
      runner: 0.65,
      armored: 2.4,
      ranged: 1.2,
      support: 1.7,
      splitter: 1.5,
      elite: 7,
      boss: 28,
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
          ? 17
          : kind === 'ranged'
            ? 5
            : 3.8
        : kind === 'boss'
          ? 18
          : kind === 'ranged'
            ? 5.2
            : 4) *
      (1 + s.wave * 0.03),
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
  };
  s.enemies.push(e);
  return e;
}
function startWave(s: RunV2, wave: number) {
  s.wave = wave;
  s.waveTime = 0;
  s.spawned = 0;
  s.spawnTotal = Math.min(40, 7 + Math.floor(wave * 0.23));
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
        hit(s, e, p);
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
    if (p.kind === 'drone') {
      const angle = p.seed + (p.maxLife - p.life) * 0.55;
      p.x = origin.x + Math.cos(angle) * 90;
      p.y = origin.y + Math.sin(angle) * 90;
      const w = s.weapons.find((w) => w.id === p.weaponId),
        target = chooseTarget(s, w ? getWeaponStats(s, w).range : 300, p);
      if (w && target && s.projectiles.length < 4096 && ready(s, `drone-${p.id}`, 0.65)) {
        const st = getWeaponStats(s, w);
        st.damage = p.damage * 0.4;
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
    const radius = 30 + p.radius + Math.hypot(p.x - p.previousX, p.y - p.previousY);
    const nearby = grid.near(p.x, p.y, radius).sort((a, b) => dist(a, p) - dist(b, p));
    for (const e of nearby) {
      if (e.hp <= 0 || p.hit.includes(e.id) || segmentDistance(e.x, e.y, p) > e.radius + p.radius)
        continue;
      p.hit.push(e.id);
      hit(s, e, p);
      if (p.kind === 'mine') {
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
  if (s.phase !== 'combat' || (which === 'signature' ? s.skillCd : s.secondaryCd) > 0) return false;
  s.stats.skillsUsed++;
  if (which === 'signature') s.skillCd = 30 / (1 + ep(s, 'skill-cooldown'));
  else s.secondaryCd = 38 / (1 + ep(s, 'skill-cooldown'));
  const spell = which === 'signature' ? s.tower : s.secondary;
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
    s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.25);
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
      speed = e.speed * (1 - e.chill * resist) * (s.stage === 0 && s.time % 18 < 3 ? 1.06 : 1);
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
      for (const other of s.enemies)
        if (dist(other, e) < 100) other.hp = Math.min(other.maxHp, other.hp + other.maxHp * 0.025);
      e.attackCd = 3;
      visual(s, 'ring', e.x, e.y, '#91d3a6', 100);
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
          const variant = Math.floor((e.spawnWave - 1) / 25) % 4;
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
          e.attackCd = 6 - e.bossPhase * 0.45;
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
  if (s.phase !== 'combat' || !Number.isFinite(dt) || dt <= 0) return;
  if (dt > TICK * 1.01) {
    for (let left = Math.min(dt, 1); left > 1e-8; left -= TICK) step(s, Math.min(TICK, left));
    return;
  }
  s.time += dt;
  s.waveTime += dt;
  s.skillCd = Math.max(0, s.skillCd - dt);
  s.secondaryCd = Math.max(0, s.secondaryCd - dt);
  s.buffs = s.buffs.filter((b) => b.expires > s.time);
  s.hp = Math.min(
    s.maxHp,
    s.hp + ep(s, 'regen') * (synergyEffect(s, 'health-renewal') ? 1.6 : 1) * dt,
  );
  grantShield(s, ep(s, 'shield-regen') * (synergyEffect(s, 'shield-renewal') ? 1.5 : 1) * dt);
  if (ep(s, 'barrier') && ready(s, 'barrier', 12)) grantShield(s, ep(s, 'barrier'));
  if (s.waveTime > 40 && ready(s, `enrage-${s.wave}`, 8)) {
    spawnEnemy(s, 'runner', undefined, undefined, 0);
    visual(s, 'hazard', origin.x, origin.y, '#df9b78', 210);
    if (s.waveTime < 41)
      s.notices.push('Prolonged siege: reinforcements arrive and enemy attacks grow stronger.');
  }
  if (s.waveTime > 70 && ready(s, `siege-pressure-${s.wave}`, 8)) {
    takeDamage(s, (6 + (s.waveTime - 70) * 0.7) * (1 + s.difficulty * 0.15), 'void');
    visual(s, 'retaliation', origin.x, origin.y, '#d394c7', 280);
    if (s.waveTime < 79)
      s.notices.push('Siege collapse: break the formation before pressure overwhelms the spire.');
  }
  s.spawnTimer -= dt;
  if (s.spawned < s.spawnTotal && s.spawnTimer <= 0) {
    let kind: EnemyV2['kind'] | undefined;
    if (s.spawned === 0 && s.wave % 25 === 0) kind = 'boss';
    else if (s.spawned === 0 && s.wave % 10 === 0) kind = 'elite';
    spawnEnemy(s, kind);
    s.spawned++;
    s.spawnTimer = Math.max(0.32, 1.2 - s.wave * 0.007);
  }
  for (const w of s.weapons) {
    w.cooldown -= dt;
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
    if (cleared === 100 && !s.endless) {
      s.phase = 'victory';
      s.cleared = true;
      return;
    }
    if (cleared % 2 === 0) queueReward(s, 'draft', cleared);
    if (cleared % 10 === 0) queueReward(s, 'shop', cleared);
    startWave(s, cleared + 1);
  }
  if (ready(s, 'cleanup', 15)) {
    const living = new Set(s.enemies.map((e) => e.id));
    for (const key of Object.keys(s.counters)) {
      if (key.startsWith('boss-heals-')) {
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
