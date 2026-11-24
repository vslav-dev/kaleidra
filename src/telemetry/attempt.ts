import { indexOf, neighbor, posOf } from '@/core/board';
import { advance, createGame, makeMove, startFinale, strike } from '@/core/game';
import { DIRECTIONS } from '@/core/hex';
import { type Board, Booster, type GameState, type LevelDef, type Pos } from '@/core/types';
import { GEN_VERSION, type LevelDraft } from '@/gen/generator';
import type { Difficulty } from '@/player/difficulty';
import type { PlayerModel } from '@/player/model';
import { track } from '@/telemetry/telemetry';

/**
 * One attempt as the least that replays it: the game is deterministic and the player acts only on a calm board,
 * so the starting board seed and the player's moves rebuild every board, cascade, rotor turn and score offline.
 * Each move also keeps how long the player thought, whether a hint was showing, and how the swap was entered.
 * Sent as one `attempt` event: a summary always, the moves for a share of players. Swaps that matched nothing
 * change no state: they are kept apart, with where on the replay they happened, since they show what the player misreads.
 */
export interface AttemptRecord {
  /** seed of the starting board */
  board: number;
  /**
   * one packed move each: cell 7 bits, direction 3 (0–5, clockwise from up), hint 1, think time 8 (0.1 s),
   * dragged (else two taps) 1. A booster strike is an entry too, with STRIKE_BIT set: cell 7 bits, booster 1 (BOOSTER_BITS).
   */
  moves: number[];
  /** swaps tried that matched nothing, packed: cell 7 bits, direction 3, entries in `moves` before it 15 */
  misses: number[];
  /** when the attempt started, epoch ms: with the report time it gives the attempt's wall time */
  started: number;
  /** times the attempt was paused, the app going to the background included */
  pauses: number;
}

export const AttemptEnd = {
  Won: 'won',
  Lost: 'lost',
  Restart: 'restart',
} as const;
export type AttemptEnd = (typeof AttemptEnd)[keyof typeof AttemptEnd];

/** Players (by seed) whose attempts carry the moves; the summary comes from everyone. Lowered as the audience grows. */
const REPLAY_PERCENT = 100;
const BYTE = 255;
const MAX_MOVE_INDEX = 2 ** 15 - 1;
const STRIKE_BIT = 1 << 29;
const BOOSTER_BITS: readonly Booster[] = [Booster.Star, Booster.Meteor];

export function newRecord(board: number): AttemptRecord {
  return { board, moves: [], misses: [], started: Date.now(), pauses: 0 };
}

/** A valid swap of `a` onto `b`. */
export function recordMove(rec: AttemptRecord, board: Board, a: Pos, b: Pos, hint: boolean, thinkMs: number, drag: boolean): void {
  const think = Math.min(BYTE, Math.round(thinkMs / 100));
  rec.moves.push(swapBits(board, a, b) | ((hint ? 1 : 0) << 10) | (think << 11) | ((drag ? 1 : 0) << 19));
}

/** A booster aimed at cell `at`. */
export function recordStrike(rec: AttemptRecord, board: Board, booster: Booster, at: Pos): void {
  rec.moves.push(STRIKE_BIT | indexOf(board, at.r, at.c) | (BOOSTER_BITS.indexOf(booster) << 7));
}

/** A swap of `a` onto `b` that matched nothing. */
export function recordMiss(rec: AttemptRecord, board: Board, a: Pos, b: Pos): void {
  rec.misses.push(swapBits(board, a, b) | (Math.min(MAX_MOVE_INDEX, rec.moves.length) << 10));
}

function swapBits(board: Board, a: Pos, b: Pos): number {
  const from = indexOf(board, a.r, a.c);
  const to = indexOf(board, b.r, b.c);
  let dir = 0;
  while (dir < DIRECTIONS && neighbor(board, from, dir) !== to) dir++;
  return from | (dir << 7);
}

/** Plays the recorded attempt again on its level, through the finale of a win. */
export function replayAttempt(level: LevelDef, rec: Pick<AttemptRecord, 'board' | 'moves'>): GameState {
  const game = createGame(level, rec.board);
  for (const packed of rec.moves) {
    // The player acts only at rest: the app ran the board until it said so.
    while (advance(game)) continue;
    const from = packed & 127;
    if (packed & STRIKE_BIT) {
      strike(game, BOOSTER_BITS[(packed >>> 7) & 1], posOf(game.board, from));
      continue;
    }
    makeMove(game, posOf(game.board, from), posOf(game.board, neighbor(game.board, from, (packed >>> 7) & 7)));
  }
  while (advance(game)) continue;
  // As in the app: the finale runs only with moves left over.
  if (game.status === 'won' && game.movesLeft > 0) {
    startFinale(game);
    while (advance(game)) continue;
  }
  return game;
}

/** Four little-endian bytes per move, base64. */
export function encodeMoves(moves: number[]): string {
  const bytes = new Uint8Array(new Uint32Array(moves).buffer);
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

export function decodeMoves(text: string): number[] {
  const bytes = Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));
  return [...new Uint32Array(bytes.buffer)];
}

export interface AttemptReport {
  draft: LevelDraft;
  game: GameState;
  record: AttemptRecord;
  end: AttemptEnd;
  /** moves left when the attempt ended; for a win, before the finale used them up */
  left: number;
  stars: number;
  fails: number;
  difficulty: Difficulty;
  /** the win rate the attempt was finalized for, before the twin's own rate at the chosen moves */
  target: number;
  /** the 3-star quantile it was finalized with */
  threeStars: number;
  model: PlayerModel;
}

/**
 * Everything that rebuilds the level: the generator that built it, the player seed, number, the twin it was
 * built for, and the exact numbers it was finalized with. Then the twin's prediction, the model as it stood,
 * and how the attempt went. `rules` is the game code that played it: replays need the same.
 */
export function trackAttempt(r: AttemptReport): void {
  const { request, variant } = r.draft;
  const { game } = r;
  const level = game.level;
  const replayed = request.seed % 100 < REPLAY_PERCENT;
  track('attempt', {
    gen: r.draft.version,
    rules: GEN_VERSION,
    seed: request.seed,
    n: request.number,
    variant,
    style: request.style,
    pace: request.pace,
    difficulty: r.difficulty,
    fails: r.fails,
    target: r.target,
    threeStars: r.threeStars,
    p: round2(level.targetWinRate),
    model: [round2(r.model.strength), round2(r.model.rank), r.model.moves],
    moves: level.moves,
    board: r.record.board,
    end: r.end,
    made: game.movesMade,
    strikes: game.strikes,
    left: r.left,
    score: game.score,
    stars: r.stars,
    goals: level.objectives.map((o, k) => round2(game.progress[k] / o.target)),
    bad: r.record.misses.length,
    wall: Math.round((Date.now() - r.record.started) / 1000),
    pauses: r.record.pauses,
    rec: replayed ? encodeMoves(r.record.moves) : null,
    misses: replayed ? encodeMoves(r.record.misses) : null,
  });
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
