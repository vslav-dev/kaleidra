import type { Container, Sprite, Texture } from 'pixi.js';
import type { SpritePool } from '@/view/pool';

/** A kind of particle. Lengths are in cells, times in ms, so a preset looks the same on any board. */
export interface Preset {
  /** atlas frame for the k-th particle of a burst of pieces of `color` */
  frame: (color: number, k: number) => string;
  /** light adds up (sparks, glitter); matter covers (shards, splinters) */
  light: boolean;
  count: number;
  /** cells per second */
  speed: readonly [number, number];
  /** sprite scale: 1 is one cell */
  size: readonly [number, number];
  life: readonly [number, number];
  /** cells per second squared, down */
  gravity: number;
  /** speed lost per second, as a rate: a fast burst that hangs in the air */
  drag: number;
  /** rad/s, either way */
  spin: number;
  /** size at the end of life, relative to the start */
  grow: number;
  /** streaks: stretched along the flight by this much per cell/s of speed */
  stretch: number;
  /** starts white and settles into its color over the first part of its life */
  whiteHot: boolean;
  /** fade curve: alpha = 1 - k^fade; higher stays solid longer */
  fade: number;
  twinkle: boolean;
}

export interface EmitOptions {
  /** gem color of the burst, for frames that take one */
  color: number;
  tint: number;
  /** count multiplier: harder hits throw more */
  amount?: number;
  /** direction and its spread, radians; all around by default */
  angle?: number;
  spread?: number;
  /** start this far from the point (cells), on a ring; with `inward` they fly to the point instead */
  radius?: number;
  inward?: boolean;
}

interface Particle {
  sprite: Sprite;
  vx: number;
  vy: number;
  spin: number;
  life: number;
  maxLife: number;
  size: number;
  preset: Preset;
  r: number;
  g: number;
  b: number;
  phase: number;
}

const MAX_PARTICLES = 320;
/** share of the life a white-hot particle takes to reach its color */
const COOL_DOWN = 0.35;

/**
 * Pooled sprite particles on two layers: light (additive) and matter (normal), so a burst never
 * breaks a batch by switching blend modes back and forth. Bursts wake the render loop.
 */
export class Particles {
  /** share of each burst that is thrown; lowered when the device is slow */
  public density = 1;
  public cell = 48;
  private live: Particle[] = [];
  private readonly spare: Particle[] = [];

  public constructor(
    private readonly matter: Container,
    private readonly lightLayer: Container,
    private readonly pool: SpritePool,
    private readonly texture: (name: string) => Texture,
    private readonly onStart: () => void,
  ) {}

  public emit(preset: Preset, x: number, y: number, o: EmitOptions): void {
    const count = Math.round(preset.count * (o.amount ?? 1) * this.density);
    const cell = this.cell;
    const spread = o.spread ?? Math.PI * 2;
    const base = o.angle ?? 0;
    for (let k = 0; k < count && this.live.length < MAX_PARTICLES; k++) {
      const angle = base + (o.spread === undefined ? Math.random() : Math.random() - 0.5) * spread;
      const speed = between(preset.speed) * cell;
      const sprite = this.pool.acquire(preset.light ? this.lightLayer : this.matter, this.texture(preset.frame(o.color, k)), preset.light ? 'add' : 'normal');
      const p = this.spare.pop() ?? ({} as Particle);
      const ring = (o.radius ?? 0) * cell;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      sprite.position.set(x + dx * ring, y + dy * ring);
      p.sprite = sprite;
      p.preset = preset;
      p.life = 0;
      p.maxLife = between(preset.life);
      // Inward: arrive at the point as life ends, whatever the drag.
      const v = o.inward ? -ring / (p.maxLife / 1000) : speed;
      p.vx = dx * v;
      p.vy = dy * v;
      p.spin = (Math.random() - 0.5) * 2 * preset.spin;
      p.size = between(preset.size);
      p.r = (o.tint >> 16) & 0xff;
      p.g = (o.tint >> 8) & 0xff;
      p.b = o.tint & 0xff;
      p.phase = Math.random() * Math.PI * 2;
      sprite.rotation = preset.stretch > 0 ? angle : Math.random() * Math.PI * 2;
      this.draw(p, 0);
      this.live.push(p);
    }
    if (count > 0) this.onStart();
  }

  /** Returns whether particles are still alive. */
  public update(dt: number): boolean {
    if (this.live.length === 0) return false;
    const s = dt / 1000;
    let write = 0;
    for (const p of this.live) {
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.retire(p);
        continue;
      }
      const preset = p.preset;
      const keep = Math.exp(-preset.drag * s);
      p.vx *= keep;
      p.vy = p.vy * keep + preset.gravity * this.cell * s;
      p.sprite.x += p.vx * s;
      p.sprite.y += p.vy * s;
      if (preset.stretch > 0) p.sprite.rotation = Math.atan2(p.vy, p.vx);
      else p.sprite.rotation += p.spin * s;
      this.draw(p, p.life / p.maxLife);
      this.live[write++] = p;
    }
    this.live.length = write;
    return write > 0;
  }

  public clear(): void {
    for (const p of this.live) this.retire(p);
    this.live = [];
  }

  private draw(p: Particle, k: number): void {
    const preset = p.preset;
    const sprite = p.sprite;
    const size = p.size * (1 + (preset.grow - 1) * k);
    if (preset.stretch > 0) {
      const speed = Math.hypot(p.vx, p.vy) / this.cell;
      sprite.scale.set(size * (1 + speed * preset.stretch), size);
    } else {
      sprite.scale.set(size);
    }
    let alpha = 1 - k ** preset.fade;
    if (preset.twinkle) alpha *= 0.65 + 0.35 * Math.sin(p.life * 0.045 + p.phase);
    sprite.alpha = alpha;
    // Tint changes only while cooling down: past it the last one (all but the color) stays.
    if (preset.whiteHot ? k <= COOL_DOWN : k === 0) {
      const w = preset.whiteHot ? 1 - k / COOL_DOWN : 0;
      sprite.tint = (mix(p.r, w) << 16) | (mix(p.g, w) << 8) | mix(p.b, w);
    }
  }

  private retire(p: Particle): void {
    this.pool.release(p.sprite);
    this.spare.push(p);
  }
}

function between([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}

/** Channel blended toward white by `w`. */
function mix(channel: number, w: number): number {
  return Math.round(channel + (255 - channel) * w);
}
