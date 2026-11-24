export type EaseFn = (t: number) => number;

export const Ease = {
  linear: (t: number): number => t,
  inQuad: (t: number): number => t * t,
  outQuad: (t: number): number => t * (2 - t),
  outCubic: (t: number): number => 1 - (1 - t) ** 3,
  inOutCubic: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t: number): number => {
    const c = 1.70158;
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
  },
} as const;

interface Tween {
  /** false for a pause: it moves nothing on screen */
  visual: boolean;
  /** slow, calm motion that looks the same at a low frame rate */
  calm: boolean;
  /** negative while waiting for the delay */
  elapsed: number;
  duration: number;
  ease: EaseFn;
  update: (k: number) => void;
  resolve: () => void;
}

export interface TweenOptions {
  delay?: number;
  ease?: EaseFn;
  /** slow, calm motion (a hint breathing): drawn at a low frame rate while nothing else moves */
  calm?: boolean;
}

/**
 * Minimal tween runner: every tween is a progress callback, so any property or path can be animated.
 * Starting a tween wakes the render loop, so tweens chained with `await` never stall an idle loop.
 */
export class Tweens {
  /** global time scale; raised to fast-forward the finale */
  public speed = 1;
  private list: Tween[] = [];

  public constructor(private readonly onStart: () => void) {}

  public get active(): boolean {
    return this.list.length > 0;
  }

  /** Something on screen is moving: a tween past its delay that is not a pause. */
  public get visual(): boolean {
    return this.list.some((t) => t.visual && t.elapsed >= 0);
  }

  /** Something on screen moves at full pace: a visual tween past its delay that is not calm. */
  public get moving(): boolean {
    return this.list.some((t) => t.visual && !t.calm && t.elapsed >= 0);
  }

  public run(duration: number, update: (k: number) => void, options: TweenOptions = {}): Promise<void> {
    return this.add(true, duration, update, options);
  }

  /** A pause in game time: it keeps the clock running but draws nothing. */
  public wait(ms: number): Promise<void> {
    return this.add(false, ms, () => undefined, { ease: Ease.linear });
  }

  private add(visual: boolean, duration: number, update: (k: number) => void, options: TweenOptions): Promise<void> {
    return new Promise((resolve) => {
      this.list.push({
        visual,
        calm: options.calm ?? false,
        elapsed: -(options.delay ?? 0),
        duration: Math.max(1, duration),
        ease: options.ease ?? Ease.outQuad,
        update,
        resolve,
      });
      this.onStart();
    });
  }

  /** Advances every tween; returns how many finished (what awaited them runs after this frame is drawn). */
  public update(dt: number): number {
    const step = dt * this.speed;
    const done: Tween[] = [];
    for (const t of this.list) {
      t.elapsed += step;
      if (t.elapsed < 0) continue;
      const k = Math.min(1, t.elapsed / t.duration);
      t.update(t.ease(k));
      if (k >= 1) done.push(t);
    }
    if (done.length === 0) return 0;
    this.list = this.list.filter((t) => !done.includes(t));
    for (const t of done) t.resolve();
    return done.length;
  }

  /** Jumps every running tween to its end. */
  public finishAll(): void {
    const all = this.list;
    this.list = [];
    for (const t of all) {
      t.update(t.ease(1));
      t.resolve();
    }
  }
}
