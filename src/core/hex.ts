/**
 * Hex geometry. Flat-top hexes stand in columns; odd columns sit half a cell lower ("odd-q" offset).
 * Cells are stored row-major (r * cols + c) like a square grid; lines and areas use axial coordinates (q, a).
 *
 * Directions run clockwise from straight up. Each axis is a direction and its opposite:
 * axis 0 is vertical, axis 1 runs "/" (up-right), axis 2 runs "\" (down-right).
 */
export const Dir = { N: 0, NE: 1, SE: 2, S: 3, SW: 4, NW: 5 } as const;
export type Dir = (typeof Dir)[keyof typeof Dir];
export const DIRECTIONS = 6;
export const AXES = 3;

/** Axial step per direction. */
const STEP: readonly [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

export function opposite(d: number): number {
  return (d + 3) % 6;
}

export function axial(r: number, c: number): [number, number] {
  return [c, r - ((c - (c & 1)) >> 1)];
}

export function offset(q: number, a: number): [number, number] {
  return [a + ((q - (q & 1)) >> 1), q];
}

/** Hex distance between two offset positions. */
export function hexDistance(r1: number, c1: number, r2: number, c2: number): number {
  const [q1, a1] = axial(r1, c1);
  const [q2, a2] = axial(r2, c2);
  const dq = q1 - q2;
  const da = a1 - a2;
  return Math.max(Math.abs(dq), Math.abs(da), Math.abs(dq + da));
}

/** Vertical position of a cell's center in rows: odd columns are half a row lower. */
export function screenRow(r: number, c: number): number {
  return r + (c & 1) * 0.5;
}

const tables = new Map<string, Int32Array>();

/**
 * Neighbor of every cell in every direction: `table[i * 6 + d]`, or -1 past the board's rectangle.
 * Holes are inside the rectangle and stay in the table: callers check `exists`.
 */
export function neighborTable(rows: number, cols: number): Int32Array {
  const key = `${rows}x${cols}`;
  let table = tables.get(key);
  if (table) return table;
  table = new Int32Array(rows * cols * DIRECTIONS).fill(-1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [q, a] = axial(r, c);
      for (let d = 0; d < DIRECTIONS; d++) {
        const [nr, nc] = offset(q + STEP[d][0], a + STEP[d][1]);
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) table[(r * cols + c) * DIRECTIONS + d] = nr * cols + nc;
      }
    }
  }
  tables.set(key, table);
  return table;
}

/** Cell `k` steps from `i` in direction `d` (holes included), or -1 past the rectangle. */
export function walk(rows: number, cols: number, i: number, d: number, k: number): number {
  const table = neighborTable(rows, cols);
  for (let s = 0; s < k && i >= 0; s++) i = table[i * DIRECTIONS + d];
  return i;
}

/** Every cell index on the axis through `i`, holes included, in order. */
export function axisLine(rows: number, cols: number, i: number, axis: number): number[] {
  const table = neighborTable(rows, cols);
  const back = opposite(axis);
  let start = i;
  while (table[start * DIRECTIONS + back] >= 0) start = table[start * DIRECTIONS + back];
  const line: number[] = [];
  for (let j = start; j >= 0; j = table[j * DIRECTIONS + axis]) line.push(j);
  return line;
}

/** Every cell index within `radius` steps of `i`, holes included. */
export function hexArea(rows: number, cols: number, i: number, radius: number): number[] {
  const r0 = Math.floor(i / cols);
  const c0 = i % cols;
  const cells: number[] = [];
  for (let r = Math.max(0, r0 - radius - 1); r <= Math.min(rows - 1, r0 + radius + 1); r++) {
    for (let c = Math.max(0, c0 - radius); c <= Math.min(cols - 1, c0 + radius); c++) {
      if (hexDistance(r, c, r0, c0) <= radius) cells.push(r * cols + c);
    }
  }
  return cells;
}

/** Position of cell `i` turned 60° clockwise about cell `center`, or -1 when it lands off the rectangle. */
export function rotate60(rows: number, cols: number, i: number, center: number): number {
  const [q, a] = axial(Math.floor(i / cols), i % cols);
  const [cq, ca] = axial(Math.floor(center / cols), center % cols);
  const dq = q - cq;
  const da = a - ca;
  const [r, c] = offset(cq - da, ca + dq + da);
  return r >= 0 && r < rows && c >= 0 && c < cols ? r * cols + c : -1;
}

/**
 * Direction from one cell's center to another's on screen, snapped to the nearest of the six:
 * `dx`, `dy` in any units where a column step is 1.5 and a row step is √3 (flat-top hexes of radius 1).
 */
export function directionOf(dx: number, dy: number): Dir {
  // Screen angle clockwise from up: N 0°, NE 60°, SE 120°...
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return (((Math.round(angle / 60) % 6) + 6) % 6) as Dir;
}
