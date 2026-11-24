/**
 * Target win rate of an attempt. The level curve gives the base; the chosen difficulty and failures
 * on the level shift it in logit units, so the curve keeps its shape and never sticks to 0 or 100 %.
 */
export const Difficulty = {
  Easy: 'easy',
  Normal: 'normal',
  Hard: 'hard',
} as const;
export type Difficulty = (typeof Difficulty)[keyof typeof Difficulty];

/** Easiest first: the settings stepper walks this list. */
export const DIFFICULTIES: readonly Difficulty[] = [Difficulty.Easy, Difficulty.Normal, Difficulty.Hard];

const SHIFT: Record<Difficulty, number> = {
  [Difficulty.Easy]: 0.85,
  [Difficulty.Normal]: 0,
  [Difficulty.Hard]: -0.85,
};
/** Each failure on the same level raises the target by this much. */
const FAIL_ASSIST = 0.45;
const MIN_WIN_RATE = 0.25;
const MAX_WIN_RATE = 0.97;

/** The difficulty and failures only: how strong the player is lives in the twin bot the level is calibrated on. */
export function targetWinRate(base: number, difficulty: Difficulty, fails: number): number {
  const p = sigmoid(logit(base) + SHIFT[difficulty] + FAIL_ASSIST * fails);
  return Math.min(MAX_WIN_RATE, Math.max(MIN_WIN_RATE, p));
}

function logit(p: number): number {
  return Math.log(p / (1 - p));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
