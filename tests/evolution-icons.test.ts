// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EVOLUTION_PATHS } from '../src/content/evolutions';
import { evolutionIcon } from '../src/ui/evolution-icons';

describe('evolution icons', () => {
  it('gives all fourteen paths distinct, self-contained mechanism geometry', () => {
    const geometry = new Set<string>();
    expect(EVOLUTION_PATHS).toHaveLength(14);
    for (const path of EVOLUTION_PATHS) {
      document.body.innerHTML = evolutionIcon(path.id);
      const svg = document.querySelector('svg')!;
      expect(svg.getAttribute('aria-label')).toBe(path.name);
      expect(svg.querySelector('title')?.textContent).toBe(path.name);
      expect(svg.querySelector('g')?.getAttribute('stroke')).toBe(path.color);
      geometry.add(svg.querySelector('g')!.innerHTML);
      expect(svg.querySelectorAll('script, image, foreignObject, a, use')).toHaveLength(0);
      expect(svg.outerHTML).not.toMatch(/\bon\w+=|(?:href|src)=|javascript:/i);
    }
    expect(geometry.size).toBe(14);
  });

  it.each([
    [1, 12],
    [12.4, 12],
    [42.7, 43],
    [900, 128],
    [NaN, 40],
    [Infinity, 40],
  ])('normalizes size %s to %s', (size, normalized) => {
    document.body.innerHTML = evolutionIcon('citadel', size);
    const svg = document.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe(String(normalized));
    expect(svg.getAttribute('height')).toBe(String(normalized));
    expect(svg.getAttribute('viewBox')).toBe('0 0 64 64');
  });

  it('uses a fixed fallback without inserting unknown input', () => {
    for (const id of ['missing', '__proto__', 'constructor', '"><script>alert(1)</script>']) {
      expect(evolutionIcon(id)).toBe(evolutionIcon('unknown'));
      document.body.innerHTML = evolutionIcon(id);
      expect(document.querySelector('svg')?.getAttribute('aria-label')).toBe('Tower evolution');
      expect(document.querySelector('script')).toBeNull();
    }
  });
});
