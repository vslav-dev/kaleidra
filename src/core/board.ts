import { AXES, DIRECTIONS, hexDistance, neighborTable, opposite } from '@/core/hex';
import { randInt } from '@/core/rng';
import { type Board, type Cell, type Piece, type Pos, NO_COLOR, Special } from '@/core/types';

export function indexOf(b: Board, r: number, c: number): number {
  return r * b.cols + c;
}

export function posOf(b: Board, i: number): Pos {
  return { r: Math.floor(i / b.cols), c: i % b.cols };
}

export function inside(b: Board, r: number, c: number): boolean {
  return r >= 0 && r < b.rows && c >= 0 && c < b.cols;
}

/** Existing cell at (r, c), or null for out of bounds and holes. */
export function cellAt(b: Board, r: number, c: number): Cell | null {
  if (!inside(b, r, c)) return null;
  const cell = b.cells[r * b.cols + c];
  return cell.exists ? cell : null;
}

/** Neighbor of cell `i` in direction `d` when it exists (not a hole, not off the board), else -1. */
export function neighbor(b: Board, i: number, d: number): number {
  const j = neighborTable(b.rows, b.cols)[i * DIRECTIONS + d];
  return j >= 0 && b.cells[j].exists ? j : -1;
}

/** Existing neighbors of cell `i`, clockwise from up. */
export function neighbors6(b: Board, i: number): number[] {
  const result: number[] = [];
  for (let d = 0; d < DIRECTIONS; d++) {
    const j = neighbor(b, i, d);
    if (j >= 0) result.push(j);
  }
  return result;
}

/** Color that takes part in matching in cell `i` (an index, or -1), or NO_COLOR. */
export function colorOf(b: Board, i: number): number {
  if (i < 0) return NO_COLOR;
  const cell = b.cells[i];
  return cell.exists && cell.piece ? cell.piece.color : NO_COLOR;
}

/** Cell can hold a piece (exists and is not a stone). */
export function holdsPiece(cell: Cell): boolean {
  return cell.exists && cell.crate === 0;
}

/** Piece in the cell can be swapped and can fall. */
export function isMovable(cell: Cell): boolean {
  return cell.piece !== null && cell.chain === 0 && cell.crate === 0;
}

export function newPiece(b: Board, color: number, special: Special = Special.None): Piece {
  return { id: b.nextId++, color: special === Special.Prism ? NO_COLOR : color, special };
}

/** Refill color: uniform, so calibration over many boards stays honest. */
export function spawnColor(b: Board): number {
  return randInt(b, b.colors);
}

export function swapPieces(b: Board, i: number, j: number): void {
  const piece = b.cells[i].piece;
  b.cells[i].piece = b.cells[j].piece;
  b.cells[j].piece = piece;
}

export function isAdjacent(a: Pos, b: Pos): boolean {
  return hexDistance(a.r, a.c, b.r, b.c) === 1;
}

/** Same-color run from `i` (exclusive) in direction `d`. */
function run(b: Board, i: number, d: number, k: number): number {
  let n = 0;
  for (let j = neighbor(b, i, d); j >= 0 && colorOf(b, j) === k; j = neighbor(b, j, d)) n++;
  return n;
}

/** Whether a piece of color k in cell `i` would complete a line of 3 along any axis with its neighbors. */
export function wouldMatch(b: Board, i: number, k: number): boolean {
  for (let axis = 0; axis < AXES; axis++) if (run(b, i, axis, k) + run(b, i, opposite(axis), k) >= 2) return true;
  return false;
}

/** Random color that creates no match in cell `i`, if one exists. */
export function randomFreeColor(b: Board, i: number): number {
  const start = randInt(b, b.colors);
  for (let k = 0; k < b.colors; k++) {
    const color = (start + k) % b.colors;
    if (!wouldMatch(b, i, color)) return color;
  }
  return start;
}
