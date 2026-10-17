// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProfile } from '../src/storage';
import { acquireCard, advanceMastery, createRun } from '../src/v3/engine';
import { BuildInspector } from '../src/v3/inspector';

let inspector: BuildInspector | undefined;
afterEach(() => {
  inspector?.destroy();
  inspector = undefined;
  document.body.replaceChildren();
});

function setup() {
  const run = createRun(defaultProfile(), 'bastion', 0, 0, 542);
  const host = document.createElement('div');
  document.body.append(host);
  const onOpen = vi.fn();
  inspector = new BuildInspector({ host, getRun: () => run, onOpen });
  const button = () => host.querySelector<HTMLButtonElement>('.build-socket[data-entity-id]')!;
  const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
  const hover = (element: Element) =>
    element.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  return { run, host, onOpen, button, tooltip, hover };
}

describe('pinned build tooltip stability', () => {
  it('keeps the hovered weapon mounted and tooltip visible as mastery advances', () => {
    const { run, button, tooltip, hover } = setup();
    const original = button();
    hover(original.querySelector('svg')!);
    const description = original.getAttribute('aria-describedby');
    expect(tooltip.hidden).toBe(false);
    for (let i = 0; i < 30; i++) {
      advanceMastery(run.weapons[0], 0.16);
      inspector!.update();
      expect(button()).toBe(original);
      expect(tooltip.hidden).toBe(false);
      expect(original.getAttribute('aria-describedby')).toBe(description);
    }
    expect(
      parseFloat(original.querySelector<HTMLElement>('.build-mastery i')!.style.width),
    ).toBeGreaterThan(0);
  });

  it('preserves hover and refreshes the summary across a mastery rank change', () => {
    const { run, button, tooltip, hover } = setup();
    hover(button());
    advanceMastery(run.weapons[0], 60);
    inspector!.update();
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toContain('Mastery 2/6');
    expect(button().getAttribute('aria-describedby')).toBe(tooltip.id);
  });

  it('retains keyboard focus through progress and structural card updates', () => {
    const { run, button, tooltip } = setup();
    button().focus();
    const original = button();
    advanceMastery(run.weapons[0], 1);
    inspector!.update();
    expect(document.activeElement).toBe(original);
    expect(
      acquireCard(run, { id: 'upgrade', cardId: 'weapon-bolt', rarity: 'normal', price: 0 }),
    ).toBe(true);
    inspector!.update();
    expect(document.activeElement).toBe(button());
    expect(tooltip.hidden).toBe(false);
    button().blur();
    expect(tooltip.hidden).toBe(true);
  });

  it('hides the tooltip when the hovered equipment is removed', () => {
    const { run, button, tooltip, hover } = setup();
    hover(button());
    run.weapons = [];
    inspector!.update();
    expect(tooltip.hidden).toBe(true);
  });

  it('keeps hover across icon children and dismisses on a real pointer exit', () => {
    const { button, tooltip, hover } = setup();
    const icon = button().querySelector('svg')!;
    hover(icon);
    icon.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: button() }));
    expect(tooltip.hidden).toBe(false);
    button().dispatchEvent(
      new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }),
    );
    expect(tooltip.hidden).toBe(true);
  });
});
