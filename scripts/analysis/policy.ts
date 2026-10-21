import * as engine from '../../src/game/engine';
import { CARDS } from '../../src/content/catalog';
import type { CardOffer, PendingReward } from '../../src/model/arsenal';
import type { RunV3 } from '../../src/game/types';
import type { AuditObserver } from './observer';

export type PolicyEdition = 'selection-v1' | 'controlled-v2';
export type AuditPolicy = 'competent' | 'random' | 'fusion' | 'defense';
export type EvolutionPolicy = 'first' | 'second' | 'random' | 'off';
export type EvolutionMode = EvolutionPolicy | 'alternating' | 'both';
export interface AuditRules {
  autoFuse: boolean;
  repairBelow: number | null;
  /** Card purchases only; repairs use the separate shared stock. Null is unlimited. */
  shopCardLimit: number | null;
  randomTargets: boolean;
}

/** Controlled policies differ in card ordering, not access to support actions. */
export function auditRules(edition: PolicyEdition, policy: AuditPolicy): AuditRules {
  if (edition === 'controlled-v2')
    return { autoFuse: true, repairBelow: 0.65, shopCardLimit: 2, randomTargets: false };
  return policy === 'random'
    ? { autoFuse: false, repairBelow: null, shopCardLimit: 1, randomTargets: true }
    : { autoFuse: true, repairBelow: 0.65, shopCardLimit: null, randomTargets: false };
}

export function auditRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function evolutionPolicies(mode: EvolutionMode, seed: number): EvolutionPolicy[] {
  if (mode === 'both') return ['first', 'second'];
  if (mode === 'alternating') return [(seed + 1) % 2 === 0 ? 'first' : 'second'];
  return [mode];
}

export function orderAuditOffers(
  offers: readonly CardOffer[],
  policy: AuditPolicy,
  score: (offer: CardOffer) => number,
  random: () => number,
): CardOffer[] {
  const ordered = [...offers];
  if (policy !== 'random') return ordered.sort((a, b) => score(b) - score(a));
  for (let i = ordered.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  }
  return ordered;
}

export function auditTarget(
  run: RunV3,
  offer: CardOffer,
  targetKinds: ReadonlySet<string>,
  rules: AuditRules,
  random: () => number,
): string | undefined {
  const card = CARDS.find((c) => c.id === offer.cardId)!;
  if (
    card.group === 'weapon' &&
    !run.weapons.some((w) => w.kind === card.weapon) &&
    run.weapons.length >= 6
  )
    return (
      run.weapons.find((w) => !w.fusion && !targetKinds.has(w.kind))?.id ||
      run.weapons.find((w) => !w.fusion)?.id
    );
  if (rules.randomTargets) return run.weapons[Math.floor(random() * run.weapons.length)]?.id;
  return (
    run.weapons.find((w) => targetKinds.has(w.kind) && w.masteryRank! < 6)?.id || run.weapons[0].id
  );
}

export function applyAuditFusions(run: RunV3, rules: AuditRules, observer: AuditObserver): void {
  if (!rules.autoFuse) return;
  const candidates = engine.availableFusions(run);
  if (candidates.length) observer.observe(run);
  for (const f of candidates)
    if (engine.fuseCores(run, f.recipeId, f.ingredientIds[0], f.ingredientIds[1]))
      observer.observe(run);
}

export function resolveAuditShop(
  run: RunV3,
  reward: PendingReward,
  offers: readonly CardOffer[],
  target: (offer: CardOffer) => string | undefined,
  rules: AuditRules,
  observer: AuditObserver,
): void {
  const before = {
    scrap: run.scrap,
    hp: run.hp,
    purchases: run.stats.shopPurchases,
    repairHealing: 0,
    repairSpend: 0,
  };
  const snapshot = { ...reward, offers: [...reward.offers] };
  if (rules.repairBelow !== null && run.hp < run.maxHp * rules.repairBelow)
    engine.repair(run, reward.id);
  before.repairHealing = run.hp - before.hp;
  before.repairSpend = before.scrap - run.scrap;
  let cards = 0;
  for (const offer of offers) {
    if (rules.shopCardLimit !== null && cards >= rules.shopCardLimit) break;
    if (engine.buyOffer(run, reward.id, offer.id, target(offer))) {
      observer.choice(offer, true);
      cards++;
    }
  }
  observer.shop(run, snapshot, before);
  engine.closeShop(run, reward.id);
}
