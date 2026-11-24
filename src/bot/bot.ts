import { FEATURE_COUNT, goalsOf, type MoveOptions, moveOptions, score } from '@/bot/features';
import { posOf } from '@/core/board';
import { advance, createGame, playMove, startFinale } from '@/core/game';
import { findMoves, type Move } from '@/core/moves';
import { random, randInt, type RngHolder } from '@/core/rng';
import { type Board, type GameState, type LevelDef, type Pos } from '@/core/types';

/**
 * How a player picks moves: a weight per move feature (see features.ts). A move is picked with probability
 * ∝ exp(weights · features); a greedy bot always takes the highest. All-zero weights pick at random.
 */
export interface BotStyle {
  weights: readonly number[];
  greedy?: boolean;
  /**
   * How strong the bot plays beyond its taste, -1..1: at a positive strength it takes the expert's best move
   * with that probability, at a negative one a random move; otherwise it picks by its weights.
   */
  strength?: number;
}

/**
 * Takes the best move by a hand-made sense of value every time, and loves specials and combos:
 * the ceiling a level is checked against. Order: see Feature.
 */
export const EXPERT_BOT: BotStyle = { weights: [1, 2, 3, 3, 1, 7, 9, 12, 16, 21, 40, 6, 1.5, 0], greedy: true };
/** Taps any valid move. */
export const RANDOM_BOT: BotStyle = { weights: new Array<number>(FEATURE_COUNT).fill(0) };

export interface SimResult {
  /** moves needed to complete every goal by play, or null when the moves ran out: a level with at least that many is won */
  needed: number | null;
  /** score when the goals were complete, or at the end */
  score: number;
  /** score the finale adds per move left, measured on a won run when asked for; 0 otherwise */
  finale: number;
  /**
   * Move counts up to `needed` at which a level ending right there is still won, with the final score: [moves, score].
   * Each holds for that exact count only: the last move's cascade makes no specials and the last chance fires,
   * while with more moves the game plays on and may spend its specials.
   */
  chances: [number, number][];
}

export interface SimOptions {
  /** measure the finale on a won run */
  finale?: boolean;
  /** play every move from `chancesFrom` up to `chancesUpTo` once more as the last one; 0 skips that, the costly part of a run */
  chancesFrom?: number;
  chancesUpTo?: number;
  /** stop at the first move count that wins, by play or through the last chance: all a length estimate needs */
  untilFirstWin?: boolean;
}

/** Below this share of every goal, one last move and a volley of specials cannot finish the level: the check is skipped. */
const LAST_CHANCE_REACH = 0.5;
/** Moves left over when the finale is measured; below the finale's conversion cap. */
const FINALE_PROBE = 6;

let values = new Float64Array(64);

/** Index of the chosen option: a softmax over weights · features, or the best one for a greedy style. */
export function pickMove(o: MoveOptions, style: BotStyle, rng: RngHolder): number {
  const n = o.moves.length;
  const strength = style.strength ?? 0;
  if (strength !== 0 && random(rng) < Math.abs(strength)) return strength > 0 ? pickMove(o, EXPERT_BOT, rng) : randInt(rng, n);
  if (values.length < n) values = new Float64Array(n * 2);
  let best = 0;
  let max = -Infinity;
  for (let m = 0; m < n; m++) {
    values[m] = score(o, m, style.weights);
    if (values[m] > max) {
      max = values[m];
      best = m;
    }
  }
  if (style.greedy) return best;
  let sum = 0;
  for (let m = 0; m < n; m++) {
    values[m] = Math.exp(values[m] - max);
    sum += values[m];
  }
  let roll = random(rng) * sum;
  for (let m = 0; m < n; m++) {
    roll -= values[m];
    if (roll < 0) return m;
  }
  return n - 1;
}

/** Plays a level to the end with the given style, without playback. */
export function simulate(level: LevelDef, seed: number, maxMoves: number, style: BotStyle, opts: SimOptions = {}): SimResult {
  const game = createGame({ ...level, moves: maxMoves }, seed);
  const rng: RngHolder = { rng: seed ^ 0x5bd1e995 };
  const chances: [number, number][] = [];
  const tapper = style.weights.every((w) => w === 0);
  // The bot looks where its last move landed, as a player does.
  let last = -1;
  while (game.status === 'playing') {
    const move = chooseMove(game, style, tapper, last, rng);
    if (!move) break;
    last = move[1];
    const b = game.board;
    const a = posOf(b, move[0]);
    const c = posOf(b, move[1]);
    if (game.movesMade < (opts.chancesUpTo ?? 0) && game.movesMade + 1 >= (opts.chancesFrom ?? 1)) {
      const score = lastMoveScore(game, a, c);
      if (score !== null) {
        chances.push([game.movesMade + 1, score]);
        if (opts.untilFirstWin) return { needed: null, score, finale: 0, chances };
      }
    }
    playMove(game, a, c);
  }
  if (game.status !== 'won') return { needed: null, score: game.score, finale: 0, chances };
  return { needed: game.movesMade, score: game.score, finale: opts.finale ? finaleValue(game) : 0, chances };
}

function chooseMove(game: GameState, style: BotStyle, tapper: boolean, last: number, rng: RngHolder): Move | null {
  if (tapper) {
    // A random tapper needs no features: the cheapest bot by far.
    const moves = findMoves(game.board);
    return moves.length > 0 ? moves[randInt(rng, moves.length)] : null;
  }
  const options = moveOptions(game.board, goalsOf(game), last);
  return options.moves.length > 0 ? options.moves[pickMove(options, style, rng)] : null;
}

/** Score per move left that the finale adds to a won game; finishes the game. */
function finaleValue(game: GameState): number {
  const before = game.score;
  game.movesLeft = FINALE_PROBE;
  startFinale(game);
  while (advance(game)) continue;
  return (game.score - before) / FINALE_PROBE;
}

/**
 * The final score if this move were the level's last, played to the end with the last chance; null when it would lose.
 * Tried only when every goal is at least LAST_CHANCE_REACH done: one move and one volley close a gap, not a level.
 */
function lastMoveScore(game: GameState, a: Pos, b: Pos): number | null {
  if (!game.level.objectives.every((o, k) => game.progress[k] >= o.target * LAST_CHANCE_REACH)) return null;
  const trial: GameState = { ...game, board: cloneBoard(game.board), progress: [...game.progress], fuse: [...game.fuse], movesLeft: 1 };
  playMove(trial, a, b);
  return trial.status === 'won' ? trial.score : null;
}

/** A board copy for a trial: pieces are copied too, since resolving mutates them. Much cheaper than structuredClone. */
function cloneBoard(b: Board): Board {
  return { ...b, cells: b.cells.map((c) => ({ ...c, piece: c.piece ? { ...c.piece } : null })) };
}
