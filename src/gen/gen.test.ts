import { describe, expect, it } from 'vitest';
import { EXPERT_BOT, pickMove, simulate } from '@/bot/bot';
import { FEATURE_COUNT, goalsOf, moveOptions } from '@/bot/features';
import { neighbors6, posOf } from '@/core/board';
import { advance, createGame, playMove, startFinale, starsFor } from '@/core/game';
import { hasAnyMatch, hasMove } from '@/core/moves';
import { LevelKind, ObjectiveKind } from '@/core/types';
import { type DraftRequest, draftLevel, finalizeLevel } from '@/gen/generator';
import { refillReachesAll } from '@/gen/layout';
import { planLevel } from '@/gen/plan';
import { newModel, type TwinStyle, twinOf } from '@/player/model';

const AVERAGE: TwinStyle = { ...twinOf(newModel()), strength: 0.3 };
const TAPPER: TwinStyle = { weights: new Array<number>(FEATURE_COUNT).fill(0), strength: 0, craft: 0 };
const PLANNER: TwinStyle = { weights: [...EXPERT_BOT.weights], strength: 0.8, craft: 1 };
const req = (number: number, seed = 12345, style = AVERAGE, pace = 1): DraftRequest => ({ seed, number, style, pace });

describe('generator', () => {
  it('is deterministic per request', () => {
    expect(draftLevel(req(17))).toEqual(draftLevel(req(17)));
  });

  it('shares the first levels and builds the rest per player', () => {
    expect(draftLevel(req(3, 1)).level).toEqual(draftLevel(req(3, 2)).level);
    expect(draftLevel(req(20, 1)).level).not.toEqual(draftLevel(req(20, 2)).level);
  });

  it('produces valid, playable levels across the curve', () => {
    for (const n of [1, 2, 4, 9, 14, 20, 26, 31, 47, 66]) {
      const level = finalizeLevel(draftLevel(req(n)), planLevel(n).baseWinRate);
      expect(level.moves).toBeGreaterThanOrEqual(14);
      expect(level.moves).toBeLessThanOrEqual(50);
      expect(level.objectives.length).toBeGreaterThan(0);
      for (const o of level.objectives) expect(o.target).toBeGreaterThan(0);
      if (level.objectives.some((o) => o.kind === ObjectiveKind.Score)) expect(level.objectives).toHaveLength(1);
      const [one, two, three] = level.stars;
      expect(two).toBeGreaterThan(one);
      expect(three).toBeGreaterThan(two);
      const game = createGame(level, 7);
      expect(hasAnyMatch(game.board)).toBe(false);
      expect(hasMove(game.board)).toBe(true);
    }
    // Full calibrations: seconds on a laptop, several times slower on CI runners.
  }, 120_000);

  it('gives a random tapper whole boards and a planner more intricate ones', () => {
    const levels = [8, 20, 33, 51, 70];
    const holes = (style: TwinStyle): number =>
      levels.reduce((sum, n) => sum + draftLevel(req(n, 7, style)).level.mask.filter((m) => m === 0).length, 0);
    expect(holes(TAPPER)).toBe(0);
    expect(holes(PLANNER)).toBeGreaterThan(0);
  }, 120_000);

  it('never walls a free cell off from the refill with stones and locks', () => {
    for (const n of [10, 16, 25, 48, 77, 139]) {
      const { level } = draftLevel(req(n, n * 31, PLANNER));
      const blocked = (i: number): boolean => level.crate[i] > 0 || level.chain[i] > 0;
      expect(refillReachesAll({ rows: level.rows, cols: level.cols, mask: level.mask, blocked }), `level ${n}`).toBe(true);
    }
  }, 120_000);

  it('predicts each twin run at the finalized moves, wins about as targeted, and keeps 3 stars rare', () => {
    const level = finalizeLevel(draftLevel(req(26)), 0.7);
    const runs = 80;
    let wins = 0;
    let three = 0;
    let mispredicted = 0;
    for (let k = 0; k < runs; k++) {
      const seed = 9000 + k;
      // The same seeds as a calibration run: the played game follows the simulated one move for move.
      const sim = simulate(level, seed, 60, AVERAGE, { chancesUpTo: level.moves });
      const predicted = (sim.needed !== null && sim.needed <= level.moves) || sim.chances.some(([m]) => m === level.moves);
      const game = createGame(level, seed);
      const rng = { rng: seed ^ 0x5bd1e995 };
      let last = -1;
      while (game.status === 'playing') {
        const options = moveOptions(game.board, goalsOf(game), last);
        const [i, j] = options.moves[pickMove(options, AVERAGE, rng)];
        playMove(game, posOf(game.board, i), posOf(game.board, j));
        last = j;
      }
      if (predicted !== (game.status === 'won')) mispredicted++;
      if (game.status !== 'won') continue;
      startFinale(game);
      while (advance(game)) continue;
      wins++;
      if (starsFor(game) === 3) three++;
    }
    // Only the skipped last-chance checks far from the goals can disagree.
    expect(mispredicted).toBeLessThanOrEqual(runs * 0.03);
    expect(wins / runs).toBeGreaterThan(0.55);
    expect(wins / runs).toBeLessThan(0.9);
    expect(three / wins).toBeLessThan(0.35);
  }, 60_000);

  it('grows the goals and the moves for a player faster than their twin', () => {
    // A shared level: one layout, so only the goals can differ.
    const own = finalizeLevel(draftLevel(req(1, 5, AVERAGE, 1)), 0.7);
    const fast = finalizeLevel(draftLevel(req(1, 5, AVERAGE, 2)), 0.7);
    const amount = (l: typeof own): number => l.objectives.reduce((sum, o) => sum + o.target, 0);
    expect(fast.moves).toBeGreaterThan(own.moves);
    expect(amount(fast)).toBeGreaterThan(amount(own));
  }, 60_000);

  it('gives more moves for a higher target win rate', () => {
    const draft = draftLevel(req(13));
    expect(finalizeLevel(draft, 0.9).moves).toBeGreaterThanOrEqual(finalizeLevel(draft, 0.4).moves);
  });

  // The bound is the measured draft; the warm-up draft before it only counts against the test's own timeout.
  // A few seconds, not tens: the next level is drafted while this one is played. The CI runner drafts ~1.5× slower
  // than a dev laptop (3.1 s against ~2 s), so the bound leaves it room; phones report real times in `perf` ops.
  it('drafts a level fast enough for a worker during the previous level', () => {
    draftLevel(req(44));
    const start = performance.now();
    draftLevel(req(45));
    expect(performance.now() - start).toBeLessThan(6000);
  }, 30_000);
});

describe('rotors', () => {
  it('the rotor intro has one, and every ring is whole and free of blockers', () => {
    const intro = draftLevel(req(14)).level;
    expect(intro.rotors).toHaveLength(1);
    for (const n of [14, 23, 37, 52, 71]) {
      const { level } = draftLevel(req(n, n * 17, PLANNER));
      for (const rotor of level.rotors) {
        const b = createGame(level, 1).board;
        for (const j of neighbors6(b, rotor.at)) {
          expect(level.crate[j]).toBe(0);
          expect(level.chain[j]).toBe(0);
        }
        expect(neighbors6(b, rotor.at)).toHaveLength(6);
      }
    }
  }, 120_000);
});

describe('plan', () => {
  it('introduces mechanics on intro levels', () => {
    expect(planLevel(4).kind).toBe(LevelKind.Intro);
    expect(planLevel(14).intro).toBe('rotor');
    expect(planLevel(11).kind).toBe(LevelKind.Hard);
    expect(planLevel(12).kind).toBe(LevelKind.Relief);
  });
});
