import type { ShopRepair } from '../game/shop-healing';
import { cardIcon } from './icons';

const hpText = (value: number) =>
  Number.isInteger(value) ? String(value) : value > 0 && value < 0.1 ? '<0.1' : value.toFixed(1);
const gain = (option: ShopRepair) => `Restore ${hpText(option.amount)} HP`;
const healthLabel = (hp: number, maxHp: number) => `${hpText(hp)} / ${hpText(maxHp)} HP`;

export function repairPanelMarkup(options: ShopRepair[], hp: number, maxHp: number): string {
  if (!options.length) return '';
  return `<section class="shop-repairs" aria-label="Repair integrity"><div class="launch-section-heading"><h3>Repair integrity</h3><strong data-repair-health>${healthLabel(hp, maxHp)}</strong></div><p>${options[0].legacy ? 'Recovered expedition · original 30% repair rules.' : 'Choose one repair per shop. Base healing uses maximum HP; repair upgrades increase it. Excess healing is lost.'}</p><div class="repair-options">${options.map((o) => `<button class="outline-button repair-option" data-repair-percent="${o.percent}" ${o.disabledReason ? 'disabled' : ''}>${cardIcon('util-repair', 32)}<b>Heal ${o.percent}% of max HP</b><span class="repair-gain">${gain(o)}</span><strong>${o.cost} scrap</strong><small class="repair-state">${o.disabledReason || 'One repair stock'}</small></button>`).join('')}</div></section>`;
}

/** Update live quotes without rebuilding hovered/focused buttons. */
export function updateRepairPanel(
  panel: HTMLElement,
  options: ShopRepair[],
  hp: number,
  maxHp: number,
) {
  const health = panel.querySelector('[data-repair-health]');
  if (health) health.textContent = healthLabel(hp, maxHp);
  for (const option of options) {
    const button = panel.querySelector<HTMLButtonElement>(
      `[data-repair-percent="${option.percent}"]`,
    );
    if (!button) continue;
    button.disabled = !!option.disabledReason;
    button.querySelector('.repair-gain')!.textContent = gain(option);
    button.querySelector('.repair-state')!.textContent =
      option.disabledReason || 'One repair stock';
  }
}
