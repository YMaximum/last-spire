import { ENEMY_BY_ID } from '../content/enemies';
import type { EnemyV2, RunV2 } from '../game/types';
import type { EnemyArchetypeId } from '../content/enemies';

type Ctx = CanvasRenderingContext2D;

interface Sprite {
  color: string;
  rim: string;
  pixels: string[];
}

// Small authored pixel stamps keep the stage roster legible at combat scale.
// Characters are silhouette, metal, or arcane-light pixels, not animation frames.
const SPRITES: Partial<Record<EnemyArchetypeId, Sprite>> = {
  'thorn-retaliator': {
    color: '#91b875',
    rim: '#d6e6a7',
    pixels: [
      '..^...^..',
      '.^^^#^^^.',
      '..+###+..',
      '.+#####..',
      '..#####..',
      '.#######.',
      '..#o#o#..',
      '...###...',
      '..#...#..',
    ],
  },
  'spore-shepherd': {
    color: '#b2d18c',
    rim: '#eff4bd',
    pixels: [
      '...ooo...',
      '..ooooo..',
      '.o#####o.',
      '..+###+..',
      '...###...',
      '..#####..',
      '..#o#o#..',
      '...#o#...',
      '..#...#..',
    ],
  },
  burrower: {
    color: '#c7ab79',
    rim: '#eee0b9',
    pixels: [
      '....^....',
      '...###...',
      '..#####..',
      '.#######.',
      '..#####..',
      '..+###...',
      '.+#####..',
      '...###...',
      '..##.##..',
    ],
  },
  'plated-crawler': {
    color: '#d5a26f',
    rim: '#ffe0a0',
    pixels: [
      '..#####..',
      '.#######.',
      '##+###+##',
      '#########',
      '.###+###.',
      '..#####..',
      '.##...##.',
      '##.....##',
      '.........',
    ],
  },
  'furnace-artillery': {
    color: '#f4a76d',
    rim: '#ffe4ad',
    pixels: [
      '....+....',
      '...###...',
      '..#####..',
      '.#######.',
      '#########',
      '.###+###.',
      '..#####..',
      '...###...',
      '..##.##..',
    ],
  },
  'forge-carrier': {
    color: '#e4bd7b',
    rim: '#fff0b8',
    pixels: [
      '....+....',
      '...+#+...',
      '..+###+..',
      '.+#####..',
      '+###+###+',
      '.#######.',
      '..##o##..',
      '...###...',
      '..#...#..',
    ],
  },
  'rift-skirmisher': {
    color: '#bd9be2',
    rim: '#f0d9ff',
    pixels: [
      '..#...#..',
      '.##...##.',
      '..#####..',
      '...###...',
      '.###+###.',
      '...###...',
      '..#####..',
      '.##...##.',
      '#.......#',
    ],
  },
  'pulse-caster': {
    color: '#c5a5ee',
    rim: '#efe0ff',
    pixels: [
      '...ooo...',
      '..o###o..',
      '.o#####o.',
      '..+###+..',
      '...###...',
      '..#####..',
      '.##...##.',
      '..#...#..',
      '.o.....o.',
    ],
  },
  'echo-attacker': {
    color: '#a8b0ed',
    rim: '#e5eaff',
    pixels: [
      '..#...#..',
      '.###.###.',
      '##o#.#o##',
      '.#######.',
      '..#####..',
      '...###...',
      '..#####..',
      '.##...##.',
      '#.......#',
    ],
  },
  'elder-root': {
    color: '#adc77d',
    rim: '#e5f2af',
    pixels: [
      '..#..#..#..',
      '.##.###.##.',
      '..#######..',
      '...##+##...',
      '.#########.',
      '###########',
      '..###o###...',
      '..#######...',
      '.##..#..##..',
      '##...#...##.',
      '.....#.....',
    ],
  },
  'forge-colossus': {
    color: '#efb76f',
    rim: '#fff0bd',
    pixels: [
      '...#####...',
      '..#######..',
      '.###+###+##.',
      '###########',
      '##o#####o##',
      '###########',
      '..###+###...',
      '.#########.',
      '.##.....##.',
      '###.....###.',
      '...##...##...',
    ],
  },
  'last-eclipse': {
    color: '#d6b5fa',
    rim: '#f6eaff',
    pixels: [
      '....ooo....',
      '..oo###oo..',
      '.o#######o.',
      'oo###+###oo',
      '.o#######o.',
      '..#######..',
      '...#####...',
      '..##o#o##..',
      '...#####...',
      '..#.....#..',
      '.##.....##.',
    ],
  },
};

const stamps = new Map<EnemyArchetypeId, HTMLCanvasElement>();
function stamp(id: EnemyArchetypeId): HTMLCanvasElement {
  const cached = stamps.get(id);
  if (cached) return cached;
  const sprite = SPRITES[id]!;
  const image = document.createElement('canvas');
  image.width = Math.max(...sprite.pixels.map((row) => row.length)) * 2;
  image.height = sprite.pixels.length * 2;
  const pen = image.getContext('2d')!;
  for (let y = 0; y < sprite.pixels.length; y++)
    for (let x = 0; x < sprite.pixels[y].length; x++) {
      const mark = sprite.pixels[y][x];
      if (mark === '.') continue;
      pen.fillStyle =
        mark === '+' || mark === '^' ? sprite.rim : mark === 'o' ? '#fff0bd' : sprite.color;
      pen.fillRect(((image.width / 2 - sprite.pixels[y].length) / 2) * 2 + x * 2, y * 2, 2, 2);
    }
  stamps.set(id, image);
  return image;
}
export function hasEncounterSprite(enemy: EnemyV2): boolean {
  return !!enemy.archetypeId && !!SPRITES[enemy.archetypeId];
}

/** Paints new encounter actors with stable, original pixel silhouettes. */
export function drawEncounterSprite(
  c: Ctx,
  enemy: EnemyV2,
  time: number,
  reducedMotion: boolean,
): void {
  const sprite = enemy.archetypeId ? SPRITES[enemy.archetypeId] : undefined;
  if (!sprite) return;
  const rows = sprite.pixels;
  const columns = Math.max(...rows.map((row) => row.length));
  const cell = (enemy.radius * 2) / Math.max(rows.length, columns);
  const width = columns * cell;
  const height = rows.length * cell;
  c.save();
  c.translate(Math.round(enemy.x - width / 2), Math.round(enemy.y - height / 2));
  c.globalAlpha = enemy.hp > 0 ? 1 : 0.42;
  c.fillStyle = '#17221d';
  c.fillRect(cell, height - cell * 0.2, width - cell * 2, cell * 0.65);
  c.imageSmoothingEnabled = false;
  c.drawImage(stamp(enemy.archetypeId!), 0, 0, width, height);
  if (enemy.stun > 0) {
    c.fillStyle = '#fff0a8';
    for (const x of [-0.7, 0, 0.7])
      c.fillRect(width / 2 + x * cell, -cell * 0.65, cell * 0.35, cell * 0.35);
  }
  // Animation is deliberately cosmetic and disabled with reduced motion.
  if (!reducedMotion && enemy.hp > 0) {
    c.globalAlpha = 0.14 + Math.sin(time * 3 + enemy.id) * 0.04;
    c.fillStyle = sprite.rim;
    c.fillRect(width / 2 - cell / 2, height / 2 - cell / 2, cell, cell);
  }
  c.restore();
}

const value = (run: RunV2, enemy: EnemyV2, name: string) =>
  run.counters[`enc-${enemy.id}-${name}`] || 0;
const line = (
  c: Ctx,
  x: number,
  y: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
) => {
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x2, y2);
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
};

/** State-driven warnings and status marks. This pass is read-only and always shown. */
export function drawEncounterWarnings(c: Ctx, run: RunV2, enemy: EnemyV2): void {
  if (!enemy.archetypeId || enemy.hp <= 0) return;
  const id = enemy.archetypeId!;
  const windup = value(run, enemy, 'windup');
  const echo = value(run, enemy, 'echo');
  const recovery = value(run, enemy, 'recovery');
  const covered = id === 'plated-crawler' && (run.time + enemy.id * 0.17) % 5 < 3;
  const barrier = value(run, enemy, 'barrier-until') > run.time ? value(run, enemy, 'barrier') : 0;
  c.save();
  c.globalAlpha = 0.98;
  if (windup > run.time) {
    const supportive = id === 'spore-shepherd' || id === 'forge-carrier';
    const tx = supportive ? enemy.x : value(run, enemy, 'aim-x') || 500;
    const ty = supportive ? enemy.y : value(run, enemy, 'aim-y') || 400;
    const color = supportive
      ? id === 'spore-shepherd'
        ? '#b2d18c'
        : '#8fe1ed'
      : id === 'rift-skirmisher'
        ? '#d4a7ff'
        : id === 'burrower'
          ? '#f3d497'
          : id.includes('boss') ||
              id === 'elder-root' ||
              id === 'forge-colossus' ||
              id === 'last-eclipse'
            ? '#ffcc91'
            : '#ffd789';
    c.setLineDash([5, 5]);
    if (supportive) {
      c.beginPath();
      c.arc(enemy.x, enemy.y, 105, 0, Math.PI * 2);
      c.strokeStyle = color;
      c.lineWidth = 1.5;
      c.stroke();
      const allies = run.enemies
        .filter(
          (a) => a.id !== enemy.id && a.hp > 0 && Math.hypot(a.x - enemy.x, a.y - enemy.y) <= 105,
        )
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)
        .slice(0, 3);
      for (const ally of allies) line(c, enemy.x, enemy.y, ally.x, ally.y, color, 1.5);
    }
    line(c, enemy.x, enemy.y, tx, ty, '#171c1a', 4.5);
    line(c, enemy.x, enemy.y, tx, ty, color, 2);
    c.setLineDash([]);
    c.beginPath();
    c.arc(tx, ty, 10, 0, Math.PI * 2);
    c.strokeStyle = color;
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = color;
    c.fillRect(tx - 2, ty - 2, 4, 4);
    // A compact outer arc communicates that the warning is still charging.
    const duration =
      id === 'last-eclipse'
        ? 1.7
        : id === 'forge-colossus'
          ? 1.5
          : id === 'elder-root'
            ? 1.3
            : id === 'furnace-artillery'
              ? 1.2
              : id === 'rift-skirmisher'
                ? 1
                : id === 'pulse-caster' || id === 'burrower'
                  ? 1.1
                  : id === 'forge-carrier'
                    ? 1
                    : id === 'echo-attacker' || id === 'spore-shepherd'
                      ? 0.9
                      : 1;
    const charge = Math.max(0.08, Math.min(1, 1 - (windup - run.time) / duration));
    c.beginPath();
    c.arc(enemy.x, enemy.y, enemy.radius + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * charge);
    c.strokeStyle = color;
    c.lineWidth = 2.5;
    c.stroke();
  }
  if (echo > run.time) {
    c.setLineDash([3, 5]);
    c.beginPath();
    c.arc(enemy.x, enemy.y, enemy.radius + 9, 0, Math.PI * 2);
    c.strokeStyle = '#dce0ff';
    c.lineWidth = 2.5;
    c.stroke();
    line(c, enemy.x, enemy.y, 500, 400, '#dce0ff', 1.4);
    c.setLineDash([]);
  }
  if (recovery > run.time) {
    const vulnerable =
      id === 'elder-root' ||
      id === 'forge-colossus' ||
      id === 'last-eclipse' ||
      id === 'furnace-artillery' ||
      id === 'rift-skirmisher' ||
      id === 'burrower';
    c.strokeStyle = vulnerable ? '#fff0a8' : '#d8e4da';
    c.lineWidth = 3;
    c.strokeRect(
      enemy.x - enemy.radius - 4,
      enemy.y - enemy.radius - 4,
      (enemy.radius + 4) * 2,
      (enemy.radius + 4) * 2,
    );
    if (vulnerable) {
      c.fillStyle = '#fff0a8';
      c.fillRect(enemy.x - 3, enemy.y - enemy.radius - 8, 6, 3);
    }
  }
  if (covered) {
    c.strokeStyle = '#ffe0a0';
    c.lineWidth = 3;
    c.strokeRect(
      enemy.x - enemy.radius - 2,
      enemy.y - enemy.radius - 2,
      (enemy.radius + 2) * 2,
      (enemy.radius + 2) * 2,
    );
  }
  if (barrier > 0) {
    c.strokeStyle = '#8fe1ed';
    c.lineWidth = 2.5;
    c.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
      const x = enemy.x + Math.cos(a) * (enemy.radius + 7),
        y = enemy.y + Math.sin(a) * (enemy.radius + 7);
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
  }
  if (hasEncounterSprite(enemy) && (enemy.kind === 'boss' || enemy.hp < enemy.maxHp)) {
    const width = enemy.kind === 'boss' ? 70 : 28;
    const y = enemy.y - enemy.radius - 10;
    c.fillStyle = '#091612';
    c.fillRect(enemy.x - width / 2 - 2, y - 2, width + 4, 7);
    c.fillStyle = recovery > run.time ? '#b2ead6' : '#e8bf86';
    c.fillRect(enemy.x - width / 2, y, width * Math.max(0, Math.min(1, enemy.hp / enemy.maxHp)), 3);
    if (enemy.kind === 'boss') {
      c.font = '14px system-ui';
      c.textAlign = 'center';
      c.textBaseline = 'bottom';
      c.fillStyle = '#07110f';
      c.fillRect(enemy.x - 90, y - 43, 180, 20);
      c.fillStyle = '#f2dfb6';
      c.fillText(ENEMY_BY_ID[id].name, enemy.x, y - 26);
    }
  }
  if (enemy.kind === 'boss') {
    const phase = Math.max(0, Math.min(2, enemy.bossPhase));
    c.fillStyle = '#101816';
    c.fillRect(enemy.x - 16, enemy.y - enemy.radius - 22, 32, 7);
    for (let i = 0; i <= phase; i++) {
      c.fillStyle = i === phase ? '#f6d390' : '#a7c58b';
      c.fillRect(enemy.x - 14 + i * 10, enemy.y - enemy.radius - 20, 8, 3);
    }
  }
  c.restore();
}
