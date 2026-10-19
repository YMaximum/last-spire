import { damageNumberLifetime, type DamageElement, type DamageNumber } from '../game/damage-feedback';

export const DAMAGE_STYLES = {
  physical: { color: '#f2e6cb', accent: '#bca981', sigil: 'blade' },
  fire: { color: '#ffab69', accent: '#ffe2a7', sigil: 'flame' },
  frost: { color: '#a5efff', accent: '#f1fdff', sigil: 'crystal' },
  lightning: { color: '#d2c4ff', accent: '#fff2ae', sigil: 'bolt' },
  poison: { color: '#b9ed7d', accent: '#e6ffc2', sigil: 'venom' },
  solar: { color: '#ffe392', accent: '#fff8d9', sigil: 'sun' },
  void: { color: '#dfa9ff', accent: '#f3d7ff', sigil: 'rift' },
} as const satisfies Record<DamageElement, { color: string; accent: string; sigil: string }>;

export function formatDamage(amount: number): string {
  if (amount < 0.1) return '<0.1';
  if (amount >= 1e6) return `${(amount / 1e6).toFixed(1).replace(/\.0$/, '')}m`;
  if (amount >= 1e3) return `${(amount / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return amount < 10 ? amount.toFixed(1).replace(/\.0$/, '') : String(Math.round(amount));
}

export interface NumberView {
  time: number;
  motion: boolean;
  detail: boolean;
  width: number;
  height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}
export function layoutDamageNumbers(entries: readonly DamageNumber[], view: NumberView) {
  const limit = view.width < 600 ? 16 : view.detail ? 40 : 24;
  const placed: { x: number; y: number; width: number; height: number }[] = [];
  return entries
    .filter((n) => view.time >= n.born && view.time - n.born < damageNumberLifetime(n))
    .sort((a, b) => Number(b.critical) - Number(a.critical) || b.born - a.born)
    .slice(0, limit)
    .flatMap((n) => {
      const age = view.time - n.born;
      const life = age / damageNumberLifetime(n);
      const text = formatDamage(n.amount);
      const tag = n.critical
        ? 'CRIT'
        : n.source === 'dot'
          ? 'TICK'
          : n.source === 'retaliation'
            ? 'RETURN'
            : '';
      const size = n.critical ? 24 : n.source === 'dot' ? 16 : 18;
      const width =
        Math.max(text.length * size * 0.65 + 34 + (n.hits > 1 ? 22 : 0), tag.length * 8 + 10) *
        (view.motion && n.critical ? 1.2 : 1);
      const height = (tag ? 44 : 30) * (view.motion && n.critical ? 1.2 : 1);
      const clampX = (x: number) =>
        Math.max(width / 2 + 8, Math.min(view.width - width / 2 - 8, x));
      const clampY = (y: number) => Math.max(height + 8, Math.min(view.height - 18, y));
      let x = clampX(view.offsetX + n.x * view.scale + ((n.seed % 3) - 1) * 13);
      let y = clampY(view.offsetY + n.y * view.scale - 20 - (view.motion ? age * 42 : 0));
      // Small screen-space lanes keep labels readable independently of arena zoom.
      const baseX = x,
        baseY = y;
      let fits = false;
      for (let attempt = 0; attempt < 25; attempt++) {
        const column = [0, -1, 1, -2, 2][attempt % 5];
        const row = [0, -1, 1, -2, 2][Math.floor(attempt / 5)];
        x = clampX(baseX + column * (width + 8));
        y = clampY(baseY + row * (height + 6));
        if (
          !placed.some(
            (p) =>
              Math.abs(p.x - x) < (p.width + width) / 2 &&
              Math.abs(p.y - y) < Math.max(p.height, height),
          )
        ) {
          fits = true;
          break;
        }
      }
      if (!fits) return [];
      placed.push({ x, y, width, height });
      return [
        {
          n,
          text,
          tag,
          size,
          x,
          y,
          width,
          height,
          age,
          alpha: Math.min(1, (1 - life) * 3),
          pop:
            view.motion && n.critical ? 1 + Math.sin(Math.min(1, age / 0.22) * Math.PI) * 0.2 : 1,
        },
      ];
    });
}

function sigil(c: CanvasRenderingContext2D, element: DamageElement, age: number, motion: boolean) {
  c.beginPath();
  switch (element) {
    case 'physical':
      c.moveTo(-5, 5);
      c.lineTo(4, -5);
      c.lineTo(1, 3);
      c.moveTo(-5, 1);
      c.lineTo(0, 5);
      break;
    case 'fire':
      c.moveTo(0, 6);
      c.bezierCurveTo(-10, 1, -2, -1, -2, -7);
      c.bezierCurveTo(8, -2, 8, 3, 0, 6);
      break;
    case 'frost':
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        c.moveTo(-Math.cos(a) * 7, -Math.sin(a) * 7);
        c.lineTo(Math.cos(a) * 7, Math.sin(a) * 7);
      }
      c.moveTo(0, -4);
      c.lineTo(4, 0);
      c.lineTo(0, 4);
      c.lineTo(-4, 0);
      c.closePath();
      break;
    case 'lightning':
      c.moveTo(3, -7);
      c.lineTo(-4, 0);
      c.lineTo(1, 0);
      c.lineTo(-3, 7);
      c.lineTo(5, -2);
      c.lineTo(0, -2);
      break;
    case 'poison':
      c.moveTo(0, -7);
      c.bezierCurveTo(-8, 1, -6, 6, 0, 6);
      c.bezierCurveTo(6, 6, 8, 1, 0, -7);
      c.moveTo(9, -4);
      c.arc(7, -4, 2, 0, Math.PI * 2);
      break;
    case 'solar':
      c.arc(0, 0, 3, 0, Math.PI * 2);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        c.moveTo(Math.cos(a) * 5, Math.sin(a) * 5);
        c.lineTo(Math.cos(a) * 8, Math.sin(a) * 8);
      }
      break;
    case 'void':
      c.ellipse(0, 0, 7, 3, motion ? age : -0.4, 0, Math.PI * 2);
      c.moveTo(0, -7);
      c.lineTo(3, 0);
      c.lineTo(0, 7);
      c.lineTo(-3, 0);
      c.closePath();
      break;
  }
  c.stroke();
}

/** Paint in CSS-pixel space: numbers stay legible on narrow battlefields. */
export function drawDamageNumbers(
  c: CanvasRenderingContext2D,
  entries: readonly DamageNumber[],
  view: NumberView,
): void {
  for (const label of layoutDamageNumbers(entries, view)) {
    const { n, text, tag, size, x, y, age, alpha, pop } = label;
    const style = DAMAGE_STYLES[n.element];
    c.save();
    c.translate(x, y);
    c.scale(pop, pop);
    c.globalAlpha = alpha;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.font = `${n.critical ? 'italic 800' : '700'} ${size}px ui-monospace, monospace`;
    c.lineWidth = 5;
    c.strokeStyle = '#071513';
    c.strokeText(text, 0, 0);
    c.fillStyle = style.color;
    c.fillText(text, 0, 0);
    const half = c.measureText(text).width / 2;
    c.save();
    c.translate(-half - 12, 0);
    c.strokeStyle = style.color;
    c.lineWidth = 1.7;
    sigil(c, n.element, age, view.motion);
    c.restore();
    if (tag) {
      c.font = `800 ${n.critical ? 12 : 10}px ui-monospace, monospace`;
      c.strokeStyle = '#071513';
      c.lineWidth = 4;
      c.strokeText(tag, 0, -size * 0.8);
      c.fillStyle = n.critical ? '#fff1b8' : style.accent;
      c.fillText(tag, 0, -size * 0.8);
    }
    if (n.hits > 1) {
      c.font = '600 10px ui-monospace, monospace';
      c.strokeText(`×${n.hits}`, half + 11, 8);
      c.fillStyle = style.accent;
      c.fillText(`×${n.hits}`, half + 11, 8);
    }
    if (n.critical) {
      c.strokeStyle = style.accent;
      c.lineWidth = 1.6;
      c.beginPath();
      for (const direction of [-1, 1]) {
        const edge = direction * (half + 7);
        c.moveTo(edge, 7);
        c.lineTo(edge + direction * 5, 0);
        c.lineTo(edge, -7);
      }
      c.stroke();
      if (view.motion && view.detail && age < 0.24) {
        c.globalAlpha *= 1 - age / 0.24;
        c.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2 + Math.PI / 4;
          const r = 16 + age * 55;
          c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          c.lineTo(Math.cos(a) * (r + 6), Math.sin(a) * (r + 6));
        }
        c.stroke();
      }
    } else if (view.motion && view.detail && (n.element === 'fire' || n.element === 'poison')) {
      c.fillStyle = style.accent;
      c.globalAlpha *= 0.65;
      c.fillRect(-half + Math.sin(n.seed) * 8, -12 - age * 14, 2, 2);
    }
    c.restore();
  }
}
