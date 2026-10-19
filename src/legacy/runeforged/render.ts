import { ArenaRenderer } from '../../render/arena';
import type { Enemy, RunState as LegacyRun, Settings, TowerId } from '../../model/shared';
import type { AreaEffect, Element, ProjectileV2, RunV2, SettingsV2, VisualV2 } from '../../model/arsenal';

const W = 1000, H = 800, CX = 500, CY = 400, TAU = Math.PI * 2;
const COLORS: Record<Element, string> = {
  fire: '#ff9864', frost: '#9ce8f1', lightning: '#b9bbff',
  poison: '#b0dc76', solar: '#ffe0a0', void: '#d5a5f4',
};
const TOWERS: Record<TowerId, string> = {
  bastion: '#d9c28b', pyre: COLORS.fire, tempest: COLORS.lightning,
  glacier: COLORS.frost, verdant: COLORS.poison, null: COLORS.void,
  monolith: '#c2e3db',
};
type Ctx = CanvasRenderingContext2D;
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const hash = (n: number) => { const a = Math.sin(n * 127.1 + 311.7) * 43758.5453; return a - Math.floor(a); };
function circle(c: Ctx, x: number, y: number, r: number, color: string, width = 1) {
  c.beginPath(); c.arc(x, y, Math.max(.1, r), 0, TAU); c.strokeStyle = color; c.lineWidth = width; c.stroke();
}
function line(c: Ctx, x: number, y: number, x2: number, y2: number, color: string, width = 1) {
  c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.strokeStyle = color; c.lineWidth = width; c.stroke();
}
function poly(c: Ctx, points: number[][], fill: string, stroke?: string, width = 1) {
  c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath();
  c.fillStyle = fill; c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
}
function gem(c: Ctx, r: number, fill: string, rim = '#fff3d9') {
  poly(c, [[r, 0], [0, -r * .65], [-r, 0], [0, r * .65]], fill, rim, 1.2);
}

// ArenaRenderer owns the original pixel art. This narrow bridge reuses its cached
// scenery and sprite painters without duplicating those assets or legacy shots.
// Keep it here so any change to those painter signatures has one integration point.
interface PixelScene {
  background: HTMLCanvasElement | null;
  tower(c: Ctx, id: TowerId, time: number, buff: boolean, glow: boolean): void;
  enemy(c: Ctx, e: Enemy, time: number, settings: Settings): void;
}

/** Canvas-only presentation; all combat dimensions and timings come from state. */
export class BattleRenderer {
  private readonly ctx: Ctx;
  private readonly legacy: ArenaRenderer;
  private readonly scratch: HTMLCanvasElement;
  private readonly pixel: PixelScene;
  private readonly glows = new Map<string, HTMLCanvasElement>();
  private readonly resizeObserver: ResizeObserver | null;
  private stage = -1;
  private seed = -1;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private intensity = 1;
  private detail = true;
  private motion = true;
  private time = 0;
  private terrainPattern: CanvasPattern | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas2D is unavailable');
    this.ctx = ctx;
    this.scratch = document.createElement('canvas');
    this.legacy = new ArenaRenderer(this.scratch);
    this.pixel = this.legacy as unknown as PixelScene;
    this.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.resize());
    this.resizeObserver?.observe(canvas);
    this.resize();
  }

  resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width || this.canvas.parentElement?.clientWidth || W);
    const height = Math.max(1, bounds.height || this.canvas.parentElement?.clientHeight || H);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(width * dpr), h = Math.round(height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.scale = Math.min(w / W, h / H);
    this.offsetX = (w - W * this.scale) / 2;
    this.offsetY = (h - H * this.scale) / 2;
    this.ctx.imageSmoothingEnabled = false;
  }

  draw(s: RunV2 | LegacyRun, settings: SettingsV2): void {
    const c = this.ctx;
    this.detail = settings.effects === 'high';
    this.motion = !settings.reducedMotion;
    this.time = this.motion ? s.time : 0;
    this.intensity = settings.intensity === 'subtle' ? .48 : settings.intensity === 'spectacular' ? 1.12 : .76;
    if (s.version === 1) {
      // A resumed v1 run retains its original presentation and mechanics.
      this.legacy.draw(s, settings);
      this.prepareTerrain();
      this.begin(c);
      this.drawTerrain(c);
      c.drawImage(this.scratch, 0, 0, W, H);
      c.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }
    if (this.stage !== s.stage || this.seed !== s.seed || !this.pixel.background) {
      const adapter = {
        ...s, version: 1, enemies: [], projectiles: [], visuals: [],
        attacks: [], buff: 0, stasis: 0, shield: 0,
      } as unknown as LegacyRun;
      this.legacy.draw(adapter, { ...settings, effects: 'low' });
      this.stage = s.stage; this.seed = s.seed;
      this.prepareTerrain();
    }
    this.begin(c);
    if (this.motion && settings.shake) {
      const shock = s.visuals.find(v => /^(retaliation|shield-break|impact)$/.test(v.kind)
        && v.maxLife - v.life < .1 && Math.hypot(v.x - CX, v.y - CY) < 100);
      if (shock) c.translate(Math.sin(s.time * 73) * 1.6, Math.cos(s.time * 89) * 1.6);
    }
    this.drawTerrain(c);
    this.environment(c, s);
    // All fields and luminous energy sit beneath the pixel combatants. Hit
    // feedback and text are a separate, crisp final pass.
    for (const a of s.areas) this.area(c, a);
    for (const v of s.visuals) if (!this.isForeground(v)) this.visual(c, v);
    for (const p of s.projectiles) this.projectile(c, p);
    this.evolution(c, s);
    this.pixel.tower(c, s.tower, this.time, s.buffs.length > 0, false);
    const enemies = s.enemies.length > 1 ? [...s.enemies].sort((a, b) => a.y - b.y) : s.enemies;
    for (const enemy of enemies) this.pixel.enemy(c, enemy, this.time, settings);
    if (s.shield > 0) this.shield(c, CX, CY - 15, 61, TOWERS[s.tower], clamp(s.shield / s.maxHp));
    // Enemy warnings stay visible even when a meteor or a large orb crosses them.
    for (const e of enemies) {
      if (e.kind === 'boss') { c.globalAlpha = .8; circle(c, e.x, e.y, e.radius + 6, '#f2a8a0', 1.5); c.globalAlpha = 1; }
      if (e.kind === 'ranged' && e.attackCd < .6) {
        c.setLineDash([4, 8]); line(c, e.x, e.y, CX, CY, '#f4c0a4', 1); c.setLineDash([]);
      }
    }
    for (const a of s.areas) if (a.delay > 0) this.warning(c, a);
    for (const v of s.visuals) if (this.isForeground(v)) this.visual(c, v);
    this.coreBars(c, s);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.shadowBlur = 0;
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.legacy.dispose(); this.glows.clear(); this.terrainPattern = null;
    this.scratch.width = this.scratch.height = 1;
  }

  private begin(c: Ctx) {
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#0b2022'; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
    c.lineCap = 'round'; c.lineJoin = 'round';
  }
  private prepareTerrain() { this.terrainPattern = this.pixel.background ? this.ctx.createPattern(this.pixel.background, 'repeat') : null; }
  private drawTerrain(c: Ctx) {
    // Repeat only scenery into the extra viewport, never stretch combat geometry.
    const x = -this.offsetX / this.scale, y = -this.offsetY / this.scale;
    c.fillStyle = this.terrainPattern || '#102b2b';
    c.fillRect(x, y, this.canvas.width / this.scale, this.canvas.height / this.scale);
    if (this.pixel.background) c.drawImage(this.pixel.background, 0, 0, W, H);
  }
  private glow(c: Ctx, x: number, y: number, r: number, color: string, alpha = .4) {
    if (r < 1 || alpha <= 0) return;
    let sprite = this.glows.get(color);
    if (!sprite) {
      sprite = document.createElement('canvas'); sprite.width = sprite.height = 96;
      const g = sprite.getContext('2d')!, gradient = g.createRadialGradient(48, 48, 1, 48, 48, 48);
      gradient.addColorStop(0, color); gradient.addColorStop(.24, color); gradient.addColorStop(1, 'transparent');
      g.fillStyle = gradient; g.fillRect(0, 0, 96, 96);
      // Color space is small (six elements plus fixed engine feedback colors).
      if (this.glows.size < 48) this.glows.set(color, sprite);
    }
    c.save(); c.globalAlpha *= alpha * this.intensity;
    c.drawImage(sprite, x - r, y - r, r * 2, r * 2); c.restore();
  }
  private environment(c: Ctx, s: RunV2) {
    const color = TOWERS[s.tower];
    this.glow(c, CX, CY, 190, color, .055);
    c.save(); c.globalAlpha = .16;
    for (let i = 0; i < 4; i++) {
      const a = i * TAU / 4;
      const x = CX + Math.cos(a) * 304, y = CY + Math.sin(a) * 304;
      circle(c, x, y, 11, '#c9b683', 2);
      line(c, x - 4, y, x + 4, y, '#b6d4bb', 2);
      line(c, x, y - 4, x, y + 4, '#b6d4bb', 2);
    }
    c.restore();
    if (!this.detail) return;
    for (let i = 0; i < 12; i++) {
      const a = hash(i + s.seed) * TAU, r = 130 + hash(i + 11) * 310;
      const y = CY + Math.sin(a) * r - (this.time * 5 + i * 7) % 22;
      c.globalAlpha = (.09 + Math.sin(this.time + i) * .04) * this.intensity;
      c.fillStyle = '#b9c6a1'; c.fillRect(CX + Math.cos(a) * r, y, 1.5, 1.5);
    }
    c.globalAlpha = 1;
  }

  private projectile(c: Ctx, p: ProjectileV2) {
    const primary = COLORS[p.elements[0]] || '#d0dfc5';
    const rim = COLORS[p.elements[1]] || '#fff1cf';
    const r = Math.max(2, p.radius), age = p.maxLife - p.life;
    const pulse = p.pulseInterval > 0 ? (age % p.pulseInterval) / p.pulseInterval : 0;
    const speed = Math.hypot(p.vx, p.vy), angle = speed > 1 ? Math.atan2(p.vy, p.vx) : this.time + p.seed;
    this.glow(c, p.x, p.y, r * 3 + 10, primary, this.detail ? .24 : .11);
    c.save(); c.translate(p.x, p.y); c.rotate(angle);
    const trail = Math.min(70, Math.max(r * 1.8, speed * .065));
    if (speed > 15 && p.kind !== 'mine' && p.kind !== 'orbit') {
      c.globalAlpha = .24;
      c.beginPath(); c.moveTo(-trail, -r * .5); c.quadraticCurveTo(-trail * .4, -r * .9, 0, 0);
      c.quadraticCurveTo(-trail * .5, r * .65, -trail, r * .45);
      c.strokeStyle = primary; c.lineWidth = Math.max(1, r * .24); c.stroke();
      if (this.detail && r > 9) {
        c.beginPath(); c.moveTo(-trail * 1.4, r); c.quadraticCurveTo(-trail * .6, r * 1.4, r * .3, r * .8);
        c.strokeStyle = rim; c.lineWidth = 1; c.stroke();
      }
      c.globalAlpha = 1;
    }
    c.lineWidth = 1.5;
    switch (p.kind) {
      case 'bolt': gem(c, r * 1.25, primary, rim); line(c, -r * .7, 0, r * .7, 0, '#fff8df', 1.5); break;
      case 'volley':
        poly(c, [[r * 1.5, 0], [-r, -r * .7], [-r * .45, 0], [-r, r * .7]], primary, rim);
        line(c, -r * 1.5, -r * .6, -r * .5, 0, rim); line(c, -r * 1.5, r * .6, -r * .5, 0, rim); break;
      case 'spiral': {
        c.rotate(this.time * 2 + p.seed); circle(c, 0, 0, r, primary, 2);
        for (let i = 0; i < 3; i++) { c.rotate(TAU / 3); c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(r * 1.8, -r, r, r * .4); c.strokeStyle = i === 1 ? rim : primary; c.stroke(); }
        gem(c, r * .4, rim, primary); break;
      }
      case 'beam': case 'rail':
        line(c, -r * 3, 0, r * 2.5, 0, primary, p.kind === 'rail' ? r * .7 : r);
        line(c, -r * 2, 0, r * 2.5, 0, rim, Math.max(1.5, r * .22));
        if (p.kind === 'rail') { line(c, -r * 2, -r, r, -r, primary); line(c, -r * 2, r, r, r, primary); } break;
      case 'orbit':
        c.rotate(this.time * 1.3); circle(c, 0, 0, r * 1.4, rim, 1);
        gem(c, r, primary, rim); c.rotate(Math.PI / 2); gem(c, r * .7, '#213c40', primary); break;
      case 'pulse': case 'singularity': {
        const rr = r * (this.motion ? 1 + Math.sin(pulse * TAU) * .025 : 1);
        c.beginPath(); c.arc(0, 0, rr, 0, TAU); c.fillStyle = p.kind === 'singularity' ? '#142032' : primary; c.fill();
        circle(c, 0, 0, rr, rim, 2); circle(c, 0, 0, rr * .72, primary, 1.2);
        c.save(); c.rotate(this.time * .6); c.scale(1.3, .45); circle(c, 0, 0, r * 1.35, rim, 2); c.restore();
        if (p.pulseInterval > 0) { c.globalAlpha = (1 - pulse) * .55; circle(c, 0, 0, r * (1 + (this.motion ? pulse : .2) * .8), primary, 1.8); c.globalAlpha = 1; }
        if (p.kind === 'pulse') { c.beginPath(); c.arc(-r * .25, -r * .28, r * .24, 0, TAU); c.fillStyle = '#fff5db'; c.fill(); }
        break;
      }
      case 'swarm':
        poly(c, [[r, 0], [-r * .9, -r * .55], [-r * .4, 0], [-r * .9, r * .55]], primary, rim);
        line(c, -r * .3, 0, -r * 1.2, -r, rim); line(c, -r * .3, 0, -r * 1.2, r, rim); break;
      case 'mine':
        c.rotate(-angle + this.time * .25 + p.seed); this.rune(c, 0, 0, r + 5, primary, 6);
        gem(c, r, '#193034', primary); gem(c, r * .45, rim, primary);
        c.globalAlpha = .35; circle(c, 0, 0, r + 10, primary); c.globalAlpha = 1; break;
      case 'ricochet':
        poly(c, [[r * 1.3, 0], [0, -r], [-r, -r * .45], [-r, r * .45], [0, r]], '#274548', primary, 2);
        gem(c, r * .55, primary, rim); break;
      case 'chakram':
        c.rotate(this.time * 5); circle(c, 0, 0, r, primary, 3); circle(c, 0, 0, r * .58, rim, 1.5);
        for (let i = 0; i < 4; i++) { c.rotate(TAU / 4); poly(c, [[r * .8, 0], [r * 1.4, -r * .55], [r * .4, -r * .9]], primary, rim); } break;
      case 'flame':
        poly(c, [[r * 1.4, 0], [-r * .1, -r], [-r * .5, -r * .35], [-r * 1.7, -r * .5], [-r, 0], [-r * 1.6, r * .6], [-r * .1, r]], primary);
        gem(c, r * .55, rim, '#fff2cb'); break;
      case 'tesla':
        this.lightning(c, -r * 2, 0, r * 2, 0, primary, p.seed, 2.5); gem(c, r * .5, rim, primary); break;
      case 'drone':
        poly(c, [[-r, -r * .5], [r * .7, -r * .5], [r * 1.1, 0], [r * .7, r * .5], [-r, r * .5]], '#284446', '#d2be88', 2);
        gem(c, r * .5, primary, rim);
        for (const y of [-r, r]) { line(c, -r * .9, y, r * .4, y, '#b9ad83', 2); circle(c, -r * .3, y, r * .55, primary); } break;
      case 'meteor':
        poly(c, [[-r * 3, -r], [-r, -r * .8], [r, -r * .5], [r * 1.2, r * .4], [0, r], [-r * 3.5, r * .5], [-r, 0]], primary);
        poly(c, [[-r, -r * .5], [0, -r], [r, -.2 * r], [.6 * r, r], [-r * .6, r]], '#77544a', rim, 1.5); break;
    }
    // A second infusion is a separate rotating element lattice, not a recolor.
    if (p.elements.length > 1) {
      c.rotate(-angle + this.time * .8); c.globalAlpha = .8;
      for (let i = 0; i < p.elements.length - 1; i++) {
        const a = i * TAU / Math.max(2, p.elements.length - 1);
        const x = Math.cos(a) * r * 1.2, y = Math.sin(a) * r * 1.2;
        line(c, x * .45, y * .45, x, y, COLORS[p.elements[i + 1]], 1.3);
        c.save(); c.translate(x, y); gem(c, Math.max(2, r * .24), COLORS[p.elements[i + 1]], '#edf5d6'); c.restore();
      }
    }
    if (p.critical) { c.globalAlpha = .85; circle(c, 0, 0, r + 3, '#fff0c4', 1); }
    c.restore();
  }

  private warning(c: Ctx, a: AreaEffect) {
    const r = a.radius;
    c.save(); c.globalAlpha = .95; c.setLineDash([8, 5]);
    circle(c, a.x, a.y, r, '#ffc58a', 2); c.setLineDash([]);
    circle(c, a.x, a.y, r * .76, '#ffc58a', 1);
    line(c, a.x - 9, a.y, a.x + 9, a.y, '#fff2ca', 2);
    line(c, a.x, a.y - 9, a.x, a.y + 9, '#fff2ca', 2);
    for (let i = 0; i < 4; i++) {
      const t = i * TAU / 4;
      line(c, a.x + Math.cos(t) * (r + 4), a.y + Math.sin(t) * (r + 4), a.x + Math.cos(t) * (r + 10), a.y + Math.sin(t) * (r + 10), '#ffe0ac', 2);
    }
    c.restore();
  }
  private area(c: Ctx, a: AreaEffect) {
    if (a.delay > 0) {
      if (a.kind === 'meteor') {
        const descent = clamp(1 - a.delay / .9);
        const height = this.motion ? (1 - descent) * 235 : 85;
        const x = a.x - height * .55, y = a.y - height;
        this.glow(c, x, y, 50, COLORS.fire, .38);
        c.save(); c.globalAlpha = .85;
        const comet = c.createLinearGradient(x - 70, y - 125, x, y);
        comet.addColorStop(0, 'transparent'); comet.addColorStop(1, COLORS.fire);
        poly(c, [[x - 85, y - 140], [x + 9, y - 5], [x, y + 10], [x - 12, y + 3]], comet as unknown as string);
        c.translate(x, y); gem(c, 10 + a.radius * .08, '#ffe2ab', COLORS.fire); c.restore();
      }
      return;
    }
    const color = COLORS[a.element] || COLORS.void, r = a.radius;
    const fade = clamp(a.life / Math.min(1, a.maxLife));
    c.save(); c.globalAlpha = fade;
    this.glow(c, a.x, a.y, r * 1.3, color, .15);
    c.globalAlpha *= .13; c.fillStyle = color;
    c.beginPath(); c.arc(a.x, a.y, r, 0, TAU); c.fill(); c.globalAlpha = fade;
    c.save(); c.translate(a.x, a.y); c.rotate(this.time * .1 + a.id);
    c.globalAlpha *= .6; circle(c, 0, 0, r, color, 1.5);
    c.setLineDash([r * .12, r * .08]); circle(c, 0, 0, r * .79, color, 1); c.setLineDash([]); c.restore();
    const count = this.detail ? 10 : 4;
    if (a.kind === 'frost') {
      for (let i = 0; i < count; i++) {
        const angle = hash(a.id + i) * TAU, distance = Math.sqrt(hash(i + 81)) * r * .85;
        const x = a.x + Math.cos(angle) * distance, y = a.y + Math.sin(angle) * distance;
        const h = 8 + hash(i + 18) * 17;
        poly(c, [[x - 4, y + 2], [x - 3, y - h * .6], [x + 1, y - h], [x + 5, y]], '#558e9b', color);
        line(c, x + 1, y - h, x + 1, y, '#d7f9ed', 1);
      }
    } else if (a.kind === 'poison') {
      for (let i = 0; i < count; i++) {
        const phase = (this.time * .24 + hash(i + a.id)) % 1;
        const x = a.x + (hash(i * 17 + a.id) - .5) * r * 1.5;
        const y = a.y + (hash(i * 31) - .5) * r - phase * 25;
        c.globalAlpha = fade * (1 - phase) * .3;
        circle(c, x, y, 5 + phase * 10, color, 1.5);
      }
    } else if (a.kind === 'fire' || a.kind === 'meteor' || a.kind === 'solar') {
      if (a.kind === 'meteor') {
        c.globalAlpha = fade * .8;
        circle(c, a.x, a.y, r * .55, '#332c29', 8);
        circle(c, a.x, a.y, r * .59, '#b67750', 2);
      }
      for (let i = 0; i < count; i++) {
        const angle = i * TAU / count + hash(a.id), distance = r * (.4 + hash(i + 8) * .4);
        const x = a.x + Math.cos(angle) * distance, y = a.y + Math.sin(angle) * distance;
        const h = 5 + (1 + Math.sin(this.time * 5 + i)) * 5;
        c.globalAlpha = fade * .8;
        poly(c, [[x - 3, y], [x, y - h], [x + 4, y]], i % 3 ? color : '#ffe4ae');
      }
    } else if (a.kind === 'storm') {
      for (let i = 0; i < (this.detail ? 3 : 1); i++) {
        const angle = this.time * .5 + i * TAU / 3, x = a.x + Math.cos(angle) * r * .8, y = a.y + Math.sin(angle) * r * .8;
        c.globalAlpha = .5 * fade; this.lightning(c, a.x, a.y, x, y, color, a.id + i, 1.5);
      }
    } else {
      c.globalAlpha = .6 * fade;
      this.rune(c, a.x, a.y, r * .62, color, 8, this.time * .15);
      if (a.kind === 'void') { c.save(); c.translate(a.x, a.y); c.rotate(this.time * -.2); c.scale(1, .45); circle(c, 0, 0, r * .9, '#e5c3ed', 2); c.restore(); }
    }
    c.restore();
  }

  private isForeground(v: VisualV2) { return /^(text|synergy|hit|impact|reflect|thorns|retaliation|shield|shield-break|evolution)$/.test(v.kind); }
  private visual(c: Ctx, v: VisualV2) {
    const f = clamp(v.life / Math.max(.001, v.maxLife)), p = 1 - f;
    const r = Math.max(2, v.size), color = v.color || '#d9e7c6';
    c.save(); c.globalAlpha = Math.min(1, f * 2);
    if (v.kind === 'text' || v.kind === 'synergy') {
      c.font = `${v.kind === 'synergy' ? 600 : 500} ${v.kind === 'synergy' ? 14 : 11}px ui-monospace, monospace`;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 3; c.strokeStyle = '#081c22'; c.fillStyle = color;
      const y = v.y - (this.motion ? p * 22 : 0);
      c.strokeText(v.text || '', v.x, y); c.fillText(v.text || '', v.x, y);
    } else if (/^(beam|rail|flame|ray)$/.test(v.kind)) {
      const x2 = v.x2 ?? CX, y2 = v.y2 ?? CY, width = Math.max(1.5, r * f);
      c.globalAlpha *= .16 * this.intensity; line(c, v.x, v.y, x2, y2, color, width * 3);
      c.globalAlpha = Math.min(1, f * 2); line(c, v.x, v.y, x2, y2, color, width);
      line(c, v.x, v.y, x2, y2, v.secondaryColor || '#fff3d9', Math.max(1, width * .22));
      if (v.kind === 'rail') {
        const dx = x2 - v.x, dy = y2 - v.y, length = Math.hypot(dx, dy) || 1;
        const nx = -dy / length * (width + 3), ny = dx / length * (width + 3);
        line(c, v.x + nx, v.y + ny, x2 + nx, y2 + ny, color, 1);
        line(c, v.x - nx, v.y - ny, x2 - nx, y2 - ny, color, 1);
      }
    } else if (/^(chain|tesla|lightning)$/.test(v.kind)) {
      this.lightning(c, v.x, v.y, v.x2 ?? CX, v.y2 ?? CY, color, v.seed ?? v.x + v.y, Math.max(1.5, r * .2));
    } else if (v.kind === 'hazard') {
      c.globalAlpha *= .12; c.beginPath(); c.arc(v.x, v.y, r, 0, TAU); c.fillStyle = color; c.fill();
      c.globalAlpha = .9; c.setLineDash([6, 5]); circle(c, v.x, v.y, r, color, 2); c.setLineDash([]);
    } else if (v.kind === 'shield' || v.kind === 'shield-break') {
      this.shield(c, v.x, v.y, r * (v.kind === 'shield-break' ? 1 + p * .25 : 1), color, f);
    } else if (v.kind === 'reflect') {
      c.translate(v.x, v.y); c.rotate(Math.atan2((v.y2 ?? CY) - v.y, (v.x2 ?? CX) - v.x));
      poly(c, [[r * .6, -r], [r, 0], [r * .6, r], [-r * .3, r * .65], [0, 0], [-r * .3, -r * .65]], '#254b53', color, 2);
      line(c, -r, 0, -r * .2, 0, '#f3f4d2', 2);
    } else if (v.kind === 'thorns' || v.kind === 'retaliation') {
      const count = v.kind === 'thorns' ? 10 : 8;
      for (let i = 0; i < count; i++) {
        const angle = i * TAU / count;
        c.save(); c.translate(v.x, v.y); c.rotate(angle);
        const distance = r * (.5 + (this.motion ? p : .3) * .5);
        poly(c, [[distance - 10, -3], [distance + 10, 0], [distance - 10, 3], [distance - 5, 0]], color, v.secondaryColor || '#fff0ce'); c.restore();
      }
      circle(c, v.x, v.y, r * (.5 + p * .4), color, 1.5);
    } else if (v.kind === 'evolution' || v.kind === 'rune') {
      this.rune(c, v.x, v.y, r, color, 10, this.time * .2);
    } else if (v.kind === 'ring' || v.kind === 'pulse' || v.kind === 'nova') {
      const radius = r * (this.motion ? .35 + p * .65 : .85);
      this.glow(c, v.x, v.y, radius * 1.15, color, .12 * f);
      circle(c, v.x, v.y, radius, color, Math.max(1, 3 * f));
      if (this.detail) { c.globalAlpha *= .45; circle(c, v.x, v.y, radius * .87, v.secondaryColor || color, 1); }
    } else {
      this.glow(c, v.x, v.y, Math.min(70, r * 1.6), color, .3 * f);
      const count = this.detail ? 7 : 3;
      for (let i = 0; i < count; i++) {
        const a = hash(i * 17 + (v.seed ?? v.x)) * TAU, distance = (this.motion ? p : .25) * r;
        const x = v.x + Math.cos(a) * distance, y = v.y + Math.sin(a) * distance;
        line(c, x, y, x + Math.cos(a) * (3 + 5 * f), y + Math.sin(a) * (3 + 5 * f), i % 3 ? color : '#fff1ce', Math.max(1, f * 2));
      }
    }
    c.restore();
  }

  private lightning(c: Ctx, x: number, y: number, x2: number, y2: number, color: string, seed: number, width: number) {
    const dx = x2 - x, dy = y2 - y, length = Math.hypot(dx, dy) || 1;
    const steps = Math.max(3, Math.min(16, Math.ceil(length / 22))), nx = -dy / length, ny = dx / length;
    const tick = this.motion ? Math.floor(this.time * 12) : 0;
    c.beginPath(); c.moveTo(x, y);
    for (let i = 1; i < steps; i++) {
      const offset = (hash(seed + i * 9 + tick) - .5) * Math.min(24, length * .14);
      const px = x + dx * i / steps + nx * offset, py = y + dy * i / steps + ny * offset;
      c.lineTo(px, py);
      if (this.detail && i % 3 === 0) {
        c.lineTo(px + nx * offset * 1.8 + dx / steps * .3, py + ny * offset * 1.8 + dy / steps * .3);
        c.moveTo(px, py);
      }
    }
    c.lineTo(x2, y2); c.strokeStyle = color; c.lineWidth = width + 2; c.stroke();
    c.strokeStyle = '#fff3e3'; c.lineWidth = Math.max(.8, width * .32); c.stroke();
  }
  private rune(c: Ctx, x: number, y: number, r: number, color: string, sides: number, rotation = 0) {
    c.save(); c.translate(x, y); c.rotate(rotation); circle(c, 0, 0, r, color, 1);
    c.beginPath();
    for (let i = 0; i <= sides; i++) {
      const angle = i * TAU / sides, px = Math.cos(angle) * r * .88, py = Math.sin(angle) * r * .88;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.strokeStyle = color; c.lineWidth = 1; c.stroke();
    for (let i = 0; i < sides; i++) {
      c.save(); c.rotate(i * TAU / sides); line(c, r - 3, -3, r + 3, 3, color); line(c, r, -5, r, 5, color); c.restore();
    }
    c.restore();
  }
  private shield(c: Ctx, x: number, y: number, r: number, color: string, strength: number) {
    c.save(); c.translate(x, y);
    const points: number[][] = [];
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + Math.PI / 8; points.push([Math.cos(a) * r, Math.sin(a) * r]); }
    c.globalAlpha *= .07 + strength * .05; poly(c, points, color);
    c.globalAlpha = .4 + strength * .35;
    for (let i = 0; i < 8; i++) {
      const a = points[i], b = points[(i + 1) % 8];
      line(c, a[0], a[1], b[0], b[1], color, i % 2 ? 1 : 2);
      if (this.detail) line(c, a[0] * .68, a[1] * .68, a[0], a[1], color, .7);
    }
    c.restore();
  }
  private evolution(c: Ctx, s: RunV2) {
    if (!s.synergies.length) return;
    c.save(); c.globalAlpha = .38; c.translate(CX, CY + 18); c.scale(1, .38);
    this.rune(c, 0, 0, 77 + Math.min(s.synergies.length, 5) * 4, '#d9c58e', 12, this.time * .08);
    c.restore();
  }
  private coreBars(c: Ctx, s: RunV2) {
    c.fillStyle = '#061b20'; c.fillRect(CX - 36, CY + 49, 72, 8);
    c.fillStyle = s.hp / s.maxHp < .3 ? '#ee9e86' : '#bbd6b0';
    c.fillRect(CX - 34, CY + 51, 68 * clamp(s.hp / s.maxHp), 3);
    if (s.shield > 0) { c.fillStyle = '#b4e5e8'; c.fillRect(CX - 34, CY + 59, 68 * clamp(s.shield / s.maxHp), 2); }
  }
}
