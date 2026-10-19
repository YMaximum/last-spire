import { describe, expect, it } from 'vitest';
import {
  CARDS,
  CARD_BY_ID,
  RARITIES,
  RARITY_COLORS,
  SYNERGIES,
  WEAPONS,
  WEAPON_BY_ID,
  rarityLabel,
} from '../src/content/base-catalog';
import { cardIcon, iconMarkup } from '../src/ui/base-icons';

describe('v2 original catalog', () => {
  it('provides exactly 100 unique cards in the seven required groups', () => {
    expect(CARDS).toHaveLength(100);
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(100);
    expect(new Set(CARDS.map((c) => c.iconId)).size).toBe(100);
    expect(
      Object.fromEntries(
        ['weapon', 'infusion', 'modifier', 'defense', 'trigger', 'skill', 'utility'].map(
          (group) => [group, CARDS.filter((c) => c.group === group).length],
        ),
      ),
    ).toEqual({
      weapon: 16,
      infusion: 6,
      modifier: 24,
      defense: 18,
      trigger: 20,
      skill: 10,
      utility: 6,
    });
    for (const card of CARDS) {
      expect(CARD_BY_ID[card.id]).toBe(card);
      expect(card.description.length).toBeGreaterThan(18);
      expect(card.value).toBeGreaterThan(0);
      expect(card.maxStacks).toBe(12);
    }
  });

  it('covers all 16 weapon behaviors with bounded starting stats', () => {
    expect(WEAPONS.map((w) => w.id)).toEqual([
      'bolt',
      'volley',
      'spiral',
      'beam',
      'orbit',
      'pulse',
      'swarm',
      'mine',
      'ricochet',
      'chakram',
      'rail',
      'flame',
      'tesla',
      'drone',
      'meteor',
      'singularity',
    ]);
    for (const weapon of WEAPONS) {
      expect(WEAPON_BY_ID[weapon.id]).toBe(weapon);
      expect(CARDS.filter((c) => c.weapon === weapon.id)).toHaveLength(1);
      expect(weapon.damage).toBeGreaterThanOrEqual(16);
      expect(weapon.damage).toBeLessThanOrEqual(32);
      expect(weapon.cooldown).toBeGreaterThanOrEqual(0.6);
      expect(weapon.cooldown).toBeLessThanOrEqual(2);
      expect(weapon.range).toBeGreaterThanOrEqual(300);
      expect(weapon.range).toBeLessThanOrEqual(380);
      expect(weapon.speed).toBeGreaterThanOrEqual(250);
      expect(weapon.speed).toBeLessThanOrEqual(400);
    }
    expect(
      CARDS.filter((c) => c.group === 'infusion').every((c) => c.scope === 'weapon' && c.element),
    ).toBe(true);
    expect(
      CARDS.filter((c) => c.group === 'modifier').every((c) => c.scope === 'projectiles'),
    ).toBe(true);
  });

  it('defines 40 distinct recipe effects with valid card requirements', () => {
    expect(SYNERGIES).toHaveLength(40);
    expect(new Set(SYNERGIES.map((s) => s.id)).size).toBe(40);
    expect(new Set(SYNERGIES.map((s) => s.effect)).size).toBe(40);
    expect(new Set(SYNERGIES.map((s) => [...s.requires].sort().join('|'))).size).toBe(40);
    for (const synergy of SYNERGIES) {
      expect(synergy.requires.length).toBeGreaterThanOrEqual(2);
      expect(synergy.requires.every((id) => Boolean(CARD_BY_ID[id]))).toBe(true);
      expect(new Set(synergy.requires).size).toBe(synergy.requires.length);
    }
  });

  it('offers the five named mastery rarities and a color for each', () => {
    expect(RARITIES).toEqual(['normal', 'rare', 'epic', 'legendary', 'mythic']);
    for (const rarity of RARITIES) {
      expect(RARITY_COLORS[rarity]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(rarityLabel(rarity)).toBe(rarity[0].toUpperCase() + rarity.slice(1));
    }
  });

  it('gives every card safe original SVG geometry independent of its label', () => {
    const geometry = new Set<string>();
    for (const card of CARDS) {
      const svg = cardIcon(card.iconId);
      expect(svg).toContain('viewBox="0 0 48 48"');
      expect(svg).toContain('role="img"');
      expect(svg).not.toMatch(/<script|<foreignObject|\bon\w+=|(?:href|src)=|url\(|data:/i);
      expect(svg).not.toContain('class=');
      expect(svg).not.toContain('undefined');
      const drawing = svg.match(/<g\b[^>]*>([\s\S]*)<\/g>/)?.[1];
      expect(drawing).toBeTruthy();
      geometry.add(drawing!);
      expect(iconMarkup(card.id, 24)).toContain('width="24" height="24"');
    }
    expect(geometry.size).toBe(100);
    expect(cardIcon('" onload="alert(1)')).not.toContain('onload');
    expect(cardIcon('__proto__')).toContain('Unknown relic');
    expect(cardIcon('weapon-bolt', Infinity)).toContain('width="40"');
    expect(cardIcon('weapon-bolt', -2)).toContain('width="12"');
  });
});
