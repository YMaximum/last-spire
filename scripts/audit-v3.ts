/** Reproducible policy audit. Raw observations stay in ignored local output. */
import * as engine from '../src/game/engine';
import { CARDS, TOWERS, FUSIONS, isDefensiveKind } from '../src/content/catalog';
import { defaultProfile } from '../src/legacy/classic/storage';
import type { CardOffer, RunV2 } from '../src/model/arsenal';
import { emptySave, exportGame } from '../src/persistence/storage';
import { defaultAutocastConfig } from '../src/game/controls';
import type { RunMode } from '../src/game/types';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
if (process.argv.includes('--help')) {
  console.log(
    'Usage: node --import tsx scripts/audit-v3.ts --tower=all --stage=0,1,2 --mode=normal,quick --policy=competent,random --seeds=1 --seed-start=1 --seconds=5400 --output=.private/reports/audit-v3.json',
  );
  process.exit(0);
}
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
  seeds = Number(value('seeds', '1')),
  seedStart = Number(value('seed-start', '1'));
const output = value('output', '.private/reports/audit-v3.json');
const profile = defaultProfile();
profile.unlocked = TOWERS.map((t) => t.id);
profile.stageUnlocked = 3;
profile.tutorialDone = true;
const results: Record<string, unknown>[] = [];
const weights: Record<string, number> = {
  regen: 22,
  lifesteal: 18,
  'shield-regen': 18,
  crit: 11,
  'crit-damage': 8,
  slow: 11,
  heavy: 9,
  pulse: 11,
  trail: 9,
  blast: 10,
  homing: 8,
  pierce: 7,
  size: 6,
  range: 6,
  lifetime: 4,
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
  'projectile-growth': 6,
  'rebound-charge': 8,
  'return-pulse': 9,
  'expiry-shards': 7,
  'armor-erosion': 17,
  crossfire: 11,
  'absorption-charge': 14,
  'healing-barrier': 14,
  'critical-mirror': 16,
  'briar-wounds': 17,
  'field-resonance': 7,
  'control-release': 8,
};
const recipePairs = FUSIONS.map((recipe) => recipe.ingredients);

for (const tower of TOWERS.filter(
  (t) => selectedTowers.includes('all') || selectedTowers.includes(t.id),
))
  for (const stage of stages)
    for (const mode of modes)
      for (let seed = seedStart; seed < seedStart + seeds; seed++)
        for (const policy of policies) {
          const s = engine.createRun(
            profile,
            tower.id,
            stage,
            Number(value('difficulty', '0')),
            seed * 1299709,
            { mode },
          );
          let decision =
            (Math.imul(seed, 3157) ^
              Math.imul(TOWERS.indexOf(tower) + 1, 73856093) ^
              Math.imul(stage + 1, 19349663) ^
              (mode === 'quick' ? 83492791 : 1299709)) >>>
            0;
          const random = () => {
            decision = (Math.imul(decision, 1664525) + 1013904223) >>> 0;
            return decision / 4294967296;
          };
          let checkpointWave = 0,
            peakSaveBytes = 0;
          const checkpoint = () => {
            const save = emptySave();
            save.profile = profile;
            save.run = s;
            save.progression.active = {
              runId: s.id,
              rulesVersion: 3,
              runes: s.runeSnapshot,
              autocast: defaultAutocastConfig(),
            };
            peakSaveBytes = Math.max(
              peakSaveBytes,
              new TextEncoder().encode(exportGame(save)).length,
            );
          };
          let lastSkill = -100,
            failures = 0;
          const starter = s.weapons[0].kind,
            firstPair = recipePairs.find((p) => p.includes(starter)) || recipePairs[0],
            secondPair = isDefensiveKind(starter) ? recipePairs[7] : recipePairs[3];
          const targetKinds = new Set([...firstPair, ...secondPair]);
          const score = (o: CardOffer) => {
            const c = CARDS.find((c) => c.id === o.cardId)!;
            const invested = s.cards
              .filter((x) => x.cardId === c.id)
              .reduce((sum, x) => sum + x.stacks, 0);
            let v = (weights[c.effect] || 2) / (1 + invested * 0.8);
            const desperate = s.hp < s.maxHp * 0.45;
            if (
              desperate &&
              ['regen', 'lifesteal', 'kill-mend', 'shield-regen', 'healing-field'].includes(
                c.effect,
              )
            )
              v += 12;
            if (c.group === 'weapon') {
              const owned = s.weapons.find((w) => w.kind === c.weapon);
              const completed = s.weapons.some((w) =>
                w.fusion?.ingredients.some((i) => i.kind === c.weapon),
              );
              v = owned
                ? owned.masteryRank! < 6
                  ? 9
                  : 2
                : s.weapons.length < 3
                  ? 30
                  : s.weapons.length < 6
                    ? 11
                    : -35;
              if (policy === 'fusion' || policy === 'competent') {
                const partner = recipePairs.some(
                  (pair) =>
                    pair.includes(c.weapon!) &&
                    pair.some(
                      (k) => k !== c.weapon && s.weapons.some((w) => !w.fusion && w.kind === k),
                    ),
                );
                if (targetKinds.has(c.weapon!)) v += completed ? -15 : 14;
                if (partner && !owned) v += 24;
                if (owned && s.weapons.length < 3) v -= 20;
                if (owned?.masteryRank === 6) v -= 12;
              }
              if (policy === 'defense' && !isDefensiveKind(c.weapon!)) v = -100;
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
            if (s.wave % 10 === 0 && checkpointWave !== s.wave) {
              checkpointWave = s.wave;
              checkpoint();
            }
            if (s.time - lastSkill > 1) {
              lastSkill = s.time;
              engine.useSkill(s, 'signature');
              if (s.hp < s.maxHp * 0.8 || s.secondary !== 'repair') engine.useSkill(s, 'secondary');
            }
            const fuse = engine as unknown as {
              availableFusions?: (s: RunV2) => { recipeId: string; ingredientIds: string[] }[];
              fuseCores?: (s: RunV2, id: string, a: string, b: string) => boolean;
            };
            if (policy !== 'random' && fuse.availableFusions && fuse.fuseCores)
              for (const f of fuse.availableFusions(s)) {
                fuse.fuseCores(s, f.recipeId, f.ingredientIds[0], f.ingredientIds[1]);
              }
            for (const reward of [...s.pendingRewards]) {
              const offers = [...reward.offers];
              if (policy === 'random') {
                // Fisher–Yates avoids engine-dependent bias from a random sort comparator.
                for (let i = offers.length - 1; i > 0; i--) {
                  const j = Math.floor(random() * (i + 1));
                  [offers[i], offers[j]] = [offers[j], offers[i]];
                }
              } else offers.sort((a, b) => score(b) - score(a));
              const targetFor = (o: CardOffer) => {
                const c = CARDS.find((c) => c.id === o.cardId)!;
                if (
                  c.group === 'weapon' &&
                  !s.weapons.some((w) => w.kind === c.weapon) &&
                  s.weapons.length >= 6
                )
                  return (
                    s.weapons.find((w) => !w.fusion && !targetKinds.has(w.kind))?.id ||
                    s.weapons.find((w) => !w.fusion)?.id
                  );
                if (policy === 'random')
                  return s.weapons[Math.floor(random() * s.weapons.length)]?.id;
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
          checkpoint();
          const result = {
            peakSaveBytes,
            tower: tower.id,
            stage,
            mode,
            seed,
            policy,
            cleared: s.cleared,
            terminalPhase: s.phase,
            outcome:
              mode === 'endless'
                ? s.phase === 'ended'
                  ? 'defeat'
                  : 'survival'
                : s.cleared
                  ? 'clear'
                  : s.phase === 'ended'
                    ? 'defeat'
                    : 'timeout',
            wave: s.wave,
            seconds: Math.round(s.time),
            level: s.level,
            choices: s.level - 1,
            credits: engine.rewardForRun(s),
            earned: s.earned,
            scrap: s.scrap,
            damage: Object.values(s.damageByWeapon).reduce((a, b) => a + b, 0),
            cards: s.cards.map((c) => ({ cardId: c.cardId, stacks: c.stacks, rarity: c.rarity })),
            damageByWeapon: s.damageByWeapon,
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
