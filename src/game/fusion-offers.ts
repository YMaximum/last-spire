import { availableFusions, isModern } from './engine';
import type { RunV2 } from './types';
import { evolutionState } from './evolution';

export type FusionOffer = ReturnType<typeof availableFusions>[number];
const BOUNDARY = 'ui.fusion.boundary';
const SEEN = 'ui.fusion.seen.';

// Two independent 32-bit digests keep arbitrary saved equipment IDs within the
// existing metadata identifier limit. This is a UI acknowledgement, not a credential.
export function fusionOfferKey(offer: FusionOffer): string {
  const text = JSON.stringify([offer.recipeId, ...[...offer.ingredientIds].sort()]);
  let a = 2166136261,
    b = 5381;
  for (const character of text) {
    a = Math.imul(a ^ character.charCodeAt(0), 16777619);
    b = Math.imul(b, 33) ^ character.charCodeAt(0);
  }
  return `${SEEN}${offer.recipeId}.${(a >>> 0).toString(16)}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

export function unseenFusions(run: RunV2): FusionOffer[] {
  return availableFusions(run).filter((offer) => run.counters[fusionOfferKey(offer)] !== 1);
}

export function recordFusionBoundary(run: RunV2, previousWave: number): void {
  if (!isModern(run)) return;
  if (run.wave > previousWave && run.phase === 'combat') run.counters[BOUNDARY] = run.wave;
  else if (run.waveTime > 0) delete run.counters[BOUNDARY];
}

export function pendingFusionOffer(run: RunV2): boolean {
  return (
    isModern(run) &&
    run.phase === 'combat' &&
    run.waveTime === 0 &&
    run.counters[BOUNDARY] === run.wave &&
    unseenFusions(run).length > 0
  );
}

export function nextRunDecision(run: RunV2): 'reward' | 'evolution' | 'fusion' | null {
  if (run.phase !== 'combat') return null;
  if (run.pendingRewards.length) return 'reward';
  if (evolutionState(run)?.pending) return 'evolution';
  return pendingFusionOffer(run) ? 'fusion' : null;
}

export function acknowledgeFusions(run: RunV2, offers: FusionOffer[]): void {
  if (!isModern(run)) return;
  const current = new Set(availableFusions(run).map(fusionOfferKey));
  for (const key of Object.keys(run.counters))
    if (key.startsWith(SEEN) && !current.has(key)) delete run.counters[key];
  for (const offer of offers) {
    const key = fusionOfferKey(offer);
    if (current.has(key)) run.counters[key] = 1;
  }
}
