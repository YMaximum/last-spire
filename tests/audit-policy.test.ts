import { describe, expect, it } from 'vitest';
import {
  applyAuditFusions,
  auditRandom,
  auditRules,
  auditTarget,
  evolutionPolicies,
  orderAuditOffers,
  resolveAuditShop,
  type AuditPolicy,
} from '../scripts/analysis/policy';
import { parseAuditArgs, summarizeAudit } from '../scripts/analysis/balance-report';
import { AuditObserver } from '../scripts/analysis/observer';
import { acquireCard, advanceMastery, availableFusions, createRun } from '../src/game/engine';
import { defaultProfile } from '../src/legacy/classic/storage';
import type { CardOffer, PendingReward } from '../src/model/arsenal';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const fresh = () => createRun(defaultProfile(), 'bastion', 0, 0, 743);
const offers = (): CardOffer[] =>
  ['mod-damage', 'mod-range', 'mod-speed', 'mod-rate'].map((cardId, i) => ({
    id: `synthetic-${i}`,
    cardId,
    rarity: 'normal',
    price: 10,
  }));
function shop() {
  const run = fresh();
  run.hp = run.maxHp * 0.4;
  run.scrap = 1000;
  const reward: PendingReward = {
    id: 'synthetic-shop',
    kind: 'shop',
    wave: 10,
    offers: offers(),
    rerolls: 0,
    repairStock: 1,
  };
  run.pendingRewards = [reward];
  return { run, reward };
}

describe('comparable audit policies', () => {
  it('runs the CLI matrix with paired seeds and separate path cohorts before evolution', () => {
    mkdirSync(resolve('.private/reports'), { recursive: true });
    const folder = mkdtempSync(resolve('.private/reports/policy-cli-'));
    try {
      const output = join(folder, 'audit.json');
      execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          'scripts/audit-v3.ts',
          '--seconds=1',
          '--evolution=both',
          '--policy-edition=controlled-v2',
          `--output=${output}`,
        ],
        { stdio: 'pipe', timeout: 15000 },
      );
      const report = JSON.parse(readFileSync(output, 'utf8'));
      expect(report).toMatchObject({
        schema: 3,
        audit: { policyEdition: 'controlled-v2' },
        summary: { requestedCases: 4, observedCases: 4, notStarted: 0 },
      });
      expect(report.summary.groups).toHaveLength(4);
      expect(report.results.map((r: { evolutionPolicy: string }) => r.evolutionPolicy)).toEqual([
        'first',
        'first',
        'second',
        'second',
      ]);
      expect(report.results.every((r: { outcome: string }) => r.outcome === 'time-cap')).toBe(true);
      expect(report.results[0].actualSeed).toBe(report.results[2].actualSeed);
      expect(
        report.results.every(
          (r: { decisionRules: unknown }) =>
            JSON.stringify(r.decisionRules) ===
            JSON.stringify(auditRules('controlled-v2', 'competent')),
        ),
      ).toBe(true);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('versions support rules and includes both paths in the matrix budget', () => {
    expect(parseAuditArgs([]).policyEdition).toBe('controlled-v2');
    expect(parseAuditArgs(['--evolution=both']).requestedCases).toBe(4);
    expect(() =>
      parseAuditArgs(['--tower=all', '--stage=0,1,2', '--seeds=2', '--evolution=both']),
    ).toThrow(/128/);
    for (const arg of [
      '--policy-edition=unknown',
      '--policy-edition=selection-v1,controlled-v2',
      '--evolution=first,second',
    ])
      expect(() => parseAuditArgs([arg])).toThrow();
    expect(parseAuditArgs(['--policy-edition=selection-v1']).policyEdition).toBe('selection-v1');
    expect(evolutionPolicies('both', 1)).toEqual(['first', 'second']);
    expect(evolutionPolicies('alternating', 1)).toEqual(['first']);
    expect(evolutionPolicies('alternating', 2)).toEqual(['second']);
  });

  it('keeps policy editions and assigned paths apart even before evolution is reached', () => {
    const row = {
      tower: 'bastion',
      stage: 0,
      difficulty: 0,
      mode: 'normal',
      policy: 'random',
      outcome: 'defeat',
      seconds: 5,
      wave: 1,
    };
    const summary = summarizeAudit(
      [
        { ...row, policyEdition: 'controlled-v2', evolutionPolicy: 'first' },
        { ...row, policyEdition: 'controlled-v2', evolutionPolicy: 'second' },
        { ...row, policyEdition: 'selection-v1', evolutionPolicy: 'first' },
        row,
      ],
      5,
    );
    expect(summary.groups).toHaveLength(4);
    expect(summary.notStarted).toBe(1);
    expect(summary.groups.every((g) => g.targetAssessment === 'insufficient-sample')).toBe(true);
  });

  it('separates card purchases from healing and leaves historical splits unknown', () => {
    const row = {
      tower: 'bastion',
      stage: 0,
      difficulty: 0,
      mode: 'normal',
      policy: 'random',
      outcome: 'clear',
      seconds: 30,
      wave: 100,
    };
    const summary = summarizeAudit(
      [
        {
          ...row,
          policyEdition: 'controlled-v2',
          shops: [{ purchases: 3, cardPurchases: 2, affordable: 4, offers: 4 }],
        },
        { ...row, shops: [{ purchases: 3, affordable: 4, offers: 4 }] },
      ],
      2,
    );
    expect(summary.groups[0]).toMatchObject({
      purchasesPerResolvedShop: 3,
      cardPurchasesPerResolvedShop: 2,
    });
    expect(summary.groups[1].cardPurchasesPerResolvedShop).toBeNull();
  });

  it('orders candidate cards reproducibly without mutating offers', () => {
    const input = offers();
    const weighted = orderAuditOffers(
      input,
      'competent',
      (o) => Number(o.id.at(-1)),
      () => 0,
    );
    const random = orderAuditOffers(
      input,
      'random',
      () => 0,
      () => 0,
    );
    expect(weighted.map((o) => o.id)).not.toEqual(random.map((o) => o.id));
    expect(input).toEqual(offers());
    expect(orderAuditOffers(input, 'random', () => 0, auditRandom(17))).toEqual(
      orderAuditOffers(input, 'random', () => 0, auditRandom(17)),
    );
  });

  it.each<AuditPolicy>(['competent', 'random', 'fusion', 'defense'])(
    '%s receives repair stock and two card purchases under the same controlled rules',
    (policy) => {
      const { run, reward } = shop();
      const observer = new AuditObserver();
      const rules = auditRules('controlled-v2', policy);
      const target = (o: CardOffer) =>
        auditTarget(run, o, new Set(['bolt', 'rail']), rules, () => {
          throw Error('Shared targets must not draw randomness');
        });
      const before = run.maxHp;
      resolveAuditShop(run, reward, reward.offers, target, rules, observer);
      expect(run.hp).toBeCloseTo(before * 0.65);
      expect(observer.shops[0]).toMatchObject({ cardPurchases: 2, purchases: 3 });
      expect(observer.shops[0].repairSpend).toBeGreaterThan(0);
      expect(observer.shops[0].repairHealing).toBeCloseTo(before * 0.25);
      expect(Object.values(observer.cards).reduce((n, c) => n + c.shopPicks, 0)).toBe(2);
      expect(run.pendingRewards).toHaveLength(0);
      expect(run.scrap).toBe(1000 - observer.shops[0].repairSpend - 20);
    },
  );

  it.each<AuditPolicy>(['competent', 'random', 'fusion', 'defense'])(
    '%s can fuse a fully mastered pair under controlled rules',
    (policy) => {
      const run = fresh();
      acquireCard(run, { id: 'synthetic-rail', cardId: 'weapon-rail', rarity: 'normal', price: 0 });
      for (const core of run.weapons) advanceMastery(core, 900);
      expect(availableFusions(run)).toHaveLength(1);
      const observer = new AuditObserver();
      applyAuditFusions(run, auditRules('controlled-v2', policy), observer);
      expect(run.weapons).toHaveLength(1);
      expect(run.weapons[0].fusion).toBeDefined();
      expect(observer.fusions).toHaveLength(1);
      applyAuditFusions(run, auditRules('controlled-v2', policy), observer);
      expect(observer.fusions).toHaveLength(1);
    },
  );

  it('respects scrap and healing stock rather than granting free support', () => {
    const { run, reward } = shop();
    run.scrap = 5;
    const observer = new AuditObserver();
    resolveAuditShop(
      run,
      reward,
      reward.offers,
      () => undefined,
      auditRules('controlled-v2', 'random'),
      observer,
    );
    expect(run.scrap).toBe(5);
    expect(run.hp).toBe(run.maxHp * 0.4);
    expect(observer.shops[0]).toMatchObject({ cardPurchases: 0, repairSpend: 0, repairHealing: 0 });
    const next = shop();
    next.reward.repairStock = 0;
    resolveAuditShop(
      next.run,
      next.reward,
      next.reward.offers,
      () => undefined,
      auditRules('controlled-v2', 'competent'),
      new AuditObserver(),
    );
    expect(next.run.hp).toBe(next.run.maxHp * 0.4);
    expect(next.run.scrap).toBe(980);
  });

  it('retains legacy random support behavior and uncapped focused shops', () => {
    for (const policy of ['random', 'competent'] as const) {
      const { run, reward } = shop();
      const observer = new AuditObserver();
      resolveAuditShop(
        run,
        reward,
        reward.offers,
        () => undefined,
        auditRules('selection-v1', policy),
        observer,
      );
      expect(observer.shops[0].cardPurchases).toBe(policy === 'random' ? 1 : 4);
      expect(observer.shops[0].repairHealing > 0).toBe(policy !== 'random');
    }
    const run = fresh();
    acquireCard(run, { id: 'synthetic-rail', cardId: 'weapon-rail', rarity: 'normal', price: 0 });
    for (const core of run.weapons) advanceMastery(core, 900);
    applyAuditFusions(run, auditRules('selection-v1', 'random'), new AuditObserver());
    expect(availableFusions(run)).toHaveLength(1);
    expect(
      auditTarget(run, offers()[0], new Set(), auditRules('selection-v1', 'random'), () => 0.99),
    ).toBe(run.weapons[1].id);
  });
});
