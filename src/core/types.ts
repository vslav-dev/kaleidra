/**
 * Special pieces. A ray fires along one of the three hex axes (see hex.ts): Ray + axis.
 * Burst: a snowflake around the piece. Nova: all three axes at once. Prism: wipes a color.
 */
export const Special = {
  None: 0,
  Ray0: 1,
  Ray1: 2,
  Ray2: 3,
  Burst: 4,
  Nova: 5,
  Prism: 6,
} as const;
export type Special = (typeof Special)[keyof typeof Special];

export function rayOf(axis: number): Special {
  return (Special.Ray0 + axis) as Special;
}

/** Axis of a ray special, or -1. */
export function axisOf(s: Special): number {
  return s >= Special.Ray0 && s <= Special.Ray2 ? s - Special.Ray0 : -1;
}

/** Prism pieces have no color: they match nothing and take the color of what they are swapped with. */
export const NO_COLOR = -1;
/** Three axes make lines ~1.5× as common as on a square board: one or two more colors keep the same pace. */
export const MAX_COLORS = 7;

export interface Piece {
  id: number;
  color: number;
  special: Special;
}

export interface Cell {
  /** false = hole in the board shape */
  exists: boolean;
  piece: Piece | null;
  /** frost layers under the piece */
  ice: number;
  /** stone durability; a cell with a stone holds no piece */
  crate: number;
  /** lock layers; a locked piece cannot move */
  chain: number;
}

/** Offset coordinates: column `c`, row `r`; odd columns sit half a cell lower. */
export interface Pos {
  r: number;
  c: number;
}

/** A ring of six pieces around `at` that turns one step after every move; `spin` 1 clockwise, -1 counter-clockwise. */
export interface Rotor {
  at: number;
  spin: 1 | -1;
}

/** Plain, JSON-serializable board. Owns its RNG state and id counter so a saved board resumes exactly. */
export interface Board {
  rows: number;
  cols: number;
  colors: number;
  cells: Cell[];
  rotors: Rotor[];
  nextId: number;
  rng: number;
}

export const ObjectiveKind = {
  Score: 'score',
  Collect: 'collect',
  Ice: 'ice',
  Crate: 'crate',
} as const;
export type ObjectiveKind = (typeof ObjectiveKind)[keyof typeof ObjectiveKind];

export interface Objective {
  kind: ObjectiveKind;
  target: number;
  /** only for Collect */
  color: number;
}

export const LevelKind = {
  Normal: 'normal',
  Hard: 'hard',
  Relief: 'relief',
  Intro: 'intro',
} as const;
export type LevelKind = (typeof LevelKind)[keyof typeof LevelKind];

export const Mechanic = {
  Ice: 'ice',
  Crate: 'crate',
  Rotor: 'rotor',
  Chain: 'chain',
  DoubleGoal: 'double-goal',
} as const;
export type Mechanic = (typeof Mechanic)[keyof typeof Mechanic];

export interface LevelDef {
  number: number;
  rows: number;
  cols: number;
  /** per cell, index r * cols + c: 1 = cell exists */
  mask: number[];
  ice: number[];
  crate: number[];
  chain: number[];
  rotors: Rotor[];
  colors: number;
  moves: number;
  objectives: Objective[];
  /** score thresholds for 1, 2, 3 stars */
  stars: [number, number, number];
  kind: LevelKind;
  intro: Mechanic | null;
  /** the twin bot's win rate at these moves: what the level was calibrated for, and the prediction the player is measured against */
  targetWinRate: number;
}

export const BlastKind = {
  Ray: 'ray',
  Burst: 'burst',
  /** a combo's wide area: a big hexagon */
  Area: 'area',
  Prism: 'prism',
  /** a falling star the player aimed: the cell and its six neighbors, every layer at once */
  Star: 'star',
  /** a meteor the player aimed: every layer in its crater breaks at once */
  Meteor: 'meteor',
} as const;
export type BlastKind = (typeof BlastKind)[keyof typeof BlastKind];

export interface Blast {
  kind: BlastKind;
  origin: Pos;
  cells: Pos[];
  /** playback order inside a clear step */
  order: number;
  /** prism: color it wipes */
  color: number;
  /** ray: its axis */
  axis: number;
}

export interface RemovedPiece {
  id: number;
  pos: Pos;
  color: number;
  order: number;
  /** id of the special piece this one merged into, or -1 */
  mergeInto: number;
}

export interface CreatedPiece {
  pos: Pos;
  piece: Piece;
}

/** A special that was hit and now waits its turn to go off. */
export interface LitPiece {
  id: number;
  pos: Pos;
  order: number;
}

export interface LayerChange {
  pos: Pos;
  ice: number;
  crate: number;
  chain: number;
  order: number;
}

export interface ScorePopup {
  /** popup center: screen row (odd columns already half a row lower) and column, fractional */
  r: number;
  c: number;
  value: number;
  order: number;
}

export interface FallMove {
  piece: Piece;
  /** first point is the start; spawned pieces start above the board (negative or virtual rows) */
  path: Pos[];
  spawned: boolean;
}

export interface RotorTurn {
  center: Pos;
  spin: 1 | -1;
  /** pieces that moved one step around the center */
  moves: { id: number; from: Pos; to: Pos }[];
}

export type GameEvent =
  | { type: 'swap'; a: Pos; b: Pos; valid: boolean }
  | {
      type: 'clear';
      cascade: number;
      removed: RemovedPiece[];
      created: CreatedPiece[];
      blasts: Blast[];
      layers: LayerChange[];
      popups: ScorePopup[];
      /** specials this step lit: they stay on the board and go off one per step from the next one on */
      lit: LitPiece[];
      /** where the player's two swapped specials met and went off together, or null */
      combo: Pos | null;
    }
  /** pieces turn into specials: the finale's remaining moves, or a prism spreading its partner (`from`: the prism) */
  | { type: 'transform'; pieces: CreatedPiece[]; from: Pos | null }
  | { type: 'fall'; moves: FallMove[] }
  | { type: 'shuffle'; pieces: CreatedPiece[] }
  /** the rotors turned their rings one step */
  | { type: 'rotate'; turns: RotorTurn[] }
  /** finale and last chance: every special left on the calm board is lit */
  | { type: 'light'; pieces: LitPiece[] }
  /** out of moves with goals left: the specials still on the board are about to fire once */
  | { type: 'lastChance' };

export type SwapEvent = Extract<GameEvent, { type: 'swap' }>;

export type GameStatus = 'playing' | 'won' | 'lost';

/** A valid swap already made on the board, waiting for the next step to clear it. Cell indices. */
export interface PendingSwap {
  /** the cell the player touched first; a combo centers here */
  from: number;
  /** where the moved piece now is; a special created by the swap's match appears here */
  to: number;
}

/** Rare strikes the player saves up across levels and aims at a cell. */
export const Booster = {
  Star: 'star',
  Meteor: 'meteor',
} as const;
export type Booster = (typeof Booster)[keyof typeof Booster];

/** A booster aimed at a cell (index), waiting for the next step like a swap. */
export interface Strike {
  booster: Booster;
  at: number;
}

/** What the player did that the next step plays: a swap or a strike. */
export type PendingMove = PendingSwap | Strike;

export function isStrike(move: PendingMove): move is Strike {
  return 'booster' in move;
}

/** Everything that changes during a level. JSON-serializable for save/resume. */
export interface GameState {
  level: LevelDef;
  board: Board;
  movesLeft: number;
  movesMade: number;
  score: number;
  /** progress per objective, same order as level.objectives */
  progress: number[];
  status: GameStatus;
  pending: PendingMove | null;
  /** boosters the player used in this attempt: a win with them is an easier win */
  strikes: number;
  /** cascade depth of the next step: drives the score multiplier and praise */
  cascade: number;
  /** finale lighting rounds left; 0 outside the finale and the last chance */
  finale: number;
  /** ids of lit specials, in firing order: they go off one per step, with the board refilling in between */
  fuse: number[];
  /** the one last-chance detonation is spent */
  lastChance: boolean;
  /** a move was made since the rotors last turned: they turn once the board is calm */
  turnDue: boolean;
}
