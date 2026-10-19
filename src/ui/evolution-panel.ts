import {
  evolutionBonusText,
  evolutionMilestones,
  evolutionOptions,
  evolutionOwner,
  evolutionPath,
  evolutionState,
} from '../game/evolution';
import type { RunV2 } from '../model/arsenal';
import type { EvolutionPath } from '../model/evolution';
import { evolutionIcon } from './evolution-icons';

export function evolutionPathMarkup(path: EvolutionPath, currentTier: number, compact = false) {
  const tiers = `<ol>${path.tiers.map((tier, index) => `<li class="${index < currentTier ? 'evolution-earned' : ''}"><small>TIER ${index + 1}${index < currentTier ? ' · AWAKENED' : ''}</small><h4>${tier.name}</h4><p>${tier.description}</p><p class="quiet">${evolutionBonusText(tier.bonuses)}</p></li>`).join('')}</ol>`;
  return `<article class="evolution-path" style="--evolution-color:${path.color}"><header>${evolutionIcon(path.id, 56)}<div><h3>${path.name}</h3><p>${path.identity}</p></div></header>${compact ? `<p>${path.tiers[0].description}</p><details><summary>Inspect all three tiers</summary>${tiers}</details>` : tiers}</article>`;
}
export function evolutionPanelMarkup(run: RunV2) {
  const state = evolutionState(run);
  if (!state)
    return '<p>This recovered expedition retains its original rules. Tower evolution begins with new expeditions.</p>';
  const path = evolutionPath(run),
    owner = evolutionOwner(run);
  return `<p class="lead">${state.pending ? `Tier ${state.pending} is ready · combat paused.` : path ? `${path.name} · tier ${state.tier}/3` : 'Two paths. One choice for this expedition.'}</p><p>Free evolution after cleared waves ${evolutionMilestones(run).join(' / ')}. Your path locks at tier one. Each tier adds to the previous tiers.</p><p class="notice">${owner ? `${path?.coreName || 'Your starting core'} remains equipped${owner.fusion ? ' through its fused descendant' : ''}.` : 'Starting core replaced: core-specific benefits are dormant. Reacquire the original core to restore them; tower and signature upgrades remain active.'} Compatible fusion preserves lineage once. Only the starting component gains its core stat upgrades.</p><div class="evolution-paths" data-options="${path ? 1 : 2}">${evolutionOptions(
    run,
  )
    .map(
      (option) =>
        `<section class="evolution-option">${evolutionPathMarkup(option, state.tier, state.tier === 0)}${state.pending ? `<button class="gold-button full" data-evolution-path="${option.id}">${state.tier ? `Preview tier ${state.pending}` : `Preview ${option.name}`} · free</button>` : ''}</section>`,
    )
    .join(
      '',
    )}</div>${state.pending ? '' : '<p class="quiet">This is a live information window. Evolution choices appear automatically at milestones and stay available here.</p>'}`;
}
