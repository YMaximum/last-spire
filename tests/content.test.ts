import { describe, expect, it } from 'vitest';
import {
  ELEMENTS,
  ELEMENT_COLORS,
  MODIFIERS,
  PATTERNS,
  RECIPES,
  STAGES,
  SYNERGIES,
  TOWERS,
} from '../src/content';

describe('content catalog', () => {
  it('covers every pattern, element, and modifier combination exactly once', () => {
    expect(RECIPES).toHaveLength(192);
    expect(new Set(RECIPES.map(({ id }) => id)).size).toBe(192);
    expect(new Set(RECIPES.map(({ pattern }) => pattern))).toEqual(
      new Set(PATTERNS.map(({ id }) => id)),
    );
    expect(new Set(RECIPES.map(({ element }) => element))).toEqual(
      new Set(ELEMENTS.map(({ id }) => id)),
    );
    expect(new Set(RECIPES.map(({ modifier }) => modifier))).toEqual(
      new Set(MODIFIERS.map(({ id }) => id)),
    );
    for (const pattern of PATTERNS) {
      for (const element of ELEMENTS) {
        for (const modifier of MODIFIERS) {
          expect(RECIPES).toContainEqual({
            pattern: pattern.id,
            element: element.id,
            modifier: modifier.id,
            id: `${pattern.id}-${element.id}-${modifier.id}`,
          });
        }
      }
    }
  });

  it('keeps element swatches keyed to their canonical colors', () => {
    expect(Object.keys(ELEMENT_COLORS)).toHaveLength(6);
    expect(ELEMENTS.every(({ id, color }) => color === ELEMENT_COLORS[id])).toBe(true);
  });

  it('defines the six towers at their intended costs and starter attacks', () => {
    expect(TOWERS.map(({ id, cost }) => [id, cost])).toEqual([
      ['bastion', 0],
      ['pyre', 100],
      ['tempest', 180],
      ['glacier', 260],
      ['verdant', 350],
      ['null', 450],
    ]);
    expect(TOWERS.map(({ pattern, element }) => [pattern, element])).toEqual([
      ['bolt', 'solar'],
      ['volley', 'fire'],
      ['spiral', 'lightning'],
      ['beam', 'frost'],
      ['swarm', 'poison'],
      ['pulse', 'void'],
    ]);
    expect(
      TOWERS.every(
        ({ hp, damage, rate }) =>
          hp >= 250 && hp <= 360 && damage >= 0.9 && damage <= 1.2 && rate >= 0.8 && rate <= 1.25,
      ),
    ).toBe(true);
  });

  it('contains three stages and all eighteen requested synergies', () => {
    expect(STAGES.map(({ id }) => id)).toEqual([0, 1, 2]);
    expect(SYNERGIES).toHaveLength(18);
    const elemental = SYNERGIES.filter(({ elements }) => elements);
    expect(elemental).toHaveLength(15);
    expect(new Set(elemental.map(({ elements }) => [...elements!].sort().join('|'))).size).toBe(15);
    expect(
      SYNERGIES.filter(({ tower }) => tower).map(({ id, tower, modifiers }) => [
        id,
        tower,
        modifiers,
      ]),
    ).toEqual([
      ['bastion-mark', 'bastion', ['mark']],
      ['tempest-echo', 'tempest', ['echo']],
      ['null-surge', 'null', ['surge']],
    ]);
  });
});
