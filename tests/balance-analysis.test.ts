import { describe, it, expect } from 'vitest';
import {
  parseAuditArgs,
  privateReportPath,
  summarizeAudit,
  wilson,
  auditMarkdown,
  type AuditResult,
} from '../scripts/analysis/balance-report';
import { analyzeLocalExport, localMarkdown } from '../scripts/analysis/local-report';
import { AuditObserver } from '../scripts/analysis/observer';
import { createRun, step, TICK } from '../src/game/engine';
import { defaultProfile } from '../src/legacy/classic/storage';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { writeReportFiles } from '../scripts/analysis/report-files';

const row = (patch: Partial<AuditResult> = {}): AuditResult => ({
  tower: 'bastion',
  stage: 0,
  difficulty: 0,
  mode: 'normal',
  policy: 'competent',
  outcome: 'clear',
  seconds: 1800,
  wave: 100,
  ...patch,
});

describe('bounded synthetic balance reports', () => {
  it('writes private atomic report checkpoints and refuses a symlink escape', () => {
    mkdirSync(resolve('.private/reports'), { recursive: true });
    const root = mkdtempSync(resolve('.private/reports/analysis-test-'));
    try {
      const output = join(root, 'report.json');
      writeReportFiles(output, { schema: 2, complete: true }, '# Synthetic only');
      expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual({ schema: 2, complete: true });
      expect(readdirSync(root).sort()).toEqual(['report.json', 'report.md']);
      symlinkSync(root, join(root, 'shortcut'));
      expect(() => privateReportPath(join(root, 'shortcut', 'leak.json'))).toThrow(/symlink/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('defaults to a bounded pilot and validates content, numbers, and matrix size', () => {
    const defaults = parseAuditArgs([]);
    expect(defaults.requestedCases).toBe(2);
    expect(defaults.seconds).toBe(5400);
    for (const arg of [
      '--seconds=NaN',
      '--stage=3',
      '--mode=typo',
      '--policy=typo',
      '--seeds=0',
      '--case-wall-seconds=999',
      '--difficulty=6',
      '--tower=unknown',
      '--output=report.json',
      '--nope=1',
    ])
      expect(() => parseAuditArgs([arg])).toThrow();
    expect(() => parseAuditArgs(['--tower=all', '--seeds=50'])).toThrow(/128/);
    expect(() => privateReportPath('.private/reports/../../public/leak.json')).toThrow();
  });
  it('does not turn capped cases into defeats or pool stages and policies', () => {
    const summary = summarizeAudit(
      [
        row(),
        row({ outcome: 'wall-budget' }),
        row({ outcome: 'defeat' }),
        row({ stage: 1, outcome: 'time-cap' }),
        row({ policy: 'random' }),
      ],
      7,
    );
    expect(summary.notStarted).toBe(2);
    expect(summary.groups).toHaveLength(3);
    expect(summary.groups[0]).toMatchObject({
      terminal: 2,
      censored: 1,
      terminalClearRate: 0.5,
      meanClearMinutes: 30,
      targetAssessment: 'insufficient-sample',
    });
    expect(summary.groups[1].terminalClearRate).toBeNull();
    expect(summary.groups[1].meanClearMinutes).toBeNull();
    expect(summary.groups[0].purchasesPerResolvedShop).toBeNull();
    expect(auditMarkdown({ summary })).toContain('censored, not defeats');
  });
  it('shows honest small-sample intervals and requires a minimum terminal sample', () => {
    expect(wilson(0, 0)).toBeNull();
    const single = wilson(1, 1)!;
    expect(single[0]).toBeLessThan(0.21);
    expect(single[1]).toBeGreaterThan(0.99);
    const random = summarizeAudit(
      Array.from({ length: 30 }, () => row({ policy: 'random' })),
      30,
    );
    expect(random.groups[0].targetAssessment).toBe('outside-target');
  });
  it('observes real wave transitions and leaves seeded combat unchanged', () => {
    const profile = defaultProfile();
    profile.tutorialDone = true;
    const run = createRun(profile, 'bastion', 0, 0, 743),
      control = structuredClone(run);
    const observer = new AuditObserver();
    run.spawned = control.spawned = run.spawnTotal;
    run.waveTime = control.waveTime = 18;
    for (let i = 0; i < 120; i++) {
      const before = run.wave;
      step(run, TICK);
      step(control, TICK);
      observer.observe(run, before);
    }
    expect(run).toEqual(control);
    expect(observer.waves[0].wave).toBe(1);
    expect(observer.waves[0].seconds).toBeGreaterThan(0);
    expect(observer.waves).toHaveLength(1);
    expect(observer.lastClearedWave).toBe(1);
  });
  it('tracks fully cleared waves without leaderboard metadata, including evolution-off probes', () => {
    const p = defaultProfile();
    p.tutorialDone = true;
    const run = createRun(p, 'bastion', 0, 0, 743, { evolutionVersion: 0, leaderboard: false });
    expect(run.leaderboard).toBeUndefined();
    const observer = new AuditObserver();
    observer.observe(run, run.wave);
    expect(observer.lastClearedWave).toBe(0);
    run.spawned = run.spawnTotal;
    run.waveTime = 18;
    const before = run.wave;
    step(run, TICK);
    observer.observe(run, before);
    expect(observer.lastClearedWave).toBe(1);
  });
});

const state = (patch: Record<string, unknown> = {}) => ({
  wave: 12,
  maxHealth: 320,
  equipment: [{ id: 'private-core', kind: 'bolt' }],
  damageByWeapon: { 'private-core': 100 },
  ...patch,
});
function exportedRun(patch: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: 'private-run-id',
    build: '3.0.0',
    tower: 'bastion',
    stage: 0,
    difficulty: 0,
    mode: 'normal',
    runes: {},
    completed: true,
    droppedEvents: 0,
    droppedSamples: 0,
    events: [
      { type: 'begin', at: 0, data: { state: state() } },
      { type: 'finish', at: 600, data: {} },
    ],
    samples: [{ at: 10, data: state() }],
    outcome: state({ phase: 'ended', cleared: false }),
    ...patch,
  };
}
const analyze = (runs: unknown[]) => analyzeLocalExport({ version: 1, runs });
describe('offline observation analysis', () => {
  it('keeps original finite-mode results separate from their Endless continuations', () => {
    const finite = exportedRun({
      outcome: state({ phase: 'ended', cleared: true, endless: false }),
    });
    const continued = exportedRun({
      outcome: state({ phase: 'ended', cleared: true, endless: true }),
    });
    const report = analyze([finite, continued]);
    expect(report.groups).toHaveLength(2);
    expect(report.groups[0].key).toContain('/normal/finite/');
    expect(report.groups[1].key).toContain('/normal/endless/');
    expect(report.groups.every((g) => g.campaignClears === 1)).toBe(true);
  });
  it('keeps unfinished runs unknown, and campaign clears distinct from Endless outcomes', () => {
    const report = analyze([
      exportedRun(),
      exportedRun({ completed: false, outcome: undefined }),
      exportedRun({ mode: 'endless', outcome: state({ phase: 'ended', cleared: true }) }),
    ]);
    expect(report.groups[0]).toMatchObject({
      runs: 2,
      completed: 1,
      unfinished: 1,
      knownFiniteOutcomes: 1,
      finiteClearRate: 0,
    });
    expect(report.groups[1]).toMatchObject({ campaignClears: 1, finiteClearRate: null });
    expect(report.groups[0].damageByCore.bolt).toBe(200);
  });
  it('separates build/rules/rune cohorts and never silently upgrades old observations', () => {
    const newer = exportedRun({
      build: 'a'.repeat(40),
      runes: { power: 1 },
      samples: [{ at: 10, data: state({ rules: { combat: 3, arsenal: 2 } }) }],
    });
    const report = analyze([exportedRun(), newer]);
    expect(report.groups).toHaveLength(2);
    expect(report.groups[0].key).toContain('?.?.?.?.?');
    expect(report.groups[1].key).toContain('3.2.?.?.?');
  });
  it('deduplicates resumed offers and choices; flags missing offers from truncated logs', () => {
    const offer = {
      type: 'offers',
      at: 10,
      data: { kind: 'draft', offers: [{ id: 'offer', cardId: 'weapon-bolt' }] },
    };
    const choice = {
      type: 'level-choice',
      at: 10,
      data: { offerId: 'offer', cardId: 'weapon-bolt' },
    };
    const g = analyze([
      exportedRun({
        events: [
          offer,
          offer,
          choice,
          choice,
          { ...choice, data: { ...choice.data, offerId: 'missing' } },
        ],
        droppedEvents: 5,
      }),
    ]).groups[0];
    expect(g.cards[0]).toMatchObject({ draftOffered: 1, draftChosen: 2, unmatchedSelections: 1 });
    expect(g.droppedEvents).toBe(5);
  });
  it('uses only foreground performance windows and does not compute a p95 of p95s', () => {
    const samples = [
      {
        at: 10,
        data: state({
          performance: { status: 'foreground', renderMs: 4, simulationMs: 2, frameP95Ms: 25 },
        }),
      },
      {
        at: 20,
        data: state({
          performance: {
            status: 'background',
            renderMs: 900,
            simulationMs: 900,
            frameP95Ms: 999,
            catchupSeconds: 15,
          },
        }),
      },
      { at: 30, data: state({ performance: { renderMs: 600, fps: 1 } }) },
    ];
    expect(analyze([exportedRun({ samples })]).groups[0].performance).toMatchObject({
      foregroundSamples: 1,
      legacyContextSamples: 1,
      meanSampledRenderMs: 4,
      meanSampledSimulationMs: 2,
      worstSampledFrameP95Ms: 25,
      worstCatchupSeconds: 15,
    });
  });
  it('whitelists public content and never returns identities, timestamps or free text', () => {
    const input = exportedRun({
      email: 'synthetic@example.invalid',
      username: '<script>private</script>',
      startedAt: 12345678,
      build: '/private/secret',
      outcome: state({ damageByWeapon: { 'private-core': 9, 'synthetic@example.invalid': 5 } }),
      events: [{ type: 'fusion', at: 1, data: { recipeId: '<script>private</script>' } }],
    });
    const report = analyze([input]),
      json = JSON.stringify(report) + localMarkdown(report);
    expect(json).not.toMatch(
      /private-run-id|private-core|example.invalid|username|12345678|script>|\/private/,
    );
    expect(report.groups[0].damageByCore).toEqual({ bolt: 9, unattributed: 5 });
  });
  it('rejects future formats, unavailable exports and oversized collections', () => {
    expect(() => analyzeLocalExport({ version: 2, runs: [] })).toThrow();
    expect(() => analyzeLocalExport({ version: 1, runs: [], unavailable: true })).toThrow();
    expect(() => analyze(Array(31).fill(exportedRun()))).toThrow();
    expect(analyze([exportedRun({ samples: Array(1001).fill({}) })]).excludedRuns).toBe(1);
    expect(analyze([exportedRun({ tower: 'unknown-player-name' })]).excludedRuns).toBe(1);
    expect(analyze([exportedRun({ version: 2 })]).excludedRuns).toBe(1);
    expect(
      analyze([exportedRun({ outcome: state({ phase: 'combat', cleared: false }) })]).groups[0]
        .completed,
    ).toBe(0);
  });
});
