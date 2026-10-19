// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRun,
  repair,
  repairOptions,
  rerollReward,
  closeShop,
  acquireCard,
} from '../src/game/engine';
import { emptySave, parseGame, exportGame } from '../src/persistence/storage';
import { repairPanelMarkup, updateRepairPanel } from '../src/ui/shop-repairs';
import { HEALING_CHOICES } from '../src/game/shop-healing';

function shop(old = false) {
  const save = emptySave();
  const run = createRun(save.profile, 'bastion', 0, 0, 718, { shopVersion: old ? 1 : 2 });
  save.run = run;
  save.progression.active = {
    runId: run.id,
    rulesVersion: 3,
    runes: run.runeSnapshot,
    autocast: save.progression.autocast,
  };
  run.pendingRewards = [
    { id: 'healing-shop', kind: 'shop', wave: 10, offers: [], rerolls: 0, repairStock: 1 },
  ];
  run.hp = 1;
  run.scrap = 200;
  return { save, run, id: run.pendingRewards[0].id };
}
afterEach(() => document.body.replaceChildren());

describe('milestone shop healing', () => {
  it.each(HEALING_CHOICES)(
    'restores $percent% maximum HP for $cost scrap and consumes shared stock',
    ({ percent, cost }) => {
      const { run, id } = shop();
      const max = run.maxHp;
      expect(repair(run, id, percent)).toBe(true);
      expect(run.hp).toBeCloseTo(Math.min(max, 1 + (max * percent) / 100));
      expect(run.scrap).toBe(200 - cost);
      expect(run.stats.spent).toBe(cost);
      expect(run.stats.shopPurchases).toBe(1);
      expect(run.counters.shopHealing).toBeCloseTo(run.hp - 1);
      expect(run.pendingRewards[0].repairStock).toBe(0);
      for (const other of HEALING_CHOICES) expect(repair(run, id, other.percent)).toBe(false);
    },
  );
  it('validates health, stock, phase, shop identity, affordability and percentage before spending', () => {
    const { run, id } = shop();
    for (const percent of [0, -25, 30, 26, 101, NaN, Infinity])
      expect(repair(run, id, percent)).toBe(false);
    expect(repair(run, 'stale-shop', 25)).toBe(false);
    run.scrap = 27;
    expect(repair(run, id, 25)).toBe(false);
    run.scrap = 200;
    run.phase = 'ended';
    expect(repair(run, id, 25)).toBe(false);
    run.phase = 'combat';
    run.hp = run.maxHp;
    expect(repair(run, id, 100)).toBe(false);
    expect(run.scrap).toBe(200);
    expect(run.pendingRewards[0].repairStock).toBe(1);
    run.hp = run.maxHp - 1;
    expect(repair(run, id, 25)).toBe(true);
    expect(run.hp).toBe(run.maxHp);
    expect(run.counters.shopHealing).toBe(1);
  });
  it('keeps repair-improvement cards useful while capping excess healing without triggering offense', () => {
    const { run, id } = shop();
    acquireCard(run, { cardId: 'util-repair', rarity: 'normal', id: 'synthetic-repair', price: 0 });
    const quote = repairOptions(run, id)[0];
    expect(quote.amount).toBeGreaterThan(run.maxHp * 0.25);
    const shots = run.projectiles.length,
      zones = run.areas.length;
    expect(repair(run, id, 25)).toBe(true);
    expect(run.hp).toBeCloseTo(1 + quote.amount);
    expect(run.projectiles).toHaveLength(shots);
    expect(run.areas).toHaveLength(zones);
  });
  it('rerolling, saving, and resuming cannot replenish the one repair stock', () => {
    const { save, run, id } = shop();
    repair(run, id, 25);
    rerollReward(run, id);
    expect(run.pendingRewards[0].repairStock).toBe(0);
    const restored = parseGame(exportGame(save)).run as typeof run;
    expect(restored.shopVersion).toBe(2);
    expect(repair(restored, id, 50)).toBe(false);
    closeShop(restored, id);
    expect(repair(restored, id, 100)).toBe(false);
  });
  it('retains the original single 30%/28-scrap repair on recovered runs', () => {
    const { save, run, id } = shop(true);
    expect(run.shopVersion).toBeUndefined();
    expect(repairOptions(run, id).map((o) => [o.percent, o.cost])).toEqual([[30, 28]]);
    expect(repair(run, id, 100)).toBe(false);
    expect(repair(run, id)).toBe(true);
    expect(run.hp).toBeCloseTo(1 + run.maxHp * 0.3);
    const restored = parseGame(exportGame(save)).run as typeof run;
    expect(restored.shopVersion).toBeUndefined();
  });
  it('shows all four increasing costs and live actual healing without replacing hovered buttons', () => {
    const { run, id } = shop();
    document.body.innerHTML = repairPanelMarkup(repairOptions(run, id), run.hp, run.maxHp);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-repair-percent]')];
    expect(buttons).toHaveLength(4);
    expect(buttons.map((b) => b.querySelector('strong')!.textContent)).toEqual([
      '28 scrap',
      '56 scrap',
      '84 scrap',
      '112 scrap',
    ]);
    run.hp = run.maxHp;
    updateRepairPanel(document.body, repairOptions(run, id), run.hp, run.maxHp);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    run.hp -= 10;
    run.scrap = 28;
    updateRepairPanel(document.body, repairOptions(run, id), run.hp, run.maxHp);
    expect(document.querySelector('[data-repair-percent="25"]')).toBe(buttons[0]);
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[0].querySelector('.repair-gain')!.textContent).toBe('Restore 10 HP');
    expect(buttons.slice(1).every((b) => b.disabled)).toBe(true);
  });
});
