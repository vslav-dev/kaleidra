import { type Charges, newCharges } from '@/app/boosters';
import type { GameState } from '@/core/types';
import type { LevelDraft } from '@/gen/generator';
import { Difficulty } from '@/player/difficulty';
import { MODEL_VERSION, newModel, type PlayerModel } from '@/player/model';
import { initialThreeStars } from '@/player/stars';

const KEY = 'kaleidra-save';
const VERSION = 1;

export interface Settings {
  sound: boolean;
  haptics: boolean;
  difficulty: Difficulty;
}

/** An attempt in progress: the game, and the target its level was finalized for. */
export interface Attempt {
  game: GameState;
  target: number;
}

/** The level being played: as built for the player, failures so far, and the unfinished attempt, if any. */
export interface CurrentLevel {
  /** each attempt is finalized from it for the target win rate of that moment */
  draft: LevelDraft;
  fails: number;
  attempt: Attempt | null;
}

/** What the game has learned about the player. */
export interface PlayerState {
  model: PlayerModel;
  /** how much faster than their twin bot the player finishes, in log units */
  pace: number;
  /** the twin's score quantile that earns this player 3 stars */
  threeStars: number;
}

export interface SaveData {
  version: number;
  /** the player's own seed: their levels differ from everyone else's */
  seed: number;
  /** next level to play */
  level: number;
  /** best stars per level, index = level - 1 */
  stars: number[];
  player: PlayerState;
  boosters: Charges;
  settings: Settings;
  current: CurrentLevel | null;
}

export function defaultSave(): SaveData {
  return {
    version: VERSION,
    seed: randomSeed(),
    level: 1,
    stars: [],
    player: { model: newModel(), pace: 0, threeStars: initialThreeStars() },
    boosters: newCharges(),
    settings: { sound: true, haptics: true, difficulty: Difficulty.Normal },
    current: null,
  };
}

export function loadSave(): SaveData {
  const defaults = defaultSave();
  let data: SaveData | null;
  try {
    data = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SaveData | null;
  } catch {
    data = null;
  }
  if (!data || data.version !== VERSION) return defaults;
  // Fields added later get their defaults; a player model of another version starts over.
  const player = { ...defaults.player, ...data.player };
  if (player.model.version !== MODEL_VERSION) player.model = newModel();
  return { ...defaults, ...data, player, settings: { ...defaults.settings, ...data.settings } };
}

export function persist(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked (private mode): the game plays on, progress just is not kept.
  }
}

export function clearSave(): void {
  localStorage.removeItem(KEY);
}

/** A random 32-bit seed, unsigned. */
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
