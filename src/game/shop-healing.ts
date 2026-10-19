export const HEALING_CHOICES = [
  { percent: 25, cost: 28 },
  { percent: 50, cost: 56 },
  { percent: 75, cost: 84 },
  { percent: 100, cost: 112 },
] as const;

export interface ShopRepair {
  percent: number;
  cost: number;
  amount: number;
  disabledReason: string;
  legacy: boolean;
}

export function quoteRepairs(input: {
  modern: boolean;
  hp: number;
  maxHp: number;
  scrap: number;
  stock: number;
  bonus: number;
}): ShopRepair[] {
  const choices = input.modern ? HEALING_CHOICES : [{ percent: 30, cost: 28 }];
  return choices.map(({ percent, cost }) => ({
    percent,
    cost,
    amount: Math.max(
      0,
      Math.min(input.maxHp - input.hp, ((input.maxHp * percent) / 100) * (1 + input.bonus)),
    ),
    disabledReason:
      input.stock <= 0
        ? 'Repair used at this shop'
        : input.hp >= input.maxHp
          ? 'Integrity is full'
          : input.scrap < cost
            ? 'Not enough scrap'
            : '',
    legacy: !input.modern,
  }));
}
