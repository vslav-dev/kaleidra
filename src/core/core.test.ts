import { describe, expect, it } from 'vitest';
import { neighbor } from '@/core/board';
import { advance, createGame, makeMove, playMove } from '@/core/game';
import { axial, Dir, directionOf, hexArea, hexDistance, neighborTable, rotate60 } from '@/core/hex';
import { findGroups, newGroupScan, scanGroup } from '@/core/matches';
import { findMoves, hasAnyMatch } from '@/core/moves';
import { burstCells, rayCells, turnRotors } from '@/core/resolve';
import { type Board, type LevelDef, LevelKind, ObjectiveKind, rayOf, Special } from '@/core/types';

function level(rows: number, cols: number, extra: Partial<LevelDef> = {}): LevelDef {
  const n = rows * cols;
  return {
    number: 10,
    rows,
    cols,
    mask: new Array<number>(n).fill(1),
    ice: new Array<number>(n).fill(0),
    crate: new Array<number>(n).fill(0),
    chain: new Array<number>(n).fill(0),
    rotors: [],
    colors: 6,
    moves: 30,
    objectives: [{ kind: ObjectiveKind.Collect, target: 200, color: 0 }],
    stars: [0, 1000, 2000],
    kind: LevelKind.Normal,
    intro: null,
    targetWinRate: 0.7,
    ...extra,
  };
}

/** A board of distinct colors everywhere (nothing matches), then `paint` sets cells to color 0. */
function board(rows: number, cols: number, paint: number[] = []): Board {
  const b = createGame(level(rows, cols), 1).board;
  let id = 1000;
  // A unique color per cell, past the palette: nothing lines up.
  b.cells.forEach((cell, i) => (cell.piece = { id: id++, color: 100 + i, special: Special.None }));
  for (const i of paint) b.cells[i].piece!.color = 0;
  return b;
}

const at = (cols: number, r: number, c: number): number => r * cols + c;

describe('hex geometry', () => {
  it('neighbors are symmetric and at distance 1', () => {
    const t = neighborTable(7, 7);
    for (let i = 0; i < 49; i++) {
      for (let d = 0; d < 6; d++) {
        const j = t[i * 6 + d];
        if (j < 0) continue;
        expect(t[j * 6 + ((d + 3) % 6)]).toBe(i);
        expect(hexDistance(Math.floor(i / 7), i % 7, Math.floor(j / 7), j % 7)).toBe(1);
      }
    }
  });

  it('odd columns sit lower: their upper neighbors share the row', () => {
    const t = neighborTable(5, 5);
    // (2,1) is odd: its NW is (2,0), its NE is (2,2)
    expect(t[at(5, 2, 1) * 6 + Dir.NW]).toBe(at(5, 2, 0));
    expect(t[at(5, 2, 1) * 6 + Dir.NE]).toBe(at(5, 2, 2));
    // (2,2) is even: its NE is (1,3)
    expect(t[at(5, 2, 2) * 6 + Dir.NE]).toBe(at(5, 1, 3));
  });

  it('a hex area of radius 2 holds 19 cells', () => {
    expect(hexArea(9, 9, at(9, 4, 4), 2)).toHaveLength(19);
  });

  it('six turns of 60° come back', () => {
    const center = at(9, 4, 4);
    for (const i of hexArea(9, 9, center, 2)) {
      let j = i;
      for (let k = 0; k < 6; k++) j = rotate60(9, 9, j, center);
      expect(j).toBe(i);
      expect(axial(0, 0)).toEqual([0, 0]);
    }
  });

  it('screen directions snap to the six neighbors', () => {
    expect(directionOf(0, -1)).toBe(Dir.N);
    expect(directionOf(1.5, -0.87)).toBe(Dir.NE);
    expect(directionOf(1.5, 0.87)).toBe(Dir.SE);
    expect(directionOf(0, 1)).toBe(Dir.S);
    expect(directionOf(-1.5, 0.87)).toBe(Dir.SW);
    expect(directionOf(-1.5, -0.87)).toBe(Dir.NW);
  });
});

describe('matches', () => {
  /** Cells k steps from `start` in direction d. */
  const lineFrom = (b: Board, start: number, d: number, k: number): number[] => {
    const cells = [start];
    for (let s = 1; s < k; s++) cells.push(neighbor(b, cells[s - 1], d));
    return cells;
  };

  it('finds lines of three along each axis', () => {
    for (const d of [Dir.S, Dir.NE, Dir.SE]) {
      const b0 = board(7, 7);
      const cells = lineFrom(b0, at(7, 3, 2), d, 3);
      const b = board(7, 7, cells);
      const groups = findGroups(b, []);
      expect(groups).toHaveLength(1);
      expect(groups[0].cells.sort()).toEqual([...cells].sort());
      expect(groups[0].special).toBe(Special.None);
    }
  });

  it('four in a line makes a ray along it', () => {
    const b0 = board(7, 7);
    const cells = lineFrom(b0, at(7, 4, 1), Dir.NE, 4);
    const groups = findGroups(board(7, 7, cells), []);
    expect(groups[0].special).toBe(rayOf(1));
  });

  it('two crossing lines make a burst, three a nova, five in a line a prism', () => {
    const b0 = board(9, 9);
    const center = at(9, 4, 4);
    const v = lineFrom(b0, center, Dir.S, 3);
    const d1 = lineFrom(b0, center, Dir.NE, 3);
    const d2 = lineFrom(b0, center, Dir.NW, 3);
    expect(findGroups(board(9, 9, [...v, ...d1]), [])[0].special).toBe(Special.Burst);
    const nova = findGroups(board(9, 9, [...v, ...d1, ...d2]), [])[0];
    expect(nova.special).toBe(Special.Nova);
    expect(nova.at).toBe(center);
    expect(findGroups(board(9, 9, lineFrom(b0, at(9, 1, 4), Dir.S, 5)), [])[0].special).toBe(Special.Prism);
  });

  it('the local scan agrees with the full search', () => {
    const b0 = board(9, 9);
    const center = at(9, 4, 4);
    const cells = [...lineFrom(b0, center, Dir.S, 3), ...lineFrom(b0, center, Dir.NE, 4)];
    const b = board(9, 9, cells);
    const scan = newGroupScan();
    expect(scanGroup(b, center, scan)).toBe(true);
    const group = findGroups(b, [])[0];
    expect(scan.special).toBe(group.special);
    expect([...scan.cells.slice(0, scan.count)].sort()).toEqual([...group.cells].sort());
  });
});

describe('areas', () => {
  it('a ray takes its whole axis and a burst is a 13-cell snowflake', () => {
    const b = board(9, 9);
    expect(rayCells(b, at(9, 4, 4), 0)).toHaveLength(9);
    expect(burstCells(b, at(9, 4, 4))).toHaveLength(13);
  });
});

describe('play', () => {
  it('random play keeps the board full and calm at rest', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const lv = level(9, 9, {
        crate: Array.from({ length: 81 }, (_, i) => (i === 40 || i === 31 ? 2 : 0)),
        chain: Array.from({ length: 81 }, (_, i) => (i === 50 ? 1 : 0)),
        ice: Array.from({ length: 81 }, (_, i) => (i > 70 ? 1 : 0)),
        rotors: [{ at: at(9, 2, 2), spin: 1 }, { at: at(9, 2, 6), spin: -1 }],
      });
      const game = createGame(lv, seed);
      for (let m = 0; m < 30 && game.status === 'playing'; m++) {
        const moves = findMoves(game.board);
        expect(moves.length).toBeGreaterThan(0);
        const [i, j] = moves[(seed * 7 + m * 13) % moves.length];
        const b = game.board;
        expect(playMove(game, { r: Math.floor(i / b.cols), c: i % b.cols }, { r: Math.floor(j / b.cols), c: j % b.cols })).toBe(true);
        expect(hasAnyMatch(game.board)).toBe(false);
        for (const cell of game.board.cells) if (cell.exists && cell.crate === 0) expect(cell.piece).not.toBeNull();
      }
    }
  });

  it('rotors turn their ring one step after a move', () => {
    const lv = level(7, 7, { rotors: [{ at: at(7, 3, 3), spin: 1 }] });
    const game = createGame(lv, 3);
    const ids = (): number[] => [0, 1, 2, 3, 4, 5].map((d) => game.board.cells[neighbor(game.board, at(7, 3, 3), d)].piece!.id);
    const before = ids();
    const turns = turnRotors(game.board);
    expect(turns).not.toBeNull();
    const after = ids();
    for (let d = 0; d < 6; d++) expect(after[(d + 1) % 6]).toBe(before[d]);
  });

  it('a move owes the rotors a turn', () => {
    const lv = level(7, 7, { rotors: [{ at: at(7, 3, 3), spin: -1 }] });
    const game = createGame(lv, 5);
    const [i, j] = findMoves(game.board)[0];
    makeMove(game, { r: Math.floor(i / 7), c: i % 7 }, { r: Math.floor(j / 7), c: j % 7 });
    expect(game.turnDue).toBe(true);
    let rotated = false;
    for (let events = advance(game); events; events = advance(game)) if (events.some((e) => e.type === 'rotate')) rotated = true;
    expect(rotated).toBe(true);
  });
});
