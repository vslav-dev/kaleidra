import { describe, expect, it } from 'vitest';
import { posOf } from '@/core/board';
import { advance, canAct, canStrike, createGame, makeMove, startFinale, strike } from '@/core/game';
import { findMoves } from '@/core/moves';
import { Booster, type GameState, type LevelDef, LevelKind, ObjectiveKind } from '@/core/types';
import { decodeMoves, encodeMoves, newRecord, recordMiss, recordMove, recordStrike, replayAttempt } from '@/telemetry/attempt';

function level(target: number): LevelDef {
  const size = 81;
  const lv: LevelDef = {
    number: 9,
    rows: 9,
    cols: 9,
    mask: new Array<number>(size).fill(1),
    ice: new Array<number>(size).fill(0),
    crate: new Array<number>(size).fill(0),
    chain: new Array<number>(size).fill(0),
    rotors: [{ at: 40, spin: 1 }],
    colors: 6,
    moves: 25,
    objectives: [{ kind: ObjectiveKind.Collect, target, color: 2 }],
    stars: [0, 1000, 2000],
    kind: LevelKind.Normal,
    intro: null,
    targetWinRate: 0.7,
  };
  lv.mask[0] = 0;
  lv.chain[12] = 1;
  lv.crate[70] = 2;
  return lv;
}

/** Plays like the app: the board runs to rest, then a swap or a booster. */
function play(lv: LevelDef, seed: number, boosters = false) {
  const game = createGame(lv, seed);
  const record = newRecord(seed);
  for (let turn = 0; turn < 200; turn++) {
    while (advance(game)) continue;
    if (boosters && turn % 6 === 3 && canStrike(game)) {
      const booster = turn % 12 === 3 ? Booster.Meteor : Booster.Star;
      // Cell 0 is a hole.
      const at = posOf(game.board, 1 + ((turn * 11 + seed) % 80));
      expect(strike(game, booster, at)).toBe(true);
      recordStrike(record, game.board, booster, at);
      continue;
    }
    if (!canAct(game)) break;
    const moves = findMoves(game.board);
    if (moves.length === 0) break;
    const [i, j] = moves[(turn * 7 + seed) % moves.length];
    const [a, b] = turn % 2 ? [posOf(game.board, i), posOf(game.board, j)] : [posOf(game.board, j), posOf(game.board, i)];
    expect(makeMove(game, a, b)?.valid).toBe(true);
    recordMove(record, game.board, a, b, turn % 5 === 0, turn * 450, turn % 2 === 0);
  }
  while (advance(game)) continue;
  if (game.status === 'won' && game.movesLeft > 0) {
    startFinale(game);
    while (advance(game)) continue;
  }
  return { game, record };
}

const summary = (g: GameState) => ({ status: g.status, score: g.score, made: g.movesMade, left: g.movesLeft, progress: g.progress, strikes: g.strikes });

describe('attempt record', () => {
  for (const [name, target, boosters] of [
    ['a won attempt', 12, false],
    ['a lost attempt', 500, false],
    ['an attempt with boosters', 500, true],
  ] as const) {
    it(`replays ${name} exactly from the board seed and the packed moves`, () => {
      const lv = level(target);
      const { game, record } = play(lv, 4242, boosters);
      expect(game.status).toBe(target === 12 ? 'won' : 'lost');
      if (boosters) expect(game.strikes).toBeGreaterThan(0);
      const replayed = replayAttempt(lv, { board: record.board, moves: decodeMoves(encodeMoves(record.moves)) });
      expect(summary(replayed)).toEqual(summary(game));
    });
  }

  it('packs a move into four bytes', () => {
    const moves = [0, 2 ** 26 - 1, 123456];
    const text = encodeMoves(moves);
    expect(text.length).toBe(16);
    expect(decodeMoves(text)).toEqual(moves);
  });

  it('keeps the direction among six, and a missed swap with where on the replay it happened', () => {
    const board = createGame(level(12), 1).board;
    const record = newRecord(1);
    // (4,4) is an even column: its SE neighbor is (4,5), its SW is (4,3).
    recordMove(record, board, { r: 4, c: 4 }, { r: 4, c: 5 }, false, 1200, true);
    recordMiss(record, board, { r: 4, c: 4 }, { r: 4, c: 3 });
    const move = record.moves[0];
    expect([move & 127, (move >>> 7) & 7, (move >>> 11) & 255, (move >>> 19) & 1]).toEqual([40, 2, 12, 1]);
    const miss = record.misses[0];
    expect([miss & 127, (miss >>> 7) & 7, miss >>> 10]).toEqual([40, 4, 1]);
  });
});
