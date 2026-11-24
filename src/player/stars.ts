import { THREE_STARS } from '@/gen/generator';

/**
 * Keeps 3 stars rare for this player: the twin's score quantile that earns them moves up when the player
 * collects them more often than once in 6–7 wins, and down when less. 2 stars follow at a fixed step below.
 */
const TARGET = 0.15;
const RATE = 0.02;
const MIN = 0.6;
const MAX = 0.97;

export function initialThreeStars(): number {
  return THREE_STARS;
}

/** Learns from one win. */
export function updateThreeStars(quantile: number, gotThree: boolean): number {
  return Math.min(MAX, Math.max(MIN, quantile + RATE * ((gotThree ? 1 : 0) - TARGET)));
}
