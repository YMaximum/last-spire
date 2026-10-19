import {
  createRun,
  step,
  chooseReward,
  buyOffer,
  closeShop,
  useSkill,
  repair,
  getWeaponStats,
} from '../src/legacy/runeforged/engine';
import { CARDS } from '../src/content/base-catalog';
import { TOWERS } from '../src/content/world';
import type { CardOffer, RunV2 } from '../src/model/arsenal';
import type { Profile } from '../src/model/shared';
declare const process: { argv: string[]; stderr: { write(s: string): void } };
const profile: Profile = {
  version: 1,
  credits: 0,
  unlocked: TOWERS.map((t) => t.id),
  stageUnlocked: 2,
  clears: [],
  difficultyUnlocked: 5,
  upgrades: { power: 0, vitality: 0, fortune: 0 },
  runs: 0,
  bestWave: 0,
  totalKills: 0,
  settledRuns: [],
  seenSynergies: [],
  tutorialDone: true,
};
const arg = (key: string, fallback: number) =>
  Number(process.argv.find((a) => a.startsWith(`--${key}=`))?.split('=')[1] || fallback);
const seedStart = arg('seed-start', 1);
const seeds = arg('seeds', 3),
  stage = arg('stage', 0),
  difficulty = arg('difficulty', 0),
  limit = arg('limit', 5400);
const selected = process.argv.find((a) => a.startsWith('--tower='))?.split('=')[1];
const policyArg = process.argv.find((a) => a.startsWith('--policy='))?.split('=')[1];
function score(s: RunV2, o: CardOffer) {
  const d = CARDS.find((c) => c.id === o.cardId)!;
  let v = 1;
  if (d.group === 'weapon') v = s.weapons.length < 6 ? 18 : 6;
  const weights: Record<string, number> = {
    regen: 19,
    vitality: 9,
    armor: 12,
    'shield-regen': 15,
    damage: 12,
    rate: 12,
    count: 12,
    pierce: 6,
    homing: 5,
    'kill-fury': 14,
    'kill-haste': 14,
    lifesteal: 15,
    'kill-mend': 11,
    'skill-cooldown': 9,
    'healing-field': 10,
    'shield-field': 7,
    retaliation: 6,
    resonance: 4,
    conductivity: 5,
    'crit-damage': 3,
    crit: 5,
  };
  v += weights[d.effect] || 0;
  if (d.group === 'infusion') v = 6;
  if (d.effect === 'regen' && s.hp < s.maxHp * 0.6) v += 6;
  return v + ['normal', 'rare', 'epic', 'legendary', 'mythic'].indexOf(o.rarity) * 2;
}
const results: {
  tower: string;
  seed: number;
  policy: string;
  wave: number;
  clear: boolean;
  time: number;
  shopPurchases: number;
  [key: string]: string | number | boolean;
}[] = [];
for (const t of TOWERS.filter((t) => !selected || selected === t.id))
  for (let seed = seedStart; seed <= seeds; seed++)
    for (const policy of policyArg ? [policyArg] : ['competent', 'random']) {
      const s = createRun(profile, t.id, stage, difficulty, seed * 1299709);
      let decision = seed * 3157;
      const rand = () => {
        decision = (Math.imul(decision, 1664525) + 1013904223) >>> 0;
        return decision / 4294967296;
      };
      let lastSkill = -100;
      while (s.phase === 'combat' && s.time < limit) {
        step(s);
        if (policy === 'competent' && s.time - lastSkill > 1) {
          lastSkill = s.time;
          if (s.enemies.length > 6 || s.hp < s.maxHp * 0.8) useSkill(s, 'signature');
          if (s.hp < s.maxHp * 0.7) useSkill(s, 'secondary');
        } else if (policy === 'random' && rand() < 0.0008)
          useSkill(s, rand() < 0.5 ? 'signature' : 'secondary');
        for (const r of [...s.pendingRewards]) {
          const offers = [...r.offers].sort((a, b) => score(s, b) - score(s, a));
          const target = s.weapons.reduce(
            (best, w) => (getWeaponStats(s, w).damage > getWeaponStats(s, best).damage ? w : best),
            s.weapons[0],
          ).id;
          if (r.kind === 'draft') {
            const o =
              policy === 'competent' ? offers[0] : r.offers[Math.floor(rand() * r.offers.length)];
            chooseReward(
              s,
              r.id,
              o.id,
              CARDS.find((c) => c.id === o.cardId)?.group === 'infusion'
                ? target
                : s.weapons.reduce((a, b) =>
                    getWeaponStats(s, a).damage < getWeaponStats(s, b).damage ? a : b,
                  ).id,
            );
          } else {
            if (policy === 'competent' && s.hp < s.maxHp * 0.65) repair(s, r.id);
            for (const o of policy === 'competent' ? offers : r.offers) {
              if (buyOffer(s, r.id, o.id, target) && policy === 'random') break;
            }
            closeShop(s, r.id);
          }
        }
      }
      const result = {
        tower: t.id,
        seed,
        policy,
        wave: s.wave,
        clear: s.cleared,
        outcome: s.cleared ? 'victory' : s.phase === 'ended' ? 'defeat' : 'timeout',
        time: Math.round(s.time),
        hp: Math.round(s.hp),
        weapons: s.weapons.length,
        cards: s.cards.length,
        shots: s.weapons.reduce((n, w) => n + w.lifetimeShots, 0),
        damage: Math.round(Object.values(s.damageByWeapon).reduce((a, b) => a + b, 0)),
        ...s.stats,
      };
      results.push(result);
      process.stderr.write(`${JSON.stringify(result)}\n`);
    }
const summary = Object.fromEntries(
  ['competent', 'random'].map((policy) => {
    const r = results.filter((r) => r.policy === policy);
    return [
      policy,
      {
        runs: r.length,
        clearRate: r.filter((r) => r.clear).length / (r.length || 1),
        timeouts: r.filter((r) => r.outcome === 'timeout').length,
        meanClearTime:
          r.filter((r) => r.clear).reduce((a, r) => a + r.time, 0) /
          (r.filter((r) => r.clear).length || 1),
        meanWave: r.reduce((a, r) => a + r.wave, 0) / (r.length || 1),
        meanTime: r.reduce((a, r) => a + r.time, 0) / (r.length || 1),
        meanPurchases: r.reduce((a, r) => a + r.shopPurchases, 0) / (r.length || 1),
      },
    ];
  }),
);
console.log(JSON.stringify({ seeds, stage, difficulty, summary, results }, null, 2));
