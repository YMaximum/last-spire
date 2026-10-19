// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { launchMarkup, type LaunchState } from '../src/ui/launch';
import { emptySave } from '../src/persistence/storage';
import { createRun } from '../src/game/engine';
import type { RuneId } from '../src/game/controls';

const names: Record<RuneId, string> = {
  power: 'Power',
  vitality: 'Vitality',
  fortune: 'Fortune',
  experience: 'Experience',
  choices: 'Choices',
  autoSignature: 'Signature autocast',
  autoSecondary: 'Secondary autocast',
};
afterEach(() => document.body.replaceChildren());
function render(patch: Partial<LaunchState> = {}) {
  const state: LaunchState = {
    save: emptySave(),
    tower: 'bastion',
    stage: 0,
    difficulty: 0,
    mode: 'normal',
    playing: false,
    ...patch,
  };
  document.body.innerHTML = launchMarkup(state, '<p>Rune purchases</p>', names);
  return state;
}

describe('integrated expedition setup', () => {
  it('uses selected-stage access instead of the legacy global difficulty and shows exact clears', () => {
    const save = emptySave();
    save.profile.stageUnlocked = 3;
    save.profile.difficultyUnlocked = 5;
    save.progression.stages[0] = {
      unlockedDifficulty: 3,
      clearedDifficulties: [0, 2],
      legacyClear: false,
    };
    render({ save, stage: 1 });
    let options = [...document.querySelectorAll<HTMLOptionElement>('#difficulty-select option')];
    expect(options.map((o) => o.disabled)).toEqual([false, true, true, true, true, true]);
    expect(
      document.querySelector('[aria-label="Stage completion records"]')?.textContent,
    ).toContain('Ember Foundry records');
    render({ save, stage: 0 });
    options = [...document.querySelectorAll<HTMLOptionElement>('#difficulty-select option')];
    expect(options.map((o) => o.disabled)).toEqual([false, false, false, false, true, true]);
    expect(document.querySelectorAll('.difficulty-record.cleared')).toHaveLength(2);
    expect(document.querySelector('.stage-record-details')?.textContent).toContain(
      'Cleared: Normal, Ascension 2',
    );
  });
  it('shows tower selection, runes and settings together with a pinned start action', () => {
    render();
    expect(document.querySelectorAll('[data-launch-tower]')).toHaveLength(7);
    expect(document.querySelector('#mode-select')).not.toBeNull();
    expect(document.querySelector('#stage-select')).not.toBeNull();
    expect(document.querySelector('#difficulty-select')).not.toBeNull();
    expect(document.querySelector('.launch-rune-summary')?.textContent).toContain(
      'No runes equipped',
    );
    expect(document.querySelector('.launch-start #begin-btn')?.textContent).toContain(
      'Start expedition',
    );
    expect(document.querySelector('.launch-scroll #begin-btn')).toBeNull();
  });
  it('distinguishes unaffordable towers and acquired rune levels', () => {
    const save = emptySave();
    save.progression.runes.owned.power = 5;
    save.progression.runes.selected.power = 2;
    render({ save });
    expect(
      document.querySelector<HTMLButtonElement>('[data-launch-tower="monolith"]')!.disabled,
    ).toBe(true);
    expect(document.querySelector('.launch-rune-summary')?.textContent).toContain('Power 2');
    save.profile.credits = 1000;
    render({ save });
    expect(
      document.querySelector<HTMLButtonElement>('[data-launch-tower="monolith"]')!.disabled,
    ).toBe(false);
  });
  it('shows the active run snapshot and requires retirement instead of replacing it', () => {
    const save = emptySave();
    save.run = createRun(save.profile, 'bastion', 0, 0, 74);
    save.progression.active = {
      runId: save.run.id,
      rulesVersion: 3,
      runes: { ...save.progression.runes.selected, power: 1 },
      autocast: save.progression.autocast,
    };
    save.progression.runes.selected.power = 4;
    render({ save, playing: true });
    expect(document.querySelector('#begin-btn')).toBeNull();
    expect(document.querySelector('#resume-btn')?.textContent).toContain('Resume expedition');
    expect(document.querySelector('#launch-retire')).not.toBeNull();
    expect(document.querySelector('.launch-rune-summary')?.textContent).toContain('Power 1');
    expect(document.querySelectorAll('select:disabled')).toHaveLength(3);
    expect(
      [...document.querySelectorAll<HTMLButtonElement>('[data-launch-tower]')].every(
        (b) => b.disabled,
      ),
    ).toBe(true);
  });
  it.each(['ended', 'victory'] as const)(
    'routes a %s run back to settlement or victory',
    (phase) => {
      const save = emptySave();
      save.run = createRun(save.profile, 'bastion', 0, 0, 75);
      save.run.phase = phase;
      render({ save, playing: true });
      expect(document.querySelector('#resume-btn')?.textContent).toContain(
        phase === 'ended' ? 'Collect rewards' : 'Review victory',
      );
      expect(document.querySelector('#begin-btn')).toBeNull();
    },
  );
});
