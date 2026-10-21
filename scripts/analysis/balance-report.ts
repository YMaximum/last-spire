import type { AuditPolicy, PolicyEdition, EvolutionMode } from './policy';
import { TOWERS } from '../../src/content/catalog';
import { resolve, relative, sep } from 'node:path';
import { existsSync, lstatSync } from 'node:fs';

export interface AuditOptions {
  towers: string[];
  stages: number[];
  modes: ('normal' | 'quick' | 'endless')[];
  policies: AuditPolicy[];
  policyEdition: PolicyEdition;
  seeds: number;
  seedStart: number;
  difficulty: number;
  seconds: number;
  caseWallSeconds: number;
  batchWallSeconds: number;
  stopWave: number;
  evolution: EvolutionMode;
  output: string;
  requestedCases: number;
}
/** Defaults are a two-case pilot, not an expensive all-content batch. */
export function parseAuditArgs(args: string[]): AuditOptions {
  const defaults: Record<string, string> = {
    tower: 'bastion',
    stage: '0',
    mode: 'normal',
    policy: 'competent,random',
    seeds: '1',
    'seed-start': '1',
    difficulty: '0',
    seconds: '5400',
    'case-wall-seconds': '30',
    'batch-wall-seconds': '180',
    'stop-wave': '0',
    evolution: 'alternating',
    'policy-edition': 'controlled-v2',
    output: '.private/reports/balance-audit.json',
  };
  const values = { ...defaults };
  for (const arg of args) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || !Object.hasOwn(defaults, match[1]))
      throw new Error('Unknown or incomplete audit option; use --help.');
    values[match[1]] = match[2];
  }
  const integer = (name: string, min: number, max: number) => {
    const n = Number(values[name]);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid --${name}.`);
    return n;
  };
  const list = (key: string, valid: string[]) => {
    const result = values[key].split(',');
    if (
      !result.length ||
      new Set(result).size !== result.length ||
      result.some((v) => !valid.includes(v))
    )
      throw new Error(`Invalid --${key}.`);
    return result;
  };
  const towers =
    values.tower === 'all'
      ? TOWERS.map((t) => t.id)
      : list(
          'tower',
          TOWERS.map((t) => t.id),
        );
  const stages = list('stage', ['0', '1', '2']).map(Number);
  const modes = list('mode', ['normal', 'quick', 'endless']) as AuditOptions['modes'];
  const policies = list('policy', ['competent', 'random', 'fusion', 'defense']) as AuditPolicy[];
  const policyEdition = list('policy-edition', [
    'selection-v1',
    'controlled-v2',
  ])[0] as PolicyEdition;
  if (values['policy-edition'].includes(','))
    throw new Error('Select one --policy-edition per batch.');
  const seeds = integer('seeds', 1, 50);
  const requestedCases =
    towers.length *
    stages.length *
    modes.length *
    policies.length *
    seeds *
    (values.evolution === 'both' ? 2 : 1);
  if (requestedCases > 128) throw new Error('Split the matrix into batches of at most 128 cases.');
  const evolution = list('evolution', [
    'alternating',
    'first',
    'second',
    'random',
    'off',
    'both',
  ])[0] as EvolutionMode;
  if (values.evolution.includes(',')) throw new Error('Select one --evolution policy per batch.');
  const output = privateReportPath(values.output);
  return {
    towers,
    stages,
    modes,
    policies,
    policyEdition,
    seeds,
    requestedCases,
    evolution,
    output,
    seedStart: integer('seed-start', 0, 1_000_000),
    difficulty: integer('difficulty', 0, 5),
    seconds: integer('seconds', 1, 21600),
    caseWallSeconds: integer('case-wall-seconds', 1, 120),
    batchWallSeconds: integer('batch-wall-seconds', 1, 900),
    stopWave: integer('stop-wave', 0, 1200),
  };
}
export function privateReportPath(path: string): string {
  const root = resolve('.private/reports');
  const result = resolve(path);
  const rel = relative(root, result);
  if (
    !rel ||
    rel.startsWith(`..${sep}`) ||
    rel === '..' ||
    resolve(root, rel) !== result ||
    !result.endsWith('.json')
  )
    throw new Error('Write JSON reports inside .private/reports.');
  let current = resolve('.');
  for (const part of relative(current, result).split(sep)) {
    current = resolve(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error('Report paths cannot traverse symlinks.');
  }
  return result;
}

export interface AuditResult extends Record<string, unknown> {
  tower: string;
  stage: number;
  difficulty: number;
  mode: string;
  policy: string;
  policyEdition?: PolicyEdition;
  evolutionPolicy?: string;
  outcome: string;
  seconds: number;
  wave: number;
}
export function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
export function wilson(successes: number, total: number): [number, number] | null {
  if (!total) return null;
  const z = 1.96,
    p = successes / total,
    d = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / d;
  const radius = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / d;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}
export function summarizeAudit(results: AuditResult[], requestedCases: number) {
  const buckets = new Map<string, AuditResult[]>();
  for (const row of results) {
    const key = [
      row.tower,
      row.stage,
      row.difficulty,
      row.mode,
      row.policy,
      row.policyEdition ?? 'selection-v1',
      row.evolutionPolicy ?? 'unspecified',
    ].join('/');
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  const groups = [...buckets.entries()].map(([key, rows]) => {
    const wins = rows.filter((r) => r.outcome === 'clear');
    const terminal = rows.filter((r) => ['clear', 'defeat'].includes(r.outcome));
    const shops = rows.flatMap(
      (r) =>
        (r.shops ?? []) as {
          purchases: number;
          cardPurchases?: number;
          affordable: number;
          offers: number;
        }[],
    );
    const clearRate = terminal.length ? wins.length / terminal.length : null;
    return {
      key,
      policyEdition: rows[0].policyEdition ?? 'selection-v1',
      evolutionPolicy: rows[0].evolutionPolicy ?? 'unspecified',
      runs: rows.length,
      terminal: terminal.length,
      clears: wins.length,
      censored: rows.length - terminal.length,
      terminalClearRate: clearRate,
      clearRate95: wilson(wins.length, terminal.length),
      targetAssessment:
        rows[0].mode !== 'normal'
          ? 'not-applicable'
          : terminal.length < 30
            ? 'insufficient-sample'
            : rows.length !== terminal.length
              ? 'censored-cases'
              : rows[0].policy === 'random'
                ? clearRate! <= 0.1
                  ? 'within-target'
                  : 'outside-target'
                : rows[0].policy === 'competent'
                  ? clearRate! >= 0.4 && clearRate! <= 0.7
                    ? 'within-target'
                    : 'outside-target'
                  : 'not-applicable',
      meanClearMinutes: mean(wins.map((r) => r.seconds / 60)),
      meanFusions: mean(rows.map((r) => Number(r.fusions ?? 0))),
      meanDistinctFusionRecipes: mean(
        rows.map(
          (r) =>
            new Set(((r.fusionTimeline ?? []) as { recipe: string }[]).map((f) => f.recipe)).size,
        ),
      ),
      meanFirstFusionMinutes: mean(
        rows.flatMap((r) => {
          const first = ((r.fusionTimeline ?? []) as { seconds: number }[])[0];
          return first ? [first.seconds / 60] : [];
        }),
      ),
      purchasesPerResolvedShop: mean(shops.map((s) => s.purchases)),
      cardPurchasesPerResolvedShop: mean(
        shops.flatMap((s) => (s.cardPurchases === undefined ? [] : [s.cardPurchases])),
      ),
      affordableOffersPerShop: mean(shops.map((s) => s.affordable)),
      meanWaveReached: mean(rows.map((r) => r.wave)),
    };
  });
  return {
    requestedCases,
    observedCases: results.length,
    notStarted: requestedCases - results.length,
    groups,
  };
}
export function auditMarkdown(report: { summary: ReturnType<typeof summarizeAudit> }): string {
  const s = report.summary;
  const fmt = (n: number | null, digits = 1) => (n === null ? 'unknown' : n.toFixed(digits));
  return (
    `# Synthetic balance audit\n\n${s.observedCases}/${s.requestedCases} cases observed; ${s.notStarted} not started. No player data.\n\n` +
    '| Tower/stage/difficulty/mode/policy/edition/path | Runs | Terminal | Censored | Clears | Terminal clear rate (95% interval) | Clear minutes | Fusions | Card purchases/shop |\n|---|---:|---:|---:|---:|---|---:|---:|---:|\n' +
    s.groups
      .map(
        (g) =>
          `| ${g.key} | ${g.runs} | ${g.terminal} | ${g.censored} | ${g.clears} | ${g.terminalClearRate === null ? 'unknown' : `${fmt(g.terminalClearRate * 100)}% (${fmt(g.clearRate95![0] * 100)}–${fmt(g.clearRate95![1] * 100)}%)`} | ${fmt(g.meanClearMinutes)} | ${fmt(g.meanFusions)} | ${fmt(g.cardPurchasesPerResolvedShop, 2)} |`,
      )
      .join('\n') +
    '\n\nTime/wave/wall limits are censored, not defeats. Clear-rate intervals use terminal cases only and do not correct policy bias or censoring. Small samples do not establish player clear rates. Policy names describe heuristics, not certified human skill. Headless timings do not measure rendering or physical-mobile performance.\n'
  );
}
