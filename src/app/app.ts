import { EARN, spend, stock, winGain, withGain } from '@/app/boosters';
import { type Attempt, clearSave, type CurrentLevel, defaultSave, loadSave, persist, randomSeed, type SaveData } from '@/app/save';
import { type Update, UpdateWatch } from '@/app/updates';
import { AudioBus } from '@/audio/audio';
import { Sfx } from '@/audio/synth';
import { goalsOf, type MoveOptions, moveOptions } from '@/bot/features';
import { indexOf } from '@/core/board';
import { advance, canAct, canRescue, canStrike, createGame, makeMove, startFinale, starsFor, strike } from '@/core/game';
import { BlastKind, Booster, type GameEvent, type GameState, type Pos, Special } from '@/core/types';
import { LevelDrafts } from '@/gen/drafts';
import { type DraftRequest, finalizeLevel, GEN_VERSION, twinMoves } from '@/gen/generator';
import { planLevel } from '@/gen/plan';
import { DIFFICULTIES, targetWinRate } from '@/player/difficulty';
import { observeMove, observeOutcome, twinOf } from '@/player/model';
import { paceFactor, updatePace } from '@/player/pace';
import { updateThreeStars } from '@/player/stars';
import { AttemptEnd, type AttemptRecord, newRecord, recordMiss, recordMove, recordStrike, trackAttempt } from '@/telemetry/attempt';
import { flushPerf, perfContext, timed } from '@/telemetry/perf';
import { track } from '@/telemetry/telemetry';
import { BOOSTER_FOOTER, BoosterBar } from '@/ui/boosterBar';
import { S } from '@/ui/strings';
import { Action, Ui } from '@/ui/ui';
import { BoardView, Layer } from '@/view/boardView';
import type { Scene } from '@/view/scene';

const Mode = {
  Title: 'title',
  Play: 'play',
  Pause: 'pause',
  Settings: 'settings',
  Help: 'help',
  Finale: 'finale',
  Won: 'won',
  Lost: 'lost',
  /** the update notice is open */
  Update: 'update',
} as const;
type Mode = (typeof Mode)[keyof typeof Mode];

/** Every step of a chain plays this much faster than the one before, up to CHAIN_MAX_SPEED. */
const CHAIN_RAMP = 1.12;
const CHAIN_MAX_SPEED = 3;
const chainSpeed = (cascade: number): number => Math.min(CHAIN_MAX_SPEED, CHAIN_RAMP ** Math.max(0, cascade - 1));
/** An outcome eased by boosters teaches the player's strength this much: the twin plays without them. */
const BOOSTED_WEIGHT = 0.5;

const LAYER_SFX: Record<Layer, Sfx> = { [Layer.Ice]: Sfx.Frost, [Layer.Crate]: Sfx.Stone, [Layer.Chain]: Sfx.Lock };

/** Game flow: screens, moves, results, persistence. Owns no rules (core) and draws nothing itself (view, ui). */
export class GameApp {
  private readonly ui: Ui;
  private readonly boosters: BoosterBar;
  private readonly view: BoardView;
  private readonly audio = new AudioBus();
  private readonly drafts = new LevelDrafts();
  private save: SaveData = defaultSave();
  private game: GameState | null = null;
  private mode: Mode = Mode.Title;
  /** where settings and help return to */
  private menuReturn: Mode = Mode.Title;
  /** the game whose board steps are being played back */
  private running: GameState | null = null;
  /** the calm board's moves, valued once when it came to rest: the next swap is read against them */
  private rest: MoveOptions | null = null;
  private lastTo = -1;
  /** the hint was showing when the player moved: such a move says nothing about their taste */
  private hinted = false;
  /** when the board came to rest for the player: how long they thought before a move */
  private thinkFrom = 0;
  /** a newer build is live */
  private update: Update | null = null;
  /** where the update notice returns to */
  private updateReturn: Mode = Mode.Title;
  private aiming: Booster | null = null;
  private readonly debugEl = new URLSearchParams(location.search).has('debug') ? createDebugEl() : null;
  private readonly stage: HTMLElement;

  public constructor(
    root: HTMLElement,
    private readonly scene: Scene,
    canvas: HTMLCanvasElement,
  ) {
    this.ui = new Ui(root, (action) => void this.onAction(action));
    this.boosters = new BoosterBar(root.querySelector<HTMLElement>('#boosters')!);
    this.view = new BoardView(scene, canvas, {
      onSwap: (a, b, drag) => this.onSwap(a, b, drag),
      onStrike: (at) => this.onStrike(at),
      onLayerHit: (layer) => this.audio.play(LAYER_SFX[layer]),
      onLayout: (rect) => this.boosters.place(rect),
    });
    this.view.setFooter(BOOSTER_FOOTER);

    this.stage = root.querySelector<HTMLElement>('#stage')!;
    new ResizeObserver(() => this.fit()).observe(this.stage);

    // Mobile browsers allow audio only after a gesture; every tap re-checks cheaply.
    document.addEventListener('pointerdown', () => this.audio.unlock(), { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (this.mode === Mode.Play) this.pause();
        this.audio.suspend();
        persist(this.save);
      } else {
        this.audio.resume();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.mode === Mode.Play) this.pause();
      else if (this.mode === Mode.Pause) this.resume();
    });
  }

  public init(): void {
    this.save = loadSave();
    this.applySettings();
    this.showTitle();
    // The first level is built while the title shows.
    void this.drafts.get(this.draftRequest(this.save.level));
    new UpdateWatch(__APP_VERSION__, (update) => this.onUpdate(update)).start();
  }

  // ---------- levels ----------

  private showTitle(): void {
    flushPerf('title');
    perfContext({ level: null, board: null });
    this.mode = Mode.Title;
    this.game = null;
    this.aiming = null;
    this.view.inputEnabled = false;
    this.view.clear();
    this.ui.hideHud();
    this.boosters.hide();
    this.ui.showTitle(this.save.level, this.save.current?.attempt != null, this.update !== null);
  }

  /** The level to play now; a new one is built when the saved one is done or stale. The next one is built meanwhile. */
  private async currentLevel(): Promise<CurrentLevel> {
    const n = this.save.level;
    let current = this.save.current;
    if (!current || current.draft.request.number !== n || current.draft.version !== GEN_VERSION) {
      const fails = current?.draft.request.number === n ? current.fails : 0;
      current = { draft: await this.drafts.get(this.draftRequest(n)), fails, attempt: null };
      this.save.current = current;
    }
    void this.drafts.get(this.draftRequest(n + 1));
    return current;
  }

  /** A level of this player, for their twin as it reads now. */
  private draftRequest(n: number): DraftRequest {
    const { player } = this.save;
    return { seed: this.save.seed, number: n, style: twinOf(player.model), pace: paceFactor(player.pace) };
  }

  /** A new attempt on a fresh random board, finalized for the target of this moment: difficulty and failures so far. */
  private startAttempt(current: CurrentLevel): Attempt {
    const n = current.draft.request.number;
    const { settings, player } = this.save;
    const target = targetWinRate(planLevel(n).baseWinRate, settings.difficulty, current.fails);
    const def = finalizeLevel(current.draft, target, player.threeStars);
    const seed = randomSeed();
    current.attempt = { game: createGame(def, seed), record: newRecord(seed), target, threeStars: player.threeStars };
    return current.attempt;
  }

  private async playLevel(): Promise<void> {
    let fresh = false;
    flushPerf('level');
    // Measured behind the curtain: draft wait, calibration, board build.
    await this.ui.curtain(() => timed('level', async () => {
      const current = await this.currentLevel();
      fresh = current.attempt === null;
      const game = (current.attempt ?? this.startAttempt(current)).game;
      this.game = game;
      this.rest = null;
      this.lastTo = -1;
      this.aiming = null;
      if (this.debugEl) for (const b of Object.values(Booster)) this.save.boosters[b] = EARN[b].unit * EARN[b].max;
      perfContext({ level: game.level.number, board: `${game.board.cols}x${game.board.rows}` });
      this.view.inputEnabled = false;
      persist(this.save);
      this.ui.setTheme(game.level.number);
      this.ui.hideOverlay();
      this.ui.showHud(game.level);
      this.ui.updateHud(game);
      this.boosters.show(this.save.boosters);
      // The HUD just filled in and took its height: the board is fitted to the stage as it is now, not as it was.
      this.fit();
      this.view.setBoard(game.board);
      this.showDebug();
    }));
    const game = this.game;
    const current = this.save.current;
    if (!game || !current) return;
    this.mode = Mode.Play;
    await this.view.entrance();
    if (this.game !== game) return;
    this.ui.announce(game.level, current.fails);
    // A new mechanic explains itself once, on its intro level.
    if (fresh && game.level.intro && current.fails === 0) {
      this.menuReturn = Mode.Play;
      this.mode = Mode.Help;
      this.ui.showGoals(game);
      return;
    }
    // A save made mid-cascade resumes from there.
    await this.run(game);
  }

  /** A newer build is live: its button shows under the board, and on the title screen. */
  private onUpdate(update: Update): void {
    this.update = update;
    track('update', { event: 'found', to: update.version });
    this.boosters.showUpdate();
    if (this.mode === Mode.Title) this.showTitle();
  }

  /** The notice: what the new version brings. From play it pauses the level; "later" goes back where it was. */
  private openUpdate(): void {
    if (!this.update || (this.mode !== Mode.Play && this.mode !== Mode.Title)) return;
    this.updateReturn = this.mode;
    if (this.mode === Mode.Play) this.pause();
    this.mode = Mode.Update;
    this.ui.showUpdate(__APP_VERSION__, this.update);
  }

  private closeUpdate(): void {
    if (this.mode !== Mode.Update) return;
    if (this.updateReturn === Mode.Play) this.resume();
    else this.showTitle();
  }

  /** Reloads into the new build once the save is written: a level in progress resumes where it was. */
  private applyUpdate(): void {
    track('update', { event: 'applied', to: this.update?.version ?? null });
    flushPerf('update');
    persist(this.save);
    location.reload();
  }

  private onSwap(a: Pos, b: Pos, drag: boolean): void {
    const game = this.game;
    if (!game || this.mode !== Mode.Play || this.running === game || !canAct(game)) return;
    const ev = makeMove(game, a, b);
    if (!ev) return;
    this.view.inputEnabled = false;
    this.hinted = this.view.hintShown;
    this.view.cancelHint();
    const record = this.recordOf(game);
    if (record && ev.valid) recordMove(record, game.board, a, b, this.hinted, performance.now() - this.thinkFrom, drag);
    else if (record) recordMiss(record, game.board, a, b);
    if (ev.valid) this.learn(game, a, b);
    void this.view.play([ev], (e) => this.feedback(e)).then(() => {
      if (ev.valid) void this.run(game);
      else this.onRest();
    });
  }

  /** A swap on the calm board without a hint showing tells how the player picks among all the moves there were. */
  private learn(game: GameState, a: Pos, b: Pos): void {
    const from = indexOf(game.board, a.r, a.c);
    const to = indexOf(game.board, b.r, b.c);
    this.lastTo = to;
    const options = this.rest;
    this.rest = null;
    if (!options || this.hinted) return;
    const chosen = options.moves.findIndex(([i, j]) => (i === from && j === to) || (i === to && j === from));
    if (chosen >= 0) observeMove(this.save.player.model, options, chosen);
  }

  /** Plays the board's steps until it rests. */
  private async run(game: GameState): Promise<void> {
    if (this.running === game) return;
    this.running = game;
    this.updateBoosters();
    while (this.game === game) {
      const events = timed('advance', () => advance(game));
      if (!events) break;
      this.ui.updateHud(game);
      this.scene.tweens.speed = chainSpeed(game.cascade);
      await this.view.play(events, (ev) => this.feedback(ev));
    }
    this.scene.tweens.speed = 1;
    if (this.running === game) this.running = null;
    if (this.game !== game) return;
    this.ui.updateHud(game);
    persist(this.save);
    this.onRest();
  }

  /** The board is calm: finish the level or let the player think. Deferred while paused. */
  private onRest(): void {
    const game = this.game;
    if (!game || this.running === game || this.mode !== Mode.Play) return;
    if (game.status === 'won') {
      void this.finishWin(game);
    } else if (game.status === 'lost' && canRescue(game) && Object.values(Booster).some((b) => stock(this.save.boosters, b) > 0)) {
      this.boosters.beckon(true);
      this.ui.flashText(S.rescue);
      this.updateBoosters();
    } else if (game.status === 'lost') {
      this.showLose(game);
    } else {
      this.rest = timed('options', () => moveOptions(game.board, goalsOf(game), this.lastTo));
      this.thinkFrom = performance.now();
      this.view.inputEnabled = true;
      this.view.armHint();
      this.updateBoosters();
      this.showDebug();
    }
  }

  // ---------- boosters ----------

  private toggleAim(booster: Booster): void {
    const game = this.game;
    if (!game || this.mode !== Mode.Play || this.running === game) return;
    if (this.aiming === booster) {
      this.stopAim();
      return;
    }
    if (!canStrike(game) || stock(this.save.boosters, booster) < 1) return;
    this.aiming = booster;
    this.view.setAim(booster);
    this.audio.play(Sfx.Button);
    this.updateBoosters();
  }

  private stopAim(): void {
    this.aiming = null;
    this.view.setAim(null);
    this.updateBoosters();
  }

  private onStrike(at: Pos): void {
    const game = this.game;
    const booster = this.aiming;
    if (!game || !booster || this.running === game) return;
    this.stopAim();
    if (!strike(game, booster, at)) return;
    const record = this.recordOf(game);
    if (record) recordStrike(record, game.board, booster, at);
    spend(this.save.boosters, booster);
    this.boosters.beckon(false);
    this.view.inputEnabled = false;
    this.audio.play(booster === Booster.Star ? Sfx.FallingStar : Sfx.Meteor);
    void this.run(game);
  }

  private updateBoosters(): void {
    const game = this.game;
    const usable = game !== null && this.running !== game && canStrike(game);
    this.boosters.update(this.save.boosters, this.aiming, usable);
  }

  // ---------- results ----------

  /** The record of the attempt this game plays, if it is the current one. */
  private recordOf(game: GameState): AttemptRecord | null {
    const attempt = this.save.current?.attempt;
    return attempt?.game === game ? attempt.record : null;
  }

  /** Reports the attempt, then lets the player's strength, star rate and pace learn from it. */
  private endAttempt(game: GameState, end: AttemptEnd, left: number, stars: number): void {
    const current = this.save.current;
    const attempt = current?.attempt;
    if (!current || !attempt || attempt.game !== game) return;
    const { player, settings } = this.save;
    const { record, target, threeStars } = attempt;
    trackAttempt({ draft: current.draft, game, record, end, left, stars, fails: current.fails, difficulty: settings.difficulty, target, threeStars, model: player.model });
    // An abandoned attempt has no outcome: it teaches neither strength nor stars.
    if (end !== AttemptEnd.Restart) observeOutcome(player.model, end === AttemptEnd.Won, game.level.targetWinRate, game.strikes > 0 ? BOOSTED_WEIGHT : 1);
    if (end === AttemptEnd.Won) player.threeStars = updateThreeStars(player.threeStars, stars === 3);
    const progress = Math.min(...game.level.objectives.map((o, k) => game.progress[k] / o.target));
    player.pace = updatePace(player.pace, twinMoves(current.draft, game.level), game.movesMade, progress);
  }

  private async finishWin(game: GameState): Promise<void> {
    this.mode = Mode.Finale;
    this.view.inputEnabled = false;
    const movesAtWin = game.movesLeft;
    this.vibrate([20, 60, 30]);
    this.ui.flashText(S.win);
    this.ui.updateHud(game);
    if (game.movesLeft > 0) {
      this.scene.tweens.speed = chainSpeed(game.cascade);
      this.audio.play(Sfx.Transform);
      await this.view.play(startFinale(game), (ev) => this.feedback(ev));
      // run() calls onRest at the end, which would loop back here: the finale plays without it.
      await this.runFinale(game);
    }
    const stars = starsFor(game);
    this.save.boosters = withGain(this.save.boosters, winGain(movesAtWin, stars));
    this.endAttempt(game, AttemptEnd.Won, movesAtWin, stars);
    const n = game.level.number;
    this.save.stars[n - 1] = Math.max(this.save.stars[n - 1] ?? 0, stars);
    this.save.level = n + 1;
    this.save.current = null;
    this.game = null;
    persist(this.save);
    this.boosters.update(this.save.boosters, null, false);
    await this.view.vanish();
    this.mode = Mode.Won;
    this.ui.hideHud();
    this.boosters.hide();
    this.ui.showWin(stars, game.score);
    this.audio.play(Sfx.Win);
    for (let k = 0; k < stars; k++) setTimeout(() => this.audio.play(Sfx.Star, 1 + k * 0.12), 150 + k * 120);
  }

  private async runFinale(game: GameState): Promise<void> {
    while (this.game === game) {
      const events = advance(game);
      if (!events) break;
      this.ui.updateHud(game);
      this.scene.tweens.speed = chainSpeed(game.cascade);
      await this.view.play(events, (ev) => this.feedback(ev));
    }
    this.scene.tweens.speed = 1;
    this.ui.updateHud(game);
  }

  private showLose(game: GameState): void {
    this.boosters.beckon(false);
    this.mode = Mode.Lost;
    this.view.inputEnabled = false;
    this.audio.play(Sfx.Lose);
    this.ui.showLose(game);
    this.failLevel(AttemptEnd.Lost);
  }

  /** Ends the attempt as a failure; the next one is finalized with the failure counted. */
  private failLevel(end: AttemptEnd): void {
    const current = this.save.current;
    const game = current?.attempt?.game;
    if (!current || !game) return;
    this.endAttempt(game, end, game.movesLeft, 0);
    current.fails++;
    current.attempt = null;
    persist(this.save);
  }

  // ---------- menus ----------

  private pause(): void {
    const record = this.game ? this.recordOf(this.game) : null;
    if (record) record.pauses++;
    if (this.aiming) this.stopAim();
    this.mode = Mode.Pause;
    this.view.inputEnabled = false;
    this.view.cancelHint();
    this.ui.showPause();
  }

  private resume(): void {
    this.ui.hideOverlay();
    this.mode = Mode.Play;
    this.onRest();
  }

  private async onAction(action: Action): Promise<void> {
    this.audio.play(Sfx.Button);
    switch (action) {
      case Action.Play:
      case Action.Next:
        await this.playLevel();
        return;
      case Action.Retry:
        await this.playLevel();
        return;
      case Action.Pause:
        if (this.mode === Mode.Play) this.pause();
        return;
      case Action.Resume:
        this.resume();
        return;
      case Action.Restart:
        this.failLevel(AttemptEnd.Restart);
        this.game = null;
        await this.playLevel();
        return;
      case Action.Menu:
        this.showTitle();
        return;
      case Action.Settings:
        this.menuReturn = this.mode === Mode.Pause ? Mode.Pause : Mode.Title;
        this.mode = Mode.Settings;
        this.showSettings();
        return;
      case Action.Back:
        this.back();
        return;
      case Action.Goals:
        if (!this.game || (this.mode !== Mode.Play && this.mode !== Mode.Pause) || this.running === this.game) return;
        this.menuReturn = this.mode;
        this.mode = Mode.Help;
        this.view.inputEnabled = false;
        this.ui.showGoals(this.game);
        return;
      case Action.Shapes:
        this.menuReturn = this.mode === Mode.Pause ? Mode.Pause : Mode.Title;
        this.mode = Mode.Help;
        this.ui.showShapes();
        return;
      case Action.CloseHelp:
        this.back();
        return;
      case Action.Sound:
        this.save.settings.sound = !this.save.settings.sound;
        this.applySettings();
        this.showSettings();
        return;
      case Action.Haptics:
        this.save.settings.haptics = !this.save.settings.haptics;
        this.showSettings();
        return;
      case Action.Easier:
      case Action.Harder: {
        const k = DIFFICULTIES.indexOf(this.save.settings.difficulty) + (action === Action.Easier ? -1 : 1);
        this.save.settings.difficulty = DIFFICULTIES[Math.max(0, Math.min(DIFFICULTIES.length - 1, k))];
        this.showSettings();
        return;
      }
      case Action.Reset:
        if (!this.ui.confirmReset()) return;
        clearSave();
        this.save = defaultSave();
        persist(this.save);
        this.showTitle();
        return;
      case Action.Star:
        this.toggleAim(Booster.Star);
        return;
      case Action.Meteor:
        this.toggleAim(Booster.Meteor);
        return;
      case Action.GiveUp:
        if (this.game) this.showLose(this.game);
        return;
      case Action.Update:
        this.openUpdate();
        return;
      case Action.UpdateLater:
        this.closeUpdate();
        return;
      case Action.ApplyUpdate:
        this.applyUpdate();
        return;
    }
  }

  private showSettings(): void {
    persist(this.save);
    this.ui.showSettings(this.save.settings);
  }

  /** Leaves settings or help for where they were opened from. */
  private back(): void {
    const to = this.menuReturn;
    this.menuReturn = Mode.Title;
    if (to === Mode.Pause) {
      this.mode = Mode.Pause;
      this.ui.showPause();
    } else if (to === Mode.Play) {
      this.ui.hideOverlay();
      this.mode = Mode.Play;
      if (this.game) void this.run(this.game);
    } else {
      this.showTitle();
    }
  }

  // ---------- feedback ----------

  private feedback(ev: GameEvent): void {
    const game = this.game;
    if (game) this.ui.updateHud(game);
    switch (ev.type) {
      case 'swap':
        this.audio.play(ev.valid ? Sfx.Swap : Sfx.SwapFail);
        if (!ev.valid) this.vibrate(15);
        return;
      case 'clear': {
        const pitch = Math.min(1.6, 1 + 0.07 * ev.cascade);
        if (ev.removed.length > 0) this.audio.play(Sfx.Match, pitch);
        if (ev.created.some((c) => c.piece.special !== Special.None)) {
          this.audio.play(Sfx.Create);
          this.vibrate(20);
        }
        const kinds = new Set(ev.blasts.map((b) => b.kind));
        if (kinds.has(BlastKind.Ray)) this.audio.play(Sfx.Ray);
        if (kinds.has(BlastKind.Burst) || kinds.has(BlastKind.Area)) {
          this.audio.play(Sfx.Burst);
          this.vibrate(30);
        }
        if (kinds.has(BlastKind.Prism)) this.audio.play(Sfx.Prism);
        if (ev.cascade >= 2 && ev.blasts.length === 0) this.ui.praise(ev.cascade);
        else if (ev.combo) this.ui.praise(4);
        return;
      }
      case 'rotate':
        this.audio.play(Sfx.Rotor);
        return;
      case 'shuffle':
        this.audio.play(Sfx.Shuffle);
        this.ui.flashText(S.shuffle);
        return;
      case 'light':
        this.audio.play(Sfx.Light);
        return;
      case 'lastChance':
        this.audio.play(Sfx.LastChance);
        this.ui.flashText(S.lastChance);
        return;
      case 'transform':
        if (ev.from) this.audio.play(Sfx.Transform);
        return;
      case 'fall':
        return;
    }
  }

  private vibrate(pattern: number | number[]): void {
    if (this.save.settings.haptics) navigator.vibrate?.(pattern);
  }

  /** Sizes the canvas and the board to the stage. */
  private fit(): void {
    const { clientWidth: width, clientHeight: height } = this.stage;
    this.scene.resize(width, height);
    this.view.layout(width, height);
  }

  private applySettings(): void {
    this.audio.enabled = this.save.settings.sound;
  }

  /** `?debug`: the numbers behind this level and this player. */
  private showDebug(): void {
    const el = this.debugEl;
    const game = this.game;
    const current = this.save.current;
    if (!el || !game || !current) return;
    const { model, pace, threeStars } = this.save.player;
    const twin = twinOf(model);
    const def = game.level;
    el.textContent = [
      `level ${def.number} ${def.kind}${def.intro ? ` intro:${def.intro}` : ''} v${current.draft.variant}`,
      `${def.cols}x${def.rows} colors ${def.colors} moves ${def.moves} rotors ${def.rotors.length}`,
      `target ${current.attempt?.target.toFixed(2)} twin p ${def.targetWinRate.toFixed(2)} fails ${current.fails}`,
      `stars ${def.stars.join('/')} q3 ${threeStars.toFixed(2)}`,
      `twin str ${twin.strength} craft ${twin.craft} pace ${paceFactor(pace)} moves ${model.moves}`,
      `goals ${def.objectives.map((o) => `${o.kind}${o.kind === 'collect' ? o.color : ''}:${o.target}`).join(' ')}`,
    ].join('\n');
  }
}

function createDebugEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'debug';
  document.body.appendChild(el);
  return el;
}
