/** Reproducible policy audit. Raw observations stay in ignored local output. */
import * as engine from '../src/game/engine';
import { CARDS, TOWERS, FUSIONS, isDefensiveKind } from '../src/content/catalog';
import { defaultProfile } from '../src/legacy/classic/storage';
import type { CardOffer } from '../src/model/arsenal';
import { emptySave, exportGame } from '../src/persistence/storage';
import { defaultAutocastConfig } from '../src/game/controls';
import { chooseEvolution, evolutionOptions, evolutionState } from '../src/game/evolution';
import { writeReportFiles } from './analysis/report-files';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  parseAuditArgs,
  summarizeAudit,
  auditMarkdown,
  type AuditResult,
} from './analysis/balance-report';
import { AuditObserver } from './analysis/observer';
import { BALANCE_EDITION } from '../src/model/leaderboard';
import {
  auditRules,
  auditRandom,
  evolutionPolicies,
  orderAuditOffers,
  auditTarget,
  applyAuditFusions,
  resolveAuditShop,
} from './analysis/policy';
if (process.argv.includes('--help')) {
  console.log(
    'Usage: node --import tsx scripts/audit-v3.ts --tower=bastion --stage=0 --mode=normal --policy=competent,random --seeds=1 --seed-start=1 --seconds=5400 --case-wall-seconds=30 --batch-wall-seconds=180 --stop-wave=0 --evolution=both --policy-edition=controlled-v2 --output=.private/reports/balance-audit.json',
  );
  process.exit(0);
}
const options = parseAuditArgs(process.argv.slice(2));
const { towers: selectedTowers, stages, modes, policies, seeds, seedStart, output } = options;
const batchStarted = performance.now();
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
// Report tooling may be under development; the measured simulation must be committed.
execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'src/game', 'src/model', 'src/content']);
const toolingSha256 = createHash('sha256');
for (const file of [
  'scripts/audit-v3.ts',
  'scripts/analysis/balance-report.ts',
  'scripts/analysis/observer.ts',
  'scripts/analysis/report-files.ts',
  'scripts/analysis/policy.ts',
])
  toolingSha256.update(file).update('\0').update(readFileSync(file));
const toolingIdentity = toolingSha256.digest('hex');
const profile = defaultProfile();
profile.unlocked = TOWERS.map((t) => t.id);
profile.stageUnlocked = 3;
profile.tutorialDone = true;
const results: AuditResult[] = [];
function writeReport() {
  const summary = summarizeAudit(results, options.requestedCases);
  const { output: _output, ...publicOptions } = options;
  const report = {
    schema: 3,
    audit: {
      source: 'synthetic-simulation',
      sourceCommit,
      balanceEdition: BALANCE_EDITION,
      policyEdition: options.policyEdition,
      toolingSha256: toolingIdentity,
      options: publicOptions,
      node: process.versions.node,
      runes: 'none',
      elapsedWallSeconds: (performance.now() - batchStarted) / 1000,
    },
    summary,
    results,
  };
  writeReportFiles(output, report, auditMarkdown(report));
  return summary;
}
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

cases: for (const tower of TOWERS.filter(
  (t) => selectedTowers.includes('all') || selectedTowers.includes(t.id),
))
  for (const stage of stages)
    for (const mode of modes)
      for (let seed = seedStart; seed < seedStart + seeds; seed++)
        for (const { policy, evolutionPolicy } of evolutionPolicies(
          options.evolution,
          seed,
        ).flatMap((evolutionPolicy) => policies.map((policy) => ({ policy, evolutionPolicy })))) {
          if (performance.now() - batchStarted >= options.batchWallSeconds * 1000) break cases;
          const caseStarted = performance.now();
          const observer = new AuditObserver();
          let ticks = 0,
            stopReason = 'time-cap';
          const stepCosts: number[] = [];
          const s = engine.createRun(
            profile,
            tower.id,
            stage,
            options.difficulty,
            Math.imul(seed, 1299709) >>> 0,
            { mode, evolutionVersion: evolutionPolicy === 'off' ? 0 : 1 },
          );
          const decisionSeed =
            (Math.imul(seed, 3157) ^
              Math.imul(TOWERS.indexOf(tower) + 1, 73856093) ^
              Math.imul(stage + 1, 19349663) ^
              (mode === 'quick' ? 83492791 : 1299709)) >>>
            0;
          const random = auditRandom(decisionSeed);
          const evolutionRandom =
            options.policyEdition === 'selection-v1'
              ? random
              : auditRandom(decisionSeed ^ 0x9e3779b9);
          const rules = auditRules(options.policyEdition, policy);
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
          while (s.phase === 'combat' && s.time < options.seconds) {
            if (
              ticks++ % 300 === 0 &&
              (performance.now() - caseStarted >= options.caseWallSeconds * 1000 ||
                performance.now() - batchStarted >= options.batchWallSeconds * 1000)
            ) {
              stopReason = 'wall-budget';
              break;
            }
            if (options.stopWave && observer.lastClearedWave >= options.stopWave) {
              stopReason = 'wave-cap';
              break;
            }
            if (evolutionState(s)?.pending) {
              const paths = evolutionOptions(s);
              const index =
                evolutionPolicy === 'first'
                  ? 0
                  : evolutionPolicy === 'second'
                    ? paths.length - 1
                    : paths.length === 1
                      ? 0
                      : Math.floor(evolutionRandom() * paths.length);
              if (!chooseEvolution(s, paths[index].id))
                throw Error('Evolution decision could not resolve');
            }
            const waveBefore = s.wave;
            const measure = ticks % 60 === 0;
            const started = measure ? performance.now() : 0;
            engine.step(s);
            if (measure) {
              stepCosts.push(performance.now() - started);
              if (stepCosts.length > 1200) stepCosts.shift();
            }
            if (measure || s.wave !== waveBefore || s.phase !== 'combat')
              observer.observe(s, waveBefore);
            if (s.wave % 10 === 0 && checkpointWave !== s.wave) {
              checkpointWave = s.wave;
              checkpoint();
            }
            if (s.time - lastSkill > 1) {
              lastSkill = s.time;
              engine.useSkill(s, 'signature');
              if (s.hp < s.maxHp * 0.8 || s.secondary !== 'repair') engine.useSkill(s, 'secondary');
            }
            applyAuditFusions(s, rules, observer);
            for (const reward of [...s.pendingRewards]) {
              observer.offers(reward);
              const offers = orderAuditOffers(reward.offers, policy, score, random);
              const targetFor = (offer: CardOffer) =>
                auditTarget(s, offer, targetKinds, rules, random);
              if (reward.kind === 'draft') {
                let chosen = false;
                for (const offer of offers)
                  if (engine.chooseReward(s, reward.id, offer.id, targetFor(offer))) {
                    chosen = true;
                    observer.choice(offer, false);
                    break;
                  }
                if (!chosen && ++failures > 10) throw Error('No valid queued offer');
              } else {
                resolveAuditShop(s, reward, offers, targetFor, rules, observer);
              }
            }
          }
          checkpoint();
          observer.observe(s);
          stepCosts.sort((a, b) => a - b);
          const result = {
            evolution: evolutionState(s)?.path,
            evolutionTier: evolutionState(s)?.tier,
            peakSaveBytes,
            tower: tower.id,
            stage,
            mode,
            seed,
            policy,
            policyEdition: options.policyEdition,
            evolutionPolicy,
            decisionRules: rules,
            cleared: s.cleared,
            terminalPhase: s.phase,
            outcome: s.phase === 'victory' ? 'clear' : s.phase === 'ended' ? 'defeat' : stopReason,
            difficulty: options.difficulty,
            actualSeed: s.seed,
            clearedWaves: observer.lastClearedWave,
            wallSeconds: (performance.now() - caseStarted) / 1000,
            stepSamples: stepCosts.length,
            sampledStepP95Ms: stepCosts.length
              ? stepCosts[Math.ceil(stepCosts.length * 0.95) - 1]
              : null,
            waves: observer.waves,
            droppedWaveSamples: observer.droppedWaveSamples,
            shops: observer.shops,
            mastery: observer.mastery,
            fusionEligibility: observer.fusionEligibility,
            fusionTimeline: observer.fusions,
            evolutionTimeline: observer.evolutions,
            cardObservations: observer.cards,
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
            `${tower.id} ${stage} ${mode} ${seed} ${policy} ${evolutionPolicy}: ${result.outcome} ${s.wave}`,
          );
          writeReport();
        }
console.log(JSON.stringify(writeReport(), null, 2));
