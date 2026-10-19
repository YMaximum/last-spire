// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { CARDS, FUSIONS } from '../src/content/catalog';
import { createRun } from '../src/game/engine';
import { defaultProfile } from '../src/legacy/classic/storage';
import { fusionHintMarkup } from '../src/ui/fusion-hints';

afterEach(() => document.body.replaceChildren());
describe('compact fusion hints on weapon upgrade cards', () => {
  it.each(FUSIONS)('names the partner card in both directions for $name', (recipe) => {
    for (const ingredient of recipe.ingredients) {
      const partner = recipe.ingredients.find((k) => k !== ingredient)!;
      const card = CARDS.find((c) => c.group === 'weapon' && c.weapon === partner)!;
      document.body.innerHTML = `<button>${fusionHintMarkup(ingredient, [])}</button>`;
      expect(document.body.textContent).toContain(card.name);
      expect(document.body.textContent).toContain('Both cores need mastery 6');
      expect(document.body.textContent).toContain('Not equipped');
      expect(document.querySelectorAll('button')).toHaveLength(1);
      expect(document.querySelectorAll('a')).toHaveLength(0);
    }
  });
  it('shows owned partner mastery and never suggests a fusion chain', () => {
    const run = createRun(defaultProfile(), 'bastion', 0, 0, 81);
    run.weapons[0].masteryRank = 4;
    document.body.innerHTML = fusionHintMarkup('rail', run.weapons);
    expect(document.body.textContent).toContain('Owned · M4/6');
    expect(fusionHintMarkup('fused-lance', run.weapons)).toBe('');
  });
});
