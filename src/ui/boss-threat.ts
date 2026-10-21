import type { BossThreat } from '../game/boss-threat';

export interface BossThreatView {
  speed: 1 | 2 | 3;
  paused: boolean;
  signature: HTMLButtonElement;
  secondary: HTMLButtonElement;
}

/** Update stable nodes; countdowns must not rebuild controls or shift hover targets. */
export class BossThreatHud {
  private announcementKey = '';
  constructor(
    private readonly host: HTMLElement,
    onSlow: () => void,
  ) {
    host.classList.remove('hidden');
    host.classList.add('boss-threat');
    host.hidden = true;
    host.setAttribute('aria-label', 'Boss strike forecast');
    host.innerHTML = `<div class="boss-threat-heading"><strong data-boss="name"></strong><span data-boss="phase"></span></div><div class="boss-health-track" aria-hidden="true"><i data-boss="health"></i></div><p data-boss="damage"></p><span id="boss-warning-help" data-boss="help"></span><div class="boss-threat-clock"><b data-boss="clock"></b><button type="button" data-boss="slow" aria-label="Slow combat to normal speed">1× speed</button></div><span class="boss-live" role="status" aria-live="polite" aria-atomic="true" data-boss="live"></span>`;
    this.node<HTMLButtonElement>('slow').onclick = () => {
      if (!host.hidden) onSlow();
    };
  }
  private node<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.host.querySelector<T>(`[data-boss="${name}"]`)!;
  }
  update(threat: BossThreat | null, view: BossThreatView): void {
    this.host.hidden = !threat;
    const imminent = !!threat && ['strike', 'follow-up'].includes(threat.status) && !view.paused;
    for (const button of [view.signature, view.secondary]) {
      const ready = imminent && !button.disabled;
      button.classList.toggle('boss-ready', ready);
      if (ready) button.setAttribute('aria-describedby', 'boss-warning-help');
      else button.removeAttribute('aria-describedby');
    }
    if (!threat) {
      this.announcementKey = '';
      this.node('live').textContent = '';
      return;
    }
    this.host.dataset.risk = threat.lethal ? 'lethal' : imminent ? 'strike' : 'preparing';
    this.node('name').textContent = threat.name;
    this.node('phase').textContent = `PHASE ${threat.phase}`;
    this.node('health').style.width = `${Math.min(100, threat.healthFraction * 100)}%`;
    const first = threat.impacts[0];
    const clock = !first
      ? threat.status === 'approaching'
        ? 'Approaching · prepare your defenses'
        : 'Interrupted · preparing again'
      : view.paused
        ? `Paused · ${first.seconds.toFixed(1)}s game time to strike`
        : `${threat.status === 'preparing' ? 'Next strike ≈' : threat.status === 'follow-up' ? 'Follow-up in' : 'Strike in'} ${(first.seconds / view.speed).toFixed(1)}s${view.speed > 1 ? ` at ${view.speed}×` : ''}`;
    this.node('clock').textContent = clock;
    this.node('clock').title = first
      ? `${first.seconds.toFixed(1)} seconds of simulation time. Countdown pauses with combat.`
      : '';
    this.node('slow').hidden = view.speed === 1 || view.paused;
    const burst = threat.impacts.length > 1 ? ' + delayed follow-up' : '';
    const element = threat.element[0].toUpperCase() + threat.element.slice(1);
    this.node('damage').textContent = first
      ? `${element}${burst} · ≈${Math.ceil(threat.damage)} damage · ≈${Math.ceil(threat.hpDamage)} HP loss after barrier`
      : 'Build armor and barriers. Interrupt a charging attack with stun.';
    this.node('damage').title =
      'Estimate for this boss only, using current phase, mitigation and shield. Healing, other enemies, future phase changes, kills and interrupts can change the outcome.';
    this.node('help').textContent = threat.lethal
      ? 'Lethal risk at current defenses · use a ready skill or interrupt.'
      : imminent
        ? 'Ready skills are outlined. Shield, heal or interrupt before impact.'
        : 'Anticipate the burst; save a defensive skill for its charge.';
    const key = `${threat.name}:${threat.phase}:${threat.status}:${threat.lethal}:${view.paused}:${view.speed}`;
    if (key !== this.announcementKey) {
      this.announcementKey = key;
      this.node('live').textContent =
        `${threat.name}, phase ${threat.phase}. ${clock}. ${this.node('damage').textContent}. ${this.node('help').textContent}`;
    }
    // On narrow screens the ability tray sits outside the footer's normal flow.
    // Anchor above the actual controls, including larger device-local text scales.
    const controls = this.host.parentElement;
    if (controls?.classList.contains('combat-controls')) {
      const bounds = [...controls.children]
        .filter((child) => child !== this.host)
        .map((child) => child.getBoundingClientRect())
        .filter((rect) => rect.height > 0);
      if (bounds.length)
        this.host.style.bottom = `${Math.max(12, controls.getBoundingClientRect().bottom - Math.min(...bounds.map((rect) => rect.top)) + 12)}px`;
    }
  }
}
