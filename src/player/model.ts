import { type BotStyle, EXPERT_BOT } from '@/bot/bot';
import { FEATURE_COUNT, type MoveOptions, score } from '@/bot/features';

/**
 * The player as a bot, learned from play. Two parts, learned from two different signals:
 *  - taste: a weight per move feature, a move picked with probability ∝ exp(weights · features). Every move on
 *    a calm board nudges the weights to explain the choice (one gradient step of the log-likelihood) and pulls
 *    them a little towards the population prior, so the estimate starts sensible and follows the player.
 *  - strength, -1..1: what taste does not explain. Players win more (or less) than a bot with their taste alone;
 *    a positive strength mixes in the expert's best moves, a negative one random taps. Every attempt moves it
 *    by the surprise of the outcome against the twin's own prediction, so the twin wins as often as the player.
 * The twin that levels are calibrated on plays with both. Ported from Glimmerfall (its plans/06), where they were chosen and checked.
 */

/** Changes when the feature set or the meaning of the numbers changes: a stored model of another version is dropped. */
export const MODEL_VERSION = 1;

/**
 * Population weights. Order: see Feature. Glimmerfall's fit on recorded square-board moves (its plans/06),
 * carried over feature by feature: ray ← line, burst ← bomb; the nova, new on hexes, sits between burst and prism.
 * Refit once hex moves are recorded.
 */
const PRIOR: readonly number[] = [0.205, 0.044, 0.394, 0.529, 0.296, 0.563, 1.282, 1.909, 2.0, 2.135, 0.243, 0.257, 0.649, -0.35];
/** Spread of each feature across options: learning steps are taken in these units, so every feature learns alike. */
const SCALE: readonly number[] = [1.138, 0.924, 0.567, 0.539, 0.159, 0.502, 0.25, 0.12, 0.09, 0.068, 0.215, 0.108, 0.281, 2.044];
/** Best prequential fit on Glimmerfall's recorded moves, learning from scratch. */
const TASTE_RATE = 0.01;
const PULL = 0.01;
/** Per attempt; converged within ~30 attempts on Glimmerfall's recorded play. */
const STRENGTH_RATE = 0.1;
/** Per move: about the last 50 moves count. */
const RANK_RATE = 0.02;

export interface PlayerModel {
  version: number;
  weights: number[];
  strength: number;
  /** average rank of the chosen move among all moves by the expert's sense of value: 0 best, 0.5 random */
  rank: number;
  /** moves learned from */
  moves: number;
}

/** What a level is built and calibrated for: the twin bot, and how intricate a layout suits the player. */
export interface TwinStyle extends BotStyle {
  weights: number[];
  strength: number;
  /** how deliberately the twin plays, 0 (random taps) … 1 (always the expert's best move) */
  craft: number;
}

export function newModel(): PlayerModel {
  return { version: MODEL_VERSION, weights: [...PRIOR], strength: 0, rank: 0.35, moves: 0 };
}

let probs = new Float64Array(64);

/** Learns taste from one move made on a calm board; `chosen` indexes `o.moves`. */
export function observeMove(model: PlayerModel, o: MoveOptions, chosen: number, rate = TASTE_RATE): void {
  const n = o.moves.length;
  // A forced move says nothing about taste.
  if (n < 2) return;
  if (probs.length < n) probs = new Float64Array(n * 2);
  let max = -Infinity;
  for (let m = 0; m < n; m++) max = Math.max(max, (probs[m] = score(o, m, model.weights)));
  let sum = 0;
  for (let m = 0; m < n; m++) sum += probs[m] = Math.exp(probs[m] - max);
  for (let k = 0; k < FEATURE_COUNT; k++) {
    let expected = 0;
    for (let m = 0; m < n; m++) expected += probs[m] * o.features[m * FEATURE_COUNT + k];
    const gradient = o.features[chosen * FEATURE_COUNT + k] - expected / sum;
    model.weights[k] += rate * (gradient / (SCALE[k] * SCALE[k]) - PULL * (model.weights[k] - PRIOR[k]));
  }
  model.rank += RANK_RATE * (expertRank(o, chosen) - model.rank);
  model.moves++;
}

/**
 * Learns strength from one finished attempt: `predicted` is the twin's own win rate on it, as calibrated.
 * Attempts the player abandoned say nothing and are not passed in. `weight` < 1 for an attempt eased by boosters:
 * the twin plays without them, so such an outcome says less about the player.
 */
export function observeOutcome(model: PlayerModel, won: boolean, predicted: number, weight = 1): void {
  model.strength = Math.min(1, Math.max(-1, model.strength + weight * STRENGTH_RATE * ((won ? 1 : 0) - predicted)));
}

/** Probability the model's taste gives the chosen move: how well it predicts the player. */
export function likelihood(model: PlayerModel, o: MoveOptions, chosen: number): number {
  let max = -Infinity;
  for (let m = 0; m < o.moves.length; m++) max = Math.max(max, score(o, m, model.weights));
  let sum = 0;
  for (let m = 0; m < o.moves.length; m++) sum += Math.exp(score(o, m, model.weights) - max);
  return Math.exp(score(o, chosen, model.weights) - max) / sum;
}

/**
 * The twin, rounded: the rounded numbers are what levels get built from, what telemetry reports and what replays rebuild.
 * Craft is the expert rank the twin's play would average: its taste's rank, the expert's moves at rank 0, random ones at 0.5.
 */
export function twinOf(model: PlayerModel): TwinStyle {
  const s = model.strength;
  const rank = (1 - Math.abs(s)) * model.rank + (s < 0 ? -s * 0.5 : 0);
  return {
    weights: model.weights.map((w) => Math.round(w * 1000) / 1000),
    strength: Math.round(s * 100) / 100,
    craft: Math.round(Math.min(1, Math.max(0, 1 - 2 * rank)) * 100) / 100,
  };
}

/** 0 when the chosen move is the expert's best, 1 when it is the worst; ties share the rank. */
function expertRank(o: MoveOptions, chosen: number): number {
  const value = score(o, chosen, EXPERT_BOT.weights);
  let better = 0;
  let equal = 0;
  for (let m = 0; m < o.moves.length; m++) {
    const v = score(o, m, EXPERT_BOT.weights);
    if (v > value + 1e-9) better++;
    else if (v >= value - 1e-9) equal++;
  }
  return (better + (equal - 1) / 2) / (o.moves.length - 1);
}
