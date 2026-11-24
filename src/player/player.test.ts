import { describe, expect, it } from 'vitest';
import { type BotStyle, EXPERT_BOT, pickMove, RANDOM_BOT } from '@/bot/bot';
import { goalsOf, moveOptions } from '@/bot/features';
import { posOf } from '@/core/board';
import { createGame, playMove } from '@/core/game';
import { type LevelDef, LevelKind, ObjectiveKind } from '@/core/types';
import { Difficulty, targetWinRate } from '@/player/difficulty';
import { paceFactor, updatePace } from '@/player/pace';
import { likelihood, newModel, observeMove, observeOutcome, type PlayerModel, twinOf } from '@/player/model';
import { initialThreeStars, updateThreeStars } from '@/player/stars';

function level(): LevelDef {
  const size = 81;
  return {
    number: 1,
    rows: 9,
    cols: 9,
    mask: new Array<number>(size).fill(1),
    ice: new Array<number>(size).fill(0),
    crate: new Array<number>(size).fill(0),
    chain: new Array<number>(size).fill(0),
    rotors: [],
    colors: 6,
    moves: 1000,
    objectives: [{ kind: ObjectiveKind.Collect, target: 10_000, color: 1 }],
    stars: [0, 1000, 2000],
    kind: LevelKind.Normal,
    intro: null,
    targetWinRate: 0.7,
  };
}

/** A player who plays like `style` for `moves` moves, and the model learned from them. */
function learned(style: BotStyle, moves: number): { model: PlayerModel; before: number; after: number } {
  const model = newModel();
  const game = createGame(level(), 11);
  const rng = { rng: 5 };
  let last = -1;
  let before = 0;
  let after = 0;
  for (let k = 0; k < moves; k++) {
    const options = moveOptions(game.board, goalsOf(game), last);
    const m = pickMove(options, style, rng);
    const p = Math.log(likelihood(model, options, m));
    if (k < moves / 4) before += p;
    if (k >= (moves * 3) / 4) after += p;
    observeMove(model, options, m);
    const [i, j] = options.moves[m];
    playMove(game, posOf(game.board, i), posOf(game.board, j));
    last = j;
  }
  return { model, before, after };
}

describe('player model', () => {
  it('a new player starts from the population taste, at no extra strength', () => {
    const twin = twinOf(newModel());
    expect(twin.strength).toBe(0);
    expect(twin.craft).toBeGreaterThan(0.2);
    expect(twin.craft).toBeLessThan(0.4);
  });

  it('tells a random tapper from an expert, and predicts the expert better as it learns', () => {
    const random = learned(RANDOM_BOT, 300);
    const expert = learned(EXPERT_BOT, 300);
    expect(random.model.rank).toBeGreaterThan(0.4);
    expect(twinOf(random.model).craft).toBeLessThan(0.2);
    expect(expert.model.rank).toBeLessThan(0.15);
    expect(twinOf(expert.model).craft).toBeGreaterThan(0.7);
    expect(expert.after).toBeGreaterThan(expert.before);
  });

  it('strength follows outcomes against the prediction, and bounds itself', () => {
    const model = newModel();
    for (let k = 0; k < 20; k++) observeOutcome(model, true, 0.5);
    expect(model.strength).toBeGreaterThan(0.5);
    for (let k = 0; k < 200; k++) observeOutcome(model, true, 0);
    expect(model.strength).toBe(1);
    for (let k = 0; k < 200; k++) observeOutcome(model, false, 1);
    expect(model.strength).toBe(-1);
    // Random taps mixed in: the twin plays less deliberately.
    expect(twinOf(model).craft).toBe(0);
  });
});

describe('difficulty', () => {
  it('orders the settings and helps after failures', () => {
    const easy = targetWinRate(0.7, Difficulty.Easy, 0);
    const normal = targetWinRate(0.7, Difficulty.Normal, 0);
    const hard = targetWinRate(0.7, Difficulty.Hard, 0);
    expect(normal).toBeCloseTo(0.7);
    expect(easy).toBeGreaterThan(0.83);
    expect(hard).toBeCloseTo(0.5, 1);
    expect(targetWinRate(0.5, Difficulty.Hard, 2)).toBeGreaterThan(targetWinRate(0.5, Difficulty.Hard, 0));
  });

  it('stays inside the corridor', () => {
    expect(targetWinRate(0.95, Difficulty.Easy, 6)).toBeLessThanOrEqual(0.97);
    expect(targetWinRate(0.3, Difficulty.Hard, 0)).toBeGreaterThanOrEqual(0.25);
  });
});

describe('stars', () => {
  it('raises the 3-star bar for a player who collects them too often, lowers it otherwise, within bounds', () => {
    let q = initialThreeStars();
    for (let k = 0; k < 10; k++) q = updateThreeStars(q, true);
    expect(q).toBeGreaterThan(initialThreeStars());
    let low = initialThreeStars();
    for (let k = 0; k < 10; k++) low = updateThreeStars(low, false);
    expect(low).toBeLessThan(initialThreeStars());
    for (let k = 0; k < 1000; k++) q = updateThreeStars(q, true);
    expect(q).toBeLessThanOrEqual(0.97);
  });
});

describe('pace', () => {
  it('learns how much faster than the twin the player finishes, wins and losses alike', () => {
    let pace = 0;
    for (let k = 0; k < 30; k++) pace = updatePace(pace, 24, 12, 1);
    expect(paceFactor(pace)).toBeCloseTo(2, 1);
    // A loss halfway through 20 moves reads as 40 needed: slower than a twin that needs 24.
    expect(updatePace(0, 24, 20, 0.5)).toBeLessThan(0);
  });

  it('ignores attempts that say too little, and stays bounded', () => {
    expect(updatePace(0.2, 24, 2, 1)).toBe(0.2);
    expect(updatePace(0.2, 24, 10, 0.1)).toBe(0.2);
    expect(updatePace(0.2, null, 10, 1)).toBe(0.2);
    let pace = 0;
    for (let k = 0; k < 100; k++) pace = updatePace(pace, 60, 3, 1);
    expect(paceFactor(pace)).toBeLessThanOrEqual(3);
  });
});
