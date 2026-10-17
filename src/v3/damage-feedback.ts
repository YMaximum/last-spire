import type { DamageEvent } from '../v2/types';

export type DamageElement = DamageEvent['element'];
export interface DamageNumber {
  targetId: number;
  x: number;
  y: number;
  amount: number;
  element: DamageElement;
  source: DamageEvent['source'];
  critical: boolean;
  hits: number;
  born: number;
  seed: number;
}
type Host = { time: number };
const MAX_NUMBERS = 96;
const numbers = new WeakMap<Host, DamageNumber[]>();
export const damageNumberLifetime = (n: DamageNumber) =>
  n.critical ? 1.15 : n.source === 'dot' ? 0.9 : 1;

/** Presentation-only subscription: never enters a save, consumes RNG, or changes combat IDs. */
export function enableDamageNumbers(host: Host, enabled: boolean): void {
  if (!enabled) numbers.delete(host);
  else if (!numbers.has(host)) numbers.set(host, []);
}

export function readDamageNumbers(host: Host): readonly DamageNumber[] {
  const entries = numbers.get(host);
  if (!entries) return [];
  for (let i = entries.length - 1; i >= 0; i--)
    if (host.time - entries[i].born >= damageNumberLifetime(entries[i])) entries.splice(i, 1);
  return entries;
}

export function recordDamageNumber(
  host: Host,
  target: { id: number; x: number; y: number },
  amount: number,
  event: DamageEvent,
): void {
  const entries = numbers.get(host);
  if (!entries || !Number.isFinite(amount) || amount <= 0) return;
  readDamageNumbers(host);
  const critical = !!event.critical && event.source === 'primary' && event.depth === 0;
  let previous: DamageNumber | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    const n = entries[i];
    if (host.time - n.born > 0.12) break;
    if (
      n.targetId === target.id &&
      n.element === event.element &&
      n.critical === critical &&
      n.source === event.source
    ) {
      previous = n;
      break;
    }
  }
  if (previous) {
    previous.amount += amount;
    previous.hits++;
    return;
  }
  if (entries.length >= MAX_NUMBERS) {
    const ordinary = entries.findIndex((n) => !n.critical);
    entries.splice(ordinary < 0 ? 0 : ordinary, 1);
  }
  entries.push({
    targetId: target.id,
    x: target.x,
    y: target.y,
    amount,
    element: event.element,
    source: event.source,
    critical,
    hits: 1,
    born: host.time,
    seed: (Math.imul(target.id, 31) ^ Math.imul(event.rootId, 17)) >>> 0,
  });
}
