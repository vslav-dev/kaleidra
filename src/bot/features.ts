import { neighbor, swapPieces } from '@/core/board';
import { DIRECTIONS, hexDistance, screenRow } from '@/core/hex';
import { type GroupScan, newGroupScan, scanGroup } from '@/core/matches';
import { findMoves, isComboPair, type Move } from '@/core/moves';
import { axisOf, type Board, type GameState, ObjectiveKind, Special } from '@/core/types';

/**
 * What a player can see in a move before making it. Every move on a calm board gets one row of these;
 * a style is a weight per feature, and a move is picked with probability ∝ exp(weights · features).
 * The bots play by them and the player's style is learned from them, so both see the same game.
 * Changing the features changes the meaning of stored weights: bump MODEL_VERSION in the player model.
 */
export const Feature = {
  /** cells the match clears */
  Cells: 0,
  /** of them, cells of a collect color still wanted */
  Wanted: 1,
  /** of them, cells on frost while a frost goal is open */
  Ice: 2,
  /** goal stones next to the match */
  Crate: 3,
  /** locked cells in the match: they lose the lock instead of the piece */
  Chain: 4,
  /** specials the move sets off */
  Used: 5,
  /** the special the match creates */
  Ray: 6,
  Burst: 7,
  Nova: 8,
  Prism: 9,
  /** two specials (or a prism with anything) swapped together */
  Combo: 10,
  /** specials next to the one created: a combo waiting for the next move */
  Setup: 11,
  /** how low the move is, 0 at the top, 1 at the bottom */
  Low: 12,
  /** cells away from the previous move, capped: where the player is already looking */
  Far: 13,
} as const;
export type Feature = (typeof Feature)[keyof typeof Feature];
export const FEATURE_COUNT = 14;

/** Distance cap, and the distance assumed when there is no previous move: a typical one. */
const FAR_CAP = 8;
const FAR_UNKNOWN = 4;

/** The goals still open: what a move is worth depends on them. */
export interface Goals {
  /** one bit per collect color still wanted */
  wanted: number;
  ice: boolean;
  crate: boolean;
}

/** Every valid move with its feature row: `features[m * FEATURE_COUNT + k]`. */
export interface MoveOptions {
  moves: Move[];
  features: Float64Array;
}

export function goalsOf(state: GameState): Goals {
  const goals: Goals = { wanted: 0, ice: false, crate: false };
  state.level.objectives.forEach((o, k) => {
    if (state.progress[k] >= o.target) return;
    if (o.kind === ObjectiveKind.Collect) goals.wanted |= 1 << o.color;
    else if (o.kind === ObjectiveKind.Ice) goals.ice = true;
    else if (o.kind === ObjectiveKind.Crate) goals.crate = true;
  });
  return goals;
}

/** One scratch scan per thread: the extraction runs synchronously, never nested. */
const scan: GroupScan = newGroupScan();

/** Features of every move on a calm board; `last` is the cell of the previous move, or -1. Leaves the board as it was. */
export function moveOptions(b: Board, goals: Goals, last: number): MoveOptions {
  const moves = findMoves(b);
  const features = new Float64Array(moves.length * FEATURE_COUNT);
  // Cells counted for the current group carry its stamp: a stone next to several matched cells counts once.
  const seen = new Int32Array(b.cells.length);
  let stamp = 0;
  const bottom = Math.max(1, b.rows - 0.5);
  for (let m = 0; m < moves.length; m++) {
    const [i, j] = moves[m];
    const row = m * FEATURE_COUNT;
    features[row + Feature.Low] = (rowOf(b, i) + rowOf(b, j)) / 2 / bottom;
    features[row + Feature.Far] = last < 0 ? FAR_UNKNOWN : Math.min(FAR_CAP, distance(b, last, i), distance(b, last, j));
    const pi = b.cells[i].piece!;
    const pj = b.cells[j].piece!;
    if (isComboPair(pi, pj)) {
      features[row + Feature.Combo] = 1;
      features[row + Feature.Used] = 2;
      continue;
    }
    swapPieces(b, i, j);
    if (scanGroup(b, i, scan)) addGroup(b, i, goals, seen, ++stamp, features, row);
    if (scanGroup(b, j, scan)) addGroup(b, j, goals, seen, ++stamp, features, row);
    swapPieces(b, i, j);
  }
  return { moves, features };
}

/** Value of option `m` for a style: weights · features. */
export function score(o: MoveOptions, m: number, weights: readonly number[]): number {
  let value = 0;
  const row = m * FEATURE_COUNT;
  for (let k = 0; k < FEATURE_COUNT; k++) value += weights[k] * o.features[row + k];
  return value;
}

function made(special: Special): Feature | null {
  if (axisOf(special) >= 0) return Feature.Ray;
  if (special === Special.Burst) return Feature.Burst;
  if (special === Special.Nova) return Feature.Nova;
  if (special === Special.Prism) return Feature.Prism;
  return null;
}

/** Adds the scanned group through swapped cell x to the feature row. */
function addGroup(b: Board, x: number, goals: Goals, seen: Int32Array, stamp: number, f: Float64Array, row: number): void {
  for (let k = 0; k < scan.count; k++) {
    const i = scan.cells[k];
    seen[i] = stamp;
    const cell = b.cells[i];
    f[row + Feature.Cells]++;
    if (cell.chain > 0) {
      f[row + Feature.Chain]++;
      continue;
    }
    const piece = cell.piece!;
    if (piece.special !== Special.None) f[row + Feature.Used]++;
    if (goals.wanted & (1 << piece.color)) f[row + Feature.Wanted]++;
    if (goals.ice && cell.ice > 0) f[row + Feature.Ice]++;
  }
  if (goals.crate) {
    for (let k = 0; k < scan.count; k++) {
      for (let d = 0; d < DIRECTIONS; d++) {
        const n = neighbor(b, scan.cells[k], d);
        if (n < 0 || b.cells[n].crate === 0 || seen[n] === stamp) continue;
        seen[n] = stamp;
        f[row + Feature.Crate]++;
      }
    }
  }
  const feature = made(scan.special);
  if (feature === null) return;
  f[row + feature]++;
  for (let d = 0; d < DIRECTIONS; d++) {
    const n = neighbor(b, x, d);
    const piece = n >= 0 ? b.cells[n].piece : null;
    if (piece && piece.special !== Special.None && seen[n] !== stamp) f[row + Feature.Setup]++;
  }
}

function rowOf(b: Board, i: number): number {
  return screenRow(Math.floor(i / b.cols), i % b.cols);
}

function distance(b: Board, a: number, c: number): number {
  return hexDistance(Math.floor(a / b.cols), a % b.cols, Math.floor(c / b.cols), c % b.cols);
}
