import type { RunV3, EnemyV2 } from './types';
import type { Element } from '../model/shared';
import { ENEMY_BY_ID } from '../content/enemies';
import { getDefenseStats } from './engine';
import {
  encounterValue,
  encounterStrikeDamage,
  encounterFollowupDamage,
  ENCOUNTER_WINDUP_SECONDS,
} from './encounters';

export interface BossImpact {
  seconds: number;
  damage: number;
  followup: boolean;
}
export interface BossThreat {
  name: string;
  element: Element | 'physical';
  healthFraction: number;
  phase: number;
  status: 'approaching' | 'preparing' | 'strike' | 'follow-up';
  impacts: BossImpact[];
  /** Estimates use current mitigation and shield; no future healing or other enemies. */
  damage: number;
  hpDamage: number;
  lethal: boolean;
}

function forecast(run: RunV3, enemy: EnemyV2): BossThreat {
  const current = run.encounterVersion === 2 && !!enemy.archetypeId;
  const def = current ? ENEMY_BY_ID[enemy.archetypeId!] : undefined;
  const mechanic = def?.mechanic;
  const threat: BossThreat = {
    name: def?.name ?? 'Boss',
    element: enemy.damageType,
    healthFraction: Math.max(0, enemy.hp / enemy.maxHp),
    phase: enemy.bossPhase + 1,
    status: 'approaching',
    impacts: [],
    damage: 0,
    hpDamage: 0,
    lethal: false,
  };
  if (enemy.stun > 0) return { ...threat, status: 'preparing' };
  const windup = current
    ? encounterValue(run, enemy, 'windup')
    : run.counters[`boss-${enemy.id}`] || 0;
  const echo = current ? encounterValue(run, enemy, 'echo') : 0;
  const duration = current ? (ENCOUNTER_WINDUP_SECONDS[mechanic!] ?? 1.1) : 1.1;
  let seconds: number | undefined;
  if (echo) {
    threat.status = 'follow-up';
    threat.impacts.push({
      seconds: Math.max(0, echo - run.time),
      damage: encounterFollowupDamage(enemy),
      followup: true,
    });
  } else if (windup) {
    threat.status = 'strike';
    seconds = Math.max(0, windup - run.time);
  } else if (Math.hypot(enemy.x - 500, enemy.y - 400) <= 452) {
    threat.status = 'preparing';
    const recovery = current ? Math.max(0, encounterValue(run, enemy, 'recovery') - run.time) : 0;
    seconds = Math.max(0, enemy.attackCd, recovery) + duration;
  }
  if (seconds !== undefined) {
    const variant =
      run.mode === 'quick' && enemy.spawnWave <= 50
        ? [12, 25, 37, 50].indexOf(enemy.spawnWave)
        : Math.floor((enemy.spawnWave - 1) / 25) % 4;
    const damage = current
      ? encounterStrikeDamage(enemy)
      : enemy.damage *
        (1 + Math.max(0, run.waveTime + seconds - 40) * 0.025) *
        (0.8 + enemy.bossPhase * 0.15) *
        (variant === 2 ? 1.3 : 1);
    threat.impacts.push({ seconds, damage, followup: false });
    if (mechanic === 'eclipse-boss')
      threat.impacts.push({
        seconds: seconds + 0.8,
        damage: encounterFollowupDamage(enemy),
        followup: true,
      });
  }
  return threat;
}

/** Read-only presentation: never spends resources, consumes RNG, or changes combat. */
export function getBossThreat(run: RunV3 | null): BossThreat | null {
  if (!run || run.rulesVersion !== 3 || run.phase !== 'combat') return null;
  const threats = run.enemies
    .filter((e) => e.kind === 'boss' && e.hp > 0)
    .map((e) => forecast(run, e));
  threats.sort((a, b) => (a.impacts[0]?.seconds ?? Infinity) - (b.impacts[0]?.seconds ?? Infinity));
  const threat = threats[0];
  if (!threat) return null;
  const mitigation = getDefenseStats(run).mitigation[threat.element];
  for (const impact of threat.impacts) impact.damage *= 1 - mitigation;
  threat.damage = threat.impacts.reduce((sum, impact) => sum + impact.damage, 0);
  threat.hpDamage = Math.max(0, threat.damage - run.shield);
  threat.lethal = threat.impacts.length > 0 && threat.hpDamage >= run.hp;
  return threat;
}
