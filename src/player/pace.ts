/**
 * How many times fewer moves than their twin bot the player needs to finish a level, in log units.
 * Skill keeps the win rate on target by trimming moves; pace keeps the level long by growing the goals:
 * a player who outplays their twin still spends the intended number of moves on a level.
 */
const RATE = 0.3;
const LIMIT = Math.log(3);
/** Attempts that ended this early, or this far from the goals, say too little about the player's speed. */
const MIN_MOVES_MADE = 3;
const MIN_PROGRESS = 0.25;

/** The factor a level's twin length is multiplied by, rounded like the style: it goes into the level request. */
export function paceFactor(pace: number): number {
  return Math.round(Math.exp(pace) * 100) / 100;
}

/**
 * Learns from one attempt: `twinMoves` the twin typically needs for the level, `made` the player's moves
 * and `progress` the share of the furthest-behind goal reached, so a loss estimates the moves it would have taken.
 */
export function updatePace(pace: number, twinMoves: number | null, made: number, progress: number): number {
  if (twinMoves === null || made < MIN_MOVES_MADE || progress < MIN_PROGRESS) return pace;
  const needed = made / Math.min(1, progress);
  const next = pace + RATE * (Math.log(twinMoves / needed) - pace);
  return Math.min(LIMIT, Math.max(-LIMIT, next));
}
