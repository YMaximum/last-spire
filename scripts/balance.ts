/** Deterministic play-policy comparison. No privileged build grants or modified combat ticks. */
import { TOWERS, STAGES } from '../src/content';
import {
  buyUpgrade,
  continueRun,
  createRun,
  reroll,
  retire,
  selectDraft,
  step,
  TICK,
  useSkill,
} from '../src/engine';
import { defaultProfile } from '../src/storage';
import type { Element, RunState, Upgrade } from '../src/types';

const argv = (globalThis as unknown as { process?: { argv: string[] } }).process?.argv ?? [];
const option = (name: string, fallback: number) => {
  const found = argv.find((a) => a.startsWith(`--${name}=`));
  const value = found ? Number(found.split('=')[1]) : fallback;
  return Number.isFinite(value) ? value : fallback;
};
const SEED = option('seed', 1729),
  DIFFICULTY = Math.max(0, Math.min(5, option('difficulty', 0))),
  TARGET_WAVE = Math.max(100, Math.min(150, option('endless', 100))),
  MAX_TICKS = 30 * 60 * 110;
const strongOnly = argv.includes('--strong-only'),
  towerFilter = argv.find((a) => a.startsWith('--tower='))?.split('=')[1],
  stageFilter = option('stage', -1);
type Result = {
  tower: string;
  stage: string;
  policy: string;
  wave: number;
  clear: boolean;
  minutes: number;
  reward: number;
  kills: number;
  slots: number;
  hp: number;
  peakEnemies: number;
  peakProjectiles: number;
  peakVisuals: number;
  finite: boolean;
  endlessPeakEnemies: number;
  endlessPeakProjectiles: number;
  endlessPeakVisuals: number;
};
function score(s: RunState, u: Upgrade): number {
  const a = s.attacks[u.slot ?? 0];
  if (u.kind === 'pattern' && (u.slot ?? 0) >= s.attacks.length)
    return (
      1000 +
      ({ beam: 8, swarm: 7, orbit: 6, volley: 5, pulse: 4, spiral: 3, bolt: 2, mine: 1 }[u.value] ??
        0)
    );
  if (u.kind === 'element') {
    if (s.attacks.length < 2 || !s.attacks.some((b, i) => i !== u.slot && b.element === a.element))
      return -30;
    if (s.attacks.some((b) => b.element === u.value)) return -50;
    return (
      180 +
      ({ lightning: 8, frost: 7, fire: 6, poison: 5, solar: 4, void: 3 }[u.value as Element] ?? 0)
    );
  }
  if (u.kind === 'rank') return 115 + (5 - a.rank) * 5;
  if (u.kind === 'perk') return { damage: 108, rate: 106, armor: 75, regen: 78 }[u.value] ?? 0;
  if (u.kind === 'modifier')
    return s.tower === 'bastion' && u.value === 'mark'
      ? 95
      : s.tower === 'null' && u.value === 'surge'
        ? 95
        : u.value === 'echo'
          ? 70
          : 5;
  if (u.kind === 'secondary') return -50;
  if (u.kind === 'pattern')
    return (
      ({ beam: 55, swarm: 50, orbit: 35, volley: 25, pulse: 15, spiral: 10, bolt: 0, mine: -5 }[
        u.value
      ] ?? 0) -
      ({ beam: 55, swarm: 50, orbit: 35, volley: 25, pulse: 15, spiral: 10, bolt: 0, mine: -5 }[
        a.pattern
      ] ?? 0)
    );
  return 0;
}
function pick(s: RunState): number {
  let best = 0;
  for (let i = 1; i < s.choices.length; i++)
    if (score(s, s.choices[i]) > score(s, s.choices[best])) best = i;
  return best;
}
function numbersFinite(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(numbersFinite);
  if (value && typeof value === 'object') return Object.values(value).every(numbersFinite);
  return true;
}
function simulate(tower: RunState['tower'], stage: number, strong: boolean): Result {
  const s = createRun(defaultProfile(), tower, stage, DIFFICULTY, SEED);
  if (!strong) s.attacks[0].pattern = 'bolt';
  let ticks = 0,
    peakEnemies = 0,
    peakProjectiles = 0,
    peakVisuals = 0,
    endlessPeakEnemies = 0,
    endlessPeakProjectiles = 0,
    endlessPeakVisuals = 0,
    finite = true;
  while (
    ticks++ < MAX_TICKS &&
    s.phase !== 'ended' &&
    (s.phase !== 'victory' || TARGET_WAVE > 100) &&
    s.wave <= TARGET_WAVE
  ) {
    if (s.phase === 'victory') continueRun(s);
    if (s.phase === 'draft') {
      if (strong) {
        let i = pick(s);
        if (score(s, s.choices[i]) < 70 && s.rerolls > 0) {
          reroll(s);
          i = pick(s);
        }
        selectDraft(s, i);
      } else {
        // Baseline accepts only rank gains, otherwise the least build-changing offer.
        const priority = (u: Upgrade) =>
          u.kind === 'rank'
            ? 100
            : u.kind === 'perk'
              ? 80
              : u.kind === 'modifier'
                ? 60
                : u.kind === 'element'
                  ? 40
                  : u.kind === 'pattern' && (u.slot ?? 0) >= s.attacks.length
                    ? 30
                    : 0;
        let i = 0;
        for (let j = 1; j < s.choices.length; j++)
          if (priority(s.choices[j]) > priority(s.choices[i])) i = j;
        selectDraft(s, i);
      }
    }
    if (s.phase === 'shop') {
      if (strong) {
        for (let n = 0; n < 12; n++) {
          const affordable = s.choices
            .filter((u) => u.price <= s.scrap && score(s, u) > 0)
            .sort((a, b) => score(s, b) - score(s, a));
          if (!affordable.length) break;
          buyUpgrade(s, affordable[0].id);
        }
      }
      continueRun(s);
    }
    if (s.phase !== 'combat') continue;
    if (strong && s.enemies.length) {
      useSkill(s, 'signature');
      if (s.hp < s.maxHp * 0.72 || s.secondary !== 'repair') useSkill(s, 'secondary');
    }
    step(s, TICK);
    peakEnemies = Math.max(peakEnemies, s.enemies.length);
    peakProjectiles = Math.max(peakProjectiles, s.projectiles.length);
    peakVisuals = Math.max(peakVisuals, s.visuals.length);
    if (s.wave >= 100) {
      endlessPeakEnemies = Math.max(endlessPeakEnemies, s.enemies.length);
      endlessPeakProjectiles = Math.max(endlessPeakProjectiles, s.projectiles.length);
      endlessPeakVisuals = Math.max(endlessPeakVisuals, s.visuals.length);
    }
    finite =
      finite &&
      [s.hp, s.shield, s.time, s.scrap, ...Object.values(s.damageByElement)].every(
        Number.isFinite,
      ) &&
      s.enemies.every((e) => [e.x, e.y, e.hp, e.speed].every(Number.isFinite)) &&
      s.projectiles.every((p) => [p.x, p.y, p.vx, p.vy, p.life, p.damage].every(Number.isFinite));
    if (ticks % 30 === 0) finite = finite && numbersFinite(s);
    // Rendering artifacts do not participate in simulation, so discard them between frames.
    s.visuals = [];
    s.notices = [];
  }
  if (ticks >= MAX_TICKS && s.phase === 'combat') retire(s);
  return {
    tower,
    stage: STAGES[stage].name,
    policy: strong ? 'strong' : 'bolt',
    wave: s.wave,
    clear: s.cleared,
    minutes: Math.round((s.time / 60) * 10) / 10,
    reward: s.earned,
    kills: s.kills,
    slots: s.attacks.length,
    hp: Math.round(s.hp),
    peakEnemies,
    peakProjectiles,
    peakVisuals,
    finite,
    endlessPeakEnemies,
    endlessPeakProjectiles,
    endlessPeakVisuals,
  };
}
const start = performance.now();
const results: Result[] = [];
for (const tower of TOWERS.filter((t) => !towerFilter || t.id === towerFilter))
  for (const stage of STAGES.filter((s) => stageFilter < 0 || s.id === stageFilter))
    for (const strong of strongOnly ? [true] : [false, true])
      results.push(simulate(tower.id, stage.id, strong));
console.log(
  `Last Spire balance · seed ${SEED} · fresh profile · difficulty ${DIFFICULTY} · target wave ${TARGET_WAVE} · fixed tick ${TICK.toFixed(5)}s`,
);
console.log(
  'Strong: offered slots, diverse elements, ranks, damage/rate shops, signature on cooldown, repair below72%. Bolt: starting bolt, rank/perk priority, compulsory slot drafts, no purchases or skills.',
);
console.table(results);
const strong = results.filter((r) => r.policy === 'strong'),
  weak = results.filter((r) => r.policy === 'bolt');
console.log(
  JSON.stringify(
    {
      seconds: Math.round((performance.now() - start) / 100) / 10,
      strongClears: strong.filter((r) => r.clear).length,
      baselineClears: weak.filter((r) => r.clear).length,
      strongMeanWave: strong.reduce((n, r) => n + r.wave, 0) / strong.length,
      baselineMeanWave: weak.length ? weak.reduce((n, r) => n + r.wave, 0) / weak.length : null,
      strongMeanMinutes: strong.reduce((n, r) => n + r.minutes, 0) / strong.length,
    },
    null,
    2,
  ),
);
