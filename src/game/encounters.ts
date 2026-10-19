import { ENEMY_BY_ID, type EnemyArchetypeId } from '../content/enemies';
import type { RunV3, EnemyV2, DamageEvent } from './types';
import type { Element } from '../model/shared';
const CENTER = { x: 500, y: 400 };
const key = (e: EnemyV2, name: string) => `enc-${e.id}-${name}`;
export const encounterValue = (s: RunV3, e: EnemyV2, name: string) => s.counters[key(e, name)] || 0;
const set = (s: RunV3, e: EnemyV2, name: string, value: number) => {
  s.counters[key(e, name)] = value;
};
const remove = (s: RunV3, e: EnemyV2, name: string) => {
  delete s.counters[key(e, name)];
};
export interface EncounterActions {
  hurt: (damage: number, type: Element | 'physical', attacker: EnemyV2) => void;
  summon: (id: EnemyArchetypeId, x: number, y: number) => void;
}
export function interruptEncounter(s: RunV3, e: EnemyV2): void {
  if (encounterValue(s, e, 'windup') || encounterValue(s, e, 'echo')) {
    remove(s, e, 'windup');
    remove(s, e, 'echo');
    remove(s, e, 'aim-x');
    remove(s, e, 'aim-y');
    e.attackCd = Math.max(e.attackCd, 1);
  }
}
export function encounterDamage(
  s: RunV3,
  e: EnemyV2,
  amount: number,
  element: Element | 'physical',
): number {
  if (!e.archetypeId) return amount;
  const def = ENEMY_BY_ID[e.archetypeId];
  amount *= 1 - (def.resistance?.[element] || 0);
  if (encounterValue(s, e, 'recovery') > s.time)
    amount *=
      def.mechanic === 'eclipse-boss'
        ? 1.4
        : ['forge-boss', 'root-boss', 'artillery'].includes(def.mechanic)
          ? 1.35
          : def.mechanic === 'rift'
            ? 1.2
            : 1.25;
  if (def.mechanic === 'burrow' && encounterValue(s, e, 'windup')) amount *= 0.65;
  const shield =
    encounterValue(s, e, 'barrier-until') > s.time ? encounterValue(s, e, 'barrier') : 0;
  const absorbed = Math.min(shield, amount);
  if (absorbed) set(s, e, 'barrier', shield - absorbed);
  return Math.max(0, amount - absorbed);
}
export function encounterRetaliation(
  s: RunV3,
  e: EnemyV2,
  event: DamageEvent,
  dealt: number,
  actions: EncounterActions,
) {
  if (e.archetypeId !== 'thorn-retaliator' || e.hp <= 0 || event.source !== 'primary' || dealt <= 0)
    return;
  if (encounterValue(s, e, 'thorn-ready') > s.time) return;
  set(s, e, 'thorn-ready', s.time + 1.4);
  actions.hurt(e.damage * 0.28, 'physical', e);
  s.visuals.push({
    kind: 'encounter-thorns',
    x: e.x,
    y: e.y,
    x2: CENTER.x,
    y2: CENTER.y,
    color: '#b8ce87',
    size: 6,
    life: 0.3,
    maxLife: 0.3,
  });
}
/** New actors only. Shared roles continue through the established movement/attack code. */
export function stepEncounter(
  s: RunV3,
  e: EnemyV2,
  dt: number,
  actions: EncounterActions,
): boolean {
  if (!e.archetypeId) return false;
  const def = ENEMY_BY_ID[e.archetypeId],
    mechanic = def.mechanic;
  if (mechanic === 'shared') return false;
  const boss = e.kind === 'boss';
  if (boss) {
    const phase = e.hp / e.maxHp <= 0.35 ? 2 : e.hp / e.maxHp <= 0.7 ? 1 : 0;
    if (phase > e.bossPhase) {
      const crossed = phase - e.bossPhase;
      e.bossPhase = phase;
      s.notices.push(`${def.name}: phase ${phase + 1} · prepare for its warning.`);
      const minion: EnemyArchetypeId =
        s.stage === 0 ? 'runner' : s.stage === 1 ? 'plated-crawler' : 'rift-skirmisher';
      for (let i = 0; i < 2 * crossed && encounterValue(s, e, 'summons') < 4; i++) {
        set(s, e, 'summons', encounterValue(s, e, 'summons') + 1);
        actions.summon(minion, e.x + (i ? 24 : -24), e.y + 18);
      }
    }
  }
  const recovery = encounterValue(s, e, 'recovery') > s.time;
  if (mechanic === 'plates') e.armor = (s.time + e.id * 0.17) % 5 < 3 ? 0.45 : 0.05;
  if (mechanic === 'forge-boss') e.armor = recovery ? 0.05 : 0.45;
  const d = Math.max(1, Math.hypot(e.x - CENTER.x, e.y - CENTER.y));
  const support = ['mend', 'barrier'].includes(mechanic);
  const range = boss
    ? 450
    : support
      ? 270
      : ['artillery', 'pulse', 'echo'].includes(mechanic)
        ? mechanic === 'artillery'
          ? 300
          : 245
        : 30 + e.radius;
  const stop = boss ? 170 : range;
  const speed = e.speed * (s.mode === 'quick' ? 1.3 : 1.1) * (1 - e.chill * (boss ? 0.35 : 1));
  if (d > stop && !encounterValue(s, e, 'windup')) {
    e.vx = ((CENTER.x - e.x) / d) * speed;
    e.vy = ((CENTER.y - e.y) / d) * speed;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
  } else e.vx = e.vy = 0;
  e.attackCd -= dt;
  const echo = encounterValue(s, e, 'echo');
  if (echo && s.time >= echo) {
    actions.hurt(e.damage * (boss ? 0.65 : 0.45), e.damageType, e);
    remove(s, e, 'echo');
    if (boss) {
      set(s, e, 'recovery', s.time + 3);
      e.attackCd = 3.8;
    }
  }
  const windup = encounterValue(s, e, 'windup');
  if (windup) {
    if (s.time < windup) return true;
    remove(s, e, 'windup');
    if (mechanic === 'burrow' || mechanic === 'rift') {
      e.x = encounterValue(s, e, 'aim-x');
      e.y = encounterValue(s, e, 'aim-y');
      set(s, e, 'recovery', s.time + (mechanic === 'burrow' ? 1.5 : 0.8));
      e.attackCd = mechanic === 'burrow' ? 7 : 5.5;
    } else if (support) {
      const casts = encounterValue(s, e, 'casts'),
        cap = mechanic === 'mend' ? 6 : 3;
      if (casts < cap) {
        const allies = s.enemies
          .filter((a) => a.id !== e.id && a.hp > 0 && Math.hypot(a.x - e.x, a.y - e.y) <= 105)
          .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)
          .slice(0, 3);
        for (const ally of allies)
          if (mechanic === 'mend') ally.hp = Math.min(ally.maxHp, ally.hp + ally.maxHp * 0.025);
          else {
            set(s, ally, 'barrier', ally.maxHp * 0.15);
            set(s, ally, 'barrier-until', s.time + 6);
          }
        set(s, e, 'casts', casts + 1);
      }
      set(s, e, 'recovery', s.time + 1);
      e.attackCd = mechanic === 'mend' ? 4 : 5;
    } else {
      let allowed = true;
      if (mechanic === 'pulse') {
        const bucket = Math.floor(s.time / 6);
        if (s.counters['enc-pulse-bucket'] !== bucket) {
          s.counters['enc-pulse-bucket'] = bucket;
          s.counters['enc-pulse-hits'] = 0;
        }
        allowed = (s.counters['enc-pulse-hits'] || 0) < 3;
        if (allowed) s.counters['enc-pulse-hits'] = (s.counters['enc-pulse-hits'] || 0) + 1;
      }
      if (allowed)
        actions.hurt(
          e.damage *
            (mechanic === 'pulse'
              ? 0.6
              : mechanic === 'echo'
                ? 0.8
                : mechanic === 'eclipse-boss'
                  ? 0.65
                  : 1) *
            (boss ? 1 + e.bossPhase * 0.1 : 1),
          e.damageType,
          e,
        );
      e.attackCd = mechanic === 'artillery' ? 3.8 : boss ? 3.8 : 4;
      if (mechanic === 'echo' || mechanic === 'eclipse-boss')
        set(s, e, 'echo', s.time + (boss ? 0.8 : 1.4));
      if (mechanic === 'root-boss') {
        if (encounterValue(s, e, 'heals') < 6) {
          e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.01);
          set(s, e, 'heals', encounterValue(s, e, 'heals') + 1);
        }
        set(s, e, 'recovery', s.time + 2);
      }
      if (mechanic === 'forge-boss') set(s, e, 'recovery', s.time + 2.5);
      if (mechanic === 'artillery') {
        const shots = encounterValue(s, e, 'shots') + 1;
        set(s, e, 'shots', shots);
        if (shots % 2 === 0) set(s, e, 'recovery', s.time + 2.3);
      }
    }
    return true;
  }
  if (e.attackCd > 0 || recovery) return true;
  if (mechanic === 'plates' || mechanic === 'thorns') {
    if (d <= range + 2) {
      actions.hurt(e.damage, e.damageType, e);
      e.attackCd = 1.4;
    }
    return true;
  }
  if ((mechanic === 'burrow' || mechanic === 'rift') && d <= 100) {
    if (d <= range + 2) actions.hurt(e.damage, e.damageType, e);
    e.attackCd = 1.4;
    return true;
  }
  if (d > range + 2 && !['burrow', 'rift'].includes(mechanic)) return true;
  if (support && encounterValue(s, e, 'casts') >= (mechanic === 'mend' ? 6 : 3)) {
    // Exhausted supports eventually approach and fight rather than stall a wave.
    e.speed = Math.max(e.speed, 45);
    if (d > 45) {
      e.x += ((CENTER.x - e.x) / d) * e.speed * dt;
      e.y += ((CENTER.y - e.y) / d) * e.speed * dt;
    } else {
      actions.hurt(e.damage, e.damageType, e);
      e.attackCd = 2;
    }
    return true;
  }
  const duration: Record<string, number> = {
    mend: 0.9,
    barrier: 1,
    burrow: 1.1,
    rift: 1,
    artillery: 1.2,
    pulse: 1.1,
    echo: 0.9,
    'root-boss': 1.3,
    'forge-boss': 1.5,
    'eclipse-boss': 1.7,
  };
  set(s, e, 'windup', s.time + duration[mechanic]);
  if (mechanic === 'burrow' || mechanic === 'rift') {
    const angle = Math.atan2(e.y - CENTER.y, e.x - CENTER.x) + (mechanic === 'rift' ? 0.3 : 0),
      radius = Math.max(65, d - (mechanic === 'rift' ? 55 : 70));
    set(s, e, 'aim-x', CENTER.x + Math.cos(angle) * radius);
    set(s, e, 'aim-y', CENTER.y + Math.sin(angle) * radius);
  }
  return true;
}
export function cleanEncounterCounters(s: RunV3): void {
  const living = new Set(s.enemies.filter((e) => e.hp > 0).map((e) => String(e.id)));
  for (const key of Object.keys(s.counters))
    if (/^enc-\d+-/.test(key) && !living.has(key.split('-')[1])) delete s.counters[key];
}
