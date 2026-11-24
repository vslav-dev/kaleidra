import 'pixi.js/graphics';
import 'pixi.js/text-bitmap';
import { BitmapFont, BitmapText, Container, Graphics, Sprite } from 'pixi.js';
import { isAdjacent, neighbor } from '@/core/board';
import { directionOf, screenRow } from '@/core/hex';
import { findMoves } from '@/core/moves';
import { strikeCells } from '@/core/resolve';
import { type Blast, BlastKind, type Board, Booster, type GameEvent, NO_COLOR, type Piece, type Pos, type RotorTurn, Special } from '@/core/types';
import { AXIS_ANGLE, FrameName, GEM_TINTS } from '@/view/art';
import { Atlas } from '@/view/atlas';
import { Burst } from '@/view/bursts';
import { Camera } from '@/view/camera';
import { Particles } from '@/view/particles';
import { SpritePool } from '@/view/pool';
import type { Scene } from '@/view/scene';
import { Ease, type EaseFn } from '@/view/tween';

type ClearEvent = Extract<GameEvent, { type: 'clear' }>;
type FallEvent = Extract<GameEvent, { type: 'fall' }>;

export const Layer = { Ice: 'ice', Crate: 'crate', Chain: 'chain' } as const;
export type Layer = (typeof Layer)[keyof typeof Layer];

const SQRT3 = Math.sqrt(3);
/** Largest hex radius, CSS px: a big screen gets a comfortable board, not huge gems. */
const MAX_RADIUS = 40;
const HINT_DELAY = 5000;
const SWAP_MS = 150;
const BOUNCE_MS = 110;
const POP_MS = 170;
const MERGE_MS = 120;
const CREATE_MS = 240;
/** each further wave of blasts in one step follows this much later */
const ORDER_STEP = 110;
const FALL_PER_ROW = 55;
const FALL_MIN = 140;
const FALL_MAX = 420;
const FALL_START_SPEED = 0.35;
const FALL_EASE: EaseFn = (t) => t * (FALL_START_SPEED + (1 - FALL_START_SPEED) * t);
const ROTATE_MS = 300;
const SCORE_FONT = 'kd-score';
/** the aim's tint per booster */
const AIM_TINTS: Record<Booster, number> = { [Booster.Star]: 0xffd25e, [Booster.Meteor]: 0xff7a2a };

/** Where the board sits in the canvas area, CSS pixels. */
export interface BoardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardListener {
  onSwap(a: Pos, b: Pos): void;
  /** the player released an aimed booster over this cell */
  onStrike(at: Pos): void;
  /** a blocker layer visibly took a hit (for sound) */
  onLayerHit(layer: Layer): void;
  /** the board was fitted anew: what sits under it follows */
  onLayout(rect: BoardRect): void;
}

/**
 * Pixi presentation of the board. It never decides anything: it mirrors the board state
 * and plays back the event script the core produced for a move.
 */
export class BoardView {
  public inputEnabled = false;
  private readonly atlas = new Atlas();
  private readonly boardRoot = new Container();
  private readonly tiles = new Container();
  private readonly rotorLayer = new Container();
  private readonly iceLayer = new Container();
  private readonly litLayer = new Container();
  private readonly pieceLayer = new Container();
  private readonly crateLayer = new Container();
  private readonly chainLayer = new Container();
  private readonly matterLayer = new Container();
  private readonly lightLayer = new Container();
  private readonly aimLayer = new Container();
  private readonly textLayer = new Container();
  private readonly camera = new Camera();
  private readonly pool = new SpritePool();
  private readonly particles: Particles;
  private readonly sprites = new Map<number, Sprite>();
  private readonly ice = new Map<number, Sprite>();
  private readonly crates = new Map<number, Sprite>();
  private readonly chains = new Map<number, Sprite>();
  private readonly rotors = new Map<number, Graphics>();
  /** lit specials waiting to go off, by piece id, with their halo */
  private readonly lit = new Map<number, Sprite>();
  private clock = 0;
  /** piece per cell as the player currently sees it */
  private grid: (Piece | null)[] = [];
  private board: Board | null = null;
  /** hex radius, CSS px; a cell's frame is twice as wide */
  private radius = 24;
  private originX = 0;
  private originY = 0;
  private width = 1;
  private height = 1;
  private footer = 0;
  private selected: number | null = null;
  private drag: { cell: number; x: number; y: number } | null = null;
  private hintTimer = 0;
  private hinted: number[] = [];
  /** bumped when the board is replaced or removed: playback still in flight stops */
  private epoch = 0;
  private aiming: Booster | null = null;
  private aimAt = -1;

  public constructor(
    private readonly scene: Scene,
    private readonly canvas: HTMLCanvasElement,
    private readonly input: BoardListener,
  ) {
    this.boardRoot.addChild(this.tiles, this.rotorLayer, this.iceLayer, this.litLayer, this.pieceLayer, this.crateLayer, this.chainLayer, this.matterLayer, this.lightLayer, this.aimLayer, this.textLayer);
    this.camera.view.addChild(this.boardRoot);
    scene.root.addChild(this.camera.view);
    this.particles = new Particles(this.matterLayer, this.lightLayer, this.pool, (name) => this.atlas.get(name), () => scene.request());
    scene.addUpdater((dt) => this.particles.update(dt));
    scene.addUpdater((dt) => this.camera.update(dt), true);
    scene.addUpdater((dt) => this.pulse(dt));
    scene.onQualityChange = () => this.layout(this.width, this.height);

    BitmapFont.install({
      name: SCORE_FONT,
      chars: [['0', '9'], '+'],
      resolution: 2,
      style: {
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        fontSize: 48,
        fontWeight: '800',
        fill: '#ffffff',
        stroke: { color: '#3b1466', width: 8 },
      },
    });

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', () => {
      this.drag = null;
      this.aimAt = -1;
      this.drawAim();
    });
  }

  /** Room kept free under the board, CSS pixels. */
  public setFooter(px: number): void {
    this.footer = px;
  }

  // ---------- layout ----------

  public layout(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const b = this.board;
    if (!b) return;
    const room = Math.max(1, height - this.footer);
    const odd = b.cols > 1 ? 0.5 : 0;
    this.radius = Math.max(8, Math.floor(Math.min(MAX_RADIUS, width / (1.5 * (b.cols - 1) + 2), room / (SQRT3 * (b.rows + odd)))));
    const s = this.radius;
    const boardW = 1.5 * s * (b.cols - 1) + 2 * s;
    const boardH = SQRT3 * s * (b.rows + odd);
    this.originX = Math.round((width - boardW) / 2);
    this.originY = Math.round((room - boardH) / 2);
    // Everything on the board lives in board coordinates: a move of the board leaves animations in flight on target.
    this.boardRoot.position.set(this.originX, this.originY);
    // New textures replace the old ones: particles still flying with the old ones go.
    if (this.atlas.build(2 * s, this.scene.resolution)) this.particles.clear();
    this.particles.cell = 2 * s * 0.9;
    this.particles.density = this.scene.particleDensity;
    this.camera.frame(width / 2, room / 2, 2 * s);
    this.rebuild();
    this.input.onLayout({ x: this.originX, y: this.originY, width: boardW, height: boardH });
  }

  /** Center of a cell in board coordinates; rows above the board (negative) are where spawned pieces start. */
  private center(r: number, c: number): { x: number; y: number } {
    const s = this.radius;
    return { x: s + c * 1.5 * s, y: (SQRT3 / 2) * s + screenRow(r, c) * SQRT3 * s };
  }

  private centerOf(i: number): { x: number; y: number } {
    const cols = this.board!.cols;
    return this.center(Math.floor(i / cols), i % cols);
  }

  private indexOf(p: Pos): number {
    return p.r * this.board!.cols + p.c;
  }

  /** The existing cell under a canvas point, or -1. */
  private cellAt(x: number, y: number): number {
    const b = this.board;
    if (!b) return -1;
    let best = -1;
    let bestD = this.radius * this.radius;
    for (let i = 0; i < b.cells.length; i++) {
      if (!b.cells[i].exists) continue;
      const p = this.centerOf(i);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // ---------- board ----------

  public setBoard(b: Board): void {
    this.epoch++;
    // Piece ids start over on every board: sprites of the last one (shrunk and turned by its vanish) must not be
    // taken for this one's. Only a relayout of the same board keeps its sprites.
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
    this.board = b;
    this.grid = b.cells.map((c) => c.piece);
    this.lit.clear();
    this.selected = null;
    this.hinted = [];
    this.layout(this.width, this.height);
  }

  /** Removes everything; playback still in flight stops. */
  public clear(): void {
    this.epoch++;
    this.board = null;
    this.grid = [];
    this.lit.clear();
    this.cancelHint();
    this.particles.clear();
    this.camera.reset();
    for (const layer of [this.tiles, this.rotorLayer, this.iceLayer, this.litLayer, this.pieceLayer, this.crateLayer, this.chainLayer, this.aimLayer, this.textLayer]) {
      layer.removeChildren().forEach((child) => child.destroy());
    }
    this.sprites.clear();
    this.hinted = [];
    this.ice.clear();
    this.crates.clear();
    this.chains.clear();
    this.rotors.clear();
    this.scene.request();
  }

  /**
   * Draws the board as the player sees it now: after a resize or a new board. Piece sprites are kept and moved,
   * so a resize during playback leaves the tweens in flight a sprite to move.
   */
  private rebuild(): void {
    const b = this.board!;
    const keepLit = new Set(this.lit.keys());
    for (const layer of [this.tiles, this.rotorLayer, this.iceLayer, this.litLayer, this.crateLayer, this.chainLayer, this.aimLayer]) {
      layer.removeChildren().forEach((child) => child.destroy());
    }
    const old = new Map(this.sprites);
    this.pieceLayer.removeChildren();
    this.sprites.clear();
    this.ice.clear();
    this.crates.clear();
    this.chains.clear();
    this.rotors.clear();
    this.lit.clear();
    b.cells.forEach((cell, i) => {
      if (!cell.exists) return;
      const p = this.centerOf(i);
      const r = Math.floor(i / b.cols);
      const c = i % b.cols;
      // Three tones: a hex grid colors with three so that no two neighbors share one.
      const a = r - ((c - (c & 1)) >> 1);
      const tile = this.addSprite(this.tiles, FrameName.tile((((c - a) % 3) + 3) % 3), p.x, p.y);
      tile.alpha = 1;
      this.setLayerSprite(this.ice, this.iceLayer, i, cell.ice > 0 ? FrameName.ice(cell.ice) : null);
      this.setLayerSprite(this.crates, this.crateLayer, i, cell.crate > 0 ? FrameName.crate(cell.crate) : null);
      this.setLayerSprite(this.chains, this.chainLayer, i, cell.chain > 0 ? FrameName.chain(cell.chain) : null);
      const piece = this.grid[i];
      if (!piece) return;
      const sprite = old.get(piece.id);
      old.delete(piece.id);
      if (sprite) {
        sprite.texture = this.atlas.get(frameOf(piece));
        sprite.position.set(p.x, p.y);
        this.pieceLayer.addChild(sprite);
        this.sprites.set(piece.id, sprite);
      } else {
        this.sprites.set(piece.id, this.addSprite(this.pieceLayer, frameOf(piece), p.x, p.y));
      }
    });
    for (const sprite of old.values()) sprite.destroy();
    for (const rotor of b.rotors) this.drawRotor(rotor.at, rotor.spin);
    for (const id of keepLit) this.addHalo(id);
    this.scene.request();
  }

  /** The track a rotor's ring rides: a glowing circle through the six cells, arrows showing which way it turns. */
  private drawRotor(at: number, spin: 1 | -1): void {
    const s = this.radius;
    const g = new Graphics();
    const ring = SQRT3 * s;
    g.circle(0, 0, ring).stroke({ width: s * 0.9, color: 0xffffff, alpha: 0.07 });
    g.circle(0, 0, ring).stroke({ width: s * 0.06, color: 0xffffff, alpha: 0.35 });
    // Chevrons between the ring cells, pointing along the spin.
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      const x = Math.cos(a) * ring;
      const y = Math.sin(a) * ring;
      const tx = -Math.sin(a) * spin;
      const ty = Math.cos(a) * spin;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      const w = s * 0.22;
      g.moveTo(x - tx * w + nx * w, y - ty * w + ny * w)
        .lineTo(x + tx * w * 0.6, y + ty * w * 0.6)
        .lineTo(x - tx * w - nx * w, y - ty * w - ny * w)
        .stroke({ width: s * 0.09, color: 0xffffff, alpha: 0.55, cap: 'round', join: 'round' });
    }
    const p = this.centerOf(at);
    g.position.set(p.x, p.y);
    const hub = new Sprite(this.atlas.get(FrameName.Hub));
    hub.anchor.set(0.5);
    hub.alpha = 0.5;
    g.addChild(hub);
    this.rotorLayer.addChild(g);
    this.rotors.set(at, g);
  }

  private addSprite(layer: Container, frame: string, x: number, y: number): Sprite {
    const sprite = new Sprite(this.atlas.get(frame));
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    layer.addChild(sprite);
    return sprite;
  }

  private setLayerSprite(map: Map<number, Sprite>, layer: Container, i: number, frame: string | null): void {
    const old = map.get(i);
    if (!frame) {
      if (old) {
        old.destroy();
        map.delete(i);
      }
      return;
    }
    if (old) {
      old.texture = this.atlas.get(frame);
      return;
    }
    const p = this.centerOf(i);
    map.set(i, this.addSprite(layer, frame, p.x, p.y));
  }

  // ---------- input ----------

  /** The pointer in board coordinates. */
  private point(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left - this.originX, y: e.clientY - rect.top - this.originY };
  }

  private onDown(e: PointerEvent): void {
    if (!this.board) return;
    const { x, y } = this.point(e);
    const cell = this.cellAt(x, y);
    if (this.aiming) {
      this.aimAt = cell;
      this.drawAim();
      return;
    }
    if (!this.inputEnabled || cell < 0) return;
    this.cancelHint();
    this.canvas.setPointerCapture(e.pointerId);
    if (this.selected !== null && this.selected !== cell && this.isNeighbor(this.selected, cell)) {
      const from = this.selected;
      this.select(null);
      this.swap(from, cell);
      return;
    }
    this.drag = { cell, x, y };
    this.select(cell);
  }

  private onMove(e: PointerEvent): void {
    const { x, y } = this.point(e);
    if (this.aiming) {
      const cell = this.cellAt(x, y);
      if (cell !== this.aimAt && (e.buttons > 0 || e.pointerType === 'mouse')) {
        this.aimAt = cell;
        this.drawAim();
      }
      return;
    }
    const drag = this.drag;
    if (!drag || !this.inputEnabled || !this.board) return;
    const dx = x - drag.x;
    const dy = y - drag.y;
    if (Math.hypot(dx, dy) < this.radius * 0.45) return;
    this.drag = null;
    const target = neighbor(this.board, drag.cell, directionOf(dx, dy));
    this.select(null);
    if (target >= 0) this.swap(drag.cell, target);
  }

  private onUp(e: PointerEvent): void {
    this.drag = null;
    if (!this.aiming) return;
    const { x, y } = this.point(e);
    const cell = this.cellAt(x, y);
    this.aimAt = -1;
    this.drawAim();
    if (cell >= 0) this.input.onStrike(this.pos(cell));
  }

  private isNeighbor(a: number, b: number): boolean {
    return isAdjacent(this.pos(a), this.pos(b));
  }

  private pos(i: number): Pos {
    const cols = this.board!.cols;
    return { r: Math.floor(i / cols), c: i % cols };
  }

  private swap(from: number, to: number): void {
    this.input.onSwap(this.pos(from), this.pos(to));
  }

  private select(cell: number | null): void {
    if (this.selected !== null) {
      const piece = this.grid[this.selected];
      const sprite = piece ? this.sprites.get(piece.id) : undefined;
      if (sprite) sprite.scale.set(1);
    }
    this.selected = cell;
    if (cell !== null) {
      const piece = this.grid[cell];
      const sprite = piece ? this.sprites.get(piece.id) : undefined;
      if (sprite) sprite.scale.set(1.12);
    }
    this.scene.request();
  }

  // ---------- aim ----------

  public setAim(booster: Booster | null): void {
    this.aiming = booster;
    this.aimAt = -1;
    this.select(null);
    this.cancelHint();
    this.drawAim();
  }

  private drawAim(): void {
    this.aimLayer.removeChildren().forEach((c) => c.destroy());
    const b = this.board;
    if (b && this.aiming && this.aimAt >= 0) {
      for (const i of strikeCells(b, this.aiming, this.aimAt)) {
        const p = this.centerOf(i);
        const sprite = this.addSprite(this.aimLayer, FrameName.HexGlow, p.x, p.y);
        sprite.tint = AIM_TINTS[this.aiming];
        sprite.alpha = 0.85;
      }
    }
    this.scene.request();
  }

  // ---------- hint ----------

  /** A calm board waits for the player: after a while a move breathes. */
  public armHint(): void {
    this.cancelHint();
    const epoch = this.epoch;
    this.hintTimer = window.setTimeout(() => {
      if (epoch !== this.epoch || !this.board || !this.inputEnabled) return;
      const moves = findMoves(this.board);
      if (moves.length === 0) return;
      this.hinted = moves[Math.floor(Math.random() * moves.length)];
      this.scene.request();
    }, HINT_DELAY);
  }

  public get hintShown(): boolean {
    return this.hinted.length > 0;
  }

  public cancelHint(): void {
    clearTimeout(this.hintTimer);
    for (const i of this.hinted) {
      const piece = this.grid[i];
      const sprite = piece ? this.sprites.get(piece.id) : undefined;
      if (sprite) sprite.scale.set(1);
    }
    this.hinted = [];
  }

  /** Hint breathing and the halos of lit specials. */
  private pulse(dt: number): boolean {
    this.clock += dt;
    const beat = Math.sin(this.clock / 110);
    for (const i of this.hinted) {
      const piece = this.grid[i];
      const sprite = piece ? this.sprites.get(piece.id) : undefined;
      if (sprite) sprite.scale.set(1 + 0.07 * (0.5 + 0.5 * beat));
    }
    for (const [id, halo] of this.lit) {
      const sprite = this.sprites.get(id);
      if (!sprite) continue;
      halo.position.copyFrom(sprite.position);
      halo.scale.set(1.25 + 0.15 * beat);
      halo.alpha = 0.7 + 0.25 * beat;
    }
    return this.hinted.length > 0 || this.lit.size > 0;
  }

  private addHalo(id: number): void {
    if (this.lit.has(id) || !this.sprites.has(id)) return;
    const halo = this.addSprite(this.litLayer, FrameName.Glow, 0, 0);
    halo.blendMode = 'add';
    halo.tint = 0xfff1b0;
    this.lit.set(id, halo);
  }

  private dropHalo(id: number): void {
    this.lit.get(id)?.destroy();
    this.lit.delete(id);
  }

  // ---------- playback ----------

  /** Plays the events one after another; `onEvent` fires as each starts (sound, haptics, HUD). */
  public async play(events: GameEvent[], onEvent: (ev: GameEvent) => void): Promise<void> {
    const epoch = this.epoch;
    for (const ev of events) {
      if (epoch !== this.epoch) return;
      onEvent(ev);
      await this.playOne(ev);
    }
  }

  private async playOne(ev: GameEvent): Promise<void> {
    switch (ev.type) {
      case 'swap':
        return this.playSwap(ev.a, ev.b, ev.valid);
      case 'clear':
        return this.playClear(ev);
      case 'fall':
        return this.playFall(ev);
      case 'transform':
        return this.playTransform(ev.pieces, ev.from);
      case 'shuffle':
        return this.playShuffle(ev.pieces);
      case 'rotate':
        return this.playRotate(ev.turns);
      case 'light':
        for (const p of ev.pieces) this.addHalo(p.id);
        return this.wait(220);
      case 'lastChance':
        return this.wait(650);
    }
  }

  private wait(ms: number): Promise<void> {
    return this.scene.tweens.wait(ms);
  }

  private async playSwap(a: Pos, b: Pos, valid: boolean): Promise<void> {
    const i = this.indexOf(a);
    const j = this.indexOf(b);
    const pa = this.grid[i];
    const pb = this.grid[j];
    const sa = pa ? this.sprites.get(pa.id) : undefined;
    const sb = pb ? this.sprites.get(pb.id) : undefined;
    const from = this.centerOf(i);
    const to = this.centerOf(j);
    // The moved piece passes over the other.
    if (sa) this.pieceLayer.addChild(sa);
    const move = (k: number): void => {
      sa?.position.set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
      sa?.scale.set(1 + 0.1 * Math.sin(k * Math.PI));
      sb?.position.set(to.x + (from.x - to.x) * k, to.y + (from.y - to.y) * k);
      sb?.scale.set(1 - 0.08 * Math.sin(k * Math.PI));
    };
    if (valid) {
      await this.scene.tweens.run(SWAP_MS, move, { ease: Ease.inOutCubic });
      this.grid[i] = pb;
      this.grid[j] = pa;
      return;
    }
    await this.scene.tweens.run(BOUNCE_MS, (k) => move(k * 0.45), { ease: Ease.outQuad });
    await this.scene.tweens.run(BOUNCE_MS * 1.6, (k) => move(0.45 * (1 - k)), { ease: Ease.outBack });
  }

  private async playClear(ev: ClearEvent): Promise<void> {
    const strikes = ev.blasts.filter((bl) => bl.kind === BlastKind.Star || bl.kind === BlastKind.Meteor);
    for (const s of strikes) await this.strikeFall(s);
    if (ev.combo) await this.gather(ev.combo);

    const maxOrder = Math.max(0, ...ev.blasts.map((bl) => bl.order), ...ev.removed.map((r) => r.order));
    const created = new Map(ev.created.map((c) => [c.piece.id, c.pos]));
    const jobs: Promise<void>[] = [];
    for (let order = 0; order <= maxOrder; order++) {
      const delay = order * ORDER_STEP;
      for (const bl of ev.blasts) if (bl.order === order && !strikes.includes(bl)) this.blastFx(bl, delay);
      for (const rm of ev.removed) {
        if (rm.order !== order) continue;
        const i = this.indexOf(rm.pos);
        this.grid[i] = null;
        const target = created.get(rm.mergeInto);
        jobs.push(target ? this.mergePiece(rm.id, target, delay) : this.popPiece(rm.id, rm.color, delay));
        this.dropHalo(rm.id);
      }
      for (const layer of ev.layers) if (layer.order === order) jobs.push(this.updateLayers(this.indexOf(layer.pos), layer.ice, layer.crate, layer.chain, delay));
    }
    for (const l of ev.lit) void this.wait(l.order * ORDER_STEP).then(() => this.addHalo(l.id));
    for (const popup of ev.popups) this.scorePopup(popup.r, popup.c, popup.value, popup.order * ORDER_STEP);
    if (ev.removed.length > 0) this.camera.punch(Math.min(0.03, 0.004 * ev.blasts.length));
    jobs.push(this.wait(POP_MS + maxOrder * ORDER_STEP));
    await Promise.all(jobs);
    if (ev.created.length > 0) await Promise.all(ev.created.map((c) => this.createPiece(c.piece, this.indexOf(c.pos))));
  }

  private async popPiece(id: number, color: number, delay: number): Promise<void> {
    const sprite = this.sprites.get(id);
    if (!sprite) return;
    this.sprites.delete(id);
    await this.wait(delay);
    const { x, y } = sprite.position;
    if (color !== NO_COLOR) {
      this.particles.emit(Burst.shards, x, y, { color, tint: 0xffffff });
      this.particles.emit(Burst.sparks, x, y, { color, tint: GEM_TINTS[color] });
    } else {
      this.particles.emit(Burst.glitter, x, y, { color: 0, tint: 0xffffff, amount: 3 });
    }
    await this.scene.tweens.run(POP_MS, (k) => {
      sprite.scale.set(1 + 0.25 * k - 1.25 * k * k);
      sprite.alpha = 1 - k;
    });
    sprite.destroy();
  }

  private async mergePiece(id: number, to: Pos, delay: number): Promise<void> {
    const sprite = this.sprites.get(id);
    if (!sprite) return;
    this.sprites.delete(id);
    await this.wait(delay);
    const from = { x: sprite.x, y: sprite.y };
    const target = this.centerOf(this.indexOf(to));
    await this.scene.tweens.run(
      MERGE_MS,
      (k) => {
        sprite.position.set(from.x + (target.x - from.x) * k, from.y + (target.y - from.y) * k);
        sprite.scale.set(1 - 0.4 * k);
      },
      { ease: Ease.outCubic },
    );
    sprite.destroy();
  }

  private async createPiece(piece: Piece, i: number): Promise<void> {
    this.grid[i] = piece;
    const p = this.centerOf(i);
    const sprite = this.addSprite(this.pieceLayer, frameOf(piece), p.x, p.y);
    this.sprites.set(piece.id, sprite);
    const flash = this.pool.acquire(this.lightLayer, this.atlas.get(FrameName.Glow), 'add');
    flash.position.set(p.x, p.y);
    this.particles.emit(Burst.glitter, p.x, p.y, { color: 0, tint: 0xffffff, amount: 3 });
    await this.scene.tweens.run(
      CREATE_MS,
      (k) => {
        sprite.scale.set(k);
        flash.scale.set(1 + 1.5 * k);
        flash.alpha = 1 - k;
      },
      { ease: Ease.outBack },
    );
    this.pool.release(flash);
  }

  private async updateLayers(i: number, ice: number, crate: number, chain: number, delay: number): Promise<void> {
    await this.wait(delay);
    const p = this.centerOf(i);
    const iceSprite = this.ice.get(i);
    if (iceSprite && (ice === 0 || iceSprite.texture !== this.atlas.get(FrameName.ice(ice)))) {
      this.particles.emit(Burst.frost, p.x, p.y, { color: 0, tint: 0xcdeeff });
      this.input.onLayerHit(Layer.Ice);
    }
    const crateSprite = this.crates.get(i);
    if (crateSprite && (crate === 0 || crateSprite.texture !== this.atlas.get(FrameName.crate(crate)))) {
      this.particles.emit(Burst.chips, p.x, p.y, { color: 0, tint: 0x8d6ad6, amount: crate === 0 ? 2 : 1 });
      this.particles.emit(Burst.dust, p.x, p.y, { color: 0, tint: 0xb8a2e8 });
      this.input.onLayerHit(Layer.Crate);
    }
    const chainSprite = this.chains.get(i);
    if (chainSprite && (chain === 0 || chainSprite.texture !== this.atlas.get(FrameName.chain(chain)))) {
      this.particles.emit(Burst.sparks, p.x, p.y, { color: 0, tint: 0xffd25e });
      this.input.onLayerHit(Layer.Chain);
    }
    this.setLayerSprite(this.ice, this.iceLayer, i, ice > 0 ? FrameName.ice(ice) : null);
    this.setLayerSprite(this.crates, this.crateLayer, i, crate > 0 ? FrameName.crate(crate) : null);
    this.setLayerSprite(this.chains, this.chainLayer, i, chain > 0 ? FrameName.chain(chain) : null);
  }

  // ---------- blasts ----------

  private blastFx(bl: Blast, delay: number): void {
    void this.wait(delay).then(() => {
      const o = this.centerOf(this.indexOf(bl.origin));
      switch (bl.kind) {
        case BlastKind.Ray:
          this.rayFx(bl);
          this.camera.shake(0.18);
          break;
        case BlastKind.Burst:
          this.ringFx(o.x, o.y, 2.6, 0xffffff);
          for (const c of bl.cells) this.cellFlash(c, 0xd8f4ff);
          this.camera.shake(0.3);
          this.scene.hitstop(40);
          break;
        case BlastKind.Area:
          this.ringFx(o.x, o.y, 4.5, 0xffe7a0);
          for (const c of bl.cells) this.cellFlash(c, 0xfff1c0);
          this.camera.shake(0.5);
          this.scene.hitstop(70);
          break;
        case BlastKind.Prism:
          this.prismFx(bl, o);
          this.camera.shake(0.3);
          break;
        default:
          break;
      }
    });
  }

  /** A bright beam along the ray's whole axis, narrowing as it fades. */
  private rayFx(bl: Blast): void {
    const pts = bl.cells.map((c) => this.centerOf(this.indexOf(c)));
    if (pts.length === 0) return;
    const angle = AXIS_ANGLE[bl.axis];
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const along = pts.map((p) => p.x * dx + p.y * dy);
    const lo = Math.min(...along);
    const hi = Math.max(...along);
    const o = this.centerOf(this.indexOf(bl.origin));
    const oAlong = o.x * dx + o.y * dy;
    const mid = (lo + hi) / 2;
    const cell = 2 * this.radius;
    const beam = this.pool.acquire(this.lightLayer, this.atlas.get(FrameName.Beam), 'add');
    beam.position.set(o.x + (mid - oAlong) * dx, o.y + (mid - oAlong) * dy);
    beam.rotation = angle;
    beam.tint = 0xfff6d0;
    const length = (hi - lo + cell * 1.2) / cell;
    void this.scene.tweens
      .run(300, (k) => {
        beam.scale.set(length * Math.min(1, k * 4), 0.9 * (1 - k));
        beam.alpha = 1 - k * k;
      })
      .then(() => this.pool.release(beam));
    for (const p of pts) this.particles.emit(Burst.trail, p.x, p.y, { color: 0, tint: 0xfff1b0 });
  }

  private ringFx(x: number, y: number, cells: number, tint: number): void {
    const shock = this.pool.acquire(this.lightLayer, this.atlas.get(FrameName.Shock), 'add');
    shock.position.set(x, y);
    shock.tint = tint;
    const flash = this.pool.acquire(this.lightLayer, this.atlas.get(FrameName.Glow), 'add');
    flash.position.set(x, y);
    void this.scene.tweens
      .run(360, (k) => {
        shock.scale.set(0.3 + cells * 1.4 * k);
        shock.alpha = 1 - k;
        flash.scale.set(1 + 2.5 * k);
        flash.alpha = 1 - k;
      }, { ease: Ease.outCubic })
      .then(() => {
        this.pool.release(shock);
        this.pool.release(flash);
      });
  }

  private cellFlash(c: Pos, tint: number): void {
    const p = this.centerOf(this.indexOf(c));
    const glow = this.pool.acquire(this.lightLayer, this.atlas.get(FrameName.HexGlow), 'add');
    glow.position.set(p.x, p.y);
    glow.tint = tint;
    void this.scene.tweens.run(280, (k) => (glow.alpha = 1 - k)).then(() => this.pool.release(glow));
  }

  /** Streaks fly from the prism to every piece of its color. */
  private prismFx(bl: Blast, o: { x: number; y: number }): void {
    const tint = bl.color >= 0 ? GEM_TINTS[bl.color] : 0xffffff;
    this.ringFx(o.x, o.y, 3, tint);
    for (const c of bl.cells.slice(0, 40)) {
      const p = this.centerOf(this.indexOf(c));
      const streak = this.pool.acquire(this.lightLayer, this.atlas.get(FrameName.Streak), 'add');
      streak.tint = tint;
      const dist = Math.hypot(p.x - o.x, p.y - o.y);
      streak.rotation = Math.atan2(p.y - o.y, p.x - o.x);
      void this.scene.tweens
        .run(200, (k) => {
          streak.position.set(o.x + (p.x - o.x) * k, o.y + (p.y - o.y) * k);
          streak.scale.set(Math.max(0.3, (dist / (2 * this.radius)) * (1 - k)), 0.5);
          streak.alpha = 1 - k * 0.5;
        })
        .then(() => this.pool.release(streak));
    }
  }

  /** A star or meteor falls on its cell from the upper right before the strike lands. */
  private async strikeFall(bl: Blast): Promise<void> {
    const meteor = bl.kind === BlastKind.Meteor;
    const to = this.centerOf(this.indexOf(bl.origin));
    const from = { x: to.x + this.width * 0.6, y: to.y - this.height * 0.8 };
    const sprite = this.pool.acquire(this.lightLayer, this.atlas.get(meteor ? FrameName.Meteor : FrameName.FallingStar), 'normal');
    const size = meteor ? 1.8 : 1.3;
    await this.scene.tweens.run(
      meteor ? 650 : 430,
      (k) => {
        const x = from.x + (to.x - from.x) * k;
        const y = from.y + (to.y - from.y) * k;
        sprite.position.set(x, y);
        sprite.scale.set(size * (0.5 + 0.5 * k));
        sprite.rotation += 0.2;
        this.particles.emit(meteor ? Burst.fire : Burst.trail, x, y, { color: 0, tint: meteor ? 0xff8a30 : 0xffd25e });
      },
      { ease: Ease.inQuad },
    );
    this.pool.release(sprite);
    this.ringFx(to.x, to.y, meteor ? 5 : 3, meteor ? 0xffa060 : 0xfff1b0);
    for (const c of bl.cells) this.cellFlash(c, meteor ? 0xffb070 : 0xfff1b0);
    if (meteor) this.particles.emit(Burst.rubble, to.x, to.y, { color: 0, tint: 0x8a5a3a });
    this.particles.emit(Burst.glitter, to.x, to.y, { color: 0, tint: 0xffffff, amount: 4 });
    this.camera.shake(meteor ? 0.8 : 0.35);
    this.camera.punch(meteor ? 0.05 : 0.025);
    this.scene.hitstop(meteor ? 120 : 50);
  }

  /** Two specials swapped together gather power before they go off. */
  private async gather(at: Pos): Promise<void> {
    const p = this.centerOf(this.indexOf(at));
    this.particles.emit(Burst.gather, p.x, p.y, { color: 0, tint: 0xfff1b0, radius: 1.6, inward: true });
    await this.wait(170);
    this.camera.punch(0.04);
  }

  private scorePopup(r: number, c: number, value: number, delay: number): void {
    if (value <= 0) return;
    const s = this.radius;
    const x = s + c * 1.5 * s;
    const y = (SQRT3 / 2) * s + r * SQRT3 * s;
    const text = new BitmapText({ text: `+${value}`, style: { fontFamily: SCORE_FONT, fontSize: Math.max(14, s * 0.75) } });
    text.anchor.set(0.5);
    text.position.set(x, y);
    text.alpha = 0;
    this.textLayer.addChild(text);
    void this.wait(delay)
      .then(() =>
        this.scene.tweens.run(650, (k) => {
          text.alpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4);
          text.y = y - k * s * 1.2;
          text.scale.set(0.8 + 0.3 * Math.min(1, k * 5));
        }),
      )
      .then(() => text.destroy());
  }

  // ---------- movement ----------

  private async playFall(ev: FallEvent): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const move of ev.moves) {
      const path = move.path;
      const last = path[path.length - 1];
      const i = this.indexOf(last);
      // The starting cell is left: the piece is wherever it last was.
      const start = path[0];
      if (!move.spawned) {
        const si = this.indexOf(start);
        if (this.grid[si]?.id === move.piece.id) this.grid[si] = null;
      }
      this.grid[i] = move.piece;
      let sprite = this.sprites.get(move.piece.id);
      const points = path.map((p) => this.center(p.r, p.c));
      if (!sprite) {
        sprite = this.addSprite(this.pieceLayer, frameOf(move.piece), points[0].x, points[0].y);
        this.sprites.set(move.piece.id, sprite);
      }
      jobs.push(this.followPath(sprite, points, move.spawned));
    }
    await Promise.all(jobs);
  }

  /** A spawned piece fades in as it falls: it starts above the board, where nothing should show. */
  private async followPath(sprite: Sprite, points: { x: number; y: number }[], spawned: boolean): Promise<void> {
    const lengths = points.slice(1).map((p, k) => Math.hypot(p.x - points[k].x, p.y - points[k].y));
    const total = lengths.reduce((a, b) => a + b, 0);
    if (total === 0) return;
    const rows = total / (SQRT3 * this.radius);
    const duration = Math.min(FALL_MAX, Math.max(FALL_MIN, rows * FALL_PER_ROW + 80));
    await this.scene.tweens.run(
      duration,
      (k) => {
        let d = k * total;
        let seg = 0;
        while (seg < lengths.length - 1 && d > lengths[seg]) d -= lengths[seg++];
        const t = lengths[seg] > 0 ? Math.min(1, d / lengths[seg]) : 1;
        const a = points[seg];
        const b = points[seg + 1];
        sprite.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        if (spawned) sprite.alpha = Math.min(1, k * 2.5);
      },
      { ease: FALL_EASE },
    );
    // A little squash on landing.
    void this.scene.tweens.run(140, (k) => sprite.scale.set(1 + 0.08 * Math.sin(k * Math.PI), 1 - 0.08 * Math.sin(k * Math.PI)));
  }

  private async playTransform(pieces: { pos: Pos; piece: Piece }[], from: Pos | null): Promise<void> {
    const origin = from ? this.centerOf(this.indexOf(from)) : null;
    const jobs = pieces.map(async ({ pos, piece }, k) => {
      const i = this.indexOf(pos);
      this.grid[i] = piece;
      await this.wait(k * 45);
      const sprite = this.sprites.get(piece.id);
      if (!sprite) return;
      const p = this.centerOf(i);
      if (origin) {
        const streak = this.pool.acquire(this.lightLayer, this.atlas.get(FrameName.Streak), 'add');
        streak.position.set((origin.x + p.x) / 2, (origin.y + p.y) / 2);
        streak.rotation = Math.atan2(p.y - origin.y, p.x - origin.x);
        streak.scale.set(Math.hypot(p.x - origin.x, p.y - origin.y) / (2 * this.radius), 0.4);
        void this.scene.tweens.run(160, (t) => (streak.alpha = 1 - t)).then(() => this.pool.release(streak));
      }
      sprite.texture = this.atlas.get(frameOf(piece));
      this.particles.emit(Burst.glitter, p.x, p.y, { color: 0, tint: 0xffffff, amount: 2 });
      await this.scene.tweens.run(220, (t) => sprite.scale.set(1 + 0.35 * Math.sin(t * Math.PI)));
    });
    await Promise.all(jobs);
  }

  private async playShuffle(pieces: { pos: Pos; piece: Piece }[]): Promise<void> {
    const moves = pieces.map(({ pos, piece }) => {
      const i = this.indexOf(pos);
      this.grid[i] = piece;
      const to = this.centerOf(i);
      let sprite = this.sprites.get(piece.id);
      if (!sprite) {
        sprite = this.addSprite(this.pieceLayer, frameOf(piece), to.x, to.y);
        this.sprites.set(piece.id, sprite);
      }
      // A shuffle that found no arrangement recolors pieces.
      sprite.texture = this.atlas.get(frameOf(piece));
      return { sprite, from: { x: sprite.x, y: sprite.y }, to };
    });
    const c = { x: this.width / 2 - this.originX, y: (this.height - this.footer) / 2 - this.originY };
    await this.scene.tweens.run(
      600,
      (k) => {
        const pull = Math.sin(k * Math.PI) * 0.6;
        for (const m of moves) {
          const x = m.from.x + (m.to.x - m.from.x) * k;
          const y = m.from.y + (m.to.y - m.from.y) * k;
          m.sprite.position.set(x + (c.x - x) * pull, y + (c.y - y) * pull);
          m.sprite.rotation = Math.sin(k * Math.PI) * 0.8;
          m.sprite.alpha = 1;
        }
      },
      { ease: Ease.inOutCubic },
    );
  }

  /** The ring pieces ride their circle one sixth of a turn; the track's arrows turn with them. */
  private async playRotate(turns: RotorTurn[]): Promise<void> {
    const rides = turns.flatMap((turn) => {
      const center = this.centerOf(this.indexOf(turn.center));
      return turn.moves.map((m) => {
        const from = this.centerOf(this.indexOf(m.from));
        const to = this.centerOf(this.indexOf(m.to));
        const a0 = Math.atan2(from.y - center.y, from.x - center.x);
        let a1 = Math.atan2(to.y - center.y, to.x - center.x);
        // The short way round, in the rotor's direction.
        while (turn.spin > 0 && a1 < a0) a1 += Math.PI * 2;
        while (turn.spin < 0 && a1 > a0) a1 -= Math.PI * 2;
        const radius = Math.hypot(from.x - center.x, from.y - center.y);
        return { sprite: this.sprites.get(m.id), center, a0, a1, radius, to: this.indexOf(m.to), id: m.id };
      });
    });
    const pieces = new Map(turns.flatMap((t) => t.moves.map((m) => [m.id, this.grid[this.indexOf(m.from)]] as const)));
    for (const r of rides) this.grid[r.to] = pieces.get(r.id) ?? null;
    const tracks = turns.map((t) => ({ g: this.rotors.get(this.indexOf(t.center)), spin: t.spin }));
    const start = tracks.map((t) => t.g?.rotation ?? 0);
    await this.scene.tweens.run(
      ROTATE_MS,
      (k) => {
        for (const r of rides) {
          const a = r.a0 + (r.a1 - r.a0) * k;
          r.sprite?.position.set(r.center.x + Math.cos(a) * r.radius, r.center.y + Math.sin(a) * r.radius);
        }
        tracks.forEach((t, n) => {
          if (t.g) t.g.rotation = start[n] + (t.spin * Math.PI * k) / 3;
        });
      },
      { ease: Ease.inOutCubic },
    );
    for (const t of turns) {
      const c = this.centerOf(this.indexOf(t.center));
      this.particles.emit(Burst.glitter, c.x, c.y, { color: 0, tint: 0xffffff, amount: 2, radius: 1.6 });
    }
  }

  // ---------- level in and out ----------

  /** Pieces drop in column by column, a wave from the middle out. */
  public async entrance(): Promise<void> {
    const b = this.board;
    if (!b) return;
    const mid = (b.cols - 1) / 2;
    const jobs: Promise<void>[] = [];
    b.cells.forEach((cell, i) => {
      const piece = this.grid[i];
      const sprite = piece ? this.sprites.get(piece.id) : undefined;
      if (!cell.exists || !sprite) return;
      const to = this.centerOf(i);
      const c = i % b.cols;
      const from = to.y - this.height * 0.7;
      sprite.y = from;
      sprite.alpha = 0;
      const delay = Math.abs(c - mid) * 45 + (b.rows - Math.floor(i / b.cols)) * 18;
      jobs.push(
        this.scene.tweens.run(
          380,
          (k) => {
            sprite.y = from + (to.y - from) * k;
            sprite.alpha = Math.min(1, k * 3);
          },
          { delay, ease: Ease.outBack },
        ),
      );
    });
    await Promise.all(jobs);
  }

  /** Pieces spin out and fade, from the middle outwards. */
  public async vanish(): Promise<void> {
    const b = this.board;
    if (!b) return;
    const jobs: Promise<void>[] = [];
    const c = { x: this.width / 2 - this.originX, y: (this.height - this.footer) / 2 - this.originY };
    for (const sprite of this.sprites.values()) {
      const d = Math.hypot(sprite.x - c.x, sprite.y - c.y);
      jobs.push(
        this.scene.tweens.run(
          320,
          (k) => {
            sprite.scale.set(1 - k);
            sprite.rotation = k * 2;
            sprite.alpha = 1 - k;
          },
          { delay: d * 0.6, ease: Ease.inQuad },
        ),
      );
    }
    await Promise.all(jobs);
  }
}

function frameOf(piece: Piece): string {
  return piece.special === Special.Prism ? FrameName.Prism : FrameName.gem(piece.color, piece.special);
}
