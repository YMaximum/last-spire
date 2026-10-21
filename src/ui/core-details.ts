import type { RunV2, WeaponInstance } from '../model/arsenal';
import {
  CARDS,
  EXPANSION_FUSION_IDS,
  FUSIONS,
  FUSION_BY_ID,
  WEAPON_BY_ID,
  isDefensiveKind,
  isFusedKind,
} from '../content/catalog';
import { availableFusions, getWeaponStatBreakdown } from '../game/engine';
import { cardIcon } from './icons';

const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const format = (value: number, digits = 1) =>
  Number.isFinite(value) ? value.toFixed(digits).replace(/\.0+$/, '') : '—';
const icon = (kind: WeaponInstance['kind']) =>
  CARDS.find((c) => c.weapon === kind)?.iconId ??
  FUSIONS.find((f) => f.kind === kind)?.iconId ??
  'unknown';

/** Read-only inspection: the simulation remains the source of effective parameters. */
export function coreDetailsMarkup(run: RunV2, core: WeaponInstance): string {
  const parameters = getWeaponStatBreakdown(run, core)
    .map(({ kind, stats }) => {
      const rows: [string, string][] = [
        ['Base hit damage', format(stats.damage)],
        ['Cycle interval', `${format(stats.cooldown, 2)} s`],
        ['Range', `${format(stats.range, 0)} units`],
        ['Projectile count', format(stats.count, 0)],
        ['Projectile speed', `${format(stats.speed, 0)} units/s`],
        ['Projectile size', `${format(stats.size)} units`],
        ['Projectile lifetime', `${format(stats.life, 2)} s`],
        ['Pierce / bounces', `${stats.pierce} / ${stats.bounces}`],
        ['Critical chance', `${format(stats.crit * 100)}%`],
        ['Critical multiplier', `×${format(stats.critDamage, 2)}`],
        ['Traveling pulse', stats.pulse > 0 ? 'Enabled' : 'None'],
        ['Damaging trail', stats.trail > 0 ? 'Enabled' : 'None'],
        ['Homing / split', `${format(stats.homing)} / ${stats.split}`],
        ['Returns', stats.returning ? 'Yes' : 'No'],
      ];
      const defensive = isDefensiveKind(kind);
      const grid = (items: [string, string][]) =>
        `<dl class="core-stat-grid">${items.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
      return `<div class="core-parameter-view">${core.fusion ? `<h4>${escape(WEAPON_BY_ID[kind].name)} component</h4>` : ''}${grid(defensive ? rows.slice(0, 3) : rows.slice(0, 4))}${defensive ? '<p class="core-detail-note">Trigger-based defense: incoming damage, absorption, recovery, and individual effect rules determine actual output. Base hit damage is the starting parameter before those interactions.</p>' : `<details class="core-projectile-details"><summary>Projectile properties</summary>${grid(rows.slice(4))}</details>`}</div>`;
    })
    .join('');
  const fusion = coreFusionMarkup(run, core);
  const count =
    core.fusion || isFusedKind(core.kind)
      ? 'lineage'
      : String(
          FUSIONS.filter(
            (f) =>
              run.rulesVersion === 3 &&
              f.ingredients.includes(core.kind) &&
              ((run as RunV2 & { arsenalVersion?: number }).arsenalVersion === 2 ||
                !EXPANSION_FUSION_IDS.includes(f.id)),
          ).length,
        );
  return `<div class="core-detail-sections"><nav class="core-detail-tabs" aria-label="Core detail sections"><button type="button" class="build-reference" data-core-tab="stats" aria-pressed="true">Stats</button><button type="button" class="build-reference" data-core-tab="fusions" aria-pressed="false">Fusions · ${count}</button></nav><section class="core-parameters" data-core-section="stats" aria-label="Effective core stats"><h4>Effective parameters</h4>${parameters}<p class="core-detail-note">Snapshot when opened, including current upgrades and temporary buffs. Base parameters are not measured DPS; patterns and triggered effects change actual output.${core.fusion ? ' Each fused component keeps its own parameters and attack cycle.' : ''} Reopen to refresh.</p></section><div data-core-section="fusions" hidden>${fusion}</div></div>`;
}

/** Delegate within the existing window; no simulation or save mutation. */
export function selectCoreDetailSection(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const button = target.closest<HTMLButtonElement>('[data-core-tab]');
  const root = button?.closest('.core-detail-sections');
  if (!button || !root) return false;
  const section = button.dataset.coreTab;
  for (const item of root.querySelectorAll<HTMLElement>('[data-core-section]'))
    item.hidden = item.dataset.coreSection !== section;
  for (const item of root.querySelectorAll('[data-core-tab]'))
    item.setAttribute('aria-pressed', String(item === button));
  return true;
}

function coreFusionMarkup(run: RunV2, core: WeaponInstance): string {
  if (core.fusion || isFusedKind(core.kind)) {
    const recipe = core.fusion && FUSION_BY_ID[core.fusion.recipeId];
    return `<section class="core-fusion-options"><h4>Fusion lineage</h4><p>${recipe ? `${escape(recipe.name)} · ${recipe.ingredients.map((kind) => escape(WEAPON_BY_ID[kind].name)).join(' + ')}.` : 'Already fused.'} Fused cores cannot fuse again.</p></section>`;
  }
  if (run.rulesVersion !== 3)
    return '<section class="core-fusion-options"><h4>Possible fusions</h4><p>This recovered expedition retains its original equipment rules. Mastery-six fusions are available in new expeditions.</p></section>';
  const expanded = (run as RunV2 & { arsenalVersion?: number }).arsenalVersion === 2;
  const recipes = FUSIONS.filter(
    (f) => f.ingredients.includes(core.kind) && (expanded || !EXPANSION_FUSION_IDS.includes(f.id)),
  );
  const ready = availableFusions(run);
  return `<section class="core-fusion-options"><h4>Possible fusions · ${recipes.length}</h4><p class="core-detail-note">Free at mastery 6 on both cores. Choose an alternative; the two ingredients become one core. Compatible investments carry forward. Review consequences before confirming.</p>${recipes
    .map((recipe) => {
      const kind = recipe.ingredients.find((k) => k !== core.kind)!;
      const partner = run.weapons
        .filter((w) => w.kind === kind && !w.fusion)
        .sort((a, b) => (b.masteryRank ?? 1) - (a.masteryRank ?? 1))[0];
      const match = ready.find(
        (candidate) =>
          candidate.recipeId === recipe.id && candidate.ingredientIds.includes(core.id),
      );
      return `<article class="core-fusion-option"><header>${cardIcon(recipe.iconId, 40)}<button class="build-reference" type="button" data-entity-kind="fusion" data-entity-id="${escape(recipe.id)}">${escape(recipe.name)}</button></header><p>${escape(recipe.description)}</p><div class="core-fusion-partner">${cardIcon(icon(kind), 28)}<span>${escape(WEAPON_BY_ID[kind].name)}<small>${partner ? `Equipped · mastery ${partner.masteryRank ?? 1}/6` : 'Not equipped · acquire this core'}</small></span></div><small class="core-detail-note">This core: mastery ${core.masteryRank ?? 1}/6 · ${match ? 'Ready to fuse' : 'Both cores must reach mastery 6'}</small>${match ? `<button type="button" class="outline-button full" data-fuse-recipe="${escape(recipe.id)}" data-ingredient-a="${escape(match.ingredientIds[0])}" data-ingredient-b="${escape(match.ingredientIds[1])}">Preview fusion</button>` : ''}</article>`;
    })
    .join('')}</section>`;
}
