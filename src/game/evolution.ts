import { EVOLUTION_BY_ID, evolutionPathsForTower } from '../content/evolutions';
import { TOWERS } from '../content/catalog';
import type { DamageEvent, EnemyV2, RunV2, WeaponInstance, WeaponKind } from '../model/arsenal';
import type { EvolutionBonuses, EvolutionPathId, EvolutionState } from '../model/evolution';
import type { RunV3 } from './types';
import type { ArsenalHooks } from './arsenal';

export const evolutionState = (s: RunV2): EvolutionState | undefined =>
  s.rulesVersion === 3 ? (s as RunV3).evolution : undefined;
export function evolutionPath(s: RunV2) {
  const state = evolutionState(s);
  return state?.path ? EVOLUTION_BY_ID[state.path] : undefined;
}
export function evolutionBonuses(s: RunV2): EvolutionBonuses {
  const state = evolutionState(s),
    path = evolutionPath(s),
    result: EvolutionBonuses = {};
  if (state && path)
    for (const tier of path.tiers.slice(0, state.tier))
      for (const [key, value] of Object.entries(tier.bonuses)) {
        const stat = key as keyof EvolutionBonuses;
        result[stat] = (result[stat] || 0) + value;
      }
  return result;
}
export function startingCoreKind(s: RunV2): WeaponKind {
  return s.tower === 'monolith' ? 'core-mirror' : TOWERS.find((t) => t.id === s.tower)!.pattern;
}
export function evolutionOwner(s: RunV2): WeaponInstance | undefined {
  const state = evolutionState(s);
  return (
    state &&
    s.weapons.find(
      (w) => w.id === state.coreId || w.fusion?.ingredients.some((i) => i.id === state.coreId),
    )
  );
}
/** Ingredient stat bonuses affect the starting component, not both fusion views. */
export function evolvedCore(s: RunV2, w: WeaponInstance) {
  const owner = evolutionOwner(s);
  return !!owner && owner.id === w.id && (w.kind === startingCoreKind(s) || !!w.fusion);
}
export function restoreEvolutionCore(s: RunV2) {
  const state = evolutionState(s);
  if (!state || evolutionOwner(s)) return;
  const replacement = s.weapons.find((w) => !w.fusion && w.kind === startingCoreKind(s));
  if (replacement) state.coreId = replacement.id;
}
export function evolutionMilestones(s: RunV2) {
  return (s as RunV3).mode === 'quick' ? [12, 25, 37] : [25, 50, 75];
}
export function queueEvolution(s: RunV2, clearedWave: number) {
  const state = evolutionState(s);
  if (!state || state.pending || state.tier === 3) return;
  if (clearedWave >= evolutionMilestones(s)[state.tier])
    state.pending = (state.tier + 1) as 1 | 2 | 3;
}
export function chooseEvolution(s: RunV2, pathId: EvolutionPathId): boolean {
  const state = evolutionState(s),
    path = EVOLUTION_BY_ID[pathId];
  if (
    !state ||
    s.phase !== 'combat' ||
    !path ||
    path.tower !== s.tower ||
    !state.pending ||
    state.pending !== state.tier + 1 ||
    s.pendingRewards.length ||
    (state.path && state.path !== pathId) ||
    s.wave - 1 < evolutionMilestones(s)[state.tier]
  )
    return false;
  state.path = pathId;
  state.tier = state.pending;
  state.pending = 0;
  s.notices.push(`Tower evolved: ${path.name} · tier ${state.tier}`);
  s.visuals.push({
    kind: 'evolve-tier',
    x: 500,
    y: 400,
    color: path.color,
    size: 100 + state.tier * 15,
    life: 2,
    maxLife: 2,
    text: `${path.name} ${state.tier}`,
  });
  return true;
}
export function evolutionOptions(s: RunV2) {
  const path = evolutionPath(s);
  return path ? [path] : evolutionPathsForTower(s.tower);
}
export function evolutionBonusText(b: EvolutionBonuses): string {
  const names: Record<keyof EvolutionBonuses, string> = {
    coreDamage: 'core damage',
    coreRate: 'core rate',
    coreRange: 'core range',
    corePierce: 'core pierce',
    coreCount: 'core projectiles',
    shieldCapacity: 'max-HP shield capacity',
    shieldRegen: 'shield/second',
    healthRegen: 'HP/second',
    mitigation: 'mitigation points',
    globalDamage: 'all core damage',
    skillCooldown: 'signature cooldown reduction',
  };
  return Object.entries(b)
    .map(
      ([key, value]) =>
        `${value >= 0 ? '+' : ''}${['corePierce', 'coreCount', 'shieldRegen', 'healthRegen'].includes(key) ? value.toFixed(2).replace(/\.00$/, '') : `${Math.round(value * 100)}%`} ${names[key as keyof EvolutionBonuses]}`,
    )
    .join(' · ');
}
export interface EvolutionHooks extends ArsenalHooks {
  heal(s: RunV2, amount: number): void;
}
const center = { x: 500, y: 400 };
const distance = (a: { x: number; y: number }, b = center) => Math.hypot(a.x - b.x, a.y - b.y);
function ready(s: RunV2, key: string, seconds: number) {
  if ((s.counters[key] || 0) > s.time) return false;
  s.counters[key] = s.time + seconds;
  return true;
}
function targets(s: RunV2, at = center, range = 460) {
  return s.enemies
    .filter((e) => e.hp > 0 && distance(e, at) <= range)
    .sort((a, b) => distance(a, at) - distance(b, at));
}
function strike(
  s: RunV2,
  e: EnemyV2,
  amount: number,
  element: DamageEvent['element'],
  h: EvolutionHooks,
  kind = 'evolve-strike',
) {
  h.damage(s, e, {
    rootId: s.nextId++,
    source: 'proc',
    depth: 2,
    weaponId: `evolution-${evolutionPath(s)!.id}`,
    damage: amount,
    element,
  });
  h.visual(s, kind, e.x, e.y, evolutionPath(s)!.color, 32);
}

/** Root hit handling runs once across infusions. Children are always nonrecursive. */
export function evolutionDamage(
  s: RunV2,
  e: EnemyV2,
  event: DamageEvent,
  h: EvolutionHooks,
): number {
  const state = evolutionState(s),
    path = evolutionPath(s),
    owner = evolutionOwner(s);
  if (
    !state ||
    !path ||
    !owner ||
    event.weaponId !== owner.id ||
    !(
      event.source === 'primary' ||
      (event.source === 'retaliation' &&
        event.depth === 1 &&
        event.coreKind === startingCoreKind(s))
    )
  )
    return event.damage;
  const parts = event.partCount || 1,
    full = event.damage * parts;
  const first = s.counters['evo-root'] !== event.rootId || s.counters['evo-target'] !== e.id;
  if (first) {
    s.counters['evo-root'] = event.rootId;
    s.counters['evo-target'] = e.id;
    s.counters['evo-factor'] = 1;
    s.counters['evo-flat'] = 0;
    if (path.id === 'blightbloom' && state.tier === 3)
      s.counters[`evo-bloom-${e.id}`] = Math.min(400, full);
    const count = (s.counters['evo-hits'] || 0) + 1;
    s.counters['evo-hits'] = count % 5;
    if (
      path.id === 'citadel' &&
      (s.counters['evo-charge'] || 0) > 0 &&
      ready(s, 'evo-charge-cd', 1)
    ) {
      s.counters['evo-flat'] = Math.min(s.counters['evo-charge'], full * 0.2);
      s.counters['evo-charge'] = 0;
    }
    if (path.id === 'vanguard') e.mark = Math.max(e.mark, 4);
    if ((path.id === 'furnace' || path.id === 'blightbloom') && ready(s, 'evo-field-cd', 1.5)) {
      const fire = path.id === 'furnace';
      h.area(
        s,
        fire ? 'fire' : 'poison',
        e.x,
        e.y,
        full * (fire ? 0.12 : 0.1),
        75,
        2,
        fire ? 'fire' : 'poison',
        owner.id,
        0,
        1,
      );
    }
    if (path.id === 'crownflare') {
      const heat = s.counters['evo-heat'] || 0;
      if (state.tier === 3 && heat >= 10) {
        s.counters['evo-factor'] = 1.4;
        s.counters['evo-heat'] = 0;
      } else s.counters['evo-heat'] = Math.min(10, heat + 1);
    }
    if (path.id === 'stormweaver' && ready(s, 'evo-chain-cd', 0.6)) {
      const next = targets(s, e, 115).find((o) => o.id !== e.id);
      if (next) {
        strike(s, next, full * 0.2 * (state.tier === 3 ? 1.2 : 1), 'lightning', h);
        h.visual(s, 'chain', e.x, e.y, path.color, 3, next.x, next.y);
      }
    }
    if (path.id === 'thunderhead' && count % 5 === 0 && ready(s, 'evo-strike-cd', 1))
      strike(s, e, full * 0.3, 'lightning', h);
    if (path.id === 'winterhold')
      e.chill = Math.max(
        e.chill,
        Math.min(e.kind === 'boss' ? 0.3 : 0.68, e.chill + 0.06 * (e.kind === 'boss' ? 0.35 : 1)),
      );
    if (path.id === 'rootwarden' && ready(s, 'evo-mend-cd', 0.5)) h.heal(s, 0.5);
    if (path.id === 'event-horizon' && ready(s, 'evo-pull-cd', 0.4))
      for (const other of targets(s, e, 95)) {
        if (other.id === e.id) continue;
        const d = Math.max(1, distance(other, e)),
          pull = other.kind === 'boss' ? 3 : 10;
        other.x += ((e.x - other.x) / d) * pull;
        other.y += ((e.y - other.y) / d) * pull;
      }
    if (path.id === 'mirror-regent' && event.source === 'retaliation') {
      if (state.tier === 3 && count % 5 === 0) {
        s.counters['evo-factor'] = 1.4;
        h.visual(s, 'ars-critical', e.x, e.y, path.color, 38);
      }
      if (ready(s, 'evo-mirror-cd', 1.2)) {
        const next = targets(s, e, 120).find((o) => o.id !== e.id);
        if (next) strike(s, next, full * 0.2, 'solar', h);
      }
    }
    if (path.id === 'ironbriar' && event.source === 'retaliation' && ready(s, 'evo-barb-cd', 0.8)) {
      const charge = state.tier === 3 ? Math.min(40, s.counters['evo-charge'] || 0) : 0;
      s.counters['evo-charge'] = 0;
      strike(s, e, Math.min(60, full * 0.25) + charge, 'physical', h, 'thorns');
    }
  }
  let result =
    event.damage * (s.counters['evo-factor'] || 1) + (s.counters['evo-flat'] || 0) / parts;
  if (
    path.id === 'mirror-regent' &&
    event.source === 'retaliation' &&
    s.counters['evo-factor'] === 1.4
  )
    event.critical = true;
  if (path.id === 'citadel' && state.tier === 3 && s.shield > 0 && event.source === 'primary')
    result *= 1.1;
  if (path.id === 'vanguard' && state.tier === 3 && e.mark > 0) result *= 1.2;
  if (path.id === 'shatterspire' && e.chill > 0) result *= 1.15;
  if (path.id === 'thunderhead' && state.tier === 3 && e.kind === 'boss') result *= 1.2;
  if (path.id === 'event-horizon' && state.tier === 3 && distance(e) < 130) result *= 1.15;
  if (
    path.id === 'rift-engine' &&
    state.tier === 3 &&
    !s.enemies.some((o) => o.hp > 0 && o.id !== e.id && distance(o, e) < 85)
  )
    result *= 1.25;
  return result;
}
export function evolutionAbsorb(s: RunV2, absorbed: number, h: EvolutionHooks) {
  const path = evolutionPath(s),
    state = evolutionState(s);
  if (!path || !state || absorbed <= 0) return;
  if (path.id === 'citadel' || (path.id === 'ironbriar' && state.tier === 3))
    s.counters['evo-charge'] = Math.min(s.maxHp * 0.2, (s.counters['evo-charge'] || 0) + absorbed);
  if (path.id === 'winterhold' && state.tier === 3 && ready(s, 'evo-frost-cd', 1))
    for (const e of targets(s, center, 70)) strike(s, e, 20, 'frost', h);
}
export function evolutionHealing(s: RunV2, healed: number, h: EvolutionHooks) {
  if (
    healed > 0 &&
    evolutionPath(s)?.id === 'rootwarden' &&
    evolutionState(s)?.tier === 3 &&
    ready(s, 'evo-bramble-cd', 1)
  )
    for (const e of targets(s, center, 180)) strike(s, e, 20, 'physical', h, 'thorns');
}
export function evolutionControlEnd(
  s: RunV2,
  e: EnemyV2,
  stun: number,
  chill: number,
  h: EvolutionHooks,
) {
  if (
    evolutionPath(s)?.id === 'shatterspire' &&
    evolutionState(s)?.tier === 3 &&
    ((stun > 0 && e.stun === 0) || (chill >= 0.15 && e.chill < 0.15)) &&
    ready(s, `evo-release-${e.id}`, 3)
  )
    strike(s, e, 20, 'frost', h);
}
export function evolutionDeath(s: RunV2, e: EnemyV2, event: DamageEvent, h: EvolutionHooks) {
  if (
    evolutionPath(s)?.id !== 'blightbloom' ||
    evolutionState(s)?.tier !== 3 ||
    e.poison <= 0 ||
    event.source === 'proc' ||
    !ready(s, 'evo-death-cd', 0.5)
  )
    return;
  for (const other of targets(s, e, 90))
    if (other.id !== e.id)
      strike(
        s,
        other,
        Math.min(80, (s.counters[`evo-bloom-${e.id}`] || event.damage) * 0.2),
        'poison',
        h,
      );
}
export function evolutionSkill(s: RunV2, h: EvolutionHooks) {
  const path = evolutionPath(s),
    state = evolutionState(s);
  if (!path || !state || state.tier < 2) return;
  if (['citadel', 'mirror-regent'].includes(path.id)) h.shield(s, s.maxHp * 0.1);
  if (path.id === 'winterhold') h.shield(s, s.maxHp * 0.15);
  if (path.id === 'rootwarden') h.heal(s, s.maxHp * 0.08);
  if (['furnace', 'blightbloom', 'event-horizon'].includes(path.id)) {
    const element = path.id === 'furnace' ? 'fire' : path.id === 'blightbloom' ? 'poison' : 'void';
    h.area(
      s,
      element,
      500,
      400,
      element === 'fire' ? 40 : 35,
      230,
      element === 'void' ? 5 : 6,
      element,
      `evolution-${path.id}`,
      0,
      1,
    );
  }
  const heat = s.counters['evo-heat'] || 0;
  if (path.id === 'crownflare') s.counters['evo-heat'] = 0;
  for (const e of targets(
    s,
    center,
    path.id === 'shatterspire' ? 240 : path.id === 'ironbriar' ? 200 : 460,
  ).slice(0, ['vanguard', 'stormweaver', 'crownflare', 'rift-engine'].includes(path.id) ? 5 : 96)) {
    if (path.id === 'vanguard') {
      strike(s, e, 40, 'solar', h);
      e.mark = Math.max(e.mark, 4);
    }
    if (path.id === 'stormweaver') strike(s, e, 50 * (state.tier === 3 ? 1.2 : 1), 'lightning', h);
    if (path.id === 'crownflare' && heat > 0) strike(s, e, heat * 5, 'fire', h);
    if (path.id === 'thunderhead') e.mark = Math.max(e.mark, 4);
    if (path.id === 'shatterspire') strike(s, e, 60, 'frost', h);
    if (path.id === 'rift-engine') strike(s, e, 100, 'void', h);
    if (path.id === 'ironbriar') strike(s, e, 80, 'physical', h, 'thorns');
  }
}
export function evolutionFieldPower(s: RunV2, element: string) {
  return element === 'fire' && evolutionPath(s)?.id === 'furnace' && evolutionState(s)?.tier === 3
    ? 1.25
    : 1;
}
export function cleanEvolutionCounters(s: RunV2) {
  if (!evolutionState(s)) return;
  const ids = new Set(s.enemies.map((e) => e.id));
  for (const key of Object.keys(s.counters))
    if (
      /^(evo-release-|evo-bloom-)/.test(key) &&
      !ids.has(Number(key.slice(key.startsWith('evo-bloom-') ? 10 : 12)))
    )
      delete s.counters[key];
}
