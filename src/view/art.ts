import { AXES } from '@/core/hex';
import { MAX_COLORS, NO_COLOR, rayOf, Special } from '@/core/types';

/**
 * All game art, drawn procedurally with Canvas 2D. The same painters feed the WebGL atlas and the small DOM icons,
 * so a piece looks identical everywhere and costs zero bytes of assets.
 * Every frame is a square of side `s`: a flat-top hex cell is exactly as wide (its height is √3/2 of it).
 */

interface Palette {
  base: string;
  light: string;
  dark: string;
}

/** Each color also has its own silhouette, so the game is readable without color vision. */
export const GEM_PALETTES: Palette[] = [
  { base: '#ff4f6d', light: '#ffd0d8', dark: '#9e1236' },
  { base: '#ffbe2e', light: '#fff1c4', dark: '#a8650a' },
  { base: '#35d07f', light: '#c9ffe0', dark: '#0d7a45' },
  { base: '#3f8cff', light: '#cfe3ff', dark: '#1543a8' },
  { base: '#a65cff', light: '#ead6ff', dark: '#5a1ea8' },
  { base: '#2fe0e0', light: '#d0ffff', dark: '#0a7f8a' },
  { base: '#f3e9ff', light: '#ffffff', dark: '#8e7aa8' },
];

/** Hex tint per color for particles. */
export const GEM_TINTS = GEM_PALETTES.map((p) => parseInt(p.base.slice(1), 16));

/** Gem radius as a share of the frame: the hex's inner circle is 0.433 of it, the gem keeps a margin. */
const GEM = 0.34;
/** Hex cell radius as a share of the frame. */
const HEX = 0.5;
const SQRT3 = Math.sqrt(3);

export const FrameName = {
  gem: (color: number, special: Special): string => `gem-${color}-${special}`,
  Prism: 'prism',
  tile: (tone: number): string => `tile-${tone}`,
  ice: (layers: number): string => `ice-${layers}`,
  crate: (strength: number): string => `crate-${strength}`,
  chain: (layers: number): string => `chain-${layers}`,
  Dot: 'dot',
  Sparkle: 'sparkle',
  Ring: 'ring',
  Beam: 'beam',
  Glow: 'glow',
  Streak: 'streak',
  Shock: 'shock',
  /** a hex outline glowing on its rim: the burst's and the aim's cell */
  HexGlow: 'hex-glow',
  FallingStar: 'falling-star',
  Meteor: 'meteor',
  /** a stone chip, white to be tinted */
  Chip: 'chip',
  /** a frost flake */
  Flake: 'flake',
  /** a rotor's hub: a little pinwheel */
  Hub: 'hub',
  shard: (color: number, k: number): string => `shard-${color}-${k % SHARDS}`,
  /** the piece's outline filled white: it flashes over the piece as it is hit */
  silhouette: (color: number): string => `silhouette-${color === NO_COLOR ? 'prism' : color}`,
} as const;

export const SHARDS = 4;

type Painter = (ctx: CanvasRenderingContext2D, s: number) => void;

const GEM_SPECIALS: Special[] = [Special.None, ...Array.from({ length: AXES }, (_, a) => rayOf(a)), Special.Burst, Special.Nova];

function buildPainters(): Map<string, Painter> {
  const painters = new Map<string, Painter>();
  for (let color = 0; color < MAX_COLORS; color++) {
    for (const special of GEM_SPECIALS) painters.set(FrameName.gem(color, special), (ctx, s) => drawGem(ctx, s, color, special));
    for (let k = 0; k < SHARDS; k++) painters.set(FrameName.shard(color, k), (ctx, s) => drawShard(ctx, s, color, k));
    painters.set(FrameName.silhouette(color), (ctx, s) => drawSilhouette(ctx, s, SHAPES[color], GEM));
  }
  painters.set(FrameName.silhouette(NO_COLOR), (ctx, s) => drawSilhouette(ctx, s, SHAPES[0], GEM * 1.05));
  painters.set(FrameName.Prism, drawPrism);
  for (let tone = 0; tone < 3; tone++) painters.set(FrameName.tile(tone), (ctx, s) => drawTile(ctx, s, tone));
  for (const layers of [1, 2]) painters.set(FrameName.ice(layers), (ctx, s) => drawIce(ctx, s, layers));
  for (const strength of [1, 2, 3]) painters.set(FrameName.crate(strength), (ctx, s) => drawStone(ctx, s, strength));
  for (const layers of [1, 2]) painters.set(FrameName.chain(layers), (ctx, s) => drawLock(ctx, s, layers));
  painters.set(FrameName.Dot, drawDot);
  painters.set(FrameName.Sparkle, (ctx, s) => {
    ctx.fillStyle = '#fff';
    drawSparkle(ctx, s / 2, s / 2, s * 0.48);
  });
  painters.set(FrameName.Ring, drawRing);
  painters.set(FrameName.Beam, drawBeam);
  painters.set(FrameName.Glow, drawGlow);
  painters.set(FrameName.Streak, drawStreak);
  painters.set(FrameName.Shock, drawShock);
  painters.set(FrameName.HexGlow, drawHexGlow);
  painters.set(FrameName.FallingStar, drawFallingStar);
  painters.set(FrameName.Meteor, drawMeteor);
  painters.set(FrameName.Chip, drawChip);
  painters.set(FrameName.Flake, drawFlake);
  painters.set(FrameName.Hub, drawHub);
  return painters;
}

export const PAINTERS = buildPainters();

/**
 * Canvas 2D context the painters draw into. `willReadFrequently` keeps the canvas on the CPU rasterizer:
 * the GPU one is driver-dependent and inflates translucent pixels on some Mali GPUs (seen in Glimmerfall).
 */
export function paintContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return canvas.getContext('2d', { willReadFrequently: true })!;
}

/** Small standalone image of a frame, for DOM icons. */
export function frameDataUrl(name: string, size: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  PAINTERS.get(name)?.(paintContext(canvas), size);
  return canvas.toDataURL();
}

// ---------- shapes ----------

type Shape = (ctx: CanvasRenderingContext2D, r: number) => void;
type Pt = [number, number];

function polygon(ctx: CanvasRenderingContext2D, points: Pt[], round: number): void {
  const n = points.length;
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(points[n - 1], points[0]);
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const [x, y] = points[i];
    const [nx, ny] = mid(points[i], points[(i + 1) % n]);
    ctx.arcTo(x, y, nx, ny, round);
  }
  ctx.closePath();
}

function regular(sides: number, r: number, rotation: number, inner = 0): Pt[] {
  const pts: Pt[] = [];
  const count = inner > 0 ? sides * 2 : sides;
  for (let i = 0; i < count; i++) {
    const a = rotation + (i * Math.PI * 2) / count;
    const rad = inner > 0 && i % 2 === 1 ? inner : r;
    pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  return pts;
}

/** Flat-top hexagon of circumradius r about the origin. */
function hexagon(ctx: CanvasRenderingContext2D, r: number, round: number): void {
  polygon(ctx, regular(6, r, 0), round);
}

const SHAPES: Shape[] = [
  (ctx, r) => {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
  },
  (ctx, r) => polygon(ctx, [[0, -r * 1.05], [r * 0.85, 0], [0, r * 1.05], [-r * 0.85, 0]], r * 0.18),
  (ctx, r) => {
    // leaf / drop
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.02);
    ctx.bezierCurveTo(r * 0.75, -r * 0.35, r * 0.95, r * 0.25, 0, r * 0.98);
    ctx.bezierCurveTo(-r * 0.95, r * 0.25, -r * 0.75, -r * 0.35, 0, -r * 1.02);
    ctx.closePath();
  },
  // triangle, point up, nudged down so it sits centered
  (ctx, r) => polygon(ctx, regular(3, r * 1.18, -Math.PI / 2).map(([x, y]): Pt => [x, y + r * 0.14]), r * 0.22),
  (ctx, r) => polygon(ctx, regular(5, r * 1.06, -Math.PI / 2, r * 0.55), r * 0.12),
  (ctx, r) => polygon(ctx, regular(4, r * 1.12, Math.PI / 4), r * 0.3),
  // clover: four lobes
  (ctx, r) => {
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 - Math.PI / 4;
      ctx.moveTo(Math.cos(a) * r * 0.48 + r * 0.5, Math.sin(a) * r * 0.48);
      ctx.arc(Math.cos(a) * r * 0.48, Math.sin(a) * r * 0.48, r * 0.5, 0, Math.PI * 2);
    }
  },
];

// ---------- gems ----------

function drawGem(ctx: CanvasRenderingContext2D, s: number, color: number, special: Special): void {
  const p = GEM_PALETTES[color];
  const r = s * GEM;
  const shape = SHAPES[color];
  ctx.save();
  ctx.translate(s / 2, s / 2);

  // The shadow takes the gem's own dark color: it reads as depth, not as a black outline.
  ctx.save();
  ctx.shadowColor = `${p.dark}b3`;
  ctx.shadowBlur = s * 0.07;
  ctx.shadowOffsetY = s * 0.035;
  shape(ctx, r);
  ctx.fillStyle = p.base;
  ctx.fill();
  ctx.restore();

  const body = ctx.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.05, 0, 0, r * 1.15);
  body.addColorStop(0, p.light);
  body.addColorStop(0.45, p.base);
  body.addColorStop(1, p.dark);
  shape(ctx, r);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = s * 0.022;
  ctx.strokeStyle = p.dark;
  ctx.stroke();

  ctx.save();
  shape(ctx, r);
  ctx.clip();
  // Light bounced up from below: the lower edge glows in the gem's light color, so it looks lit through.
  const bounce = ctx.createRadialGradient(r * 0.2, r * 0.75, 0, r * 0.2, r * 0.75, r * 0.75);
  bounce.addColorStop(0, `${p.light}80`);
  bounce.addColorStop(1, `${p.light}00`);
  ctx.fillStyle = bounce;
  ctx.fillRect(-r * 1.2, -r * 1.2, r * 2.4, r * 2.4);
  const shine = ctx.createRadialGradient(-r * 0.3, -r * 0.5, 0, -r * 0.3, -r * 0.5, r * 0.7);
  shine.addColorStop(0, 'rgba(255,255,255,0.75)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.ellipse(-r * 0.25, -r * 0.45, r * 0.55, r * 0.32, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(-r * 0.3, -r * 0.32, r * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // The mark of a special glows over the gem and past its edge: it must read at a glance.
  drawSpecialMark(ctx, r, special);
  ctx.restore();
}

/** Screen angle of each axis: vertical, then "/" and "\" at ±60° from it. */
export const AXIS_ANGLE = [Math.PI / 2, -Math.PI / 6, Math.PI / 6];

function drawSpecialMark(ctx: CanvasRenderingContext2D, r: number, special: Special): void {
  if (special === Special.None) return;
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.95)';
  ctx.shadowBlur = r * 0.3;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineCap = 'round';
  if (special >= Special.Ray0 && special <= Special.Ray2) {
    // Two bright stripes along the ray's axis, with arrow tips at both ends.
    ctx.rotate(AXIS_ANGLE[special - Special.Ray0]);
    for (const y of [-0.24, 0.24]) ctx.fillRect(-r * 1.05, r * (y - 0.065), r * 2.1, r * 0.13);
    ctx.lineWidth = r * 0.14;
    ctx.lineJoin = 'round';
    for (const x of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x * r * 0.82, -r * 0.48);
      ctx.lineTo(x * r * 1.12, 0);
      ctx.lineTo(x * r * 0.82, r * 0.48);
      ctx.stroke();
    }
  } else if (special === Special.Burst) {
    // A snowflake: six spokes with a little fork near the tip.
    ctx.lineWidth = r * 0.14;
    for (let k = 0; k < 6; k++) {
      ctx.save();
      ctx.rotate((k * Math.PI) / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -r * 0.78);
      ctx.moveTo(0, -r * 0.5);
      ctx.lineTo(r * 0.2, -r * 0.7);
      ctx.moveTo(0, -r * 0.5);
      ctx.lineTo(-r * 0.2, -r * 0.7);
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
  } else if (special === Special.Nova) {
    // A six-pointed blazing star: three axes through the gem.
    ctx.shadowBlur = r * 0.5;
    polygon(ctx, regular(6, r * 1.05, -Math.PI / 2, r * 0.32), r * 0.04);
    ctx.fill();
    ctx.lineWidth = r * 0.08;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPrism(ctx: CanvasRenderingContext2D, s: number): void {
  const r = s * GEM * 1.05;
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = s * 0.06;
  ctx.shadowOffsetY = s * 0.035;
  hexagon(ctx, r, r * 0.25);
  const hues = ['#ff4f6d', '#ffbe2e', '#35d07f', '#2fe0e0', '#3f8cff', '#a65cff', '#ff4f6d'];
  const rainbow = typeof ctx.createConicGradient === 'function' ? ctx.createConicGradient(0, 0, 0) : ctx.createLinearGradient(-r, -r, r, r);
  hues.forEach((h, i) => rainbow.addColorStop(i / (hues.length - 1), h));
  ctx.fillStyle = rainbow;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  const glass = ctx.createRadialGradient(-r * 0.3, -r * 0.35, 0, 0, 0, r);
  glass.addColorStop(0, 'rgba(255,255,255,0.85)');
  glass.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  glass.addColorStop(1, 'rgba(40,0,80,0.35)');
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.lineWidth = s * 0.025;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();
  // Facets: lines from the center to every corner, like a cut crystal.
  ctx.lineWidth = s * 0.01;
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  for (const [x, y] of regular(6, r * 0.92, 0)) {
    ctx.moveTo(0, 0);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowColor = 'rgba(255,255,255,1)';
  ctx.shadowBlur = r * 0.3;
  ctx.fillStyle = '#fff';
  drawSparkle(ctx, 0, 0, r * 0.5);
  ctx.restore();
}

// ---------- cells ----------

/** Floor hexes in three tones: a hex grid colors with three so that no two neighbors share one. */
function drawTile(ctx: CanvasRenderingContext2D, s: number, tone: number): void {
  ctx.save();
  ctx.translate(s / 2, s / 2);
  hexagon(ctx, s * HEX * 0.95, s * 0.06);
  ctx.fillStyle = `rgba(255,255,255,${[0.06, 0.1, 0.14][tone]})`;
  ctx.fill();
  ctx.lineWidth = s * 0.018;
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.stroke();
  ctx.restore();
}

/** Frosted glass over the cell: one layer milky, two thicker and bluer, with frost veins. */
function drawIce(ctx: CanvasRenderingContext2D, s: number, layers: number): void {
  const strong = layers > 1;
  ctx.save();
  ctx.translate(s / 2, s / 2);
  hexagon(ctx, s * HEX * 0.9, s * 0.07);
  const g = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
  g.addColorStop(0, strong ? 'rgba(225,245,255,0.85)' : 'rgba(215,240,255,0.6)');
  g.addColorStop(1, strong ? 'rgba(120,180,255,0.78)' : 'rgba(150,205,255,0.42)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = s * 0.03;
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.stroke();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = s * 0.022;
  ctx.lineCap = 'round';
  ctx.beginPath();
  // Frost veins from the corners towards the middle.
  for (const [k, len] of strong ? [[0, 0.3], [2, 0.25], [3, 0.3], [5, 0.22]] : [[1, 0.22], [4, 0.26]]) {
    const a = (k * Math.PI) / 3;
    const x = Math.cos(a) * s * 0.42;
    const y = Math.sin(a) * s * 0.42;
    ctx.moveTo(x, y);
    ctx.lineTo(x * (1 - len * 2), y * (1 - len * 2));
    ctx.moveTo(x * 0.75, y * 0.75);
    ctx.lineTo(x * 0.75 + Math.cos(a + 1.2) * s * 0.08, y * 0.75 + Math.sin(a + 1.2) * s * 0.08);
  }
  ctx.stroke();
  ctx.restore();
}

/** Cracks a stone gets as it loses strength: none at full, more at each hit. */
const STONE_CRACKS: Pt[][] = [
  [[-0.05, -0.38], [0.05, -0.18], [-0.04, -0.02], [0.12, 0.12]],
  [[0.38, 0.1], [0.18, 0.06], [0.1, 0.22], [-0.08, 0.3]],
  [[-0.4, 0.05], [-0.22, -0.02], [-0.16, 0.16]],
];

/** A cut amethyst stone, faceted, lit from the top left; cracks for each lost point of strength. */
function drawStone(ctx: CanvasRenderingContext2D, s: number, strength: number): void {
  const r = s * HEX * 0.88;
  const tint = ['#7b5cc4', '#6447a8', '#4e3389'][strength - 1];
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = s * 0.06;
  ctx.shadowOffsetY = s * 0.03;
  hexagon(ctx, r, s * 0.05);
  ctx.fillStyle = '#2a1650';
  ctx.fill();
  ctx.restore();
  // Six facets around a flat table: each lit by its angle to the light.
  const outer = regular(6, r, 0);
  const inner = regular(6, r * 0.5, 0);
  for (let k = 0; k < 6; k++) {
    const a = outer[k];
    const b = outer[(k + 1) % 6];
    const ib = inner[(k + 1) % 6];
    const ia = inner[k];
    const mid = ((k + 0.5) * Math.PI) / 3;
    const light = 0.5 + 0.5 * Math.cos(mid - (-2.3));
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(ib[0], ib[1]);
    ctx.lineTo(ia[0], ia[1]);
    ctx.closePath();
    ctx.fillStyle = tint;
    ctx.fill();
    ctx.fillStyle = light > 0.5 ? `rgba(255,255,255,${(light - 0.5) * 0.6})` : `rgba(10,0,30,${(0.5 - light) * 0.7})`;
    ctx.fill();
  }
  polygon(ctx, inner, 0);
  const table = ctx.createLinearGradient(-r * 0.5, -r * 0.5, r * 0.5, r * 0.5);
  table.addColorStop(0, '#c9b2ff');
  table.addColorStop(1, tint);
  ctx.fillStyle = table;
  ctx.fill();
  ctx.lineWidth = s * 0.016;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.stroke();
  hexagon(ctx, r, s * 0.05);
  ctx.lineWidth = s * 0.025;
  ctx.strokeStyle = '#1d0d3d';
  ctx.stroke();
  // A glint on the table.
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  drawSparkle(ctx, -r * 0.2, -r * 0.22, r * 0.14);
  ctx.strokeStyle = 'rgba(20,5,45,0.9)';
  ctx.lineWidth = s * 0.024;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const crack of STONE_CRACKS.slice(0, 3 - strength)) {
    ctx.beginPath();
    crack.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x * s, y * s) : ctx.lineTo(x * s, y * s)));
    ctx.stroke();
  }
  ctx.restore();
}

/** Golden hoops around the piece: one level a ring with a clasp, two levels a second ring crossing it. */
function drawLock(ctx: CanvasRenderingContext2D, s: number, layers: number): void {
  ctx.save();
  ctx.translate(s / 2, s / 2);
  const hoop = (tilt: number): void => {
    ctx.save();
    ctx.rotate(tilt);
    ctx.scale(1, 0.42);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2);
    ctx.restore();
    ctx.lineWidth = s * 0.075;
    ctx.strokeStyle = '#5b3a06';
    ctx.stroke();
    ctx.lineWidth = s * 0.05;
    const g = ctx.createLinearGradient(-s * 0.4, -s * 0.2, s * 0.4, s * 0.2);
    g.addColorStop(0, '#fff1b0');
    g.addColorStop(0.5, '#e8a92a');
    g.addColorStop(1, '#fff1b0');
    ctx.strokeStyle = g;
    ctx.stroke();
  };
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = s * 0.04;
  hoop(-0.5);
  if (layers > 1) hoop(0.5);
  ctx.shadowColor = 'transparent';
  // The clasp: a little padlock where the hoops meet the front.
  const w = s * 0.17;
  ctx.fillStyle = '#5b3a06';
  ctx.beginPath();
  ctx.arc(0, s * 0.16, w * 0.62, Math.PI, 0);
  ctx.lineWidth = s * 0.035;
  ctx.strokeStyle = '#5b3a06';
  ctx.stroke();
  const body = ctx.createLinearGradient(0, s * 0.14, 0, s * 0.34);
  body.addColorStop(0, '#ffe07a');
  body.addColorStop(1, '#c98a12');
  ctx.fillStyle = body;
  polygon(ctx, [[-w, s * 0.15], [w, s * 0.15], [w, s * 0.34], [-w, s * 0.34]], s * 0.03);
  ctx.fill();
  ctx.lineWidth = s * 0.018;
  ctx.stroke();
  ctx.fillStyle = '#5b3a06';
  ctx.beginPath();
  ctx.arc(0, s * 0.235, s * 0.025, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------- effects ----------

function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(r * 0.12, -r * 0.12, r, 0);
  ctx.quadraticCurveTo(r * 0.12, r * 0.12, 0, r);
  ctx.quadraticCurveTo(-r * 0.12, r * 0.12, -r, 0);
  ctx.quadraticCurveTo(-r * 0.12, -r * 0.12, 0, -r);
  ctx.fill();
  ctx.restore();
}

function drawDot(ctx: CanvasRenderingContext2D, s: number): void {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
}

function drawRing(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = s * 0.06;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = s * 0.06;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
  ctx.stroke();
}

/** A bright band across the frame: stretched along a ray. */
function drawBeam(ctx: CanvasRenderingContext2D, s: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(0.65, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
}

function drawGlow(ctx: CanvasRenderingContext2D, s: number): void {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
}

/** Soft streak along x with a hot core: a trail when stretched along a flight. */
function drawStreak(ctx: CanvasRenderingContext2D, s: number): void {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.scale(1, 0.28);
  ctx.translate(-s / 2, -s / 2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.restore();
}

/** Ring with a bright rim that fades inward: an expanding shockwave. */
function drawShock(ctx: CanvasRenderingContext2D, s: number): void {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.08)');
  g.addColorStop(0.85, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.93, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
}

/** A hex cell glowing from its rim inward, white to be tinted. */
function drawHexGlow(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.save();
  ctx.translate(s / 2, s / 2);
  hexagon(ctx, s * HEX * 0.9, s * 0.08);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0.45)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = s * 0.05;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.stroke();
  ctx.restore();
}

/** A five-pointed star, gold to white-hot at its heart, with a soft halo. */
function drawFallingStar(ctx: CanvasRenderingContext2D, s: number): void {
  const r = s * 0.36;
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.shadowColor = 'rgba(255,214,110,0.95)';
  ctx.shadowBlur = s * 0.12;
  polygon(ctx, regular(5, r, -Math.PI / 2, r * 0.48), r * 0.08);
  const body = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.35, '#fff1b8');
  body.addColorStop(0.75, '#ffd25e');
  body.addColorStop(1, '#f0a020');
  ctx.fillStyle = body;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = s * 0.018;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();
  ctx.restore();
}

/** A lumpy dark rock lit from the hot side, molten cracks across it and an ember rim. */
function drawMeteor(ctx: CanvasRenderingContext2D, s: number): void {
  const r = s * 0.34;
  const lumps = [1, 0.9, 1.04, 0.88, 0.98, 0.92, 1.02, 0.86, 0.97];
  const rock: Pt[] = lumps.map((k, i) => {
    const a = (i / lumps.length) * Math.PI * 2;
    return [Math.cos(a) * r * k, Math.sin(a) * r * k];
  });
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.shadowColor = 'rgba(255,110,30,0.9)';
  ctx.shadowBlur = s * 0.14;
  polygon(ctx, rock, r * 0.25);
  const body = ctx.createRadialGradient(r * 0.35, r * 0.35, r * 0.1, 0, 0, r * 1.1);
  body.addColorStop(0, '#ffb347');
  body.addColorStop(0.3, '#c2451e');
  body.addColorStop(0.7, '#4a2117');
  body.addColorStop(1, '#22100c');
  ctx.fillStyle = body;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = '#ffcf6a';
  ctx.lineCap = 'round';
  ctx.shadowColor = '#ff7a1a';
  ctx.shadowBlur = s * 0.05;
  for (const [pts, width] of [
    [[[-0.5, -0.3], [-0.1, -0.05], [0.15, -0.35]], 0.035],
    [[[-0.1, -0.05], [0.05, 0.3], [0.45, 0.42]], 0.03],
    [[[0.05, 0.3], [-0.35, 0.45]], 0.022],
  ] as [Pt[], number][]) {
    ctx.lineWidth = s * width;
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x * r, y * r) : ctx.lineTo(x * r, y * r)));
    ctx.stroke();
  }
  ctx.restore();
  ctx.lineWidth = s * 0.02;
  ctx.strokeStyle = 'rgba(255,170,80,0.7)';
  polygon(ctx, rock, r * 0.25);
  ctx.stroke();
  ctx.restore();
}

function drawChip(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.fillStyle = '#fff';
  polygon(ctx, [[s * 0.3, s * 0.3], [s * 0.72, s * 0.38], [s * 0.62, s * 0.7], [s * 0.34, s * 0.62]], s * 0.03);
  ctx.fill();
}

function drawFlake(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = s * 0.07;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI) / 3;
    ctx.moveTo(Math.cos(a) * s * 0.38, Math.sin(a) * s * 0.38);
    ctx.lineTo(-Math.cos(a) * s * 0.38, -Math.sin(a) * s * 0.38);
  }
  ctx.stroke();
  ctx.restore();
}

/** A rotor's hub: a small glowing pinwheel of three blades. */
function drawHub(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.shadowColor = 'rgba(255,255,255,0.8)';
  ctx.shadowBlur = s * 0.05;
  for (let k = 0; k < 3; k++) {
    ctx.save();
    ctx.rotate((k * 2 * Math.PI) / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(s * 0.2, -s * 0.05, s * 0.2, -s * 0.2);
    ctx.quadraticCurveTo(s * 0.05, -s * 0.16, 0, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.045, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();
}

/** A wedge of the plain gem, cut from its center: the gem breaks into SHARDS of these. */
function drawShard(ctx: CanvasRenderingContext2D, s: number, color: number, k: number): void {
  const from = (k / SHARDS) * Math.PI * 2 - Math.PI / 3;
  const to = ((k + 1) / SHARDS) * Math.PI * 2 - Math.PI / 3;
  const mid = (from + to) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(s / 2, s / 2);
  ctx.lineTo(s / 2 + Math.cos(from) * s, s / 2 + Math.sin(from) * s);
  ctx.lineTo(s / 2 + Math.cos(mid + 0.15) * s * 0.9, s / 2 + Math.sin(mid + 0.15) * s * 0.9);
  ctx.lineTo(s / 2 + Math.cos(to) * s, s / 2 + Math.sin(to) * s);
  ctx.closePath();
  ctx.clip();
  drawGem(ctx, s, color, Special.None);
  ctx.restore();
}

/** The piece's shape filled white with a soft edge, at the piece's own size. */
function drawSilhouette(ctx: CanvasRenderingContext2D, s: number, shape: Shape, size: number): void {
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = s * 0.08;
  ctx.fillStyle = '#fff';
  shape(ctx, s * size);
  ctx.fill();
  ctx.restore();
}

/** Height of a flat-top hex as a share of its width. */
export const HEX_HEIGHT = SQRT3 / 2;
