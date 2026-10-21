// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BossThreatHud } from '../src/ui/boss-threat';
import type { BossThreat } from '../src/game/boss-threat';

function setup() {
  document.body.innerHTML =
    '<div id="boss-warning" class="hidden"></div><button id="q"></button><button id="e" disabled></button>';
  const host = document.getElementById('boss-warning')!;
  const slow = vi.fn();
  return {
    host,
    slow,
    hud: new BossThreatHud(host, slow),
    view: {
      speed: 3 as const,
      paused: false,
      signature: document.getElementById('q') as HTMLButtonElement,
      secondary: document.getElementById('e') as HTMLButtonElement,
    },
  };
}
const warning = (): BossThreat => ({
  name: 'The Last Eclipse',
  element: 'void',
  phase: 2,
  healthFraction: 0.6,
  status: 'strike',
  impacts: [
    { seconds: 1.2, damage: 30, followup: false },
    { seconds: 2, damage: 25, followup: true },
  ],
  damage: 55,
  hpDamage: 15,
  lethal: true,
});
afterEach(() => document.body.replaceChildren());

describe('boss forecast controls', () => {
  it('clears the mobile ability tray even when it is above the footer normal flow', () => {
    const { host, hud, view } = setup();
    const footer = document.createElement('footer');
    footer.className = 'combat-controls';
    const tray = document.createElement('div');
    footer.append(tray, host);
    document.body.append(footer);
    vi.spyOn(footer, 'getBoundingClientRect').mockReturnValue({ bottom: 832 } as DOMRect);
    const bounds = vi
      .spyOn(tray, 'getBoundingClientRect')
      .mockReturnValue({ top: 674, height: 70 } as DOMRect);
    hud.update(warning(), view);
    expect(host.style.bottom).toBe('170px');
    bounds.mockReturnValue({ top: 630, height: 114 } as DOMRect);
    hud.update(warning(), view);
    expect(host.style.bottom).toBe('214px');
  });
  it('shows real-time speed-aware countdown, follow-up, risk text and ready skill cues', () => {
    const { host, hud, view } = setup();
    hud.update(warning(), view);
    expect(host.hidden).toBe(false);
    expect(host.textContent).toContain('0.4s at 3×');
    expect(host.textContent).toContain('delayed follow-up');
    expect(host.textContent).toContain('≈15 HP loss after barrier');
    expect(host.textContent).toContain('Lethal risk');
    expect(view.signature.classList.contains('boss-ready')).toBe(true);
    expect(view.secondary.classList.contains('boss-ready')).toBe(false);
    expect(view.signature.getAttribute('aria-describedby')).toBe('boss-warning-help');
  });
  it('keeps controls stable during updates, announces transitions instead of each countdown, and slows only on request', () => {
    const { host, hud, view, slow } = setup();
    hud.update(warning(), view);
    const button = host.querySelector<HTMLButtonElement>('button')!;
    const live = host.querySelector('[role="status"]')!.textContent;
    const next = warning();
    next.impacts[0].seconds = 0.9;
    hud.update(next, view);
    expect(host.querySelector('button')).toBe(button);
    expect(host.querySelector('[role="status"]')!.textContent).toBe(live);
    expect(slow).not.toHaveBeenCalled();
    button.click();
    expect(slow).toHaveBeenCalledOnce();
    hud.update(next, { ...view, speed: 1 });
    expect(button.hidden).toBe(true);
  });
  it('freezes the countdown on pause and clears warnings/cues after a boss or run ends', () => {
    const { host, hud, view } = setup();
    hud.update(warning(), { ...view, paused: true });
    expect(host.textContent).toContain('Paused · 1.2s game time');
    expect(host.querySelector<HTMLButtonElement>('button')!.hidden).toBe(true);
    expect(view.signature.classList.contains('boss-ready')).toBe(false);
    hud.update(warning(), view);
    hud.update(null, view);
    expect(host.hidden).toBe(true);
    expect(view.signature.hasAttribute('aria-describedby')).toBe(false);
    expect(host.querySelector('[role="status"]')!.textContent).toBe('');
  });
  it('renders content names as text and keeps preparation distinct from committed impact', () => {
    const { host, hud, view } = setup();
    const threat = warning();
    threat.name = '<img src=x onerror=alert(1)>';
    threat.status = 'preparing';
    hud.update(threat, view);
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('Next strike ≈');
    expect(view.signature.classList.contains('boss-ready')).toBe(false);
  });
});
