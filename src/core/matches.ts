import { colorOf, neighbor } from '@/core/board';
import { AXES, opposite, screenRow } from '@/core/hex';
import { type Board, NO_COLOR, rayOf, Special } from '@/core/types';

export interface MatchGroup {
  cells: number[];
  color: number;
  special: Special;
  /** cell where the special piece appears, -1 when none */
  at: number;
}

interface Line {
  axis: number;
  cells: number[];
}

/**
 * The special a group makes, by its lines: the longest first (5+ a prism), then how many axes cross in it
 * (all three a nova, two a burst), then a line of four (a ray along it).
 */
export function specialFor(longest: number, longestAxis: number, axes: number): Special {
  if (longest >= 5) return Special.Prism;
  if (axes >= 3) return Special.Nova;
  if (axes === 2) return Special.Burst;
  if (longest === 4) return rayOf(longestAxis);
  return Special.None;
}

/** Same-color run length from `i` (exclusive) in direction `d`. */
function run(b: Board, i: number, d: number, k: number): number {
  let n = 0;
  for (let j = neighbor(b, i, d); j >= 0 && colorOf(b, j) === k; j = neighbor(b, j, d)) n++;
  return n;
}

/** Whether the piece in cell i is part of a line of 3+ along any axis. Used for quick move checks. */
export function matchesAt(b: Board, i: number): boolean {
  const k = colorOf(b, i);
  if (k === NO_COLOR) return false;
  for (let axis = 0; axis < AXES; axis++) if (run(b, i, axis, k) + run(b, i, opposite(axis), k) >= 2) return true;
  return false;
}

/** Reusable result of `scanGroup`, so hot loops (bots, move estimates) allocate nothing. */
export interface GroupScan {
  /** the first `count` entries are the group's cells */
  cells: Int32Array;
  count: number;
  special: Special;
}

const MAX_SCAN = 64;

export function newGroupScan(): GroupScan {
  return { cells: new Int32Array(MAX_SCAN), count: 0, special: Special.None };
}

/**
 * The group through cell x on a board where only x changed since it was calm: every new line passes through x,
 * so this local scan finds exactly what `findGroups` would, without scanning the board. Returns whether there is a match.
 */
export function scanGroup(b: Board, x: number, scan: GroupScan): boolean {
  scan.count = 0;
  scan.special = Special.None;
  const k = colorOf(b, x);
  if (k === NO_COLOR) return false;
  let axes = 0;
  let longest = 0;
  let longestAxis = 0;
  for (let axis = 0; axis < AXES; axis++) {
    const back = run(b, x, opposite(axis), k);
    const ahead = run(b, x, axis, k);
    const length = back + ahead + 1;
    if (length < 3) continue;
    axes++;
    if (length > longest) {
      longest = length;
      longestAxis = axis;
    }
    let j = x;
    for (let s = 0; s < back; s++) j = neighbor(b, j, opposite(axis));
    for (let s = 0; s < length; s++, j = neighbor(b, j, axis)) addCell(scan, j);
  }
  if (axes === 0) return false;
  scan.special = specialFor(longest, longestAxis, axes);
  return true;
}

function addCell(scan: GroupScan, i: number): void {
  for (let k = 0; k < scan.count; k++) if (scan.cells[k] === i) return;
  scan.cells[scan.count++] = i;
}

/**
 * All match groups on the board: lines of 3+ along the three axes; lines sharing a cell merge into one group,
 * whose shape decides the special it creates. `preferred` cells (the swapped pair) get the special when they can.
 */
export function findGroups(b: Board, preferred: readonly number[]): MatchGroup[] {
  const lines = collectLines(b);
  if (lines.length === 0) return [];

  const parent = lines.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const owner = new Map<number, number>();
  lines.forEach((line, s) => {
    for (const cell of line.cells) {
      const other = owner.get(cell);
      if (other === undefined) owner.set(cell, s);
      else parent[root(s)] = root(other);
    }
  });

  const components = new Map<number, Line[]>();
  lines.forEach((line, s) => {
    const key = root(s);
    const list = components.get(key);
    if (list) list.push(line);
    else components.set(key, [line]);
  });
  return [...components.values()].map((parts) => buildGroup(b, parts, preferred));
}

function collectLines(b: Board): Line[] {
  const lines: Line[] = [];
  for (let axis = 0; axis < AXES; axis++) {
    const back = opposite(axis);
    for (let i = 0; i < b.cells.length; i++) {
      const k = colorOf(b, i);
      // A line is walked from its first cell only.
      if (k === NO_COLOR || colorOf(b, neighbor(b, i, back)) === k) continue;
      const cells: number[] = [];
      for (let j = i; j >= 0 && colorOf(b, j) === k; j = neighbor(b, j, axis)) cells.push(j);
      if (cells.length >= 3) lines.push({ axis, cells });
    }
  }
  return lines;
}

function buildGroup(b: Board, parts: Line[], preferred: readonly number[]): MatchGroup {
  const cells = [...new Set(parts.flatMap((p) => p.cells))];
  const color = b.cells[cells[0]].piece!.color;
  const longest = parts.reduce((best, p) => (p.cells.length > best.cells.length ? p : best));
  const axes = new Set(parts.map((p) => p.axis)).size;
  const special = specialFor(longest.cells.length, longest.axis, axes);
  if (special === Special.None) return { cells, color, special, at: -1 };

  // A locked piece only loses its lock and a matched special stays until its turn to go off: the new one cannot appear there.
  const free = cells.filter((i) => b.cells[i].chain === 0 && b.cells[i].piece!.special === Special.None);
  if (free.length === 0) return { cells, color, special: Special.None, at: -1 };

  // Where lines of different axes cross: the heart of a burst or a nova.
  const crossing = (i: number): boolean => new Set(parts.filter((p) => p.cells.includes(i)).map((p) => p.axis)).size >= 2;
  const middle = longest.cells[Math.floor(longest.cells.length / 2)];
  const at =
    free.find((i) => preferred.includes(i)) ??
    (axes >= 2 ? free.find(crossing) : undefined) ??
    (free.includes(middle) ? middle : free.reduce((top, i) => (screenY(b, i) < screenY(b, top) ? i : top)));
  return { cells, color, special, at };
}

function screenY(b: Board, i: number): number {
  return screenRow(Math.floor(i / b.cols), i % b.cols);
}
