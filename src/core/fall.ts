import { cellAt, holdsPiece, indexOf, isMovable, neighbor, newPiece, posOf, spawnColor } from '@/core/board';
import { Dir, screenRow } from '@/core/hex';
import type { Board, FallMove, Piece, Pos } from '@/core/types';

/** Cells bottom first by where they sit on screen: diagonal slides fill the lowest gap first. */
const orders = new Map<string, number[]>();

function bottomUp(b: Board): number[] {
  const key = `${b.rows}x${b.cols}`;
  let order = orders.get(key);
  if (!order) {
    order = Array.from({ length: b.rows * b.cols }, (_, i) => i).sort(
      (x, y) => screenRow(Math.floor(y / b.cols), y % b.cols) - screenRow(Math.floor(x / b.cols), x % b.cols) || x - y,
    );
    orders.set(key, order);
  }
  return order;
}

/**
 * Gravity and refill until nothing moves.
 * Pieces fall straight down their column, through holes. Under a stone or a locked piece the gap is fed from the
 * upper-left or upper-right neighbor: on hexes these are true neighbors, so the refill flows around obstacles like sand.
 * New pieces spawn at the top existing cell of each column open to the sky.
 * Returns the path of every piece that moved, for playback.
 */
export function settle(b: Board): FallMove[] {
  const moves = new Map<number, FallMove>();
  const spawned = new Array<number>(b.cols).fill(0);

  const record = (piece: Piece, from: Pos, to: Pos, isSpawn: boolean): void => {
    const move = moves.get(piece.id);
    if (move) move.path.push(to);
    else moves.set(piece.id, { piece, path: [from, to], spawned: isSpawn });
  };

  const isEmpty = (i: number): boolean => {
    const cell = b.cells[i];
    return holdsPiece(cell) && cell.piece === null;
  };

  /** Nearest existing cell above in the column (holes are skipped), or -1 when the column is open to the sky. */
  const sourceOf = (r: number, c: number): number => {
    for (let y = r - 1; y >= 0; y--) if (cellAt(b, y, c)) return indexOf(b, y, c);
    return -1;
  };

  /** Nearest existing cell below in the column (holes are skipped), or -1. */
  const targetOf = (r: number, c: number): number => {
    for (let y = r + 1; y < b.rows; y++) if (cellAt(b, y, c)) return indexOf(b, y, c);
    return -1;
  };

  const verticalPass = (): boolean => {
    let changed = false;
    for (let c = 0; c < b.cols; c++) {
      for (let r = b.rows - 1; r >= 0; r--) {
        const i = indexOf(b, r, c);
        if (!b.cells[i].exists || !isEmpty(i)) continue;
        const src = sourceOf(r, c);
        const target = b.cells[i];
        if (src === -1) {
          const piece = newPiece(b, spawnColor(b));
          target.piece = piece;
          record(piece, { r: r - 1 - spawned[c], c }, { r, c }, true);
          spawned[c]++;
          changed = true;
          continue;
        }
        const source = b.cells[src];
        if (isMovable(source)) {
          target.piece = source.piece;
          source.piece = null;
          record(target.piece!, posOf(b, src), { r, c }, false);
          changed = true;
        }
      }
    }
    return changed;
  };

  const diagonalPass = (): boolean => {
    for (const i of bottomUp(b)) {
      if (!b.cells[i].exists || !isEmpty(i)) continue;
      const { r, c } = posOf(b, i);
      const src = sourceOf(r, c);
      // An empty cell above will be filled first; only a real obstacle blocks the straight supply.
      if (src === -1 || isEmpty(src)) continue;
      const sides = (r + c) % 2 === 0 ? [Dir.NW, Dir.NE] : [Dir.NE, Dir.NW];
      for (const d of sides) {
        const s = neighbor(b, i, d);
        if (s < 0 || !isMovable(b.cells[s])) continue;
        // The side piece first feeds its own column.
        const p = posOf(b, s);
        const below = targetOf(p.r, p.c);
        if (below !== -1 && isEmpty(below)) continue;
        b.cells[i].piece = b.cells[s].piece;
        b.cells[s].piece = null;
        record(b.cells[i].piece!, p, { r, c }, false);
        return true;
      }
    }
    return false;
  };

  while (verticalPass() || diagonalPass()) {
    // keep settling
  }
  return [...moves.values()];
}
