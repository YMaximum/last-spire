import { describe, expect, it } from 'vitest';
import { CARDS, CARD_BY_ID, NEW_CARDS, WEAPONS, WEAPON_BY_ID, DEFENSIVE_CORES, DEFENSIVE_KINDS, SYNERGIES, TOWERS, isDefensiveKind } from '../src/v3/catalog';
import { CARDS as BASE_CARDS, SYNERGIES as BASE_SYNERGIES } from '../src/v2/catalog';
import { cardIcon } from '../src/v3/icons';

describe('defensive arsenal content', () => {
  it('extends the existing catalog with exactly eight socketed cores and sixteen unique supports', () => {
    expect(CARDS).toHaveLength(124);
    expect(NEW_CARDS).toHaveLength(24);
    expect(new Set(CARDS.map(card => card.id)).size).toBe(124);
    expect(new Set(CARDS.map(card => card.iconId)).size).toBe(124);
    expect(NEW_CARDS.filter(card => card.group === 'weapon')).toHaveLength(8);
    expect(NEW_CARDS.filter(card => card.group !== 'weapon')).toHaveLength(16);
    for (const card of BASE_CARDS) expect(CARD_BY_ID[card.id]).toBe(card);
    for (const card of NEW_CARDS) {
      expect(card.value).toBeGreaterThan(0);
      expect(card.description.length).toBeGreaterThan(50);
      expect(card.maxStacks).toBe(12);
      expect(CARD_BY_ID[card.id]).toBe(card);
    }
    expect(SYNERGIES).toBe(BASE_SYNERGIES);
    expect(SYNERGIES).toHaveLength(40);
  });
  it('keeps all existing defenses outside the six shared core sockets', () => {
    expect(WEAPONS).toHaveLength(24);
    expect(DEFENSIVE_CORES.map(core => core.id)).toEqual(DEFENSIVE_KINDS);
    for (const core of DEFENSIVE_CORES) {
      expect(isDefensiveKind(core.id)).toBe(true);
      expect(WEAPON_BY_ID[core.id]).toBe(core);
      expect(core.damage).toBeGreaterThan(0);
      expect(core.cooldown).toBeGreaterThanOrEqual(1);
      expect(core.range).toBeGreaterThanOrEqual(200);
      const card = CARDS.find(card => card.weapon === core.id)!;
      expect(card.group).toBe('weapon');
      expect(card.scope).toBe('defense');
      expect(card.id).toBe(`weapon-${core.id}`);
    }
    expect(isDefensiveKind('bolt')).toBe(false);
    expect(isDefensiveKind('unknown')).toBe(false);
    expect(CARDS.filter(card => card.scope === 'defense' && card.group !== 'weapon').length).toBeGreaterThan(18);
    expect(CARD_BY_ID['utility-apprenticeship'].scope).toBe('weapon');
    expect(CARD_BY_ID['mod-range']).toBeDefined();
    expect(CARD_BY_ID['mod-lifetime']).toBeDefined();
  });
  it('adds Monolith without mutating the six legacy tower definitions', () => {
    expect(TOWERS).toHaveLength(7);
    expect(new Set(TOWERS.map(tower => tower.id)).size).toBe(7);
    const monolith = TOWERS.find(tower => tower.id === 'monolith')!;
    expect(monolith.cost).toBe(300);
    expect(monolith.hp).toBe(640);
    expect(monolith.damage).toBe(1);
    expect(monolith.description).toContain('no weapon');
    expect(monolith.skill).toBe('Reprisal');
  });
  it('bundles distinct, safe geometry at all actual icon sizes for every family', () => {
    const geometry = new Set<string>();
    for (const card of CARDS) {
      const svg = cardIcon(card.iconId);
      expect(svg).not.toContain('Unknown relic');
      expect(svg).not.toContain('undefined');
      expect(svg).not.toMatch(/<script|<foreignObject|\bon\w+=|(?:href|src)=|url\(|data:/i);
      expect(svg).not.toContain('class=');
      geometry.add(svg.match(/<g\b[^>]*>([\s\S]*)<\/g>/)![1]);
      for (const size of [24, 40, 64]) expect(cardIcon(card.iconId, size)).toContain(`width="${size}" height="${size}"`);
    }
    expect(geometry.size).toBe(124);
    expect(cardIcon('" onload="alert(1)')).not.toContain('onload');
    expect(cardIcon('__proto__')).toContain('Unknown relic');
    expect(cardIcon('weapon-core-mirror', Infinity)).toContain('width="40"');
    expect(cardIcon('weapon-core-mirror', -1)).toContain('width="12"');
  });
});
