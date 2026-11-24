import { Container } from 'pixi.js';

/** strongest shake, in cells of shift and radians of tilt */
const MAX_SHIFT = 0.2;
const MAX_TILT = 0.02;
/** trauma lost per second: a full 1 calms down in 1 s, a first hit in ~0.2 s */
const TRAUMA_DECAY = 1;
/** shake noise, rad/s: a few incommensurate sines read as a rough, smooth tremble, never as a pattern */
const NOISE = [38, 33, 27] as const;
/** the board's punch: rings at this many Hz and dies out at this rate per second */
const PUNCH_HZ = 6.5;
const PUNCH_DECAY = 9;
const PUNCH_LIFE = 0.5;

/**
 * Moves the whole board around its center: shake by trauma (Eiserloh, GDC 2016) and a springy punch.
 * Hits add trauma and the shake follows it as is: hits close together pile up into a stronger one.
 * Runs in real time: a hitstop freezes the game, not the shake.
 */
export class Camera {
  public readonly view = new Container();
  private trauma = 0;
  private time = 0;
  private punchAmp = 0;
  /** seconds since the last punch */
  private punchAge = PUNCH_LIFE;
  private cx = 0;
  private cy = 0;
  private cell = 48;

  /** The point it shakes and punches around (the board's center) and the cell the shake is measured in. */
  public frame(cx: number, cy: number, cell: number): void {
    this.cx = cx;
    this.cy = cy;
    this.cell = cell;
    this.view.pivot.set(cx, cy);
    this.apply();
  }

  /** `amount` of trauma, 0..1; it adds up and is capped at 1. */
  public shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** The board swells by `amount` and springs back; a stronger punch replaces a weaker one in flight. */
  public punch(amount: number): void {
    if (amount < this.punchNow()) return;
    this.punchAmp = amount;
    this.punchAge = 0;
  }

  public reset(): void {
    this.trauma = 0;
    this.punchAge = PUNCH_LIFE;
    this.apply();
  }

  public update(dt: number): boolean {
    if (this.trauma === 0 && this.punchAge >= PUNCH_LIFE) return false;
    const s = dt / 1000;
    this.time += s;
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * s);
    this.punchAge += s;
    this.apply();
    return this.trauma > 0 || this.punchAge < PUNCH_LIFE;
  }

  private apply(): void {
    const k = this.trauma;
    const shift = k * MAX_SHIFT * this.cell;
    this.view.position.set(this.cx + shift * this.noise(0), this.cy + shift * this.noise(1.7));
    this.view.rotation = k * MAX_TILT * this.noise(3.1);
    this.view.scale.set(1 + this.punchNow());
  }

  /** Smooth noise in -1..1, one channel per phase. */
  private noise(phase: number): number {
    const t = this.time;
    return (Math.sin(t * NOISE[0] + phase) * 0.5 + Math.sin(t * NOISE[1] + phase * 2.3) * 0.3 + Math.sin(t * NOISE[2] + phase * 4.1) * 0.2);
  }

  /** Damped sine: swells out first, overshoots a little inward, settles. */
  private punchNow(): number {
    if (this.punchAge >= PUNCH_LIFE) return 0;
    const t = this.punchAge;
    return this.punchAmp * Math.exp(-PUNCH_DECAY * t) * Math.sin(2 * Math.PI * PUNCH_HZ * t);
  }
}
