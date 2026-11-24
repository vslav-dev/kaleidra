import { autoDetectRenderer, Container, type Renderer } from 'pixi.js';
import { Tweens } from '@/view/tween';

/** Quality steps the scene falls back through for good when frames stay slow. */
const QUALITY = [
  { maxResolution: 2, particles: 1 },
  { maxResolution: 1.5, particles: 0.6 },
  { maxResolution: 1, particles: 0.35 },
];
const SLOW_FRAME_MS = 24;
const SLOW_FRAMES_TO_DOWNGRADE = 40;
/** game time runs this fast during a hitstop */
const HITSTOP_SPEED = 0.06;

/** Called every frame with the elapsed ms; returns whether it still animates. */
type Updater = (dt: number) => boolean;

/**
 * WebGL renderer with an on-demand loop: frames run only while something animates,
 * so an idle board costs no GPU, no battery and no heat.
 */
export class Scene {
  public readonly root = new Container();
  public readonly tweens = new Tweens(() => this.request());
  /** called after a quality downgrade, so textures can be rebuilt for the new resolution */
  public onQualityChange: (() => void) | null = null;
  private readonly updaters: { fn: Updater; realTime: boolean }[] = [];
  private stopLeft = 0;
  private quality = 0;
  private slowFrames = 0;
  private scheduled = false;
  private dirty = true;
  private last = 0;
  private width = 1;
  private height = 1;

  private constructor(private readonly renderer: Renderer) {}

  public static async create(canvas: HTMLCanvasElement): Promise<Scene> {
    const renderer = await autoDetectRenderer({
      preference: 'webgl',
      canvas,
      width: 1,
      height: 1,
      resolution: 1,
      autoDensity: true,
      backgroundAlpha: 0,
      antialias: true,
      powerPreference: 'low-power',
      // Interaction is plain DOM pointer events; Pixi's event and accessibility systems are not needed.
      skipExtensionImports: true,
    });
    return new Scene(renderer);
  }

  public get resolution(): number {
    return Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].maxResolution);
  }

  public get particleDensity(): number {
    return QUALITY[this.quality].particles;
  }

  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.resize(width, height, this.resolution);
    // Resizing wipes the canvas; drawing now keeps a blank frame off the screen.
    this.renderer.render(this.root);
    this.request();
  }

  /** `realTime` updaters (the camera) keep their pace through a hitstop. */
  public addUpdater(fn: Updater, realTime = false): void {
    this.updaters.push({ fn, realTime });
  }

  /** Big hits freeze the game for a moment: everything but the camera nearly stops, so the hit lands. */
  public hitstop(ms: number): void {
    this.stopLeft = Math.max(this.stopLeft, ms);
    this.request();
  }

  /** Something on screen changed: the next frame is drawn. */
  public request(): void {
    this.dirty = true;
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.scheduled = false;
    const dt = this.last ? Math.min(50, now - this.last) : 16;
    this.last = now;
    const gameDt = this.stopLeft > 0 ? dt * HITSTOP_SPEED : dt;
    this.stopLeft = Math.max(0, this.stopLeft - dt);
    this.tweens.update(gameDt);
    let animating = false;
    for (const { fn, realTime } of this.updaters) if (fn(realTime ? dt : gameDt)) animating = true;
    this.dirty = false;
    this.renderer.render(this.root);
    this.trackSpeed(dt);
    if (this.tweens.active || this.stopLeft > 0 || animating || this.dirty) {
      this.request();
    } else {
      this.last = 0;
    }
  };

  private trackSpeed(dt: number): void {
    this.slowFrames = dt > SLOW_FRAME_MS ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    if (this.slowFrames < SLOW_FRAMES_TO_DOWNGRADE || this.quality === QUALITY.length - 1) return;
    this.quality++;
    this.slowFrames = 0;
    this.renderer.resize(this.width, this.height, this.resolution);
    this.onQualityChange?.();
  }
}
