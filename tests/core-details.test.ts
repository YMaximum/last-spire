// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { CARDS, EXPANSION_FUSION_IDS, FUSIONS, WEAPON_BY_ID } from '../src/content/catalog';
import {
  acquireCard,
  advanceMastery,
  createRun,
  fuseCores,
  getWeaponStats,
  getWeaponStatBreakdown,
  step,
  TICK,
} from '../src/game/engine';
import { createRun as legacyRun } from '../src/legacy/runeforged/engine';
import { defaultProfile } from '../src/legacy/classic/storage';
import { coreDetailsMarkup, selectCoreDetailSection } from '../src/ui/core-details';
import { entityMarkup } from '../src/ui/inspector';

afterEach(() => document.body.replaceChildren());
const setup = () => createRun(defaultProfile(), 'bastion', 0, 0, 1241);

describe('clicked core details', () => {
  it('switches between compact stats and fusion views without changing the run', () => {
    const run = setup(),
      before = JSON.stringify(run);
    document.body.innerHTML = coreDetailsMarkup(run, run.weapons[0]);
    const fusions = document.querySelector<HTMLButtonElement>('[data-core-tab="fusions"]')!;
    const stats = document.querySelector<HTMLElement>('[data-core-section="stats"]')!;
    const recipes = document.querySelector<HTMLElement>('[data-core-section="fusions"]')!;
    expect(recipes.hidden).toBe(true);
    expect(selectCoreDetailSection(fusions)).toBe(true);
    expect(recipes.hidden).toBe(false);
    expect(stats.hidden).toBe(true);
    expect(fusions.getAttribute('aria-pressed')).toBe('true');
    expect(selectCoreDetailSection(document.querySelector('[data-core-tab="stats"]'))).toBe(true);
    expect(stats.hidden).toBe(false);
    expect(recipes.hidden).toBe(true);
    expect(JSON.stringify(run)).toBe(before);
  });
  it('shows effective parameters and expandable projectile properties in the existing entity window', () => {
    const run = setup(),
      core = run.weapons[0];
    acquireCard(run, { id: 'grow', cardId: 'mod-size', rarity: 'rare', price: 0 });
    const stats = getWeaponStats(run, core);
    document.body.innerHTML = entityMarkup(run, { kind: 'weapon', id: core.id });
    expect(document.body.textContent).toContain('Effective parameters');
    expect(document.body.textContent).toContain(stats.damage.toFixed(1).replace(/\.0$/, ''));
    expect(document.body.textContent).toContain('Projectile lifetime');
    expect(document.querySelector('details > summary')?.textContent).toBe('Projectile properties');
    expect(document.body.textContent).toContain('Reopen to refresh');
  });

  it.each(FUSIONS)(
    'shows $id next to each ingredient and previews only real mastered pairs',
    (recipe) => {
      const run = setup();
      run.weapons = [];
      for (const kind of recipe.ingredients) {
        const card = CARDS.find((c) => c.weapon === kind)!;
        expect(acquireCard(run, { id: kind, cardId: card.id, rarity: 'normal', price: 0 })).toBe(
          true,
        );
      }
      const [a, b] = run.weapons;
      document.body.innerHTML = coreDetailsMarkup(run, a);
      expect(document.body.textContent).toContain(recipe.name);
      expect(document.body.textContent).toContain(WEAPON_BY_ID[b.kind].name);
      expect(document.body.textContent).toContain('Equipped · mastery 1/6');
      expect(document.querySelector(`[data-fuse-recipe="${recipe.id}"]`)).toBeNull();
      advanceMastery(a, 900);
      advanceMastery(b, 900);
      document.body.innerHTML = coreDetailsMarkup(run, a);
      const action = document.querySelector<HTMLButtonElement>(
        `[data-fuse-recipe="${recipe.id}"]`,
      )!;
      expect(action.textContent).toBe('Preview fusion');
      expect([action.dataset.ingredientA, action.dataset.ingredientB]).toContain(a.id);
      expect([action.dataset.ingredientA, action.dataset.ingredientB]).toContain(b.id);
      const snapshot = JSON.stringify(run);
      coreDetailsMarkup(run, a);
      expect(JSON.stringify(run)).toBe(snapshot);
      expect(fuseCores(run, recipe.id, a.id, b.id)).toBe(true);
      document.body.innerHTML = coreDetailsMarkup(run, run.weapons[0]);
      expect(document.body.textContent).toContain('Fused cores cannot fuse again');
      for (const kind of recipe.ingredients)
        expect(document.body.textContent).toContain(`${WEAPON_BY_ID[kind].name} component`);
      expect(document.querySelector('[data-fuse-recipe]')).toBeNull();
    },
  );

  it('shows missing partners without requiring a visit to the forge', () => {
    const run = setup();
    document.body.innerHTML = coreDetailsMarkup(run, run.weapons[0]);
    expect(document.body.textContent).toContain('Not equipped · acquire this core');
    expect(document.querySelector('[data-entity-kind="fusion"]')).not.toBeNull();
  });

  it('does not offer expansion recipes to recovered runs or fusion chains', () => {
    const run = createRun(defaultProfile(), 'bastion', 0, 0, 1241, { arsenalVersion: 1 });
    run.weapons[0].kind = 'flame';
    document.body.innerHTML = coreDetailsMarkup(run, run.weapons[0]);
    for (const id of EXPANSION_FUSION_IDS)
      expect(document.querySelector(`[data-entity-id="${id}"]`)).toBeNull();
    const old = legacyRun(defaultProfile(), 'bastion', 0, 0, 5);
    document.body.innerHTML = coreDetailsMarkup(old, old.weapons[0]);
    expect(document.body.textContent).toContain('retains its original equipment rules');
    expect(document.querySelector('[data-fuse-recipe]')).toBeNull();
  });

  it('distinguishes triggered defenses from automatic projectile output', () => {
    const run = createRun(defaultProfile(), 'monolith', 0, 0, 5);
    document.body.innerHTML = coreDetailsMarkup(run, run.weapons[0]);
    expect(document.body.textContent).toContain('Trigger-based defense');
    expect(document.body.textContent).not.toContain('Critical chance');
  });

  it('leaves seeded combat unchanged when inspecting every tick', () => {
    const run = setup(),
      control = structuredClone(run);
    for (let i = 0; i < 120; i++) {
      getWeaponStatBreakdown(run, run.weapons[0]);
      step(run, TICK);
      step(control, TICK);
    }
    expect(run).toEqual(control);
  });
});
