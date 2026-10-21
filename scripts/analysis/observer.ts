import type { RunV3 } from '../../src/game/types';
import type { CardOffer, PendingReward } from '../../src/model/arsenal';
import { availableFusions } from '../../src/game/engine';
import { evolutionState } from '../../src/game/evolution';

type Point = { wave: number; seconds: number };
/** Observe public simulation state without consuming RNG or changing the run. */
export class AuditObserver {
  lastClearedWave = 0;
  waves: (Point & {
    duration: number;
    healthFraction: number;
    level: number;
    scrap: number;
    damageTaken: number;
    cumulativePeakEnemies: number;
    cumulativePeakProjectiles: number;
  })[] = [];
  shops: (Point & {
    scrapBefore: number;
    scrapAfter: number;
    affordable: number;
    offers: number;
    purchases: number;
    repairHealing: number;
    repairSpend: number;
  })[] = [];
  mastery: (Point & { kind: string })[] = [];
  fusionEligibility: (Point & { recipe: string })[] = [];
  fusions: (Point & { recipe: string })[] = [];
  evolutions: (Point & { path: string; tier: number })[] = [];
  cards: Record<string, { offered: number; draftPicks: number; shopPicks: number }> = {};
  private mastered = new Set<string>();
  private eligible = new Set<string>();
  private fused = new Set<string>();
  private evolved = new Set<string>();
  private seenRewards = new Set<string>();
  private lastClearSeconds = 0;
  private lastDamage = 0;
  private readonly maxPoints = 1200;
  droppedWaveSamples = 0;
  private point(run: RunV3): Point {
    return { wave: run.wave, seconds: run.time };
  }
  observe(run: RunV3, previousWave?: number): void {
    const point = this.point(run);
    if (previousWave !== undefined && (run.wave > previousWave || run.phase === 'victory')) {
      this.lastClearedWave = previousWave;
      const sample = {
        ...point,
        wave: previousWave,
        duration: run.time - this.lastClearSeconds,
        healthFraction: run.hp / run.maxHp,
        level: run.level,
        scrap: run.scrap,
        damageTaken: run.stats.damageTaken - this.lastDamage,
        cumulativePeakEnemies: run.stats.peakEnemies,
        cumulativePeakProjectiles: run.stats.peakProjectiles,
      };
      this.lastClearSeconds = run.time;
      this.lastDamage = run.stats.damageTaken;
      if (this.waves.length < this.maxPoints) this.waves.push(sample);
      else this.droppedWaveSamples++;
    }
    for (const core of run.weapons) {
      if (core.masteryRank === 6 && !this.mastered.has(core.id)) {
        this.mastered.add(core.id);
        this.mastery.push({ ...point, kind: core.kind });
      }
      if (core.fusion && !this.fused.has(core.id)) {
        this.fused.add(core.id);
        this.fusions.push({ ...point, recipe: core.fusion.recipeId });
      }
    }
    for (const recipe of availableFusions(run)) {
      const key = [recipe.recipeId, ...recipe.ingredientIds].join(':');
      if (!this.eligible.has(key)) {
        this.eligible.add(key);
        this.fusionEligibility.push({ ...point, recipe: recipe.recipeId });
      }
    }
    const evolution = evolutionState(run);
    const key = `${evolution?.path}:${evolution?.tier}`;
    if (evolution?.path && evolution.tier > 0 && !this.evolved.has(key)) {
      this.evolved.add(key);
      this.evolutions.push({ ...point, path: evolution.path, tier: evolution.tier });
    }
  }
  offers(reward: PendingReward): void {
    if (this.seenRewards.has(reward.id)) return;
    this.seenRewards.add(reward.id);
    for (const offer of reward.offers) this.card(offer.cardId).offered++;
  }
  choice(offer: CardOffer, shop: boolean): void {
    this.card(offer.cardId)[shop ? 'shopPicks' : 'draftPicks']++;
  }
  private card(id: string) {
    return (this.cards[id] ??= { offered: 0, draftPicks: 0, shopPicks: 0 });
  }
  shop(
    run: RunV3,
    reward: PendingReward,
    before: {
      scrap: number;
      hp: number;
      purchases: number;
      repairHealing: number;
      repairSpend: number;
    },
  ): void {
    // Called with the original offers after the purchase loop, not its mutated array.
    this.shops.push({
      ...this.point(run),
      wave: reward.wave,
      scrapBefore: before.scrap,
      scrapAfter: run.scrap,
      affordable: reward.offers.filter((o) => o.price <= before.scrap).length,
      offers: reward.offers.length,
      purchases: run.stats.shopPurchases - before.purchases,
      repairHealing: before.repairHealing,
      repairSpend: before.repairSpend,
    });
  }
}
