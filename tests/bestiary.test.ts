// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ENEMIES, ENEMY_BY_ID, enemyStats, type EnemyArchetypeId } from '../src/content/enemies';
import { bestiaryMarkup, enemyEmblem } from '../src/ui/bestiary';

const base = {
  stage: 0,
  wave: 10,
  difficulty: 0,
  mode: 'normal' as const,
  records: {},
};

describe('bestiary markup', () => {
  it('searches names and tactics and falls back to the first matching enemy', () => {
    const markup = bestiaryMarkup({ ...base, query: 'green lattice' });
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    expect(doc.querySelectorAll('[data-enemy-id]')).toHaveLength(1);
    expect(doc.querySelector('[data-enemy-id]')?.getAttribute('data-enemy-id')).toBe(
      'spore-shepherd',
    );
    expect(doc.querySelector('#bestiary-detail-title')?.textContent).toBe('Spore Shepherd');
    expect(doc.querySelector('#bestiary-search')?.getAttribute('value')).toBe('green lattice');
  });

  it('shows common enemies plus the selected stage entries, with all stages available', () => {
    const stageTwo = new DOMParser().parseFromString(
      bestiaryMarkup({ ...base, filter: 2 }),
      'text/html',
    );
    const stageTwoIds = [...stageTwo.querySelectorAll<HTMLElement>('[data-enemy-id]')].map(
      (entry) => entry.dataset.enemyId,
    );
    expect(stageTwoIds).toContain('swarmer');
    expect(stageTwoIds).toContain('rift-skirmisher');
    expect(stageTwoIds).not.toContain('burrower');
    expect(
      stageTwo.querySelector('#bestiary-stage option[value="2"]')?.hasAttribute('selected'),
    ).toBe(true);

    const all = new DOMParser().parseFromString(
      bestiaryMarkup({ ...base, filter: 'all' }),
      'text/html',
    );
    expect(all.querySelectorAll('[data-enemy-id]')).toHaveLength(ENEMIES.length);
    expect(all.querySelector('#bestiary-stage option[value="all"]')?.hasAttribute('selected')).toBe(
      true,
    );
  });

  it('renders tactics, telegraphs, bounded rules, resistances and discovery counts before discovery', () => {
    const records = { 'thorn-retaliator': { encountered: 4, defeated: 2 } };
    const doc = new DOMParser().parseFromString(
      bestiaryMarkup({
        ...base,
        selected: 'thorn-retaliator',
        records,
      }),
      'text/html',
    );
    const detail = doc.querySelector('.bestiary-detail')!.textContent!;
    expect(doc.querySelectorAll('[data-enemy-id]')).toHaveLength(12);
    expect(detail).toContain('Attack');
    expect(detail).toContain('Telegraph');
    expect(detail).toContain('Strength');
    expect(detail).toContain('Weakness');
    expect(detail).toContain('Resistances and vulnerabilities');
    expect(detail).toContain('Thorns have a 1.4-second internal cooldown');
    expect(detail).toContain('Fire 15% extra damage');
    expect(detail).toContain('Encountered 4 · Defeated 2');
    expect(doc.querySelector('[data-enemy-id="thorn-retaliator"]')?.textContent).toContain('4/2');
  });

  it('uses scaled stats for the selected preview controls and labels quick final-boss timing', () => {
    const options = {
      ...base,
      stage: 2,
      wave: 24,
      difficulty: 3,
      mode: 'quick' as const,
      selected: 'rift-skirmisher' as const,
    };
    const doc = new DOMParser().parseFromString(bestiaryMarkup(options), 'text/html');
    const expected = enemyStats('rift-skirmisher', options);
    expect(doc.querySelector('#bestiary-wave')?.getAttribute('value')).toBe('24');
    expect(
      doc.querySelector('#bestiary-difficulty option[value="3"]')?.hasAttribute('selected'),
    ).toBe(true);
    expect(
      doc.querySelector('#bestiary-mode option[value="quick"]')?.hasAttribute('selected'),
    ).toBe(true);
    expect(doc.querySelector('.bestiary-preview')?.textContent).toContain(expected.hp.toFixed(1));
    expect(doc.querySelector('.bestiary-preview')?.textContent).toContain(
      expected.damage.toFixed(1),
    );
    expect(doc.querySelector('[data-enemy-id="last-eclipse"]')?.textContent).toContain(
      'Final boss · 50',
    );
  });

  it('explains new rules beside legacy runs and safely escapes search text', () => {
    const doc = new DOMParser().parseFromString(
      bestiaryMarkup({
        ...base,
        query: '<script>alert(1)</script>',
        legacy: true,
      }),
      'text/html',
    );
    expect(doc.querySelector('.bestiary-legacy')?.textContent).toContain(
      'recovered legacy runs continue with their original rules',
    );
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelector('.bestiary-empty')?.textContent).toContain('No enemies match');
    expect(bestiaryMarkup({ ...base, query: '<script>alert(1)</script>', legacy: true })).toContain(
      '&lt;script&gt;',
    );
  });

  it('returns inline pixel-vector silhouettes for every unique archetype', () => {
    const exclusiveAndBoss = ENEMIES.filter(
      (enemy) => enemy.stage !== undefined || enemy.role === 'boss',
    );
    const silhouettes = exclusiveAndBoss.map((enemy) =>
      enemyEmblem(enemy.id).replace(/<svg[^>]*>|<\/svg>/g, ''),
    );
    expect(new Set(silhouettes).size).toBe(exclusiveAndBoss.length);
    expect(enemyEmblem('swarmer')).toContain('<svg');
    expect(enemyEmblem('last-eclipse', 36)).toContain('width="36" height="36"');
    expect(Object.keys(ENEMY_BY_ID)).toHaveLength(20);
  });
});

it('uses attainable spawn-wave stats and previews Quick endless boss schedules', () => {
  const first = new DOMParser().parseFromString(
    bestiaryMarkup({
      stage: 0,
      wave: 1,
      difficulty: 0,
      mode: 'normal',
      records: {},
      selected: 'elder-root',
    }),
    'text/html',
  );
  expect(first.querySelector<HTMLInputElement>('#bestiary-wave')?.value).toBe('100');
  const extended = new DOMParser().parseFromString(
    bestiaryMarkup({
      stage: 2,
      wave: 60,
      difficulty: 0,
      mode: 'quick',
      records: {},
      selected: 'rift-skirmisher',
    }),
    'text/html',
  );
  expect(extended.querySelector('.bestiary-roster')?.textContent).toContain('Boundary Warden');
});
