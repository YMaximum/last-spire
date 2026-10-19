import { ArenaRenderer } from './arena';
import type { Enemy, RunState as LegacyRun, Settings, TowerId } from '../model/shared';
import type { AreaEffect, Element, ProjectileV2, RunV2, SettingsV2, VisualV2 } from '../game/types';
import { FUSIONS, FUSION_BY_ID, WEAPON_BY_ID, type FusionDefinition } from '../content/catalog';
import { enableDamageNumbers, readDamageNumbers } from '../game/damage-feedback';
import { drawDamageNumbers } from './damage-numbers';
import { drawEncounterSprite, drawEncounterWarnings, hasEncounterSprite } from './encounters';
import { EVOLUTION_BY_ID } from '../content/evolutions';
import type { EvolutionState } from '../model/evolution';

const W = 1000,
  H = 800,
  CX = 500,
  CY = 400,
  TAU = Math.PI * 2;
const COLORS: Record<Element, string> = {
  fire: '#ff9864',
  frost: '#9ce8f1',
  lightning: '#b9bbff',
  poison: '#b0dc76',
  solar: '#ffe0a0',
  void: '#d5a5f4',
};
const TOWERS: Record<TowerId, string> = {
  bastion: '#d9c28b',
  pyre: COLORS.fire,
  tempest: COLORS.lightning,
  glacier: COLORS.frost,
  verdant: COLORS.poison,
  null: COLORS.void,
  monolith: '#c2e3db',
};
type Ctx = CanvasRenderingContext2D;
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const hash = (n: number) => {
  const a = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return a - Math.floor(a);
};
function circle(c: Ctx, x: number, y: number, r: number, color: string, width = 1) {
  c.beginPath();
  c.arc(x, y, Math.max(0.1, r), 0, TAU);
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}
function line(c: Ctx, x: number, y: number, x2: number, y2: number, color: string, width = 1) {
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x2, y2);
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}
function poly(c: Ctx, points: number[][], fill: string, stroke?: string, width = 1) {
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
function gem(c: Ctx, r: number, fill: string, rim = '#fff3d9') {
  poly(
    c,
    [
      [r, 0],
      [0, -r * 0.65],
      [-r, 0],
      [0, r * 0.65],
    ],
    fill,
    rim,
    1.2,
  );
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
  private readonly fusionMarks = new Map<string, HTMLCanvasElement>();
  private readonly fusionOwners = new Map<string, FusionDefinition>();
  private fusionDecorations = 0;
  private fusionFields = 0;
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
  private glowBudget = 0;
  private fieldDetails = 0;
  private terrainPattern: CanvasPattern | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas2D is unavailable');
    this.ctx = ctx;
    this.scratch = document.createElement('canvas');
    this.legacy = new ArenaRenderer(this.scratch);
    this.pixel = this.legacy as unknown as PixelScene;
    this.resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.resize());
    this.resizeObserver?.observe(canvas);
    this.resize();
  }

  resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width || this.canvas.parentElement?.clientWidth || W);
    const height = Math.max(1, bounds.height || this.canvas.parentElement?.clientHeight || H);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(width * dpr),
      h = Math.round(height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.scale = Math.min(w / W, h / H);
    this.offsetX = (w - W * this.scale) / 2;
    this.offsetY = (h - H * this.scale) / 2;
    this.ctx.imageSmoothingEnabled = false;
  }

  draw(s: RunV2 | LegacyRun, settings: SettingsV2): void {
    enableDamageNumbers(s, settings.damageNumbers);
    const c = this.ctx;
    this.detail = settings.effects === 'high';
    this.motion = !settings.reducedMotion;
    this.time = this.motion ? s.time : 0;
    this.intensity =
      settings.intensity === 'subtle' ? 0.48 : settings.intensity === 'spectacular' ? 1.12 : 0.76;
    this.glowBudget = this.detail ? 128 : 32;
    this.fieldDetails = 0;
    this.fusionDecorations = 0;
    this.fusionFields = 0;
    this.fusionOwners.clear();
    if (s.version === 1) {
      // A resumed v1 run retains its original presentation and mechanics.
      this.legacy.draw(s, settings);
      this.prepareTerrain();
      this.begin(c);
      this.drawTerrain(c);
      c.drawImage(this.scratch, 0, 0, W, H);
      this.damageLabels(c, s);
      c.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }
    for (const core of s.weapons) {
      const recipeId = (core as typeof core & { fusion?: { recipeId: string } }).fusion?.recipeId;
      const fusion = this.resolveFusion(recipeId);
      if (fusion) this.fusionOwners.set(core.id, fusion);
    }
    if (this.stage !== s.stage || this.seed !== s.seed || !this.pixel.background) {
      const adapter = {
        ...s,
        tower: s.tower === 'monolith' ? 'bastion' : s.tower,
        version: 1,
        enemies: [],
        projectiles: [],
        visuals: [],
        attacks: [],
        buff: 0,
        stasis: 0,
        shield: 0,
      } as unknown as LegacyRun;
      this.legacy.draw(adapter, { ...settings, effects: 'low' });
      this.stage = s.stage;
      this.seed = s.seed;
      this.prepareTerrain();
    }
    this.begin(c);
    if (this.motion && settings.shake) {
      const shock = s.visuals.find(
        (v) =>
          /^(retaliation|shield-break|impact)$/.test(v.kind) &&
          v.maxLife - v.life < 0.1 &&
          Math.hypot(v.x - CX, v.y - CY) < 100,
      );
      if (shock) c.translate(Math.sin(s.time * 73) * 1.6, Math.cos(s.time * 89) * 1.6);
    }
    this.drawTerrain(c);
    this.environment(c, s);
    // All fields and luminous energy sit beneath the pixel combatants. Hit
    // feedback and text are a separate, crisp final pass.
    for (const a of s.areas) {
      this.area(c, a);
      this.fusionField(c, a);
    }
    // Only cosmetics are sampled. Telegraphs, named transformations, all projectiles,
    // and every damaging field retain a visible primitive at every quality setting.
    const essential = (v: VisualV2) => /^(hazard|synergy|fusion-)/.test(v.kind);
    const cosmetic = s.visuals.filter((v) => !essential(v)).slice(-(this.detail ? 96 : 28));
    const feedback = [...s.visuals.filter(essential), ...cosmetic];
    for (const v of feedback) if (!this.isForeground(v)) this.visual(c, v);
    for (const p of s.projectiles) this.projectile(c, p);
    this.evolution(c, s);
    this.fusionCrests(c, s);
    if (s.tower === 'monolith') this.monolith(c, s);
    else this.pixel.tower(c, s.tower, this.time, s.buffs.length > 0, false);
    this.evolvedTower(c, s);
    const enemies = s.enemies.length > 1 ? [...s.enemies].sort((a, b) => a.y - b.y) : s.enemies;
    for (const enemy of enemies) {
      if (hasEncounterSprite(enemy))
        drawEncounterSprite(c, enemy, this.time, settings.reducedMotion);
      else this.pixel.enemy(c, enemy, this.time, settings);
    }
    if (s.shield > 0) this.shield(c, CX, CY - 15, 61, TOWERS[s.tower], clamp(s.shield / s.maxHp));
    for (const v of feedback) if (this.isForeground(v)) this.visual(c, v);
    this.damageLabels(c, s);
    // Enemy warnings stay visible even when a meteor or a large orb crosses them.
    for (const e of enemies) {
      if (e.archetypeId) drawEncounterWarnings(c, s, e);
      if (hasEncounterSprite(e)) continue;
      if (e.kind === 'boss') {
        c.globalAlpha = 0.95;
        circle(c, e.x, e.y, e.radius + 6, '#14201d', 4);
        circle(c, e.x, e.y, e.radius + 6, '#ffc0ae', 2);
        c.globalAlpha = 1;
      }
      if (e.kind === 'ranged' && e.attackCd < 0.6) {
        c.setLineDash([4, 8]);
        line(c, e.x, e.y, CX, CY, '#14201d', 3.5);
        line(c, e.x, e.y, CX, CY, '#ffd1b5', 1.5);
        c.setLineDash([]);
      }
    }
    for (const a of s.areas) if (a.delay > 0) this.warning(c, a);
    this.coreBars(c, s);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.shadowBlur = 0;
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  private damageLabels(c: Ctx, s: RunV2 | LegacyRun) {
    const entries = readDamageNumbers(s);
    if (!entries.length) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.save();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawDamageNumbers(c, entries, {
      time: s.time,
      motion: this.motion,
      detail: this.detail,
      width: this.canvas.width / dpr,
      height: this.canvas.height / dpr,
      scale: this.scale / dpr,
      offsetX: this.offsetX / dpr,
      offsetY: this.offsetY / dpr,
    });
    c.restore();
  }

  private monolith(c: Ctx, s: RunV2) {
    c.save();
    c.translate(CX, CY - 18);
    c.fillStyle = '#101d1d';
    c.fillRect(-37, 21, 74, 22);
    c.fillStyle = '#857b59';
    c.fillRect(-30, -40, 60, 68);
    c.fillStyle = '#b2b9a2';
    c.fillRect(-24, -46, 48, 60);
    c.fillStyle = '#223d3c';
    c.fillRect(-16, -37, 32, 46);
    poly(
      c,
      [
        [0, -39],
        [15, -21],
        [0, 4],
        [-15, -21],
      ],
      '#a8dad3',
      '#e4ebce',
      2,
    );
    c.fillStyle = '#d1b97d';
    for (const x of [-31, 23]) {
      c.fillRect(x, -30, 8, 48);
      c.fillRect(x - 3, 12, 14, 7);
    }
    if (s.shield > 0) {
      c.globalAlpha = 0.5;
      circle(c, 0, -10, 52, '#a6e3db', 2);
    }
    c.restore();
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.legacy.dispose();
    this.glows.clear();
    this.fusionMarks.clear();
    this.fusionOwners.clear();
    this.terrainPattern = null;
    this.scratch.width = this.scratch.height = 1;
  }

  private begin(c: Ctx) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#0b2022';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }
  private prepareTerrain() {
    this.terrainPattern = this.pixel.background
      ? this.ctx.createPattern(this.pixel.background, 'repeat')
      : null;
  }
  private drawTerrain(c: Ctx) {
    // Repeat only scenery into the extra viewport, never stretch combat geometry.
    const x = -this.offsetX / this.scale,
      y = -this.offsetY / this.scale;
    c.fillStyle = this.terrainPattern || '#102b2b';
    c.fillRect(x, y, this.canvas.width / this.scale, this.canvas.height / this.scale);
    if (this.pixel.background) c.drawImage(this.pixel.background, 0, 0, W, H);
  }
  private glow(c: Ctx, x: number, y: number, r: number, color: string, alpha = 0.4) {
    if (r < 1 || alpha <= 0 || this.glowBudget-- <= 0) return;
    let sprite = this.glows.get(color);
    if (!sprite) {
      sprite = document.createElement('canvas');
      sprite.width = sprite.height = 96;
      const g = sprite.getContext('2d')!,
        gradient = g.createRadialGradient(48, 48, 1, 48, 48, 48);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.24, color);
      gradient.addColorStop(1, 'transparent');
      g.fillStyle = gradient;
      g.fillRect(0, 0, 96, 96);
      // Color space is small (six elements plus fixed engine feedback colors).
      if (this.glows.size < 48) this.glows.set(color, sprite);
    }
    c.save();
    c.globalAlpha *= alpha * this.intensity;
    c.drawImage(sprite, x - r, y - r, r * 2, r * 2);
    c.restore();
  }
  private environment(c: Ctx, s: RunV2) {
    const color = TOWERS[s.tower];
    this.glow(c, CX, CY, 190, color, 0.055);
    c.save();
    c.globalAlpha = 0.16;
    for (let i = 0; i < 4; i++) {
      const a = (i * TAU) / 4;
      const x = CX + Math.cos(a) * 304,
        y = CY + Math.sin(a) * 304;
      circle(c, x, y, 11, '#c9b683', 2);
      line(c, x - 4, y, x + 4, y, '#b6d4bb', 2);
      line(c, x, y - 4, x, y + 4, '#b6d4bb', 2);
    }
    c.restore();
    if (!this.detail) return;
    for (let i = 0; i < 12; i++) {
      const a = hash(i + s.seed) * TAU,
        r = 130 + hash(i + 11) * 310;
      const y = CY + Math.sin(a) * r - ((this.time * 5 + i * 7) % 22);
      c.globalAlpha = (0.09 + Math.sin(this.time + i) * 0.04) * this.intensity;
      c.fillStyle = '#b9c6a1';
      c.fillRect(CX + Math.cos(a) * r, y, 1.5, 1.5);
    }
    c.globalAlpha = 1;
  }

  private projectile(c: Ctx, p: ProjectileV2) {
    const primary = COLORS[p.elements[0]] || '#d0dfc5';
    const rim = COLORS[p.elements[1]] || '#fff1cf';
    const r = Math.max(2, p.radius),
      age = p.maxLife - p.life;
    const pulse = p.pulseInterval > 0 ? (age % p.pulseInterval) / p.pulseInterval : 0;
    const speed = Math.hypot(p.vx, p.vy),
      angle = speed > 1 ? Math.atan2(p.vy, p.vx) : this.time + p.seed;
    this.glow(c, p.x, p.y, r * 3 + 10, primary, this.detail ? 0.24 : 0.11);
    c.save();
    c.translate(p.x, p.y);
    c.rotate(angle);
    const trail = Math.min(70, Math.max(r * 1.8, speed * 0.065));
    if (speed > 15 && p.kind !== 'mine' && p.kind !== 'orbit') {
      c.globalAlpha = 0.24;
      c.beginPath();
      c.moveTo(-trail, -r * 0.5);
      c.quadraticCurveTo(-trail * 0.4, -r * 0.9, 0, 0);
      c.quadraticCurveTo(-trail * 0.5, r * 0.65, -trail, r * 0.45);
      c.strokeStyle = primary;
      c.lineWidth = Math.max(1, r * 0.24);
      c.stroke();
      if (this.detail && r > 9) {
        c.beginPath();
        c.moveTo(-trail * 1.4, r);
        c.quadraticCurveTo(-trail * 0.6, r * 1.4, r * 0.3, r * 0.8);
        c.strokeStyle = rim;
        c.lineWidth = 1;
        c.stroke();
      }
      c.globalAlpha = 1;
    }
    c.lineWidth = 1.5;
    switch (p.kind) {
      case 'bolt':
        gem(c, r * 1.25, primary, rim);
        line(c, -r * 0.7, 0, r * 0.7, 0, '#fff8df', 1.5);
        break;
      case 'volley':
        poly(
          c,
          [
            [r * 1.5, 0],
            [-r, -r * 0.7],
            [-r * 0.45, 0],
            [-r, r * 0.7],
          ],
          primary,
          rim,
        );
        line(c, -r * 1.5, -r * 0.6, -r * 0.5, 0, rim);
        line(c, -r * 1.5, r * 0.6, -r * 0.5, 0, rim);
        break;
      case 'spiral': {
        c.rotate(this.time * 2 + p.seed);
        circle(c, 0, 0, r, primary, 2);
        for (let i = 0; i < 3; i++) {
          c.rotate(TAU / 3);
          c.beginPath();
          c.moveTo(0, 0);
          c.quadraticCurveTo(r * 1.8, -r, r, r * 0.4);
          c.strokeStyle = i === 1 ? rim : primary;
          c.stroke();
        }
        gem(c, r * 0.4, rim, primary);
        break;
      }
      case 'beam':
      case 'rail':
        line(c, -r * 3, 0, r * 2.5, 0, primary, p.kind === 'rail' ? r * 0.7 : r);
        line(c, -r * 2, 0, r * 2.5, 0, rim, Math.max(1.5, r * 0.22));
        if (p.kind === 'rail') {
          line(c, -r * 2, -r, r, -r, primary);
          line(c, -r * 2, r, r, r, primary);
        }
        break;
      case 'orbit':
        c.rotate(this.time * 1.3);
        circle(c, 0, 0, r * 1.4, rim, 1);
        gem(c, r, primary, rim);
        c.rotate(Math.PI / 2);
        gem(c, r * 0.7, '#213c40', primary);
        break;
      case 'pulse':
      case 'singularity': {
        const rr = r * (this.motion ? 1 + Math.sin(pulse * TAU) * 0.025 : 1);
        c.beginPath();
        c.arc(0, 0, rr, 0, TAU);
        c.fillStyle = p.kind === 'singularity' ? '#142032' : primary;
        c.fill();
        circle(c, 0, 0, rr, rim, 2);
        circle(c, 0, 0, rr * 0.72, primary, 1.2);
        c.save();
        c.rotate(this.time * 0.6);
        c.scale(1.3, 0.45);
        circle(c, 0, 0, r * 1.35, rim, 2);
        c.restore();
        if (p.pulseInterval > 0) {
          c.globalAlpha = (1 - pulse) * 0.55;
          circle(c, 0, 0, r * (1 + (this.motion ? pulse : 0.2) * 0.8), primary, 1.8);
          c.globalAlpha = 1;
        }
        if (p.kind === 'pulse') {
          c.beginPath();
          c.arc(-r * 0.25, -r * 0.28, r * 0.24, 0, TAU);
          c.fillStyle = '#fff5db';
          c.fill();
        }
        break;
      }
      case 'swarm':
        poly(
          c,
          [
            [r, 0],
            [-r * 0.9, -r * 0.55],
            [-r * 0.4, 0],
            [-r * 0.9, r * 0.55],
          ],
          primary,
          rim,
        );
        line(c, -r * 0.3, 0, -r * 1.2, -r, rim);
        line(c, -r * 0.3, 0, -r * 1.2, r, rim);
        break;
      case 'mine':
        c.rotate(-angle + this.time * 0.25 + p.seed);
        this.rune(c, 0, 0, r + 5, primary, 6);
        gem(c, r, '#193034', primary);
        gem(c, r * 0.45, rim, primary);
        c.globalAlpha = 0.35;
        circle(c, 0, 0, r + 10, primary);
        c.globalAlpha = 1;
        break;
      case 'ricochet':
        poly(
          c,
          [
            [r * 1.3, 0],
            [0, -r],
            [-r, -r * 0.45],
            [-r, r * 0.45],
            [0, r],
          ],
          '#274548',
          primary,
          2,
        );
        gem(c, r * 0.55, primary, rim);
        break;
      case 'chakram':
        c.rotate(this.time * 5);
        circle(c, 0, 0, r, primary, 3);
        circle(c, 0, 0, r * 0.58, rim, 1.5);
        for (let i = 0; i < 4; i++) {
          c.rotate(TAU / 4);
          poly(
            c,
            [
              [r * 0.8, 0],
              [r * 1.4, -r * 0.55],
              [r * 0.4, -r * 0.9],
            ],
            primary,
            rim,
          );
        }
        break;
      case 'flame':
        poly(
          c,
          [
            [r * 1.4, 0],
            [-r * 0.1, -r],
            [-r * 0.5, -r * 0.35],
            [-r * 1.7, -r * 0.5],
            [-r, 0],
            [-r * 1.6, r * 0.6],
            [-r * 0.1, r],
          ],
          primary,
        );
        gem(c, r * 0.55, rim, '#fff2cb');
        break;
      case 'tesla':
        this.lightning(c, -r * 2, 0, r * 2, 0, primary, p.seed, 2.5);
        gem(c, r * 0.5, rim, primary);
        break;
      case 'drone':
        poly(
          c,
          [
            [-r, -r * 0.5],
            [r * 0.7, -r * 0.5],
            [r * 1.1, 0],
            [r * 0.7, r * 0.5],
            [-r, r * 0.5],
          ],
          '#284446',
          '#d2be88',
          2,
        );
        gem(c, r * 0.5, primary, rim);
        for (const y of [-r, r]) {
          line(c, -r * 0.9, y, r * 0.4, y, '#b9ad83', 2);
          circle(c, -r * 0.3, y, r * 0.55, primary);
        }
        break;
      case 'meteor':
        poly(
          c,
          [
            [-r * 3, -r],
            [-r, -r * 0.8],
            [r, -r * 0.5],
            [r * 1.2, r * 0.4],
            [0, r],
            [-r * 3.5, r * 0.5],
            [-r, 0],
          ],
          primary,
        );
        poly(
          c,
          [
            [-r, -r * 0.5],
            [0, -r],
            [r, -0.2 * r],
            [0.6 * r, r],
            [-r * 0.6, r],
          ],
          '#77544a',
          rim,
          1.5,
        );
        break;
    }
    // A second infusion is a separate rotating element lattice, not a recolor.
    if (p.elements.length > 1) {
      c.rotate(-angle + this.time * 0.8);
      c.globalAlpha = 0.8;
      for (let i = 0; i < p.elements.length - 1; i++) {
        const a = (i * TAU) / Math.max(2, p.elements.length - 1);
        const x = Math.cos(a) * r * 1.2,
          y = Math.sin(a) * r * 1.2;
        line(c, x * 0.45, y * 0.45, x, y, COLORS[p.elements[i + 1]], 1.3);
        c.save();
        c.translate(x, y);
        gem(c, Math.max(2, r * 0.24), COLORS[p.elements[i + 1]], '#edf5d6');
        c.restore();
      }
    }
    if (p.critical) {
      c.globalAlpha = 0.85;
      circle(c, 0, 0, r + 3, '#fff0c4', 1);
    }
    c.restore();
    this.fusionProjectile(c, p);
  }

  private resolveFusion(id?: string): FusionDefinition | undefined {
    if (!id || (!id.startsWith('fusion-') && !id.startsWith('fused-'))) return undefined;
    return (
      FUSION_BY_ID[id] ||
      FUSION_BY_ID[id.replace(/^fusion-/, '')] ||
      FUSIONS.find((fusion) => fusion.kind === id)
    );
  }

  /** Synchronous cached vector artwork: twelve marks, no image loading or simulation state. */
  private fusionMark(fusion: FusionDefinition): HTMLCanvasElement {
    const cached = this.fusionMarks.get(fusion.id);
    if (cached) return cached;
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 128;
    const c = sprite.getContext('2d')!;
    c.translate(64, 64);
    c.scale(2.25, 2.25);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const brass = '#c9ad7c',
      stone = '#172622',
      energy = fusion.color;
    switch (fusion.id) {
      case 'fusion-lance':
        poly(
          c,
          [
            [24, 0],
            [8, -7],
            [-17, -3],
            [-22, 0],
            [-17, 3],
            [8, 7],
          ],
          stone,
          brass,
          1.5,
        );
        line(c, -15, 0, 19, 0, energy, 2.5);
        for (const y of [-12, 12])
          poly(
            c,
            [
              [9, y],
              [-2, y - 3],
              [-6, y],
              [-2, y + 3],
            ],
            energy,
            brass,
          );
        line(c, -9, -8, 3, -8, brass);
        line(c, -9, 8, 3, 8, brass);
        break;
      case 'fusion-prism':
        poly(
          c,
          [
            [-17, 8],
            [17, 8],
            [17, 22],
            [-17, 22],
          ],
          stone,
          brass,
          1.5,
        );
        poly(
          c,
          [
            [0, -19],
            [13, -7],
            [0, 8],
            [-13, -7],
          ],
          stone,
          energy,
          1.8,
        );
        line(c, 0, -19, 0, 8, energy);
        line(c, -13, -7, 13, -7, brass);
        for (const sign of [-1, 1]) {
          line(c, sign * 12, -13, sign * 23, -19, energy, 2);
          line(c, sign * 14, -3, sign * 24, -4, brass);
        }
        line(c, -10, 14, 10, 14, brass);
        break;
      case 'fusion-orrery':
        c.save();
        c.rotate(-0.5);
        c.scale(1, 0.48);
        circle(c, 0, 0, 23, brass, 1.5);
        c.restore();
        c.beginPath();
        c.arc(0, 0, 16, -1.8, 1.7);
        c.arc(-4, 0, 11, 1.7, -1.8, true);
        c.closePath();
        c.fillStyle = stone;
        c.fill();
        c.strokeStyle = energy;
        c.lineWidth = 2;
        c.stroke();
        gem(c, 6, energy, brass);
        for (const sign of [-1, 1])
          poly(
            c,
            [
              [sign * 18, -sign * 11],
              [sign * 24, -sign * 10],
              [sign * 20, -sign * 4],
            ],
            energy,
            brass,
          );
        break;
      case 'fusion-conduit':
        for (const x of [-15, 15]) {
          line(c, x, -20, x, 20, brass, 4);
          for (let y = -15; y <= 15; y += 10) line(c, x - 5, y, x + 5, y, energy, 1.5);
        }
        poly(
          c,
          [
            [-11, -12],
            [5, -3],
            [1, -17],
            [12, 12],
            [-4, 3],
            [0, 17],
          ],
          energy,
          brass,
          1.1,
        );
        break;
      case 'fusion-citadel':
        poly(
          c,
          [
            [-18, -7],
            [-12, -16],
            [-12, -23],
            [-5, -23],
            [-5, -16],
            [5, -16],
            [5, -23],
            [12, -23],
            [12, -16],
            [18, -7],
            [20, 13],
            [10, 21],
            [-10, 21],
            [-20, 13],
          ],
          stone,
          brass,
          1.5,
        );
        gem(c, 10, energy, brass);
        line(c, 0, -8, 0, 9, brass);
        for (const x of [-12, 12]) {
          circle(c, x, 10, 4, energy, 1.5);
          line(c, x, -2, x * 1.8, 3, brass);
        }
        break;
      case 'fusion-cataclysm':
        poly(
          c,
          [
            [-23, 7],
            [23, 7],
            [13, 15],
            [5, 16],
            [4, 21],
            [11, 21],
            [11, 25],
            [-11, 25],
            [-11, 21],
            [-4, 21],
            [-5, 16],
            [-13, 15],
          ],
          stone,
          brass,
          1.4,
        );
        c.save();
        c.translate(0, -8);
        c.rotate(-0.5);
        gem(c, 10, energy, brass);
        c.restore();
        line(c, -14, -23, -7, -13, energy, 2);
        line(c, 10, -24, 5, -16, brass, 2);
        line(c, 20, -16, 12, -8, energy, 2);
        break;
      case 'fusion-cathedral':
        poly(
          c,
          [
            [-19, 22],
            [-19, -5],
            [-12, -19],
            [-6, -5],
            [0, -25],
            [6, -5],
            [12, -19],
            [19, -5],
            [19, 22],
          ],
          stone,
          brass,
          1.5,
        );
        poly(
          c,
          [
            [0, -9],
            [10, 2],
            [7, 17],
            [-7, 17],
            [-10, 2],
          ],
          stone,
          energy,
          1.6,
        );
        line(c, 0, -9, 0, 17, energy);
        line(c, -10, 2, 10, 2, brass);
        line(c, -25, 0, -25, 17, energy);
        line(c, 25, 0, 25, 17, energy);
        break;
      case 'fusion-briar':
        c.beginPath();
        c.moveTo(0, 23);
        c.bezierCurveTo(-37, 0, -13, -28, 0, -10);
        c.bezierCurveTo(13, -28, 37, 0, 0, 23);
        c.fillStyle = stone;
        c.fill();
        c.strokeStyle = brass;
        c.lineWidth = 1.8;
        c.stroke();
        line(c, -8, 4, 8, 4, energy, 4);
        line(c, 0, -4, 0, 12, energy, 4);
        for (const sign of [-1, 1]) {
          poly(
            c,
            [
              [sign * 13, -12],
              [sign * 21, -22],
              [sign * 20, -7],
            ],
            energy,
            brass,
          );
          poly(
            c,
            [
              [sign * 12, 15],
              [sign * 25, 13],
              [sign * 20, 22],
            ],
            stone,
            brass,
          );
        }
        break;
      case 'fusion-dynamo':
        circle(c, 0, 0, 18, brass, 2);
        circle(c, 0, 0, 13, energy, 1);
        for (let i = 0; i < 6; i++) {
          const a = (i * TAU) / 6;
          line(
            c,
            Math.cos(a) * 3,
            Math.sin(a) * 3,
            Math.cos(a) * 23,
            Math.sin(a) * 23,
            energy,
            1.5,
          );
          c.save();
          c.rotate(a);
          poly(
            c,
            [
              [18, -4],
              [24, 0],
              [18, 4],
            ],
            stone,
            brass,
          );
          line(c, 8, -4, 11, 0, energy);
          line(c, 8, 4, 11, 0, energy);
          c.restore();
        }
        break;
      case 'fusion-crucible':
        poly(
          c,
          [
            [-22, 2],
            [22, 2],
            [14, 20],
            [-14, 20],
          ],
          stone,
          brass,
          1.8,
        );
        line(c, -12, 20, -16, 25, brass, 3);
        line(c, 12, 20, 16, 25, brass, 3);
        circle(c, 0, -9, 10, energy, 1.5);
        c.save();
        c.translate(0, -9);
        c.rotate(-0.45);
        c.scale(1.8, 0.5);
        circle(c, 0, 0, 10, brass, 1);
        c.restore();
        poly(
          c,
          [
            [-8, 7],
            [-2, 10],
            [0, 3],
            [6, 10],
            [3, 15],
            [-5, 15],
          ],
          energy,
        );
        break;
      case 'fusion-barbed':
        c.save();
        c.rotate(-0.4);
        c.scale(1, 0.48);
        circle(c, 0, 0, 25, brass, 1.7);
        c.restore();
        poly(
          c,
          [
            [0, -18],
            [12, -11],
            [9, 11],
            [0, 20],
            [-9, 11],
            [-12, -11],
          ],
          stone,
          energy,
          1.7,
        );
        for (let i = 0; i < 3; i++) {
          c.save();
          c.rotate((i * TAU) / 3);
          poly(
            c,
            [
              [18, -5],
              [26, -9],
              [22, 4],
              [20, 0],
            ],
            energy,
            brass,
          );
          c.restore();
        }
        break;
      case 'fusion-pyroclasm':
        c.save();
        c.scale(1, 0.62);
        circle(c, 0, 0, 19, energy, 1.8);
        c.restore();
        for (let i = 0; i < 3; i++) {
          const a = (i * TAU) / 3;
          c.save();
          c.rotate(a);
          poly(
            c,
            [
              [0, -23],
              [5, -13],
              [1, -7],
              [-4, -14],
            ],
            energy,
            brass,
            1,
          );
          c.restore();
        }
        line(c, -6, -4, 5, 4, '#fff0c4', 1.2);
        break;
      case 'fusion-tempest':
        for (const radius of [9, 17, 24]) {
          circle(c, 0, 0, radius, radius === 17 ? energy : brass, 1.3);
        }
        for (let i = 0; i < 4; i++) {
          const a = (i * TAU) / 4;
          line(
            c,
            Math.cos(a) * 10,
            Math.sin(a) * 10,
            Math.cos(a) * 23,
            Math.sin(a) * 23,
            energy,
            1.5,
          );
        }
        gem(c, 6, energy, brass);
        break;
      case 'fusion-reliquary':
        poly(
          c,
          [
            [0, -23],
            [16, -14],
            [16, 8],
            [0, 22],
            [-16, 8],
            [-16, -14],
          ],
          stone,
          brass,
          1.5,
        );
        line(c, -24, -7, 22, -7, energy, 2.2);
        line(c, -24, -3, 22, -3, brass, 0.8);
        poly(
          c,
          [
            [22, -11],
            [28, -5],
            [22, 1],
          ],
          energy,
          brass,
          1,
        );
        line(c, -10, 10, 10, 10, energy, 1.4);
        break;
      case 'fusion-impact-well':
        c.save();
        c.rotate(-0.5);
        poly(
          c,
          [
            [-20, -8],
            [9, -8],
            [19, 0],
            [9, 8],
            [-20, 8],
          ],
          stone,
          brass,
          1.4,
        );
        poly(
          c,
          [
            [-4, -6],
            [3, -1],
            [0, 6],
            [-7, 1],
          ],
          energy,
          '#fff0c4',
          1,
        );
        c.restore();
        circle(c, 0, 0, 21, energy, 1.1);
        for (const sign of [-1, 1]) {
          line(c, sign * 24, -7, sign * 13, -3, brass, 1.2);
          line(c, sign * 24, 7, sign * 13, 3, brass, 1.2);
        }
        break;
      case 'fusion-sanctuary':
        circle(c, 0, 0, 8, '#fff0c4', 2);
        for (let i = 0; i < 8; i++) {
          const a = (i * TAU) / 8;
          line(
            c,
            Math.cos(a) * 11,
            Math.sin(a) * 11,
            Math.cos(a) * 23,
            Math.sin(a) * 23,
            energy,
            1.5,
          );
        }
        for (const x of [-19, 19]) {
          circle(c, x, 0, 4, energy, 1.3);
          line(c, x, -4, x, 4, '#eaffda', 1);
        }
        break;
      case 'fusion-hoarfrost':
        c.save();
        c.scale(1, 0.62);
        circle(c, 0, 0, 22, brass, 1.3);
        circle(c, 0, 0, 15, energy, 1.5);
        c.restore();
        for (let i = 0; i < 4; i++) {
          c.save();
          c.rotate((i * TAU) / 4);
          poly(
            c,
            [
              [0, -25],
              [5, -16],
              [0, -10],
              [-5, -16],
            ],
            energy,
            '#eaffff',
            1,
          );
          c.restore();
        }
        gem(c, 5, '#eaffff', energy);
        break;
      case 'fusion-parallax':
        c.save();
        c.rotate(-0.45);
        c.scale(1, 0.55);
        circle(c, 0, 0, 23, brass, 1.3);
        c.restore();
        for (let i = 0; i < 6; i++) {
          const a = (i * TAU) / 6;
          const x = Math.cos(a) * 18,
            y = Math.sin(a) * 18;
          line(c, 0, 0, x, y, energy, 1);
          poly(
            c,
            [
              [x, y - 4],
              [x + 4, y],
              [x, y + 4],
              [x - 4, y],
            ],
            stone,
            i % 2 ? energy : brass,
            1,
          );
        }
        circle(c, 0, 0, 5, energy, 1.5);
        break;
      case 'fusion-rimechoir':
        for (const x of [-15, 0, 15]) {
          poly(
            c,
            [
              [x - 7, -12],
              [x + 7, -12],
              [x + 5, 6],
              [x, 14],
              [x - 5, 6],
            ],
            stone,
            brass,
            1.3,
          );
          line(c, x - 3, -5, x + 3, -5, energy, 1.4);
        }
        for (const radius of [20, 25]) circle(c, 0, 0, radius, energy, 0.8);
        break;
      case 'fusion-thunder':
        poly(
          c,
          [
            [0, -23],
            [13, -9],
            [13, 13],
            [0, 24],
            [-13, 13],
            [-13, -9],
          ],
          stone,
          brass,
          1.6,
        );
        poly(
          c,
          [
            [3, -16],
            [-8, 3],
            [1, 3],
            [-2, 17],
            [10, -5],
            [2, -5],
          ],
          energy,
          brass,
        );
        for (const sign of [-1, 1]) {
          line(c, sign * 18, -13, sign * 23, -4, energy);
          line(c, sign * 23, -4, sign * 23, 9, energy);
          line(c, sign * 23, 9, sign * 18, 17, energy);
        }
        break;
    }
    this.fusionMarks.set(fusion.id, sprite);
    return sprite;
  }

  private drawFusionMark(
    c: Ctx,
    fusion: FusionDefinition,
    x: number,
    y: number,
    radius: number,
    rotation = 0,
  ) {
    c.save();
    c.translate(x, y);
    c.rotate(rotation);
    c.drawImage(this.fusionMark(fusion), -radius, -radius, radius * 2, radius * 2);
    c.restore();
  }

  private fusionProjectile(c: Ctx, p: ProjectileV2) {
    const fusion =
      this.resolveFusion((p as ProjectileV2 & { fusionId?: string }).fusionId) ||
      this.fusionOwners.get(p.weaponId);
    if (!fusion) return;
    // Only additional engraving is budgeted; every damaging primitive above is always drawn.
    if (this.fusionDecorations++ >= (this.detail ? (this.intensity > 1 ? 144 : 96) : 28)) return;
    const r = Math.min(30, Math.max(5, p.radius * 1.2));
    const angle = Math.atan2(p.vy, p.vx);
    c.save();
    c.translate(p.x, p.y);
    c.rotate(angle);
    c.globalAlpha = Math.min(0.9, 0.55 + this.intensity * 0.25);
    if (this.detail) {
      switch (fusion.id) {
        case 'fusion-lance':
          for (const y of [-r * 0.75, r * 0.75]) line(c, -r * 3.8, y, -r, y, fusion.color, 1.1);
          break;
        case 'fusion-prism':
          for (const sign of [-1, 1]) {
            line(c, -r * 2, sign * r, -r * 1.5, sign * r * 0.3, '#c9ad7c');
            line(c, -r * 1.5, sign * r * 0.3, -r, sign * r, fusion.color);
          }
          break;
        case 'fusion-orrery':
        case 'fusion-barbed':
          c.save();
          c.scale(1.5, 0.6);
          circle(c, 0, 0, r * 1.25, fusion.color, 1.2);
          c.restore();
          break;
        case 'fusion-conduit':
          this.lightning(c, -r * 3, -r, 0, 0, fusion.color, p.seed, 1);
          this.lightning(c, -r * 2, r, 0, 0, '#c9ad7c', p.seed + 1, 1);
          break;
        case 'fusion-citadel':
          for (const sign of [-1, 1]) {
            c.save();
            c.translate(-r * 1.4, sign * r * 1.15);
            gem(c, r * 0.3, fusion.color, '#c9ad7c');
            c.restore();
          }
          break;
        case 'fusion-cataclysm':
          line(c, -r * 4, -r * 0.6, -r, 0, '#ffb879', 2);
          line(c, -r * 3, r * 0.75, -r, 0, fusion.color, 1.2);
          break;
        case 'fusion-cathedral':
          for (const sign of [-1, 1]) {
            c.save();
            c.translate(-r * 1.4, sign * r * 0.9);
            gem(c, r * 0.45, '#193432', fusion.color);
            c.restore();
          }
          break;
        case 'fusion-briar':
          for (const sign of [-1, 1])
            poly(
              c,
              [
                [-r, sign * r * 0.2],
                [-r * 2, sign * r],
                [-r * 0.5, sign * r * 0.8],
              ],
              fusion.color,
              '#c9ad7c',
            );
          break;
        case 'fusion-dynamo':
          for (let i = 0; i < 4; i++) {
            const a = (i * TAU) / 4;
            line(
              c,
              Math.cos(a) * r,
              Math.sin(a) * r,
              Math.cos(a) * r * 1.7,
              Math.sin(a) * r * 1.7,
              fusion.color,
            );
          }
          break;
        case 'fusion-crucible':
          c.save();
          c.scale(1.7, 0.55);
          circle(c, 0, 0, r * 1.15, fusion.color, 1.2);
          c.restore();
          line(c, -r * 2.2, -r * 0.8, -r * 0.5, 0, '#ffb879', 1.2);
          break;
        case 'fusion-pyroclasm':
          c.save();
          c.scale(1.7, 0.55);
          circle(c, -r, 0, r * 0.9, fusion.color, 1.2);
          c.restore();
          for (const side of [-1, 1]) {
            poly(
              c,
              [
                [-r * 1.5, side * r * 0.45],
                [-r * 3, side * r],
                [-r * 2.3, side * r * 0.3],
              ],
              '#ffb879',
              fusion.color,
              1,
            );
          }
          break;
        case 'fusion-tempest':
          for (const radius of [r * 1.15, r * 1.7]) circle(c, -r * 0.5, 0, radius, fusion.color, 1);
          this.lightning(c, -r * 2.5, -r, -r * 0.5, 0, '#fff0c4', p.seed, 1);
          break;
        case 'fusion-reliquary':
          line(c, -r * 3.4, -r * 0.55, r * 0.8, -r * 0.55, fusion.color, 1.8);
          line(c, -r * 3.4, r * 0.55, r * 0.8, r * 0.55, '#c9ad7c', 1);
          poly(
            c,
            [
              [r * 0.8, -r],
              [r * 1.6, 0],
              [r * 0.8, r],
            ],
            fusion.color,
            '#fff0c4',
            1,
          );
          break;
        case 'fusion-impact-well':
          c.save();
          c.scale(1.7, 0.7);
          circle(c, -r * 0.8, 0, r, fusion.color, 1.2);
          c.restore();
          for (const side of [-1, 1])
            line(c, -r * 3, side * r, -r * 0.8, side * r * 0.3, '#d7c5ec', 1.2);
          break;
        case 'fusion-sanctuary':
          for (const side of [-1, 1]) {
            circle(c, -r * 1.7, side * r * 0.6, r * 0.42, fusion.color, 1.2);
            line(
              c,
              -r * 1.7,
              side * r * 0.6 - r * 0.25,
              -r * 1.7,
              side * r * 0.6 + r * 0.25,
              '#eaffda',
              1,
            );
          }
          circle(c, -r * 0.4, 0, r * 1.1, '#fff0c4', 1);
          break;
        case 'fusion-hoarfrost':
          c.save();
          c.scale(1.6, 0.6);
          circle(c, -r * 0.5, 0, r * 1.4, fusion.color, 1.3);
          c.restore();
          for (const side of [-1, 1])
            poly(
              c,
              [
                [-r, side * r * 0.3],
                [-r * 2.6, side * r],
                [-r * 2, side * r * 0.15],
              ],
              '#c9f7ff',
              fusion.color,
              1,
            );
          break;
        case 'fusion-parallax':
          c.save();
          c.scale(1.8, 0.55);
          circle(c, -r, 0, r * 1.3, '#c9ad7c', 1);
          c.restore();
          for (const side of [-1, 1]) {
            poly(
              c,
              [
                [-r * 2.5, side * r],
                [-r * 1.8, side * r * 0.4],
                [-r * 1.1, side * r],
              ],
              '#172622',
              fusion.color,
              1,
            );
          }
          break;
        case 'fusion-rimechoir':
          for (const x of [-r * 1.8, -r * 0.8]) {
            poly(
              c,
              [
                [x - r * 0.35, -r * 0.7],
                [x + r * 0.35, -r * 0.7],
                [x + r * 0.25, r * 0.4],
                [x, r * 0.7],
                [x - r * 0.25, r * 0.4],
              ],
              '#172622',
              fusion.color,
              1,
            );
          }
          circle(c, 0, 0, r * 1.4, fusion.color, 1);
          break;
        case 'fusion-thunder':
          circle(c, 0, 0, r * 1.25, fusion.color, 1.4);
          circle(c, 0, 0, r * 1.6, '#c9ad7c', 0.7);
          break;
      }
    }
    this.drawFusionMark(c, fusion, 0, 0, r);
    c.restore();
  }

  private fusionField(c: Ctx, area: AreaEffect) {
    const fusion = this.fusionOwners.get(area.weaponId);
    if (!fusion || this.fusionFields++ >= (this.detail ? 24 : 8)) return;
    const r = Math.min(34, Math.max(13, area.radius * 0.23));
    c.save();
    c.globalAlpha =
      (area.delay > 0 ? 0.65 : 0.35) *
      clamp(area.life / Math.min(1, area.maxLife)) *
      Math.min(1, this.intensity);
    this.drawFusionMark(c, fusion, area.x, area.y, r);
    if (this.detail) {
      c.setLineDash([6, 10]);
      circle(c, area.x, area.y, area.radius * 0.76, fusion.color, 1);
      c.setLineDash([]);
      switch (fusion.id) {
        case 'fusion-pyroclasm':
        case 'fusion-impact-well':
          c.save();
          c.translate(area.x, area.y);
          c.rotate(this.motion ? this.time * 0.35 : 0);
          c.scale(1, 0.48);
          circle(c, 0, 0, area.radius * 0.58, fusion.color, 1.6);
          c.restore();
          break;
        case 'fusion-tempest':
        case 'fusion-rimechoir':
          circle(c, area.x, area.y, area.radius * 0.52, '#eafcff', 1);
          circle(c, area.x, area.y, area.radius * 0.38, fusion.color, 0.8);
          break;
        case 'fusion-reliquary':
        case 'fusion-parallax':
          c.save();
          c.translate(area.x, area.y);
          c.rotate(-0.45);
          c.scale(1, 0.42);
          circle(c, 0, 0, area.radius * 0.62, '#e8d9aa', 1.2);
          c.restore();
          line(
            c,
            area.x - area.radius * 0.55,
            area.y,
            area.x + area.radius * 0.55,
            area.y,
            fusion.color,
            1,
          );
          break;
        case 'fusion-sanctuary':
          for (const sign of [-1, 1]) {
            circle(c, area.x + sign * area.radius * 0.28, area.y, area.radius * 0.18, '#eaffda', 1);
          }
          break;
        case 'fusion-hoarfrost':
          for (let i = 0; i < 4; i++) {
            const angle = (i * TAU) / 4 + (this.motion ? this.time * 0.12 : 0);
            line(
              c,
              area.x + Math.cos(angle) * area.radius * 0.52,
              area.y + Math.sin(angle) * area.radius * 0.52,
              area.x + Math.cos(angle) * area.radius * 0.68,
              area.y + Math.sin(angle) * area.radius * 0.68,
              '#eafcff',
              1.4,
            );
          }
          break;
      }
    }
    c.restore();
  }

  private fusionCrests(c: Ctx, s: RunV2) {
    let index = 0;
    for (const core of s.weapons) {
      const fusion = this.fusionOwners.get(core.id);
      if (!fusion) continue;
      const angle = -Math.PI / 2 + (index++ * TAU) / 6;
      const x = CX + Math.cos(angle) * 86,
        y = CY - 13 + Math.sin(angle) * 70;
      const charge = this.motion ? 0.5 + 0.5 * Math.sin(this.time * 1.5 + index) : 0.5;
      c.save();
      c.globalAlpha = 0.55 + charge * 0.2;
      this.drawFusionMark(c, fusion, x, y, 13);
      if (this.detail) {
        c.globalAlpha = 0.72;
        switch (fusion.id) {
          case 'fusion-pyroclasm':
          case 'fusion-impact-well':
            c.save();
            c.translate(x, y);
            c.rotate(this.motion ? this.time * 0.25 : 0);
            c.scale(1, 0.45);
            circle(c, 0, 0, 19, fusion.color, 1);
            c.restore();
            break;
          case 'fusion-tempest':
          case 'fusion-rimechoir':
            circle(c, x, y, 19 + charge * 2, fusion.color, 1);
            break;
          case 'fusion-reliquary':
          case 'fusion-parallax':
            c.save();
            c.translate(x, y);
            c.rotate(-0.45);
            c.scale(1, 0.48);
            circle(c, 0, 0, 19, '#c9ad7c', 1);
            c.restore();
            break;
          case 'fusion-sanctuary':
            for (const side of [-1, 1]) circle(c, x + side * 17, y, 2.2, '#eaffda', 1);
            break;
          case 'fusion-hoarfrost':
            for (let i = 0; i < 4; i++) {
              const a = (i * TAU) / 4;
              line(
                c,
                x + Math.cos(a) * 17,
                y + Math.sin(a) * 17,
                x + Math.cos(a) * 21,
                y + Math.sin(a) * 21,
                '#eafcff',
                1.2,
              );
            }
            break;
        }
        c.globalAlpha = (0.12 + charge * 0.08) * Math.min(1, this.intensity);
        circle(c, CX, CY - 13, 69 + index * 3, fusion.color, 0.8);
      }
      c.restore();
    }
  }

  private fusionTransformation(c: Ctx, visual: VisualV2, fusion: FusionDefinition) {
    const fade = clamp(visual.life / Math.max(0.001, visual.maxLife));
    const progress = 1 - fade;
    const radius = this.motion ? 44 + progress * 48 : 69;
    const colors = fusion.ingredients.map((kind) => WEAPON_BY_ID[kind]?.color || fusion.color);
    c.save();
    c.globalAlpha = Math.min(0.75, fade * 1.3) * Math.min(1, this.intensity);
    if (this.detail) this.glow(c, visual.x, visual.y, radius * 1.2, fusion.color, 0.13 * fade);
    this.rune(
      c,
      visual.x,
      visual.y,
      radius,
      '#c9ad7c',
      this.detail ? 12 : 6,
      this.motion ? progress * 0.45 : 0,
    );
    for (let i = 0; i < 2; i++) {
      c.beginPath();
      c.arc(visual.x, visual.y, radius * 0.8, i * Math.PI + 0.2, (i + 1) * Math.PI - 0.2);
      c.strokeStyle = colors[i];
      c.lineWidth = 2;
      c.stroke();
    }
    this.drawFusionMark(c, fusion, visual.x, visual.y, 29);
    c.restore();
  }

  private warning(c: Ctx, a: AreaEffect) {
    const r = a.radius;
    c.save();
    c.globalAlpha = 0.95;
    c.setLineDash([8, 5]);
    circle(c, a.x, a.y, r, '#ffc58a', 2);
    c.setLineDash([]);
    circle(c, a.x, a.y, r * 0.76, '#ffc58a', 1);
    line(c, a.x - 9, a.y, a.x + 9, a.y, '#fff2ca', 2);
    line(c, a.x, a.y - 9, a.x, a.y + 9, '#fff2ca', 2);
    for (let i = 0; i < 4; i++) {
      const t = (i * TAU) / 4;
      line(
        c,
        a.x + Math.cos(t) * (r + 4),
        a.y + Math.sin(t) * (r + 4),
        a.x + Math.cos(t) * (r + 10),
        a.y + Math.sin(t) * (r + 10),
        '#ffe0ac',
        2,
      );
    }
    c.restore();
  }
  private area(c: Ctx, a: AreaEffect) {
    if (a.delay > 0) {
      if (a.kind === 'meteor') {
        const descent = clamp(1 - a.delay / 0.9);
        const height = this.motion ? (1 - descent) * 235 : 85;
        const x = a.x - height * 0.55,
          y = a.y - height;
        this.glow(c, x, y, 50, COLORS.fire, 0.38);
        c.save();
        c.globalAlpha = 0.85;
        const comet = c.createLinearGradient(x - 70, y - 125, x, y);
        comet.addColorStop(0, 'transparent');
        comet.addColorStop(1, COLORS.fire);
        poly(
          c,
          [
            [x - 85, y - 140],
            [x + 9, y - 5],
            [x, y + 10],
            [x - 12, y + 3],
          ],
          comet as unknown as string,
        );
        c.translate(x, y);
        gem(c, 10 + a.radius * 0.08, '#ffe2ab', COLORS.fire);
        c.restore();
      }
      return;
    }
    const color = COLORS[a.element] || COLORS.void,
      r = a.radius;
    const fade = clamp(a.life / Math.min(1, a.maxLife));
    if (this.fieldDetails++ >= (this.detail ? 24 : 8)) {
      c.save();
      c.globalAlpha = fade * 0.45;
      circle(c, a.x, a.y, r, color, 1.5);
      c.restore();
      return;
    }
    c.save();
    c.globalAlpha = fade;
    this.glow(c, a.x, a.y, r * 1.3, color, 0.15);
    c.globalAlpha *= 0.13;
    c.fillStyle = color;
    c.beginPath();
    c.arc(a.x, a.y, r, 0, TAU);
    c.fill();
    c.globalAlpha = fade;
    c.save();
    c.translate(a.x, a.y);
    c.rotate(this.time * 0.1 + a.id);
    c.globalAlpha *= 0.6;
    circle(c, 0, 0, r, color, 1.5);
    c.setLineDash([r * 0.12, r * 0.08]);
    circle(c, 0, 0, r * 0.79, color, 1);
    c.setLineDash([]);
    c.restore();
    const count = this.detail ? 10 : 4;
    if (a.kind === 'frost') {
      for (let i = 0; i < count; i++) {
        const angle = hash(a.id + i) * TAU,
          distance = Math.sqrt(hash(i + 81)) * r * 0.85;
        const x = a.x + Math.cos(angle) * distance,
          y = a.y + Math.sin(angle) * distance;
        const h = 8 + hash(i + 18) * 17;
        poly(
          c,
          [
            [x - 4, y + 2],
            [x - 3, y - h * 0.6],
            [x + 1, y - h],
            [x + 5, y],
          ],
          '#558e9b',
          color,
        );
        line(c, x + 1, y - h, x + 1, y, '#d7f9ed', 1);
      }
    } else if (a.kind === 'poison') {
      for (let i = 0; i < count; i++) {
        const phase = (this.time * 0.24 + hash(i + a.id)) % 1;
        const x = a.x + (hash(i * 17 + a.id) - 0.5) * r * 1.5;
        const y = a.y + (hash(i * 31) - 0.5) * r - phase * 25;
        c.globalAlpha = fade * (1 - phase) * 0.3;
        circle(c, x, y, 5 + phase * 10, color, 1.5);
      }
    } else if (a.kind === 'fire' || a.kind === 'meteor' || a.kind === 'solar') {
      if (a.kind === 'meteor') {
        c.globalAlpha = fade * 0.8;
        circle(c, a.x, a.y, r * 0.55, '#332c29', 8);
        circle(c, a.x, a.y, r * 0.59, '#b67750', 2);
      }
      for (let i = 0; i < count; i++) {
        const angle = (i * TAU) / count + hash(a.id),
          distance = r * (0.4 + hash(i + 8) * 0.4);
        const x = a.x + Math.cos(angle) * distance,
          y = a.y + Math.sin(angle) * distance;
        const h = 5 + (1 + Math.sin(this.time * 5 + i)) * 5;
        c.globalAlpha = fade * 0.8;
        poly(
          c,
          [
            [x - 3, y],
            [x, y - h],
            [x + 4, y],
          ],
          i % 3 ? color : '#ffe4ae',
        );
      }
    } else if (a.kind === 'storm') {
      for (let i = 0; i < (this.detail ? 3 : 1); i++) {
        const angle = this.time * 0.5 + (i * TAU) / 3,
          x = a.x + Math.cos(angle) * r * 0.8,
          y = a.y + Math.sin(angle) * r * 0.8;
        c.globalAlpha = 0.5 * fade;
        this.lightning(c, a.x, a.y, x, y, color, a.id + i, 1.5);
      }
    } else {
      c.globalAlpha = 0.6 * fade;
      this.rune(c, a.x, a.y, r * 0.62, color, 8, this.time * 0.15);
      if (a.kind === 'void') {
        c.save();
        c.translate(a.x, a.y);
        c.rotate(this.time * -0.2);
        c.scale(1, 0.45);
        circle(c, 0, 0, r * 0.9, '#e5c3ed', 2);
        c.restore();
      }
    }
    c.restore();
  }

  private arsenalCardVisual(
    c: Ctx,
    kind: string,
    x: number,
    y: number,
    radius: number,
    color: string,
    progress: number,
  ) {
    const phase = this.motion ? progress : 0.5;
    const inset = Math.max(3, radius * 0.42);
    const ring = radius * (0.58 + phase * 0.34);
    switch (kind) {
      case 'ars-growth':
        this.glow(c, x, y, ring, color, 0.12);
        circle(c, x, y, ring, color, 2);
        circle(c, x, y, ring * 0.72, '#fff0c4', 1);
        break;
      case 'ars-rebound':
        c.save();
        c.translate(x, y);
        c.rotate(phase * 0.35);
        c.scale(1, 0.6);
        circle(c, 0, 0, radius * 0.9, color, 1.7);
        c.restore();
        line(c, x - inset, y - inset * 0.4, x + inset, y - inset * 0.4, '#fff0c4', 1.7);
        poly(
          c,
          [
            [x + inset, y - inset],
            [x + inset * 1.5, y - inset * 0.4],
            [x + inset, y + inset * 0.2],
          ],
          color,
          '#fff0c4',
          0.8,
        );
        break;
      case 'ars-return':
        circle(c, x, y, ring, color, 1.7);
        c.save();
        c.translate(x, y);
        c.rotate(Math.PI * 0.78);
        line(c, -radius * 0.75, 0, radius * 0.45, 0, '#fff0c4', 1.6);
        poly(
          c,
          [
            [radius * 0.45, -4],
            [radius * 0.8, 0],
            [radius * 0.45, 4],
          ],
          color,
          '#fff0c4',
          1,
        );
        c.restore();
        break;
      case 'ars-shards':
        for (let i = 0; i < 3; i++) {
          c.save();
          c.translate(x, y);
          c.rotate((i * TAU) / 3 + (phase - 0.5) * 0.25);
          poly(
            c,
            [
              [inset, 0],
              [inset * 1.75, -4],
              [inset * 1.55, 0],
              [inset * 1.75, 4],
            ],
            color,
            '#fff0c4',
            0.8,
          );
          c.restore();
        }
        circle(c, x, y, inset * 0.72, color, 1.2);
        break;
      case 'ars-erosion':
        poly(
          c,
          [
            [x, y - inset],
            [x + inset, y - inset * 0.35],
            [x + inset * 0.65, y + inset],
            [x - inset * 0.65, y + inset],
            [x - inset, y - inset * 0.35],
          ],
          '#182b27',
          color,
          1.5,
        );
        line(c, x - 2, y - inset * 0.7, x + 2, y - 1, '#fff0c4', 1.4);
        line(c, x + 2, y - 1, x - 3, y + inset * 0.75, color, 1.4);
        break;
      case 'ars-crossfire':
        c.save();
        c.translate(x, y);
        c.rotate(Math.PI / 4);
        this.rune(c, 0, 0, inset * 0.78, color, 4, 0);
        c.restore();
        c.save();
        c.translate(x, y);
        c.rotate(-Math.PI / 4);
        this.rune(c, 0, 0, inset * 0.78, '#fff0c4', 4, 0);
        c.restore();
        break;
      case 'ars-absorb':
        poly(
          c,
          [
            [x, y - inset],
            [x + inset * 0.8, y - inset * 0.55],
            [x + inset * 0.65, y + inset * 0.35],
            [x, y + inset],
            [x - inset * 0.65, y + inset * 0.35],
            [x - inset * 0.8, y - inset * 0.55],
          ],
          '#254b53',
          color,
          1.8,
        );
        circle(c, x, y, inset * 0.4, '#fff0c4', 1.2);
        break;
      case 'ars-mend':
        c.save();
        c.translate(x, y);
        c.save();
        c.scale(1, 0.55);
        circle(c, 0, 0, ring * 0.72, color, 1.7);
        c.restore();
        line(c, -inset * 0.45, 0, inset * 0.45, 0, '#eaffda', 2);
        line(c, 0, -inset * 0.45, 0, inset * 0.45, '#eaffda', 2);
        c.restore();
        break;
      case 'ars-critical':
        poly(
          c,
          [
            [x, y - inset],
            [x + inset * 0.55, y - inset * 0.3],
            [x + inset * 0.35, y + inset * 0.65],
            [x, y + inset],
            [x - inset * 0.35, y + inset * 0.65],
            [x - inset * 0.55, y - inset * 0.3],
          ],
          '#172622',
          color,
          1.8,
        );
        line(c, x, y - inset * 0.72, x, y + inset * 0.75, '#fff0c4', 1);
        line(
          c,
          x - inset * 0.42,
          y - inset * 0.22,
          x + inset * 0.42,
          y - inset * 0.22,
          '#fff0c4',
          1,
        );
        break;
      case 'ars-briar':
        circle(c, x, y, inset * 0.6, color, 1.3);
        for (let i = 0; i < 6; i++) {
          const a = (i * TAU) / 6;
          const x1 = x + Math.cos(a) * inset * 0.48,
            y1 = y + Math.sin(a) * inset * 0.48;
          const x2 = x + Math.cos(a) * inset,
            y2 = y + Math.sin(a) * inset;
          line(c, x1, y1, x2, y2, color, 2);
          line(c, x2, y2, x2 - Math.sin(a) * 3, y2 + Math.cos(a) * 3, '#fff0c4', 1);
        }
        break;
      case 'ars-resonance':
        for (const scale of [0.52, 0.76, 1]) circle(c, x, y, radius * scale, color, 1.4);
        circle(c, x, y, radius * 0.25, '#fff0c4', 1);
        break;
      case 'ars-release':
        circle(c, x, y, ring * 0.58, '#dffaff', 1.2);
        for (let i = 0; i < 8; i++) {
          const a = (i * TAU) / 8;
          line(
            c,
            x + Math.cos(a) * inset * 0.55,
            y + Math.sin(a) * inset * 0.55,
            x + Math.cos(a) * inset,
            y + Math.sin(a) * inset,
            color,
            1.7,
          );
        }
        break;
    }
  }

  private isForeground(v: VisualV2) {
    return /^(text|synergy|hit|impact|reflect|thorns|retaliation|shield|shield-break|evolution|evolve-tier)$/.test(
      v.kind,
    );
  }
  private visual(c: Ctx, v: VisualV2) {
    const fusion = this.resolveFusion(v.kind);
    if (fusion) {
      this.fusionTransformation(c, v, fusion);
      return;
    }
    const f = clamp(v.life / Math.max(0.001, v.maxLife)),
      p = 1 - f;
    const r = Math.max(2, v.size),
      color = v.color || '#d9e7c6';
    c.save();
    c.globalAlpha = Math.min(1, f * 2);
    if (v.kind === 'evolve-tier') {
      const radius = r * (this.motion ? 0.55 + p * 0.65 : 0.9);
      this.rune(c, v.x, v.y, radius, color, 14, this.time * 0.12);
      for (const direction of [-1, 1]) {
        const x = v.x + direction * radius * 0.65;
        poly(
          c,
          [
            [x, v.y - 27],
            [x + direction * 7, v.y - 13],
            [x, v.y + 2],
            [x - direction * 4, v.y - 13],
          ],
          '#163238',
          color,
          2,
        );
      }
      c.font = '600 13px ui-monospace, monospace';
      c.textAlign = 'center';
      c.lineWidth = 4;
      c.strokeStyle = '#081c22';
      c.fillStyle = color;
      const y = v.y - radius - 14 - (this.motion ? p * 10 : 0);
      c.strokeText(v.text || 'Evolution', v.x, y);
      c.fillText(v.text || 'Evolution', v.x, y);
    } else if (v.kind === 'text' || v.kind === 'synergy') {
      c.font = `${v.kind === 'synergy' ? 600 : 500} ${v.kind === 'synergy' ? 14 : 11}px ui-monospace, monospace`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineWidth = 3;
      c.strokeStyle = '#081c22';
      c.fillStyle = color;
      const y = v.y - (this.motion ? p * 22 : 0);
      c.strokeText(v.text || '', v.x, y);
      c.fillText(v.text || '', v.x, y);
    } else if (/^(beam|rail|flame|ray)$/.test(v.kind)) {
      const x2 = v.x2 ?? CX,
        y2 = v.y2 ?? CY,
        width = Math.max(1.5, r * f);
      c.globalAlpha *= 0.16 * this.intensity;
      line(c, v.x, v.y, x2, y2, color, width * 3);
      c.globalAlpha = Math.min(1, f * 2);
      line(c, v.x, v.y, x2, y2, color, width);
      line(c, v.x, v.y, x2, y2, v.secondaryColor || '#fff3d9', Math.max(1, width * 0.22));
      if (v.kind === 'rail') {
        const dx = x2 - v.x,
          dy = y2 - v.y,
          length = Math.hypot(dx, dy) || 1;
        const nx = (-dy / length) * (width + 3),
          ny = (dx / length) * (width + 3);
        line(c, v.x + nx, v.y + ny, x2 + nx, y2 + ny, color, 1);
        line(c, v.x - nx, v.y - ny, x2 - nx, y2 - ny, color, 1);
      }
    } else if (/^(chain|tesla|lightning)$/.test(v.kind)) {
      this.lightning(
        c,
        v.x,
        v.y,
        v.x2 ?? CX,
        v.y2 ?? CY,
        color,
        v.seed ?? v.x + v.y,
        Math.max(1.5, r * 0.2),
      );
    } else if (v.kind.startsWith('ars-')) {
      this.arsenalCardVisual(c, v.kind, v.x, v.y, r, color, p);
    } else if (v.kind === 'hazard') {
      c.globalAlpha *= 0.12;
      c.beginPath();
      c.arc(v.x, v.y, r, 0, TAU);
      c.fillStyle = color;
      c.fill();
      c.globalAlpha = 0.9;
      c.setLineDash([6, 5]);
      circle(c, v.x, v.y, r, color, 2);
      c.setLineDash([]);
    } else if (v.kind === 'shield' || v.kind === 'shield-break') {
      this.shield(c, v.x, v.y, r * (v.kind === 'shield-break' ? 1 + p * 0.25 : 1), color, f);
    } else if (v.kind === 'reflect') {
      c.translate(v.x, v.y);
      c.rotate(Math.atan2((v.y2 ?? CY) - v.y, (v.x2 ?? CX) - v.x));
      poly(
        c,
        [
          [r * 0.6, -r],
          [r, 0],
          [r * 0.6, r],
          [-r * 0.3, r * 0.65],
          [0, 0],
          [-r * 0.3, -r * 0.65],
        ],
        '#254b53',
        color,
        2,
      );
      line(c, -r, 0, -r * 0.2, 0, '#f3f4d2', 2);
    } else if (v.kind === 'thorns' || v.kind === 'retaliation') {
      const count = v.kind === 'thorns' ? 10 : 8;
      for (let i = 0; i < count; i++) {
        const angle = (i * TAU) / count;
        c.save();
        c.translate(v.x, v.y);
        c.rotate(angle);
        const distance = r * (0.5 + (this.motion ? p : 0.3) * 0.5);
        poly(
          c,
          [
            [distance - 10, -3],
            [distance + 10, 0],
            [distance - 10, 3],
            [distance - 5, 0],
          ],
          color,
          v.secondaryColor || '#fff0ce',
        );
        c.restore();
      }
      circle(c, v.x, v.y, r * (0.5 + p * 0.4), color, 1.5);
    } else if (v.kind === 'evolution' || v.kind === 'rune') {
      this.rune(c, v.x, v.y, r, color, 10, this.time * 0.2);
    } else if (v.kind === 'ring' || v.kind === 'pulse' || v.kind === 'nova') {
      const radius = r * (this.motion ? 0.35 + p * 0.65 : 0.85);
      this.glow(c, v.x, v.y, radius * 1.15, color, 0.12 * f);
      circle(c, v.x, v.y, radius, color, Math.max(1, 3 * f));
      if (this.detail) {
        c.globalAlpha *= 0.45;
        circle(c, v.x, v.y, radius * 0.87, v.secondaryColor || color, 1);
      }
    } else {
      this.glow(c, v.x, v.y, Math.min(70, r * 1.6), color, 0.3 * f);
      const count = this.detail ? 7 : 3;
      for (let i = 0; i < count; i++) {
        const a = hash(i * 17 + (v.seed ?? v.x)) * TAU,
          distance = (this.motion ? p : 0.25) * r;
        const x = v.x + Math.cos(a) * distance,
          y = v.y + Math.sin(a) * distance;
        line(
          c,
          x,
          y,
          x + Math.cos(a) * (3 + 5 * f),
          y + Math.sin(a) * (3 + 5 * f),
          i % 3 ? color : '#fff1ce',
          Math.max(1, f * 2),
        );
      }
    }
    c.restore();
  }

  private lightning(
    c: Ctx,
    x: number,
    y: number,
    x2: number,
    y2: number,
    color: string,
    seed: number,
    width: number,
  ) {
    const dx = x2 - x,
      dy = y2 - y,
      length = Math.hypot(dx, dy) || 1;
    const steps = Math.max(3, Math.min(16, Math.ceil(length / 22))),
      nx = -dy / length,
      ny = dx / length;
    const tick = this.motion ? Math.floor(this.time * 12) : 0;
    c.beginPath();
    c.moveTo(x, y);
    for (let i = 1; i < steps; i++) {
      const offset = (hash(seed + i * 9 + tick) - 0.5) * Math.min(24, length * 0.14);
      const px = x + (dx * i) / steps + nx * offset,
        py = y + (dy * i) / steps + ny * offset;
      c.lineTo(px, py);
      if (this.detail && i % 3 === 0) {
        c.lineTo(
          px + nx * offset * 1.8 + (dx / steps) * 0.3,
          py + ny * offset * 1.8 + (dy / steps) * 0.3,
        );
        c.moveTo(px, py);
      }
    }
    c.lineTo(x2, y2);
    c.strokeStyle = color;
    c.lineWidth = width + 2;
    c.stroke();
    c.strokeStyle = '#fff3e3';
    c.lineWidth = Math.max(0.8, width * 0.32);
    c.stroke();
  }
  private rune(
    c: Ctx,
    x: number,
    y: number,
    r: number,
    color: string,
    sides: number,
    rotation = 0,
  ) {
    c.save();
    c.translate(x, y);
    c.rotate(rotation);
    circle(c, 0, 0, r, color, 1);
    c.beginPath();
    for (let i = 0; i <= sides; i++) {
      const angle = (i * TAU) / sides,
        px = Math.cos(angle) * r * 0.88,
        py = Math.sin(angle) * r * 0.88;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.strokeStyle = color;
    c.lineWidth = 1;
    c.stroke();
    for (let i = 0; i < sides; i++) {
      c.save();
      c.rotate((i * TAU) / sides);
      line(c, r - 3, -3, r + 3, 3, color);
      line(c, r, -5, r, 5, color);
      c.restore();
    }
    c.restore();
  }
  private shield(c: Ctx, x: number, y: number, r: number, color: string, strength: number) {
    c.save();
    c.translate(x, y);
    const points: number[][] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i * TAU) / 8 + Math.PI / 8;
      points.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    c.globalAlpha *= 0.07 + strength * 0.05;
    poly(c, points, color);
    c.globalAlpha = 0.4 + strength * 0.35;
    for (let i = 0; i < 8; i++) {
      const a = points[i],
        b = points[(i + 1) % 8];
      line(c, a[0], a[1], b[0], b[1], color, i % 2 ? 1 : 2);
      if (this.detail) line(c, a[0] * 0.68, a[1] * 0.68, a[0], a[1], color, 0.7);
    }
    c.restore();
  }
  private evolution(c: Ctx, s: RunV2) {
    if (!s.synergies.length) return;
    c.save();
    c.globalAlpha = 0.38;
    c.translate(CX, CY + 18);
    c.scale(1, 0.38);
    this.rune(c, 0, 0, 77 + Math.min(s.synergies.length, 5) * 4, '#d9c58e', 12, this.time * 0.08);
    c.restore();
  }

  /** Presentation only: the original tower remains beneath its evolving machinery. */
  private evolvedTower(c: Ctx, s: RunV2 & { evolution?: EvolutionState }) {
    const state = s.evolution;
    if (!state?.path || state.tier < 1 || !Object.hasOwn(EVOLUTION_BY_ID, state.path)) return;
    const path = EVOLUTION_BY_ID[state.path];
    if (path.tower !== s.tower) return;
    const tier = state.tier;
    const brass = '#bda574',
      dark = '#102a2f',
      color = path.color;
    c.save();
    c.translate(CX, CY - 21);
    // Solid uprights, rivets and a new core housing remain legible at low detail.
    for (const side of [-1, 1]) {
      poly(
        c,
        [
          [side * 18, -32],
          [side * 30, -24],
          [side * 30, 42],
          [side * 20, 42],
        ],
        dark,
        brass,
        2,
      );
      line(c, side * 25, -19, side * 25, 33, color, 2);
      for (const y of [-24, 36]) circle(c, side * 25, y, 2, '#f4dca3', 1.5);
    }
    poly(
      c,
      [
        [-17, -21],
        [0, -30],
        [17, -21],
        [17, 21],
        [0, 29],
        [-17, 21],
      ],
      dark,
      brass,
      2,
    );
    if (this.detail) {
      this.glow(c, 0, 0, 23, color, 0.12 * this.intensity);
      for (const x of [-11, -6, 6, 11]) line(c, x, 18, x, 22, brass, 1);
    }
    // Tier one is a compact mechanism; the signature tier unfolds its apparatus.
    c.save();
    const scale = tier === 1 ? 0.48 : 1;
    c.scale(scale, scale);
    const spoke = (x: number, y: number, radius = 6) => {
      line(c, 0, 0, x, y, brass, 2);
      circle(c, x, y, radius, color, 2.5);
      circle(c, x, y, Math.max(2, radius - 3), brass, 1);
    };
    switch (state.path) {
      case 'citadel':
        poly(
          c,
          [
            [-31, -25],
            [31, -25],
            [31, 13],
            [0, 39],
            [-31, 13],
          ],
          dark,
          brass,
          3,
        );
        poly(
          c,
          [
            [-21, -14],
            [21, -14],
            [21, 10],
            [0, 28],
            [-21, 10],
          ],
          '#213c3c',
          color,
          2,
        );
        for (let i = 0; i < tier + 1; i++) line(c, -12, -7 + i * 7, 12, -7 + i * 7, color, 3);
        break;
      case 'vanguard':
        poly(
          c,
          [
            [0, -38],
            [17, -5],
            [0, 29],
            [-17, -5],
          ],
          dark,
          color,
          3,
        );
        for (const side of [-1, 1]) {
          line(c, side * 18, -5, side * 46, -5, brass, 4);
          line(c, side * 46, -18, side * 46, 8, color, 3);
          poly(
            c,
            [
              [side * 23, -5],
              [side * 35, -12],
              [side * 35, 2],
            ],
            color,
          );
        }
        break;
      case 'furnace':
        poly(
          c,
          [
            [-28, -25],
            [28, -25],
            [28, 32],
            [-28, 32],
          ],
          dark,
          brass,
          3,
        );
        for (const side of [-1, 1]) {
          poly(
            c,
            [
              [side * 24, -18],
              [side * 43, -18],
              [side * 43, -43],
              [side * 34, -43],
              [side * 34, -28],
              [side * 24, -28],
            ],
            dark,
            brass,
            2,
          );
          line(c, side * 36, 24, side * 54, 24, color, 4);
        }
        poly(
          c,
          [
            [-16, 20],
            [-16, 1],
            [-7, -16],
            [0, -3],
            [10, -20],
            [17, 3],
            [13, 20],
          ],
          '#8b4c31',
          color,
          2,
        );
        break;
      case 'crownflare':
        poly(
          c,
          [
            [-36, -25],
            [-22, -14],
            [0, -43],
            [22, -14],
            [36, -25],
            [28, 20],
            [-28, 20],
          ],
          dark,
          brass,
          3,
        );
        for (const x of [-18, 0, 18])
          poly(
            c,
            [
              [x, -15],
              [x + 6, 1],
              [x, 14],
              [x - 6, 1],
            ],
            color,
            '#ffe0a0',
            1,
          );
        line(c, -29, 27, 29, 27, color, 4);
        break;
      case 'stormweaver':
        for (const x of [-42, 42]) for (const y of [-29, 26]) spoke(x, y);
        for (const side of [-1, 1]) line(c, side * 42, -23, side * 42, 20, color, 2);
        poly(
          c,
          [
            [4, -29],
            [-14, 4],
            [0, 4],
            [-5, 29],
            [18, -9],
            [4, -9],
          ],
          color,
          brass,
          1.5,
        );
        break;
      case 'thunderhead':
        poly(
          c,
          [
            [-35, -10],
            [-26, -34],
            [26, -34],
            [35, -10],
          ],
          dark,
          brass,
          3,
        );
        for (const y of [-26, -19, -12]) line(c, -25, y, 25, y, color, 2);
        poly(
          c,
          [
            [-4, -5],
            [-20, 17],
            [-4, 17],
            [-10, 38],
            [20, 7],
            [3, 7],
            [10, -5],
          ],
          color,
          brass,
          1.5,
        );
        break;
      case 'winterhold':
        for (const side of [-1, 1]) {
          poly(
            c,
            [
              [side * 29, -35],
              [side * 49, -18],
              [side * 49, 31],
              [side * 29, 31],
            ],
            dark,
            color,
            3,
          );
          line(c, side * 33, -16, side * 44, -6, brass, 2);
        }
        poly(
          c,
          [
            [-11, -41],
            [11, -41],
            [17, 32],
            [-17, 32],
          ],
          '#254953',
          brass,
          2,
        );
        line(c, 0, -31, 0, 22, color, 4);
        break;
      case 'shatterspire':
        poly(
          c,
          [
            [0, -48],
            [17, -20],
            [5, -4],
            [20, 35],
            [-14, 16],
            [-5, -6],
            [-17, -26],
          ],
          '#294653',
          color,
          3,
        );
        for (const side of [-1, 1])
          poly(
            c,
            [
              [side * 29, 32],
              [side * 48, -24],
              [side * 30, -7],
            ],
            dark,
            color,
            2,
          );
        line(c, 0, -33, 7, -20, brass, 2);
        line(c, 7, -20, -4, 3, brass, 2);
        break;
      case 'rootwarden':
        for (const side of [-1, 1]) {
          poly(
            c,
            [
              [side * 8, 31],
              [side * 14, -6],
              [side * 43, -27],
              [side * 35, -2],
              [side * 21, 3],
              [side * 19, 31],
            ],
            '#263e31',
            brass,
            2,
          );
          poly(
            c,
            [
              [side * 22, 18],
              [side * 48, 10],
              [side * 39, 28],
            ],
            '#38593b',
            color,
            2,
          );
        }
        line(c, 0, -18, 0, 13, color, 6);
        line(c, -15, -3, 15, -3, color, 6);
        break;
      case 'blightbloom':
        for (let i = 0; i < 5; i++) {
          const a = (i * TAU) / 5 - Math.PI / 2;
          const x = Math.cos(a) * 23,
            y = Math.sin(a) * 23;
          poly(
            c,
            [
              [0, 0],
              [x - 13, y - 10],
              [x * 1.7, y * 1.7],
              [x + 13, y + 10],
            ],
            '#304338',
            brass,
            2,
          );
        }
        circle(c, 0, 0, 12, color, 5);
        for (const side of [-1, 1]) line(c, side * 18, 36, side * 45, 36, color, 3);
        break;
      case 'event-horizon':
        for (const side of [-1, 1])
          poly(
            c,
            [
              [side * 20, -39],
              [side * 37, -27],
              [side * 37, 25],
              [side * 20, 38],
              [side * 27, 20],
              [side * 27, -20],
            ],
            dark,
            brass,
            3,
          );
        circle(c, 0, 0, 24, color, 3);
        circle(c, 0, 0, 14, '#080f1b', 12);
        for (const side of [-1, 1]) line(c, side * 18, 0, side * 44, 0, color, 3);
        break;
      case 'rift-engine':
        poly(
          c,
          [
            [-44, -18],
            [24, -18],
            [49, 0],
            [24, 18],
            [-44, 18],
          ],
          dark,
          brass,
          3,
        );
        line(c, -40, 0, 47, 0, color, 5);
        for (const x of [-24, -9, 6, 21]) line(c, x, -24, x + 12, 24, brass, 3);
        poly(
          c,
          [
            [0, -41],
            [11, -22],
            [-11, -22],
          ],
          color,
          brass,
          1.5,
        );
        break;
      case 'mirror-regent':
        for (const [x, y] of [
          [0, -30],
          [-42, 21],
          [42, 21],
        ]) {
          line(c, 0, 4, x, y, color, 2);
          poly(
            c,
            [
              [x, y - 20],
              [x + 12, y],
              [x, y + 20],
              [x - 12, y],
            ],
            '#31464c',
            brass,
            2,
          );
          line(c, x - 5, y - 8, x + 5, y + 7, color, 3);
        }
        line(c, -31, 21, 31, 21, color, 2);
        break;
      case 'ironbriar':
        poly(
          c,
          [
            [-18, -29],
            [18, -29],
            [31, 0],
            [18, 30],
            [-18, 30],
            [-31, 0],
          ],
          '#293d34',
          brass,
          4,
        );
        for (const side of [-1, 1]) {
          poly(
            c,
            [
              [side * 21, -21],
              [side * 48, -35],
              [side * 33, -7],
            ],
            dark,
            color,
            2,
          );
          poly(
            c,
            [
              [side * 28, 7],
              [side * 50, 27],
              [side * 16, 23],
            ],
            dark,
            color,
            2,
          );
        }
        gem(c, 13, color, brass);
        break;
    }
    c.restore();
    if (tier >= 3) {
      // A completed crown physically joins both sides of the signature apparatus.
      poly(
        c,
        [
          [-39, -48],
          [-29, -65],
          [-14, -52],
          [0, -73],
          [14, -52],
          [29, -65],
          [39, -48],
          [31, -39],
          [-31, -39],
        ],
        dark,
        brass,
        2.5,
      );
      for (const x of [-26, 0, 26]) {
        line(c, x, -47, x, -56 - (x === 0 ? 8 : 0), color, 3);
        line(c, x, -39, x, -30, color, 2);
      }
      if (this.detail) {
        c.globalAlpha = 0.6 + (this.motion ? Math.sin(this.time * 2) * 0.12 : 0);
        line(c, -33, -43, 33, -43, color, 1.5);
      }
    }
    c.restore();
  }
  private coreBars(c: Ctx, s: RunV2) {
    c.fillStyle = '#061b20';
    c.fillRect(CX - 36, CY + 49, 72, 8);
    c.fillStyle = s.hp / s.maxHp < 0.3 ? '#ee9e86' : '#bbd6b0';
    c.fillRect(CX - 34, CY + 51, 68 * clamp(s.hp / s.maxHp), 3);
    if (s.shield > 0) {
      c.fillStyle = '#b4e5e8';
      c.fillRect(CX - 34, CY + 59, 68 * clamp(s.shield / s.maxHp), 2);
    }
  }
}
