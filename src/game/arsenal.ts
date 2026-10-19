import type {
  AreaEffect,
  DamageEvent,
  Element,
  EnemyV2,
  ProjectileV2,
  RunV2,
  WeaponInstance,
} from '../model/arsenal';
import type { RunV3 } from './types';

export function hasArsenal(s: RunV2): s is RunV3 & { arsenalVersion: 2 } {
  return s.rulesVersion === 3 && (s as RunV3).arsenalVersion === 2;
}
const center = { x: 500, y: 400 };
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export interface ArsenalHooks {
  power(s: RunV2, effect: string, owner?: string): number;
  damage(s: RunV2, enemy: EnemyV2, event: DamageEvent): number;
  area(
    s: RunV2,
    kind: AreaEffect['kind'],
    x: number,
    y: number,
    damage: number,
    radius: number,
    life: number,
    element: Element,
    owner: string,
    delay?: number,
    depth?: number,
  ): void;
  visual(
    s: RunV2,
    kind: string,
    x: number,
    y: number,
    color: string,
    radius: number,
    x2?: number,
    y2?: number,
  ): void;
  fragment(s: RunV2, p: ProjectileV2, angle: number, damage: number): void;
  shield(s: RunV2, amount: number): void;
}
function ready(s: RunV2, key: string, seconds: number) {
  if ((s.counters[key] || 0) > s.time) return false;
  s.counters[key] = s.time + seconds;
  return true;
}
function burst(
  s: RunV2,
  h: ArsenalHooks,
  at: { x: number; y: number },
  radius: number,
  damage: number,
  owner: string,
  element: Element | 'physical',
  kind: string,
) {
  for (const enemy of s.enemies)
    if (enemy.hp > 0 && distance(enemy, at) < radius)
      h.damage(s, enemy, {
        rootId: s.nextId++,
        source: 'proc',
        depth: 2,
        weaponId: owner,
        damage,
        element,
      });
  h.visual(s, kind, at.x, at.y, '#bbdce4', radius);
}
const traveling = (p: ProjectileV2) =>
  !['beam', 'rail', 'pulse', 'tesla', 'mine', 'drone', 'orbit'].includes(p.kind);

export function arsenalProjectile(s: RunV2, p: ProjectileV2, dt: number, h: ArsenalHooks) {
  if (!hasArsenal(s) || p.depth !== 0) return;
  const growth = h.power(s, 'projectile-growth', p.weaponId);
  if (growth && traveling(p)) {
    const age = p.maxLife - p.life;
    const ratio =
      (1 + Math.min(1.5, age * growth)) / (1 + Math.min(1.5, Math.max(0, age - dt) * growth));
    p.radius = Math.min(75, p.radius * ratio);
  }
  const returning = p.returning && p.life < p.maxLife * 0.5;
  const pulse = h.power(s, 'return-pulse', p.weaponId);
  if (returning && pulse && ready(s, `ars-return-${p.weaponId}`, 0.7))
    burst(
      s,
      h,
      p,
      80,
      p.damage * Math.min(0.65, pulse),
      p.weaponId,
      p.elements[0] || 'physical',
      'ars-return',
    );
  if (
    p.fusionId === 'fusion-pyroclasm' &&
    p.kind === 'singularity' &&
    ready(s, `ars-vortex-${p.weaponId}`, 0.8)
  )
    h.area(s, 'fire', p.x, p.y, p.damage * 0.06, 70 + p.radius, 2, 'fire', p.weaponId, 0, 1);
  if (
    p.fusionId === 'fusion-hoarfrost' &&
    p.kind === 'ricochet' &&
    ready(s, `ars-track-${p.weaponId}`, 0.4)
  )
    h.area(s, 'frost', p.x, p.y, p.damage * 0.025, 40, 1.5, 'frost', p.weaponId, 0, 1);
}
export function arsenalExpiry(s: RunV2, p: ProjectileV2, h: ArsenalHooks) {
  if (!hasArsenal(s) || p.depth !== 0 || !traveling(p)) return;
  const value = h.power(s, 'expiry-shards', p.weaponId);
  if (!value || !ready(s, `ars-expiry-${p.weaponId}`, 0.6)) return;
  const angle = Math.atan2(p.vy, p.vx);
  for (let i = -1; i <= 1; i++)
    h.fragment(s, p, angle + i * 0.65, (p.damage * Math.min(0.8, value)) / 3);
  h.visual(s, 'ars-shards', p.x, p.y, '#efd6a6', 32);
}
export function arsenalBounce(s: RunV2, p: ProjectileV2, h: ArsenalHooks) {
  if (!hasArsenal(s) || p.depth !== 0) return;
  const value = h.power(s, 'rebound-charge', p.weaponId);
  if (value) {
    const key = `ars-bounce-${p.id}`;
    const before = s.counters[key] || 0,
      after = Math.min(0.6, before + value);
    p.damage *= (1 + after) / (1 + before);
    s.counters[key] = after;
    h.visual(s, 'ars-rebound', p.x, p.y, '#e4cf8c', p.radius + 10);
  }
  if (p.fusionId === 'fusion-hoarfrost' && ready(s, `ars-shatter-${p.weaponId}`, 0.6))
    burst(s, h, p, 80, p.damage * 0.2, p.weaponId, 'frost', 'ars-release');
}

/** Called before armor. A multi-infusion root receives one shared charge/crossfire budget. */
export function arsenalDamage(s: RunV2, enemy: EnemyV2, event: DamageEvent, h: ArsenalHooks) {
  if (!hasArsenal(s)) return event.damage;
  let amount = event.damage;
  const root = event.source === 'primary' || (event.source === 'retaliation' && event.depth === 1);
  if (root && h.power(s, 'absorption-charge')) {
    if (s.counters['ars-charge-root'] !== event.rootId) {
      s.counters['ars-charge-bonus'] = 0;
      if ((s.counters['ars-reservoir'] || 0) > 0 && ready(s, 'ars-charge-cd', 0.4)) {
        s.counters['ars-charge-root'] = event.rootId;
        s.counters['ars-charge-target'] = enemy.id;
        s.counters['ars-charge-bonus'] =
          (s.counters['ars-reservoir'] || 0) * Math.min(0.8, h.power(s, 'absorption-charge'));
        s.counters['ars-reservoir'] = 0;
        h.visual(s, 'ars-absorb', center.x, center.y, '#d1d9ac', 65, enemy.x, enemy.y);
      }
    }
    if (
      s.counters['ars-charge-root'] === event.rootId &&
      s.counters['ars-charge-target'] === enemy.id
    ) {
      const parts = s.weapons.find((w) => w.id === event.weaponId)?.infusions.length || 1;
      amount += (s.counters['ars-charge-bonus'] || 0) / parts;
    }
  }
  if (event.source === 'primary') {
    const power = h.power(s, 'crossfire');
    const owner = s.weapons.findIndex((w) => w.id === event.weaponId) + 1;
    if (power && owner) {
      const key = `ars-cross-${enemy.id}`;
      if (s.counters[`${key}-root`] !== event.rootId) {
        const alternate =
          s.counters[key] &&
          s.counters[key] !== owner &&
          (s.counters[`${key}-until`] || 0) > s.time;
        s.counters[`${key}-bonus`] =
          alternate && ready(s, `${key}-cd`, 0.8) ? Math.min(0.6, power) : 0;
        s.counters[`${key}-root`] = event.rootId;
        s.counters[key] = owner;
        s.counters[`${key}-until`] = s.time + 2;
        if (s.counters[`${key}-bonus`])
          h.visual(s, 'ars-crossfire', enemy.x, enemy.y, '#eed2a6', 28);
      }
      amount *= 1 + (s.counters[`${key}-bonus`] || 0);
    }
    const erosion = h.power(s, 'armor-erosion');
    if (erosion && ready(s, `ars-erode-cd-${enemy.id}`, 0.4)) {
      const key = `ars-erode-${enemy.id}`;
      const previous = (s.counters[`${key}-until`] || 0) > s.time ? s.counters[key] || 0 : 0;
      s.counters[key] = Math.min(0.3, erosion * 6, previous + erosion);
      s.counters[`${key}-until`] = s.time + 3;
      h.visual(s, 'ars-erosion', enemy.x, enemy.y, '#d8bc83', enemy.radius + 8);
    }
  }
  return amount;
}
export function arsenalArmor(s: RunV2, enemy: EnemyV2) {
  if (!hasArsenal(s) || (s.counters[`ars-erode-${enemy.id}-until`] || 0) <= s.time)
    return enemy.armor;
  return Math.max(0, enemy.armor - (s.counters[`ars-erode-${enemy.id}`] || 0));
}
export function arsenalAbsorb(s: RunV2, absorbed: number, h: ArsenalHooks) {
  if (!hasArsenal(s) || !h.power(s, 'absorption-charge')) return;
  s.counters['ars-reservoir'] = Math.min(
    s.maxHp * 0.25,
    (s.counters['ars-reservoir'] || 0) + absorbed,
  );
}
export function arsenalHealing(s: RunV2, healed: number, h: ArsenalHooks) {
  if (!hasArsenal(s) || healed <= 0) return;
  const barrier = Math.min(0.6, h.power(s, 'healing-barrier'));
  if (barrier) {
    h.shield(s, healed * barrier);
    if (ready(s, 'ars-heal-visual', 0.6))
      h.visual(s, 'ars-mend', center.x, center.y, '#b7e3b4', 60);
  }
  for (const w of s.weapons)
    if (w.fusion?.recipeId === 'fusion-sanctuary')
      s.counters[`ars-recovery-${w.id}`] = Math.min(
        80,
        (s.counters[`ars-recovery-${w.id}`] || 0) + healed,
      );
}
export function arsenalThorns(s: RunV2, enemy: EnemyV2, damage: number, h: ArsenalHooks) {
  if (!hasArsenal(s)) return;
  const power = h.power(s, 'briar-wounds');
  if (!power) return;
  const key = `ars-wound-${enemy.id}`;
  const active = (s.counters[`${key}-until`] || 0) > s.time ? s.counters[key] || 0 : 0;
  s.counters[key] = Math.max(active, Math.min(80, damage * power));
  s.counters[`${key}-until`] = s.time + 3;
  h.visual(s, 'ars-briar', enemy.x, enemy.y, '#b7c997', enemy.radius + 10);
}
export function arsenalEnemyTick(s: RunV2, enemy: EnemyV2, dt: number, h: ArsenalHooks) {
  if (!hasArsenal(s)) return;
  if ((s.counters[`ars-wound-${enemy.id}-until`] || 0) > s.time)
    h.damage(s, enemy, {
      rootId: enemy.id,
      source: 'dot',
      depth: 2,
      weaponId: 'defense-briar-wounds',
      damage: (s.counters[`ars-wound-${enemy.id}`] || 0) * dt,
      element: 'physical',
    });
}
export function arsenalControlEnd(
  s: RunV2,
  enemy: EnemyV2,
  stun: number,
  chill: number,
  h: ArsenalHooks,
) {
  if (!hasArsenal(s)) return;
  const ended = (stun > 0 && enemy.stun === 0) || (chill >= 0.15 && enemy.chill < 0.15);
  const value = h.power(s, 'control-release');
  if (ended && value && ready(s, `ars-release-${enemy.id}`, 3))
    burst(s, h, enemy, 70, Math.min(80, value), 'trigger-control-release', 'frost', 'ars-release');
}
export function arsenalFieldMultiplier(
  s: RunV2,
  enemy: EnemyV2,
  area: AreaEffect,
  h: ArsenalHooks,
) {
  if (!hasArsenal(s) || !h.power(s, 'field-resonance')) return 1;
  const elements = new Set(
    s.areas
      .filter((a) => a.delay <= 0 && a.life > 0 && distance(enemy, a) < a.radius)
      .map((a) => a.element),
  );
  const bonus = Math.min(0.45, Math.max(0, elements.size - 1) * h.power(s, 'field-resonance'));
  if (bonus && ready(s, `ars-resonance-${area.weaponId}`, 0.8))
    h.visual(s, 'ars-resonance', area.x, area.y, '#e0d3ac', area.radius);
  return 1 + bonus;
}
export function arsenalMeteor(s: RunV2, area: AreaEffect, h: ArsenalHooks) {
  if (
    !hasArsenal(s) ||
    !s.weapons.some((w) => w.id === area.weaponId && w.fusion?.recipeId === 'fusion-impact-well')
  )
    return;
  h.area(s, 'void', area.x, area.y, area.damage * 0.08, 95, 1.5, 'void', area.weaponId, 0.35, 1);
}
export function arsenalDrone(s: RunV2, p: ProjectileV2, h: ArsenalHooks) {
  if (!hasArsenal(s) || p.fusionId !== 'fusion-sanctuary') return;
  const key = `ars-recovery-${p.weaponId}`,
    recovery = s.counters[key] || 0;
  if (recovery < 5 || !ready(s, `ars-carrier-${p.weaponId}`, 0.75)) return;
  s.counters[key] = 0;
  const targets = s.enemies
    .filter((e) => e.hp > 0 && distance(e, p) < 300)
    .sort((a, b) => distance(a, p) - distance(b, p))
    .slice(0, 3);
  for (const enemy of targets) {
    h.damage(s, enemy, {
      rootId: s.nextId++,
      source: 'proc',
      depth: 2,
      weaponId: p.weaponId,
      damage: (recovery * 0.5) / Math.max(1, targets.length),
      element: 'solar',
    });
    h.visual(s, 'ars-mend', p.x, p.y, '#beeab5', 24, enemy.x, enemy.y);
  }
}
export function arsenalReflect(s: RunV2, w: WeaponInstance, incoming: number) {
  if (!hasArsenal(s) || w.fusion?.recipeId !== 'fusion-reliquary') return;
  s.counters[`ars-pressure-${w.id}`] = Math.min(
    0.6,
    (s.counters[`ars-pressure-${w.id}`] || 0) + incoming / s.maxHp,
  );
}
export function arsenalPulse(
  s: RunV2,
  w: WeaponInstance,
  damage: number,
  range: number,
  h: ArsenalHooks,
) {
  if (!hasArsenal(s) || w.fusion?.recipeId !== 'fusion-tempest' || !ready(s, `ars-bell-${w.id}`, 1))
    return;
  const targets = s.enemies.filter((e) => e.hp > 0 && distance(e, center) < range).slice(0, 3);
  for (const enemy of targets) {
    const next = s.enemies.find((e) => e.id !== enemy.id && e.hp > 0 && distance(e, enemy) < 120);
    if (!next) continue;
    h.damage(s, next, {
      rootId: s.nextId++,
      source: 'proc',
      depth: 2,
      weaponId: w.id,
      damage: damage * 0.12,
      element: 'lightning',
    });
    h.visual(s, 'chain', enemy.x, enemy.y, '#dbecb4', 3, next.x, next.y);
  }
}
export function cleanupArsenal(s: RunV2) {
  if (!hasArsenal(s)) return;
  const enemies = new Set(s.enemies.map((e) => e.id)),
    projectiles = new Set(s.projectiles.map((p) => p.id));
  const ownerPrefixes = [
    'return',
    'expiry',
    'vortex',
    'track',
    'shatter',
    'resonance',
    'recovery',
    'carrier',
    'pressure',
    'bell',
    'refrain',
  ].map((name) => `ars-${name}-`);
  for (const key of Object.keys(s.counters)) {
    const enemy = /^ars-(?:cross|erode|erode-cd|wound|release)-(\d+)(?:-|$)/.exec(key);
    const projectile = /^ars-bounce-(\d+)$/.exec(key);
    if (
      (enemy && !enemies.has(Number(enemy[1]))) ||
      (projectile && !projectiles.has(Number(projectile[1])))
    )
      delete s.counters[key];
    const prefix = ownerPrefixes.find((prefix) => key.startsWith(prefix));
    if (
      prefix &&
      !s.weapons.some((w) => key === prefix + w.id || key.startsWith(prefix + w.id + '-'))
    )
      delete s.counters[key];
  }
}
