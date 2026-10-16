import type {
  Element,
  Enemy,
  EnemyKind,
  Projectile,
  RunState,
  Settings,
  TowerId,
  Visual,
} from './types';

const W = 1000,
  H = 800,
  CX = 500,
  CY = 400,
  TAU = Math.PI * 2;
const ELEMENT: Record<Element, string> = {
  fire: '#ff995e',
  frost: '#99e7f1',
  lightning: '#b8b9ff',
  poison: '#a4d76c',
  solar: '#ffdc8c',
  void: '#d69eff',
};
const TOWER: Record<TowerId, string> = {
  bastion: '#eac88c',
  pyre: '#ff985c',
  tempest: '#b5b5ff',
  glacier: '#94e8ed',
  verdant: '#b4df7c',
  null: '#d39df5',
};
const PALETTES = [
  {
    ground: '#102b2b',
    deep: '#091f23',
    tile: '#1a3735',
    line: '#2a4940',
    light: '#849b6a',
    accent: '#c5b27b',
  },
  {
    ground: '#2c292a',
    deep: '#1b2023',
    tile: '#3c3530',
    line: '#554536',
    light: '#bd8251',
    accent: '#e7aa67',
  },
  {
    ground: '#1f2437',
    deep: '#12182b',
    tile: '#2b3049',
    line: '#43415e',
    light: '#9891bd',
    accent: '#b7a0dc',
  },
];
const hash = (n: number): number => {
  const a = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return a - Math.floor(a);
};
const clamp = (n: number, a: number, b: number): number => Math.max(a, Math.min(b, n));
type Context = CanvasRenderingContext2D;
function rect(c: Context, x: number, y: number, w: number, h: number, color: string) {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), w, h);
}
function polygon(c: Context, points: number[][], fill: string, stroke?: string, width = 2) {
  c.beginPath();
  points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  if (stroke) {
    c.strokeStyle = stroke;
    c.lineWidth = width;
    c.stroke();
  }
}
function circle(c: Context, x: number, y: number, radius: number, color: string, width = 1) {
  c.beginPath();
  c.arc(x, y, radius, 0, TAU);
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}
function line(c: Context, x: number, y: number, x2: number, y2: number, color: string, width = 2) {
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x2, y2);
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}
function diamond(c: Context, x: number, y: number, r: number, color: string, outline?: string) {
  polygon(
    c,
    [
      [x, y - r],
      [x + r * 0.7, y],
      [x, y + r],
      [x - r * 0.7, y],
    ],
    color,
    outline,
  );
}
function rune(c: Context, x: number, y: number, s: number, color: string, variant: number) {
  c.save();
  c.translate(x, y);
  c.strokeStyle = color;
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(-s * 0.5, s * 0.6);
  c.lineTo(0, -s * 0.7);
  c.lineTo(s * 0.5, s * 0.6);
  c.moveTo(-s * 0.3, 0);
  c.lineTo(s * 0.3, 0);
  if (variant % 3 === 0) {
    c.moveTo(0, -s * 0.7);
    c.lineTo(0, s * 0.8);
  } else if (variant % 3 === 1) {
    c.moveTo(-s * 0.55, -s * 0.45);
    c.lineTo(s * 0.55, s * 0.35);
  } else {
    c.moveTo(-s * 0.55, -s * 0.5);
    c.lineTo(s * 0.55, -s * 0.5);
  }
  c.stroke();
  c.restore();
}

/** Purely cosmetic Canvas2D view. Combat coordinates always remain 1000 × 800. */
export class ArenaRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: Context;
  private background: HTMLCanvasElement | null = null;
  private stage = -1;
  private seed = -1;
  private cssWidth = W;
  private cssHeight = H;
  private dpr = 1;
  private sprites = new Map<EnemyKind, HTMLCanvasElement>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas2D is unavailable');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    this.cssWidth = Math.max(1, bounds.width || this.canvas.parentElement?.clientWidth || W);
    this.cssHeight = Math.max(1, bounds.height || (this.cssWidth * H) / W);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(this.cssWidth * this.dpr),
      height = Math.round(this.cssHeight * this.dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.ctx.imageSmoothingEnabled = false;
  }

  draw(state: RunState, settings: Settings): void {
    const c = this.ctx,
      scale = Math.min(this.canvas.width / W, this.canvas.height / H);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#071519';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(
      scale,
      0,
      0,
      scale,
      (this.canvas.width - W * scale) / 2,
      (this.canvas.height - H * scale) / 2,
    );
    c.imageSmoothingEnabled = false;
    if (!this.background || this.stage !== state.stage || this.seed !== state.seed)
      this.createBackground(state.stage, state.seed);
    c.drawImage(this.background!, 0, 0);
    c.save();
    c.beginPath();
    c.rect(0, 0, W, H);
    c.clip();
    const time = settings.reducedMotion ? 0 : state.time;
    this.ambient(c, state, time, settings);
    // Low opacity ground effects sit underneath all combatants.
    for (const visual of state.visuals.slice(-200))
      if (visual.kind === 'hazard') this.visual(c, visual, settings);
    const color = TOWER[state.tower];
    if (state.stasis > 0) {
      c.fillStyle = '#7edfe810';
      c.fillRect(0, 0, W, H);
      circle(c, CX, CY, 310, '#87dce750', 2);
    }
    if (state.shield > 0) {
      circle(c, CX, CY, 63, color + '88', 2);
      circle(c, CX, CY, 68, color + '25', 1);
    }
    this.tower(c, state.tower, time, state.buff > 0, settings.effects === 'high');
    const enemies =
      state.enemies.length > 1 ? [...state.enemies].sort((a, b) => a.y - b.y) : state.enemies;
    for (const enemy of enemies) this.enemy(c, enemy, time, settings);
    for (const projectile of state.projectiles) this.projectile(c, projectile, time, settings);
    for (const visual of state.visuals.slice(-200))
      if (visual.kind !== 'hazard') this.visual(c, visual, settings);
    // The core's life bar remains readable through dense waves.
    const fraction = clamp(state.hp / state.maxHp, 0, 1);
    rect(c, CX - 34, CY + 51, 68, 5, '#07181d');
    rect(c, CX - 33, CY + 52, 66 * fraction, 3, fraction < 0.3 ? '#ff8b78' : '#b6d6b2');
    if (state.shield > 0)
      rect(c, CX - 33, CY + 58, 66 * Math.min(1, state.shield / state.maxHp), 2, '#a9dbe6');
    c.restore();
    c.globalAlpha = 1;
    c.shadowBlur = 0;
  }

  dispose(): void {
    this.background = null;
    this.sprites.clear();
  }

  private createBackground(stage: number, seed: number) {
    this.stage = stage;
    this.seed = seed;
    const index = clamp(stage, 0, 2),
      p = PALETTES[index];
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext('2d')!;
    c.fillStyle = p.ground;
    c.fillRect(0, 0, W, H);
    // Deterministic two-tone floor flecks keep the stone tactile without noisy animation.
    for (let i = 0; i < 1800; i++) {
      const x = Math.floor((hash(i + seed) * W) / 4) * 4,
        y = Math.floor((hash(i * 3 + seed + 27) * H) / 4) * 4;
      rect(c, x, y, hash(i + 4) > 0.8 ? 8 : 3, 2, hash(i + 6) > 0.5 ? p.deep : p.tile);
    }
    // Broken processional roads from the four gates into the spire.
    for (let arm = 0; arm < 4; arm++) {
      c.save();
      c.translate(CX, CY);
      c.rotate((arm * Math.PI) / 2);
      for (let row = 2; row < 15; row++)
        for (let col = -1; col <= 1; col++) {
          if (hash(row * 31 + col + arm * 53) > 0.87) continue;
          const x = col * 28 + (row % 2) * 10 - 12,
            y = row * 30 + 22;
          polygon(
            c,
            [
              [x, y],
              [x + 24, y - 2],
              [x + 26, y + 21],
              [x - 2, y + 23],
            ],
            p.tile,
            p.deep,
            2,
          );
          if (hash(row * 11 + col) > 0.55) line(c, x + 4, y + 3, x + 12, y + 9, p.line, 1);
        }
      c.restore();
    }
    // Thin cartographic rings and dashed sight lines provide scale.
    for (const r of [124, 226, 330]) {
      c.setLineDash(r === 226 ? [3, 12] : []);
      circle(c, CX, CY, r, p.line + '90', 1);
    }
    c.setLineDash([]);
    for (let i = 0; i < 32; i++) {
      const a = (i * TAU) / 32,
        r = 330;
      line(
        c,
        CX + Math.cos(a) * r,
        CY + Math.sin(a) * r,
        CX + Math.cos(a) * (r + 5),
        CY + Math.sin(a) * (r + 5),
        p.light + '44',
        1,
      );
    }
    for (let i = 0; i < 12; i++) {
      const a = (i * TAU) / 12;
      rune(c, CX + Math.cos(a) * 225, CY + Math.sin(a) * 225, 9, p.light + '55', i);
    }
    // Dais: concentric bronze inlaid stone and eight carved buttresses.
    circle(c, CX, CY + 7, 79, p.deep, 16);
    circle(c, CX, CY, 77, p.line, 3);
    circle(c, CX, CY, 67, p.accent + '88', 1);
    for (let i = 0; i < 8; i++) {
      const a = (i * TAU) / 8;
      c.save();
      c.translate(CX + Math.cos(a) * 74, CY + Math.sin(a) * 74);
      c.rotate(a);
      rect(c, -9, -5, 18, 10, p.deep);
      rect(c, -8, -5, 16, 3, p.light);
      rect(c, -6, 2, 12, 3, p.tile);
      c.restore();
    }
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) * TAU) / 8;
      rune(c, CX + Math.cos(a) * 57, CY + Math.sin(a) * 57, 7, p.accent + '99', i);
    }
    if (index === 0) this.forest(c, seed);
    else if (index === 1) this.foundry(c, seed);
    else this.voidscape(c, seed);
    // Strong edge vignette holds attention on the defense.
    const gradient = c.createRadialGradient(CX, CY, 230, CX, CY, 620);
    gradient.addColorStop(0, '#00000000');
    gradient.addColorStop(1, '#020d16b5');
    c.fillStyle = gradient;
    c.fillRect(0, 0, W, H);
    this.background = canvas;
  }

  private forest(c: Context, seed: number) {
    for (let i = 0; i < 95; i++) {
      const x = hash(i * 19 + seed) * W,
        y = hash(i * 29 + seed + 7) * H;
      if (
        Math.hypot((x - CX) * 0.85, y - CY) < 310 ||
        Math.abs(x - CX) < 43 ||
        Math.abs(y - CY) < 40
      )
        continue;
      const s = 0.7 + hash(i + 32) * 0.9;
      c.save();
      c.translate(Math.round(x), Math.round(y));
      c.scale(s, s);
      rect(c, -21, 13, 48, 8, '#081e22');
      rect(c, -5, -6, 10, 26, '#403a2c');
      rect(c, -3, -3, 3, 23, '#6d5840');
      polygon(
        c,
        [
          [-27, 5],
          [-19, -10],
          [-24, -10],
          [-13, -27],
          [-17, -27],
          [0, -52],
          [17, -27],
          [13, -27],
          [25, -10],
          [19, -10],
          [29, 5],
        ],
        '#102e2b',
        '#092023',
        3,
      );
      polygon(
        c,
        [
          [-22, -1],
          [-10, -18],
          [-13, -18],
          [0, -45],
          [5, -18],
          [12, -18],
          [19, -1],
        ],
        i % 3 === 0 ? '#335346' : '#25473c',
      );
      rect(c, -14, -5, 13, 3, '#49634a');
      rect(c, -7, -22, 8, 3, '#506b50');
      rect(c, 3, 4, 14, 3, '#193a30');
      c.restore();
    }
    for (let i = 0; i < 30; i++) {
      const x = hash(i * 41 + seed + 5) * W,
        y = hash(i * 71 + seed + 2) * H;
      if (Math.hypot(x - CX, y - CY) < 150) continue;
      rect(c, x, y, 14, 6, '#0a2525');
      rect(c, x + 2, y - 7, 10, 9, '#455749');
      rect(c, x + 2, y - 8, 9, 2, '#7a8361');
      rect(c, x + 6, y - 12, 4, 4, '#233d31');
    }
    for (const [x, y] of [
      [173, 186],
      [798, 581],
      [185, 630],
      [830, 166],
    ])
      this.ruin(c, x, y, '#3d5146', '#7f8461');
    for (let i = 0; i < 46; i++) {
      const x = hash(i * 43 + seed) * W,
        y = hash(i * 23 + seed + 90) * H;
      if (Math.hypot(x - CX, y - CY) < 100) continue;
      rect(c, x, y, 3, 2, i % 3 === 0 ? '#7b9a6a' : '#466b58');
      rect(c, x + 3, y + 2, 2, 3, '#284a3c');
    }
  }

  private ruin(c: Context, x: number, y: number, stone: string, edge: string) {
    rect(c, x - 23, y + 28, 53, 9, '#091f23');
    polygon(
      c,
      [
        [x - 20, y + 24],
        [x - 20, y - 30],
        [x - 8, y - 30],
        [x - 8, y - 41],
        [x + 13, y - 41],
        [x + 13, y - 28],
        [x + 22, y - 28],
        [x + 22, y + 24],
      ],
      stone,
      '#132828',
      3,
    );
    rect(c, x - 16, y - 28, 5, 48, edge);
    rect(c, x - 19, y + 19, 44, 5, edge);
    rect(c, x - 7, y - 37, 17, 3, edge);
    rune(c, x + 5, y - 10, 10, '#a4bd8c70', 1);
    line(c, x + 19, y - 22, x + 7, y - 4, '#1a312e', 3);
    line(c, x + 7, y - 4, x + 14, y + 12, '#1a312e', 3);
  }

  private foundry(c: Context, seed: number) {
    for (const x of [85, 900]) {
      rect(c, x - 12, 0, 25, H, '#131c22');
      rect(c, x - 8, 0, 17, H, '#603d2b');
      rect(c, x - 4, 0, 8, H, '#bd6533');
      rect(c, x - 2, 0, 3, H, '#edaa5d');
      for (let y = 0; y < H; y += 54) {
        rect(c, x - 16, y, 33, 8, '#1e2526');
        rect(c, x - 17, y, 34, 2, '#8e6943');
      }
    }
    for (let i = 0; i < 20; i++) {
      const x = hash(i * 19 + seed) * W,
        y = hash(i * 29 + seed + 7) * H;
      if (Math.hypot(x - CX, y - CY) < 310) continue;
      const r = 17 + hash(i + 1) * 19;
      c.save();
      c.translate(x, y);
      for (let j = 0; j < 10; j++) {
        c.save();
        c.rotate((j * TAU) / 10);
        rect(c, r - 4, -5, 9, 10, '#69503b');
        c.restore();
      }
      circle(c, 0, 0, r, '#70533b', 7);
      circle(c, 0, 0, r - 7, '#182427', 6);
      circle(c, 0, 0, 5, '#957048', 5);
      c.restore();
    }
    for (const [x, y] of [
      [190, 140],
      [804, 145],
      [195, 630],
      [810, 630],
    ]) {
      rect(c, x - 30, y - 20, 60, 67, '#142024');
      rect(c, x - 26, y - 26, 52, 64, '#4b3e32');
      rect(c, x - 21, y - 21, 42, 48, '#1d2628');
      rect(c, x - 15, y - 10, 30, 30, '#6f3c27');
      rect(c, x - 9, y - 3, 19, 20, '#da793f');
      rect(c, x - 5, y + 4, 10, 13, '#ffd38b');
      for (let k = -1; k < 2; k++) rect(c, x + k * 13 - 2, y - 18, 4, 43, '#302e29');
      rect(c, x - 30, y + 30, 60, 8, '#98714b');
      rect(c, x + 22, y - 46, 8, 23, '#74604b');
    }
    for (let i = 0; i < 30; i++) {
      const x = hash(i * 13 + seed) * W,
        y = hash(i * 33 + seed + 16) * H;
      if (Math.hypot(x - CX, y - CY) < 110) continue;
      rect(c, x, y, 18, 8, '#242a29');
      rect(c, x + 2, y, 14, 2, '#74583c');
      rect(c, x + 3, y + 4, 3, 3, '#c59656');
    }
  }

  private voidscape(c: Context, seed: number) {
    for (let i = 0; i < 165; i++) {
      const x = hash(i * 11 + seed) * W,
        y = hash(i * 71 + seed) * H;
      if (Math.hypot(x - CX, y - CY) < 100) continue;
      rect(c, x, y, i % 7 === 0 ? 3 : 1, i % 7 === 0 ? 3 : 1, i % 4 === 0 ? '#b9a4d0' : '#57657e');
    }
    for (let i = 0; i < 22; i++) {
      const x = hash(i * 19 + seed) * W,
        y = hash(i * 29 + seed + 7) * H;
      if (Math.hypot(x - CX, y - CY) < 295) continue;
      const s = 16 + hash(i + 20) * 30;
      polygon(
        c,
        [
          [x - s, y],
          [x - s * 0.7, y - s],
          [x + s * 0.5, y - s * 0.6],
          [x + s, y + s * 0.4],
          [x, y + s],
        ],
        '#303149',
        '#51516a',
      );
      polygon(
        c,
        [
          [x - s, y],
          [x, y + s],
          [x + s, y + s * 0.4],
          [x + s * 0.5, y + s * 1.6],
          [x - s * 0.4, y + s * 1.4],
        ],
        '#171e31',
      );
      rect(c, x - 3, y - s, 3, s * 1.7, '#8772a5');
    }
    for (const [x, y] of [
      [175, 190],
      [827, 169],
      [183, 623],
      [830, 610],
    ]) {
      this.ruin(c, x, y, '#3b3c55', '#8d80a3');
      diamond(c, x, y - 52, 12, '#b09acb', '#39354e');
      line(c, x, y - 37, x, y - 22, '#c5a3ea', 1);
    }
    c.setLineDash([10, 16]);
    circle(c, CX, CY, 374, '#8e6f9d33', 2);
    c.setLineDash([]);
  }

  private ambient(c: Context, state: RunState, time: number, settings: Settings) {
    const color = TOWER[state.tower];
    const glow = c.createRadialGradient(CX, CY - 10, 4, CX, CY, 125);
    glow.addColorStop(0, color + '1c');
    glow.addColorStop(1, color + '00');
    c.fillStyle = glow;
    c.fillRect(CX - 125, CY - 125, 250, 250);
    const count = settings.effects === 'high' ? 22 : 7;
    for (let i = 0; i < count; i++) {
      const a = hash(i + state.seed) * TAU,
        r = 100 + hash(i * 11 + 33) * 380;
      const x = CX + Math.cos(a) * r,
        y = CY + Math.sin(a) * r + Math.sin(time * 0.45 + i) * 7;
      c.globalAlpha = 0.16 + Math.sin(time * 0.8 + i) * 0.1;
      rect(
        c,
        x,
        y,
        2,
        2,
        state.stage === 1 ? '#ffc27a' : state.stage === 2 ? '#c7b2ee' : '#b1dfaa',
      );
    }
    c.globalAlpha = 1;
    for (let i = 0; i < 4; i++) {
      const a = time * 0.12 + (i * TAU) / 4;
      const x = CX + Math.cos(a) * 89,
        y = CY + Math.sin(a) * 64;
      rune(c, x, y, 6, color + '88', i);
    }
  }

  private tower(c: Context, id: TowerId, time: number, buff: boolean, high: boolean) {
    const color = TOWER[id];
    c.save();
    c.translate(CX, CY);
    c.fillStyle = '#04191c88';
    c.beginPath();
    c.ellipse(3, 25, 43, 17, 0, 0, TAU);
    c.fill();
    polygon(
      c,
      [
        [-35, 17],
        [-22, 4],
        [22, 4],
        [35, 17],
        [35, 29],
        [19, 39],
        [-20, 39],
        [-35, 29],
      ],
      '#243b37',
      '#0b2025',
      3,
    );
    polygon(
      c,
      [
        [-35, 17],
        [-20, 29],
        [20, 29],
        [35, 17],
        [20, 7],
        [-20, 7],
      ],
      '#7e7451',
      '#ac9c6b',
      2,
    );
    rect(c, -26, 26, 52, 4, '#4d503a');
    rect(c, -17, 31, 34, 5, '#2c3a31');
    for (const x of [-25, 22]) {
      rect(c, x, 17, 4, 8, '#dac88e');
      rect(c, x, 26, 4, 4, '#403c2e');
    }
    if (high) {
      c.shadowColor = color;
      c.shadowBlur = buff ? 25 : 12;
    }
    if (id === 'bastion') {
      rect(c, -22, -41, 44, 61, '#314844');
      rect(c, -22, -41, 7, 61, '#788575');
      rect(c, 15, -41, 7, 61, '#172f31');
      for (let y = -34; y < 20; y += 13) {
        line(c, -14, y, 14, y, '#a9ad86', 2);
        line(c, y % 2 ? -4 : 7, y, y % 2 ? -4 : 7, y + 10, '#1a3634', 2);
      }
      for (const x of [-29, 15]) {
        rect(c, x, -45, 15, 21, '#84917d');
        rect(c, x, -48, 6, 8, '#b6b796');
        rect(c, x + 10, -48, 5, 8, '#b6b796');
        rect(c, x + 3, -34, 5, 8, '#243f3c');
      }
      rect(c, -28, -25, 56, 6, '#b0a16c');
      rect(c, -10, -57, 20, 38, '#6d7865');
      rect(c, -13, -60, 26, 8, '#c3b57d');
      rect(c, -5, -51, 10, 17, color);
      rect(c, -3, -48, 4, 10, '#fff0bc');
      diamond(c, 0, 3, 10, '#c7b77d', '#e2d9a4');
    } else if (id === 'pyre') {
      polygon(
        c,
        [
          [-23, 18],
          [-25, -20],
          [-14, -41],
          [14, -41],
          [25, -20],
          [23, 18],
        ],
        '#4f3d32',
        '#b2804d',
        3,
      );
      rect(c, -16, -15, 32, 29, '#201f24');
      rect(c, -12, -11, 24, 21, '#a64928');
      rect(c, -8, -5, 16, 15, '#ffad5d');
      rect(c, -3, 0, 6, 9, '#ffe6a1');
      for (const x of [-12, 0, 12]) rect(c, x - 2, -15, 4, 29, '#6c5138');
      polygon(
        c,
        [
          [-18, -34],
          [-26, -56],
          [-13, -48],
          [0, -70],
          [13, -48],
          [26, -56],
          [18, -34],
        ],
        '#8c633b',
        '#c19756',
        2,
      );
      for (let j = 0; j < 3; j++) {
        const x = (j - 1) * 10,
          h = 18 + Math.sin(time * 6 + j) * 4;
        polygon(
          c,
          [
            [x - 8, -39],
            [x - 7, -49],
            [x, -49 - h],
            [x + 7, -50],
            [x + 8, -39],
          ],
          j === 1 ? '#ffe4a0' : '#fb9253',
        );
      }
    } else if (id === 'tempest') {
      rect(c, -17, -39, 34, 55, '#454b59');
      rect(c, -19, -32, 38, 7, '#b4ac91');
      rect(c, -19, -5, 38, 7, '#9b967e');
      rect(c, -8, -37, 16, 51, '#222e40');
      for (let y = -34; y < 8; y += 11) {
        rect(c, -24, y, 48, 4, '#727e95');
        rect(c, -22, y, 44, 1, '#c4c7d5');
      }
      rect(c, -4, -57, 8, 24, '#d5d5e3');
      circle(c, 0, -53, 18, '#9299d3', 4);
      diamond(c, 0, -53, 11, color);
      diamond(c, 0, -53, 5, '#f0edff');
      for (let i = 0; i < 3; i++) {
        const a = time * 1.8 + (i * TAU) / 3,
          x = Math.cos(a) * 28,
          y = -38 + Math.sin(a) * 10;
        diamond(c, x, y, 5, '#d4d0ff');
        line(c, x, y, x * 0.5, -43, '#a5b5ff88', 1);
      }
    } else if (id === 'glacier') {
      polygon(
        c,
        [
          [-24, 18],
          [-22, -24],
          [-8, -44],
          [4, -23],
          [15, -45],
          [28, -12],
          [23, 19],
        ],
        '#42646b',
        '#9fc6c1',
        2,
      );
      polygon(
        c,
        [
          [-13, 12],
          [-18, -41],
          [0, -77],
          [17, -40],
          [12, 15],
        ],
        '#80c9d0',
        '#d1f3ec',
        2,
      );
      polygon(
        c,
        [
          [0, -77],
          [3, -29],
          [12, 15],
          [17, -40],
        ],
        '#447e95',
      );
      polygon(
        c,
        [
          [0, -77],
          [-18, -41],
          [-7, -33],
        ],
        '#d0f4eb',
      );
      polygon(
        c,
        [
          [-24, 8],
          [-34, -24],
          [-20, -43],
          [-9, -12],
          [-8, 17],
        ],
        '#68b7c5',
        '#afdfe0',
        2,
      );
      polygon(
        c,
        [
          [17, 15],
          [12, -15],
          [29, -40],
          [36, -12],
          [26, 20],
        ],
        '#7bbac9',
        '#b6e0dd',
        2,
      );
      rect(c, -22, 18, 44, 4, '#c2eee2');
    } else if (id === 'verdant') {
      polygon(
        c,
        [
          [-19, 20],
          [-12, -10],
          [-19, -35],
          [-5, -28],
          [0, -59],
          [9, -26],
          [23, -39],
          [16, -7],
          [22, 21],
        ],
        '#645d3b',
        '#a89e65',
        3,
      );
      line(c, -1, 17, 3, -43, '#a7a16b', 4);
      line(c, 1, -12, -22, -38, '#787c46', 5);
      line(c, 5, -16, 28, -38, '#787c46', 5);
      for (const [x, y, s] of [
        [-22, -38, 18],
        [20, -43, 21],
        [-4, -60, 24],
        [-9, -32, 18],
      ]) {
        polygon(
          c,
          [
            [x - s, y],
            [x - s + 4, y - 13],
            [x - 5, y - 20],
            [x + 11, y - 17],
            [x + s, y - 6],
            [x + s - 3, y + 8],
            [x - 6, y + 10],
          ],
          '#2d634b',
          '#72a56a',
          2,
        );
        rect(c, x - 7, y - 13, 15, 4, '#a5cb7a');
      }
      diamond(c, 0, -25, 11, '#d2e99c');
      rect(c, -3, -29, 6, 8, '#f4f8bf');
      for (let j = 0; j < 3; j++) {
        const x = -18 + j * 17;
        line(c, x, -32, x, -14 + j * 4, '#a2b96c', 1);
        rect(c, x - 2, -15 + j * 4, 4, 6, '#c7e788');
      }
    } else {
      polygon(
        c,
        [
          [-20, 19],
          [-16, -6],
          [16, -6],
          [20, 19],
        ],
        '#4e435d',
        '#a08ba4',
        2,
      );
      for (const side of [-1, 1]) {
        const x = side * 24;
        polygon(
          c,
          [
            [x - 7, -7],
            [x - 9, -37],
            [x, -57],
            [x + 9, -37],
            [x + 7, -7],
          ],
          '#342c48',
          '#9780a6',
          2,
        );
        line(c, x, -43, x, -15, '#c49adc', 2);
      }
      const bob = Math.sin(time * 1.8) * 3;
      c.save();
      c.translate(0, bob);
      polygon(
        c,
        [
          [-12, -24],
          [-14, -54],
          [0, -76],
          [14, -54],
          [12, -24],
          [0, -14],
        ],
        '#201c35',
        '#a58ac1',
        2,
      );
      diamond(c, 0, -47, 15, '#744f9b', '#dfb3f5');
      diamond(c, 0, -47, 8, '#231d3d');
      rect(c, -2, -53, 4, 12, '#f4c9ff');
      c.restore();
      c.save();
      c.translate(0, -36);
      c.rotate(time * 0.3);
      c.scale(1, 0.4);
      circle(c, 0, 0, 34, '#c9a0e5', 2);
      c.restore();
    }
    c.shadowBlur = 0;
    if (buff) {
      circle(c, 0, -11, 48, color + 'bb', 2);
      for (let i = 0; i < 8; i++) {
        const a = time + (i * TAU) / 8;
        diamond(c, Math.cos(a) * 49, -11 + Math.sin(a) * 49, 3, color);
      }
    }
    c.restore();
  }

  private enemySprite(kind: EnemyKind): HTMLCanvasElement {
    const cached = this.sprites.get(kind);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const c = canvas.getContext('2d')!;
    c.translate(48, 49);
    const palette: Record<EnemyKind, string[]> = {
      swarmer: ['#739d86', '#b1c999'],
      runner: ['#cd9575', '#edc5a1'],
      armored: ['#688b91', '#b5c4b4'],
      ranged: ['#ad7a91', '#edb1b1'],
      support: ['#779b8e', '#c2e2ac'],
      splitter: ['#9b9b61', '#d5d796'],
      elite: ['#b78d66', '#f0cb8c'],
      boss: ['#8d6c89', '#f5b6bb'],
    };
    const [base, light] = palette[kind],
      dark = '#142c31';
    if (kind === 'swarmer') {
      for (const side of [-1, 1]) {
        line(c, side * 12, 0, side * 25, -12, dark, 6);
        line(c, side * 11, 7, side * 26, 16, dark, 5);
        line(c, side * 12, 0, side * 25, -12, base, 2);
        line(c, side * 11, 7, side * 26, 16, base, 2);
      }
      polygon(
        c,
        [
          [-15, -8],
          [-8, -18],
          [8, -18],
          [16, -7],
          [11, 15],
          [0, 23],
          [-11, 15],
        ],
        base,
        dark,
        4,
      );
      rect(c, -5, -13, 10, 25, '#3d6762');
      rect(c, -10, -5, 5, 4, '#f0d692');
      rect(c, 5, -5, 5, 4, '#f0d692');
    } else if (kind === 'runner') {
      polygon(
        c,
        [
          [-22, 5],
          [-31, -7],
          [-18, -7],
          [-9, -19],
          [11, -19],
          [26, -6],
          [19, 7],
          [5, 16],
          [-15, 12],
        ],
        base,
        dark,
        4,
      );
      polygon(
        c,
        [
          [-2, -14],
          [15, -12],
          [23, -5],
          [10, -2],
        ],
        light,
      );
      rect(c, 13, -8, 5, 3, '#ffe4ab');
      line(c, -12, 10, -23, 22, base, 6);
      line(c, 8, 12, 16, 21, base, 6);
      line(c, -23, 22, -29, 22, light, 3);
      line(c, 16, 21, 24, 21, light, 3);
    } else if (kind === 'armored' || kind === 'elite') {
      rect(c, -17, 18, 11, 10, dark);
      rect(c, 6, 18, 11, 10, dark);
      polygon(
        c,
        [
          [-22, -17],
          [-10, -27],
          [10, -27],
          [22, -17],
          [24, 14],
          [13, 25],
          [-13, 25],
          [-24, 14],
        ],
        base,
        dark,
        4,
      );
      polygon(
        c,
        [
          [-22, -17],
          [-9, -21],
          [-8, 17],
          [-22, 14],
        ],
        light,
      );
      rect(c, -12, -23, 24, 18, '#364f55');
      rect(c, -8, -16, 16, 4, kind === 'elite' ? '#ffc77d' : '#e6d39c');
      rect(c, -16, -2, 32, 5, '#a69c7b');
      diamond(c, 0, 11, 9, light);
      line(c, 0, 0, 0, 22, '#344b50', 3);
      if (kind === 'elite') {
        polygon(
          c,
          [
            [-22, -20],
            [-28, -37],
            [-10, -27],
            [0, -39],
            [10, -27],
            [28, -37],
            [22, -20],
          ],
          '#bd9361',
          dark,
          3,
        );
        diamond(c, 0, -25, 6, '#ffdda1');
      }
    } else if (kind === 'ranged') {
      polygon(
        c,
        [
          [-8, -21],
          [7, -21],
          [13, -9],
          [20, 22],
          [-20, 22],
          [-13, -9],
        ],
        base,
        dark,
        4,
      );
      polygon(
        c,
        [
          [-8, -21],
          [0, -29],
          [10, -17],
          [10, -5],
          [-11, -5],
        ],
        '#4d4659',
        dark,
        3,
      );
      rect(c, -6, -16, 13, 5, '#f5c5b3');
      rect(c, -2, -16, 4, 5, '#d56369');
      line(c, -24, 24, -24, -23, '#bba888', 4);
      diamond(c, -24, -25, 8, '#ef9c9c');
      line(c, -14, 1, -24, 4, light, 5);
      rect(c, -9, 19, 5, 8, '#ccb6a2');
      rect(c, 6, 19, 5, 8, '#ccb6a2');
    } else if (kind === 'support') {
      polygon(
        c,
        [
          [-14, 21],
          [-17, 2],
          [-11, -16],
          [0, -25],
          [11, -16],
          [17, 2],
          [14, 21],
        ],
        base,
        dark,
        4,
      );
      circle(c, 0, -16, 18, light, 3);
      rect(c, -7, -14, 14, 10, '#293f3e');
      rect(c, -5, -12, 3, 3, '#e2efb7');
      rect(c, 3, -12, 3, 3, '#e2efb7');
      diamond(c, 0, 6, 10, '#cee0a4');
      line(c, -23, 0, -13, 4, light, 5);
      line(c, 13, 4, 23, 0, light, 5);
      diamond(c, -24, -2, 5, light);
      diamond(c, 24, -2, 5, light);
    } else if (kind === 'splitter') {
      polygon(
        c,
        [
          [-23, 15],
          [-26, -4],
          [-13, -18],
          [5, -24],
          [21, -12],
          [27, 5],
          [17, 24],
          [-9, 26],
        ],
        base,
        dark,
        4,
      );
      polygon(
        c,
        [
          [-15, -8],
          [-10, -15],
          [5, -19],
          [14, -11],
          [6, -4],
          [-4, -1],
        ],
        light,
      );
      circle(c, -5, 12, 5, '#566e4e', 3);
      circle(c, 15, 4, 4, '#566e4e', 3);
      rect(c, -12, -5, 4, 4, '#f1ebac');
      rect(c, 4, -8, 4, 4, '#f1ebac');
      line(c, -2, -14, 1, -3, dark, 3);
      line(c, 1, -3, -5, 10, dark, 3);
    } else {
      for (const side of [-1, 1]) {
        polygon(
          c,
          [
            [side * 13, -17],
            [side * 26, -36],
            [side * 32, -39],
            [side * 29, -19],
            [side * 37, -5],
            [side * 28, 15],
            [side * 16, 10],
          ],
          base,
          dark,
          4,
        );
        line(c, side * 16, 19, side * 28, 34, light, 7);
      }
      polygon(
        c,
        [
          [-23, -11],
          [-15, -30],
          [0, -36],
          [15, -30],
          [23, -11],
          [22, 20],
          [0, 34],
          [-22, 20],
        ],
        base,
        dark,
        4,
      );
      polygon(
        c,
        [
          [-13, -22],
          [0, -30],
          [13, -22],
          [10, -6],
          [-10, -6],
        ],
        '#362c42',
      );
      rect(c, -11, -19, 7, 5, '#ffd4b2');
      rect(c, 4, -19, 7, 5, '#ffd4b2');
      diamond(c, 0, 6, 16, '#d7929c', '#edc1ab');
      diamond(c, 0, 6, 7, '#fff0cb');
      line(c, -11, 22, 11, 22, '#513a50', 3);
    }
    this.sprites.set(kind, canvas);
    return canvas;
  }

  private enemy(c: Context, e: Enemy, time: number, settings: Settings) {
    const radius = e.radius || 12,
      size = radius * 3.2,
      bob = settings.reducedMotion || e.stun > 0 ? 0 : Math.sin(time * e.speed * 0.11 + e.id) * 1.5;
    c.fillStyle = '#03171c66';
    c.beginPath();
    c.ellipse(e.x, e.y + radius * 0.7, radius * 0.95, radius * 0.36, 0, 0, TAU);
    c.fill();
    if (e.kind === 'ranged' && e.attackCd < 0.6) {
      c.save();
      c.setLineDash([5, 7]);
      line(c, e.x, e.y, CX, CY, '#f69a8d88', 1);
      c.setLineDash([]);
      circle(c, e.x, e.y, radius + 7, '#ffc6a4', 2);
      rune(c, e.x, e.y - radius - 16, 7, '#ffc6a4', 0);
      c.restore();
    }
    c.save();
    c.translate(e.x, e.y + bob);
    if (e.kind === 'runner' && e.x > CX) c.scale(-1, 1);
    c.drawImage(this.enemySprite(e.kind), -size / 2, -size / 2, size, size);
    c.restore();
    if (e.chill > 0) {
      circle(c, e.x, e.y, radius + 3, '#a6e8f0aa', 1);
      diamond(c, e.x - radius, e.y, 3, '#c6f5f2');
    }
    if (e.burn > 0) {
      for (let i = 0; i < 2; i++) {
        const x = e.x + (i ? 1 : -1) * radius * 0.6;
        polygon(
          c,
          [
            [x - 3, e.y],
            [x, e.y - 8 - Math.sin(time * 8 + i) * 3],
            [x + 4, e.y + 1],
          ],
          '#ffad69',
        );
      }
    }
    if (e.poison > 0) {
      rect(c, e.x - radius, e.y + 4, 3, 3, '#bddd78');
      rect(c, e.x + radius - 2, e.y - 4, 3, 3, '#bddd78');
    }
    if (e.mark > 0) {
      circle(c, e.x, e.y, radius + 5, '#e7b2f2aa', 1);
      line(c, e.x - 4, e.y - radius - 8, e.x + 4, e.y - radius - 8, '#f1c5fa', 2);
    }
    if (e.stun > 0) {
      rune(c, e.x, e.y - radius - 9, 5, '#f5dc96', 2);
    }
    if (e.hp < e.maxHp || e.kind === 'boss' || e.kind === 'elite') {
      const w = Math.max(18, radius * 2.4),
        y = e.y - radius - 9;
      rect(c, e.x - w / 2 - 1, y - 1, w + 2, 5, '#0a1c21');
      rect(
        c,
        e.x - w / 2,
        y,
        w * clamp(e.hp / e.maxHp, 0, 1),
        3,
        e.kind === 'boss' ? '#edb0ba' : '#c3aa83',
      );
    }
  }

  private projectile(c: Context, p: Projectile, time: number, settings: Settings) {
    const color = ELEMENT[p.element],
      r = clamp(p.radius, 2, 12),
      speed = Math.hypot(p.vx, p.vy) || 1,
      dx = p.vx / speed,
      dy = p.vy / speed;
    c.save();
    c.translate(p.x, p.y);
    if (settings.effects === 'high') {
      c.shadowColor = color;
      c.shadowBlur = p.surge ? 13 : 6;
    }
    if (p.pattern === 'mine') {
      c.save();
      c.rotate(time * 0.8 + p.id);
      diamond(c, 0, 0, r + 5, '#132a31', color);
      rune(c, 0, 0, r, color, p.id);
      c.restore();
      circle(c, 0, 0, r + 9, color + '55');
    } else if (p.pattern === 'orbit') {
      circle(c, 0, 0, r + 3, color + '99', 1);
      diamond(c, 0, 0, r, color);
      rect(c, -1, -2, 2, 4, '#fff5d5');
    } else {
      line(c, -dx * (r + 9), -dy * (r + 9), 0, 0, color + '66', r * 0.85);
      if (p.element === 'fire') {
        polygon(
          c,
          [
            [-dx * 13 - dy * 3, -dy * 13 + dx * 3],
            [dx * r - dy * r * 0.5, dy * r + dx * r * 0.5],
            [dx * (r + 2), dy * (r + 2)],
            [dx * r + dy * r * 0.5, dy * r - dx * r * 0.5],
          ],
          color,
        );
        diamond(c, 0, 0, r * 0.7, '#ffe5a6');
      } else if (p.element === 'lightning') {
        c.rotate(Math.atan2(p.vy, p.vx));
        polygon(
          c,
          [
            [-10, -3],
            [-2, -3],
            [-3, -7],
            [10, 0],
            [2, 0],
            [3, 5],
          ],
          color,
        );
        line(c, -2, 0, 6, 0, '#fff3ef', 2);
      } else if (p.element === 'frost') {
        c.rotate(Math.atan2(p.vy, p.vx) + Math.PI / 2);
        diamond(c, 0, 0, r + 2, color, '#d7ffff');
        line(c, 0, -r, 0, r, '#eaffff', 1);
      } else if (p.element === 'poison') {
        rect(c, -r, -r, r * 2, r * 2, color);
        rect(c, -r + 2, -r + 2, r, 3, '#efffc0');
        rect(c, -2, r, 4, 3, '#527e49');
      } else if (p.element === 'solar') {
        diamond(c, 0, 0, r + 3, color);
        diamond(c, 0, 0, r * 0.55, '#fff8d4');
        line(c, -r - 3, 0, r + 3, 0, '#ffe9b2', 1);
      } else {
        diamond(c, 0, 0, r + 2, '#b88ad5', color);
        diamond(c, 0, 0, r * 0.7, '#20203c');
      }
    }
    if (p.modifier === 'echo') circle(c, 0, 0, r + 6, color + '66');
    c.restore();
  }

  private visual(c: Context, v: Visual, settings: Settings) {
    const fraction = clamp(v.life / (v.maxLife || 1), 0, 1),
      progress = 1 - fraction,
      color = v.color;
    c.save();
    c.globalAlpha = Math.min(1, fraction * 2);
    c.strokeStyle = color;
    c.fillStyle = color;
    if (v.kind === 'text' || v.kind === 'synergy') {
      c.font = `${v.kind === 'synergy' ? '600 15' : '600 12'}px ui-monospace, monospace`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineWidth = 4;
      c.strokeStyle = '#102329';
      const y = v.y - (settings.reducedMotion ? 0 : progress * 22);
      c.strokeText(v.text || '', v.x, y);
      c.fillText(v.text || '', v.x, y);
      if (v.kind === 'synergy') {
        line(c, v.x - 53, y + 15, v.x + 53, y + 15, color + '88', 1);
        diamond(c, v.x - 61, y + 15, 3, color);
        diamond(c, v.x + 61, y + 15, 3, color);
      }
    } else if (v.kind === 'beam' || v.kind === 'chain') {
      const x2 = v.x2 ?? CX,
        y2 = v.y2 ?? CY;
      if (v.kind === 'beam') {
        line(c, v.x, v.y, x2, y2, color, Math.max(2, v.size * fraction));
        line(c, v.x, v.y, x2, y2, '#fff5de', Math.max(1, v.size * fraction * 0.25));
      } else {
        c.beginPath();
        c.moveTo(v.x, v.y);
        const dx = x2 - v.x,
          dy = y2 - v.y,
          d = Math.hypot(dx, dy) || 1;
        for (let i = 1; i < 9; i++) {
          const offset = (hash(i * 13 + Math.floor(v.x)) - 0.5) * 21;
          c.lineTo(v.x + (dx * i) / 9 - (dy / d) * offset, v.y + (dy * i) / 9 + (dx / d) * offset);
        }
        c.lineTo(x2, y2);
        c.lineWidth = 3;
        c.stroke();
        c.strokeStyle = '#fff5eb';
        c.lineWidth = 1;
        c.stroke();
      }
    } else if (v.kind === 'ring') {
      const r = Math.max(1, v.size * (0.4 + progress * 0.6));
      circle(c, v.x, v.y, r, color, Math.max(1, 4 * fraction));
      if (settings.effects === 'high') circle(c, v.x, v.y, r * 0.9, color + '66', 1);
    } else if (v.kind === 'hazard') {
      c.globalAlpha = 0.15 + fraction * 0.25;
      c.fillStyle = color;
      c.beginPath();
      c.arc(v.x, v.y, v.size, 0, TAU);
      c.fill();
      c.globalAlpha = 0.75;
      c.setLineDash([7, 7]);
      circle(c, v.x, v.y, v.size, color, 2);
      c.setLineDash([]);
      rune(c, v.x, v.y, 14, color, 1);
    } else {
      const count = settings.effects === 'high' ? 7 : 3;
      for (let i = 0; i < count; i++) {
        const a = hash(i * 47 + Math.floor(v.x + v.y)) * TAU,
          r = progress * v.size;
        const x = v.x + Math.cos(a) * r,
          y = v.y + Math.sin(a) * r;
        rect(c, x, y, Math.max(1, 4 * fraction), Math.max(1, 4 * fraction), color);
      }
      if (fraction > 0.6) diamond(c, v.x, v.y, v.size * 0.35 * fraction, '#fff2ce');
    }
    c.restore();
  }
}
