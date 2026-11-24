import { Dir, DIRECTIONS, hexDistance, neighborTable, rotate60, screenRow } from '@/core/hex';
import { pick, randInt, random, type RngHolder } from '@/core/rng';
import type { Rotor } from '@/core/types';

/**
 * Board shapes and blocker patterns. Every pattern is mirror-symmetric about the middle column (boards have an odd
 * number of columns, so a column and its mirror share their half-row offset); on hexagonal boards blockers may also
 * repeat every 120° about the center, like the picture in a kaleidoscope.
 */
export interface Grid {
  rows: number;
  cols: number;
  mask: number[];
  /** the center cell: rotations and distances are taken about it */
  center: number;
  /** the board is a hexagon around the center: rotational patterns fit it */
  hexagonal: boolean;
  /** stone or lock: pieces neither fall into nor through it */
  blocked: (i: number) => boolean;
  /** rotor rings and hubs: kept free of stones and locks */
  reserved: Set<number>;
}

interface ShapeRule {
  hexagonal: boolean;
  /** whether cell `i` exists, given its distance from the center */
  keep: (g: { rows: number; cols: number; center: number }, i: number, d: number) => boolean;
}

const R = 4;

/** Whether cell `i` lies exactly `d` steps from the center along one of `dirs`. */
function onSpoke(g: { cols: number; rows: number; center: number }, i: number, d: number, dirs: readonly number[]): boolean {
  const table = neighborTable(g.rows, g.cols);
  return dirs.some((dir) => {
    let j = g.center;
    for (let s = 0; s < d && j >= 0; s++) j = table[j * DIRECTIONS + dir];
    return j === i;
  });
}

/** Plainest first: the player's craft decides how far down the list a level may reach. */
const SHAPES: ShapeRule[] = [
  { hexagonal: false, keep: () => true },
  { hexagonal: true, keep: (_, __, d) => d <= R },
  // A rectangle with its corners rounded off.
  { hexagonal: false, keep: (_, __, d) => d <= R + 1 },
  // A hexagon with an eye in the middle: pieces fall through it.
  { hexagonal: true, keep: (_, __, d) => d <= R && d > 0 },
  // A snowflake outline: the six corners cut.
  { hexagonal: true, keep: (g, i, d) => d < R || !onSpoke(g, i, R, [0, 1, 2, 3, 4, 5]) },
  // A rectangle with a flower-shaped hole.
  { hexagonal: false, keep: (_, __, d) => d > 1 },
  // A hexagon with three holes, a triangle about the center.
  { hexagonal: true, keep: (g, i, d) => d <= R && !onSpoke(g, i, 2, [Dir.N, Dir.SE, Dir.SW]) },
];

/** A shape for the level: early levels a small open rectangle, then a 9-column board, more intricate with craft. */
export function makeShape(n: number, craft: number, h: RngHolder): Omit<Grid, 'blocked' | 'reserved'> {
  if (n <= 3) {
    const rows = 7;
    const cols = 7;
    return { rows, cols, mask: new Array<number>(rows * cols).fill(1), center: 3 * cols + 3, hexagonal: false };
  }
  const options = SHAPES.slice(0, 1 + Math.round(craft * (SHAPES.length - 1)));
  for (let attempt = 0; attempt < 10; attempt++) {
    const rule = pick(h, options);
    const cols = 9;
    const rows = rule.hexagonal ? 9 : pick(h, [8, 9, 9]);
    const center = Math.floor((rows - 1) / 2) * cols + (cols - 1) / 2;
    const g = { rows, cols, center };
    const cr = Math.floor(center / cols);
    const cc = center % cols;
    const mask = Array.from({ length: rows * cols }, (_, i) =>
      rule.keep(g, i, hexDistance(Math.floor(i / cols), i % cols, cr, cc)) ? 1 : 0,
    );
    if (mask.filter(Boolean).length >= 40 && isConnected(mask, rows, cols)) return { rows, cols, mask, center, hexagonal: rule.hexagonal };
  }
  return { rows: 9, cols: 9, mask: new Array<number>(81).fill(1), center: 40, hexagonal: false };
}

function isConnected(mask: number[], rows: number, cols: number): boolean {
  const start = mask.indexOf(1);
  if (start === -1) return false;
  const table = neighborTable(rows, cols);
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    const i = stack.pop()!;
    for (let d = 0; d < DIRECTIONS; d++) {
      const j = table[i * DIRECTIONS + d];
      if (j >= 0 && mask[j] === 1 && !seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen.size === mask.filter(Boolean).length;
}

export function mirror(g: Pick<Grid, 'cols'>, i: number): number {
  const r = Math.floor(i / g.cols);
  return r * g.cols + (g.cols - 1 - (i % g.cols));
}

/** A cell and its mirror twin; on a hexagon also their turns by 120°: a kaleidoscope pattern. */
export function orbit(g: Grid, i: number, kaleidoscope: boolean): number[] {
  const cells = new Set([i, mirror(g, i)]);
  if (kaleidoscope && g.hexagonal) {
    for (const j of [...cells]) {
      let k = j;
      for (let t = 0; t < 2; t++) {
        k = rotate60(g.rows, g.cols, rotate60(g.rows, g.cols, k, g.center), g.center);
        if (k >= 0) cells.add(k);
      }
    }
  }
  return [...cells].filter((j) => j >= 0 && g.mask[j] === 1);
}

/** Sets a blocker on a cell's orbit, unless that would cut some free cell off from the refill or touch a rotor. */
function setBlocker(g: Grid, layer: number[], i: number, value: number, kaleidoscope: boolean): void {
  const cells = orbit(g, i, kaleidoscope);
  if (cells.some((j) => g.reserved.has(j))) return;
  const before = cells.map((j) => layer[j]);
  for (const j of cells) layer[j] = value;
  if (!refillReachesAll(g)) cells.forEach((j, k) => (layer[j] = before[k]));
}

/** Cells top first by where they sit on screen. */
function topDown(rows: number, cols: number): number[] {
  return Array.from({ length: rows * cols }, (_, i) => i).sort(
    (x, y) => screenRow(Math.floor(x / cols), x % cols) - screenRow(Math.floor(y / cols), y % cols) || x - y,
  );
}

/**
 * Follows the fall rules: a free cell is fed straight from above (holes are skipped) or from a fed upper-left or
 * upper-right neighbor. A cell nothing can feed empties for good and can leave the board without a move.
 */
export function refillReachesAll(g: Pick<Grid, 'rows' | 'cols' | 'mask' | 'blocked'>): boolean {
  const { rows, cols, mask } = g;
  const table = neighborTable(rows, cols);
  const fed = new Array<boolean>(rows * cols).fill(false);
  for (const i of topDown(rows, cols)) {
    if (mask[i] !== 1 || g.blocked(i)) continue;
    const c = i % cols;
    let above = Math.floor(i / cols) - 1;
    while (above >= 0 && mask[above * cols + c] !== 1) above--;
    const straight = above < 0 || fed[above * cols + c];
    const diagonal = [Dir.NW, Dir.NE].some((d) => {
      const j = table[i * DIRECTIONS + d];
      return j >= 0 && fed[j];
    });
    if (!straight && !diagonal) return false;
    fed[i] = true;
  }
  return true;
}

/** Twin length the base amounts of stones and frost were set for; longer levels get proportionally more. */
const LAYER_LENGTH = 18;

export function placeCrates(g: Grid, crate: number[], n: number, craft: number, length: number, h: RngHolder): void {
  const cap = 1 + Math.round(2 * craft);
  const strength = (): number => Math.min(cap, n < 15 ? 1 : n < 40 ? 1 + randInt(h, 2) : 1 + randInt(h, 3));
  const kaleidoscope = random(h) < 0.5;
  const half = Math.ceil(g.cols / 2);
  if (random(h) < craft) {
    // A shelf: one row of stones from the walls inwards, leaving the middle open; what is under it is hard to reach.
    const r = 3 + randInt(h, Math.max(1, g.rows - 5));
    const width = 1 + randInt(h, Math.max(1, half - 2));
    const s = strength();
    for (let c = 0; c < width; c++) setBlocker(g, crate, r * g.cols + c, s, false);
  }
  // Capped well below the board: the refill check refuses stones that would wall cells off anyway.
  const size = g.mask.filter(Boolean).length;
  const target = Math.min(Math.round(size * 0.35), Math.round((6 + Math.min(12, Math.floor(n / 5))) * (length / LAYER_LENGTH)));
  for (let guard = 0; guard < 120 && crate.filter(Boolean).length < target; guard++) {
    const r = 2 + randInt(h, Math.max(1, g.rows - 3));
    setBlocker(g, crate, r * g.cols + randInt(h, half), strength(), kaleidoscope);
  }
}

export function placeIce(g: Grid, ice: number[], crate: number[], n: number, craft: number, length: number, h: RngHolder): void {
  const { rows, cols } = g;
  const cr = Math.floor(g.center / cols);
  const cc = g.center % cols;
  const size = Math.min(0.5, (0.22 + Math.min(0.25, n / 400)) * Math.sqrt(length / LAYER_LENGTH));
  const reach = Math.max(1, Math.round(size * 6));
  const dist = (i: number): number => hexDistance(Math.floor(i / cols), i % cols, cr, cc);
  const tone = (i: number): number => {
    const c = i % cols;
    const a = Math.floor(i / cols) - ((c - (c & 1)) >> 1);
    return (((c - a) % 3) + 3) % 3;
  };
  const patterns: ((i: number) => boolean)[] = [
    // a hexagon in the middle
    (i) => dist(i) <= reach - 1,
    // the bottom rows
    (i) => screenRow(Math.floor(i / cols), i % cols) >= rows - Math.max(2, Math.round(rows * size * 1.2)),
    // a ring about the center
    (i) => dist(i) === Math.min(3, reach),
    // a star: the three axes through the center
    (i) => dist(i) <= reach + 1 && onSpoke({ rows, cols, center: g.center }, i, dist(i), [0, 1, 2, 3, 4, 5]),
    // one tone of the three-tone floor
    (i) => tone(i) === tone(g.center) && dist(i) <= reach + 1,
  ];
  const pattern = pick(h, patterns);
  const thick = n >= 40 && random(h) < 0.7 * craft;
  for (let i = 0; i < ice.length; i++) {
    if (g.mask[i] === 1 && crate[i] === 0 && pattern(i)) ice[i] = thick && dist(i) <= 2 ? 2 : 1;
  }
  if (!ice.some(Boolean)) {
    for (let i = 0; i < ice.length; i++) if (g.mask[i] === 1 && crate[i] === 0 && Math.floor(i / cols) >= rows - 2) ice[i] = 1;
  }
}

export function placeChains(g: Grid, chain: number[], crate: number[], n: number, craft: number, h: RngHolder): void {
  const target = 4 + Math.min(8, Math.floor(n / 10));
  const half = Math.ceil(g.cols / 2);
  for (let guard = 0; guard < 100 && chain.filter(Boolean).length < target; guard++) {
    const i = (1 + randInt(h, g.rows - 1)) * g.cols + randInt(h, half);
    if (crate[i] > 0) continue;
    setBlocker(g, chain, i, n >= 50 && random(h) < 0.6 * craft ? 2 : 1, false);
  }
}

/**
 * Rotors: a hub whose six neighbors all exist, its flower clear of other rotors. One in the middle column spins
 * clockwise; others come in mirror pairs spinning against each other, so the pattern stays symmetric as it turns.
 */
export function placeRotors(g: Grid, count: number, h: RngHolder): Rotor[] {
  const table = neighborTable(g.rows, g.cols);
  const flower = (i: number): number[] => [i, ...Array.from({ length: DIRECTIONS }, (_, d) => table[i * DIRECTIONS + d])];
  const fits = (i: number): boolean => flower(i).every((j) => j >= 0 && g.mask[j] === 1 && !g.reserved.has(j));
  const rotors: Rotor[] = [];
  const mid = (g.cols - 1) / 2;
  const add = (i: number, spin: 1 | -1): void => {
    rotors.push({ at: i, spin });
    for (const j of flower(i)) g.reserved.add(j);
    // A gap ring around the flower keeps two rings from touching.
    for (const j of flower(i)) for (let d = 0; d < DIRECTIONS; d++) if (table[j * DIRECTIONS + d] >= 0) g.reserved.add(table[j * DIRECTIONS + d]);
  };
  if (count % 2 === 1 && fits(g.center)) add(g.center, 1);
  for (let guard = 0; guard < 60 && rotors.length < count; guard++) {
    const r = 1 + randInt(h, g.rows - 2);
    const c = 1 + randInt(h, mid - 1);
    const i = r * g.cols + c;
    const twin = mirror(g, i);
    if (!fits(i)) continue;
    add(i, 1);
    if (fits(twin)) add(twin, -1);
  }
  // Nothing fit the pattern (a hole in the middle): the free spot closest to the center takes one.
  if (rotors.length === 0 && count > 0) {
    const cr = Math.floor(g.center / g.cols);
    const cc = g.center % g.cols;
    const spots = g.mask.flatMap((_, i) => (fits(i) ? [i] : []));
    const best = spots.sort((x, y) => hexDistance(Math.floor(x / g.cols), x % g.cols, cr, cc) - hexDistance(Math.floor(y / g.cols), y % g.cols, cr, cc))[0];
    if (best !== undefined) add(best, 1);
  }
  return rotors;
}

/**
 * Keeps about `share` of the layer's cells, at least one: the lowest go first, a cell with its mirror twin.
 * Fewer stones never cut the refill off.
 */
export function dropLayer(rows: number, cols: number, layer: number[], share: number): boolean {
  const keep = Math.max(1, Math.round(layer.filter((v) => v > 0).length * share));
  let count = layer.filter((v) => v > 0).length;
  const before = count;
  for (const i of topDown(rows, cols).reverse()) {
    if (count <= keep) break;
    for (const j of new Set([i, mirror({ cols }, i)])) {
      if (layer[j] === 0) continue;
      layer[j] = 0;
      count--;
    }
  }
  return count < before;
}
