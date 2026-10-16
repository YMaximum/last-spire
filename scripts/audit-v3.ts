/** Reproducible policy audit. Raw observations stay in ignored local output. */
import * as engine from '../src/v3/engine';
import { CARDS, TOWERS, isDefensiveKind } from '../src/v3/catalog';
import { defaultProfile } from '../src/storage';
import type { CardOffer, RunV2 } from '../src/v2/types';
import type { RunMode } from '../src/v3/types';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const value = (key: string, fallback: string) =>
  process.argv
    .find((a) => a.startsWith(`--${key}=`))
    ?.split('=')
    .slice(1)
    .join('=') || fallback;
const selectedTowers = value('tower', 'all').split(','),
  stages = value('stage', '0,1,2').split(',').map(Number),
  modes = value('mode', 'normal,quick').split(',') as RunMode[],
  policies = value('policy', 'competent,random').split(','),
  seeds = Number(value('seeds', '1'));
const output = value('output', '.private/reports/audit-v3.json');
const profile = defaultProfile();
profile.unlocked = TOWERS.map((t) => t.id);
profile.stageUnlocked = 3;
profile.tutorialDone = true;
const results: Record<string, unknown>[] = [];
const weights: Record<string, number> = {
  regen: 20,
  lifesteal: 18,
  'shield-regen': 15,
  armor: 13,
  vitality: 12,
  damage: 14,
  rate: 14,
  count: 12,
  'kill-mend': 13,
  'kill-haste': 15,
  'kill-fury': 15,
  'skill-cooldown': 10,
  'healing-field': 14,
  'xp-gain': 7,
  'mastery-focus': 8,
  'mastery-investment': 7,
};
const recipePairs = [
  ['bolt', 'rail'],
  ['volley', 'ricochet'],
  ['spiral', 'chakram'],
  ['beam', 'tesla'],
  ['swarm', 'drone'],
  ['mine', 'meteor'],
  ['core-mirror', 'core-echo'],
  ['core-thorn', 'core-mending'],
  ['core-capacitor', 'core-frost'],
  ['core-cinder', 'core-gravitic'],
  ['orbit', 'core-thorn'],
  ['pulse', 'core-capacitor'],
];
for (const tower of TOWERS.filter(
  (t) => selectedTowers.includes('all') || selectedTowers.includes(t.id),
))
  for (const stage of stages)
    for (const mode of modes)
      for (let seed = 1; seed <= seeds; seed++)
        for (const policy of policies) {
          const s = engine.createRun(
            profile,
            tower.id,
            stage,
            Number(value('difficulty', '0')),
            seed * 1299709,
            { mode },
          );
          let decision = (seed * 3157) >>> 0;
          const random = () => {
            decision = (Math.imul(decision, 1664525) + 1013904223) >>> 0;
            return decision / 4294967296;
          };
          let lastSkill = -100,
            failures = 0;
          const starter = s.weapons[0].kind,
            firstPair = recipePairs.find((p) => p.includes(starter)) || recipePairs[0],
            secondPair = isDefensiveKind(starter) ? recipePairs[7] : recipePairs[3];
          const targetKinds = new Set([...firstPair, ...secondPair]);
          const score = (o: CardOffer) => {
            const c = CARDS.find((c) => c.id === o.cardId)!;
            let v = weights[c.effect] || 1;
            if (c.group === 'weapon') {
              const owned = s.weapons.find((w) => w.kind === c.weapon);
              v = owned ? 8 : s.weapons.length < 6 ? 22 : 0;
              if (policy === 'fusion') {
                v += targetKinds.has(c.weapon!) ? 30 : -10;
                if (owned?.masteryRank === 6) v -= 25;
              }
              if (policy === 'defense' && !isDefensiveKind(c.weapon!)) v = -50;
              if (c.weapon === 'core-mending' || c.weapon === 'core-capacitor') v += 5;
            }
            if (c.group === 'infusion') v = s.weapons.some((w) => !w.infusions.length) ? 9 : 3;
            return v + ['normal', 'rare', 'epic', 'legendary', 'mythic'].indexOf(o.rarity) * 2;
          };
          while (
            s.phase === 'combat' &&
            s.time < Number(value('seconds', mode === 'endless' ? '300' : '5400'))
          ) {
            engine.step(s);
            if (s.time - lastSkill > 1) {
              lastSkill = s.time;
              engine.useSkill(s, 'signature');
              if (s.hp < s.maxHp * 0.8 || s.secondary !== 'repair') engine.useSkill(s, 'secondary');
            }
            const fuse = engine as unknown as {
              availableFusions?: (s: RunV2) => { recipeId: string; ingredientIds: string[] }[];
              fuseCores?: (s: RunV2, id: string, a: string, b: string) => boolean;
            };
            if (policy === 'fusion' && fuse.availableFusions && fuse.fuseCores)
              for (const f of fuse.availableFusions(s)) {
                fuse.fuseCores(s, f.recipeId, f.ingredientIds[0], f.ingredientIds[1]);
              }
            for (const reward of [...s.pendingRewards]) {
              const offers = [...reward.offers];
              if (policy === 'random') offers.sort(() => random() - 0.5);
              else offers.sort((a, b) => score(b) - score(a));
              const targetFor = (o: CardOffer) => {
                const c = CARDS.find((c) => c.id === o.cardId)!;
                if (
                  c.group === 'weapon' &&
                  !s.weapons.some((w) => w.kind === c.weapon) &&
                  s.weapons.length >= 6
                )
                  return s.weapons.find((w) => !targetKinds.has(w.kind))?.id || s.weapons[0].id;
                return (
                  s.weapons.find((w) => targetKinds.has(w.kind) && w.masteryRank! < 6)?.id ||
                  s.weapons[0].id
                );
              };
              if (reward.kind === 'draft') {
                let chosen = false;
                for (const offer of offers)
                  if (engine.chooseReward(s, reward.id, offer.id, targetFor(offer))) {
                    chosen = true;
                    break;
                  }
                if (!chosen && ++failures > 10) throw Error('No valid queued offer');
              } else {
                if (policy !== 'random' && s.hp < s.maxHp * 0.65) engine.repair(s, reward.id);
                for (const o of offers)
                  if (engine.buyOffer(s, reward.id, o.id, targetFor(o)) && policy === 'random')
                    break;
                engine.closeShop(s, reward.id);
              }
            }
          }
          const result = {
            tower: tower.id,
            stage,
            mode,
            seed,
            policy,
            outcome: s.cleared
              ? 'clear'
              : s.phase === 'ended'
                ? 'defeat'
                : mode === 'endless'
                  ? 'survival'
                  : 'timeout',
            wave: s.wave,
            seconds: Math.round(s.time),
            level: s.level,
            choices: s.level - 1,
            credits: engine.rewardForRun(s),
            earned: s.earned,
            scrap: s.scrap,
            damage: Object.values(s.damageByWeapon).reduce((a, b) => a + b, 0),
            equipment: s.weapons.map((w) => ({
              kind: w.kind,
              rank: w.masteryRank,
              investment: w.mastery,
            })),
            ...s.stats,
            fusions: s.counters.fusions || 0,
          };
          results.push(result);
          console.error(
            `${tower.id} ${stage} ${mode} ${seed} ${policy}: ${result.outcome} ${s.wave}`,
          );
          mkdirSync(dirname(output), { recursive: true });
          writeFileSync(output, JSON.stringify({ results }, null, 2));
        }
const summary = Object.fromEntries(
  modes.flatMap((mode) =>
    policies.map((policy) => {
      const rows = results.filter((r) => r.mode === mode && r.policy === policy),
        wins = rows.filter((r) => r.outcome === 'clear');
      const sum = (key: string, rs = rows) => rs.reduce((a, r) => a + Number(r[key] || 0), 0);
      return [
        `${mode}/${policy}`,
        {
          runs: rows.length,
          clears: wins.length,
          clearRate: wins.length / Math.max(1, rows.length),
          meanClearMinutes: sum('seconds', wins) / Math.max(1, wins.length) / 60,
          meanClearLevels: sum('choices', wins) / Math.max(1, wins.length),
          purchasesPerShop: sum('shopPurchases') / Math.max(1, sum('shopsVisited')),
          creditsPerMinute: (sum('credits') / Math.max(1, sum('seconds'))) * 60,
          timeouts: rows.filter((r) => r.outcome === 'timeout').length,
        },
      ];
    }),
  ),
);
writeFileSync(output, JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
