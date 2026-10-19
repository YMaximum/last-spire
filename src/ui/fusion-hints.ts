import { CARDS, FUSIONS, EXPANSION_FUSION_IDS } from '../content/catalog';
import type { WeaponInstance, WeaponKind } from '../game/types';
import { cardIcon } from './icons';

/** Small, non-interactive hints inside an upgrade card; the card remains one target. */
export function fusionHintMarkup(
  kind: WeaponKind,
  equipped: WeaponInstance[],
  expanded = true,
): string {
  const partners = [
    ...new Set(
      FUSIONS.filter(
        (r) => r.ingredients.includes(kind) && (expanded || !EXPANSION_FUSION_IDS.includes(r.id)),
      ).map((r) => r.ingredients.find((k) => k !== kind)!),
    ),
  ];
  if (!partners.length) return '';
  return `<span class="card-fusion-hint"><b>Fuses with</b>${partners
    .map((partner) => {
      const card = CARDS.find((c) => c.group === 'weapon' && c.weapon === partner)!;
      const owned = equipped.find((w) => w.kind === partner);
      return `<span class="fusion-partner">${cardIcon(card.iconId, 20)}<span>${card.name}<small>${owned ? `Owned · M${owned.masteryRank ?? 1}/6` : 'Not equipped'}</small></span></span>`;
    })
    .join('')}<small>Both cores need mastery 6 · fusion is free</small></span>`;
}
