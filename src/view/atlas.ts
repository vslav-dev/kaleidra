import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { PAINTERS, paintContext } from '@/view/art';

const PAD = 2;

/**
 * One texture with every frame of the game, painted for the exact cell size and pixel density.
 * One texture means the whole board is drawn in one or two batches.
 */
export class Atlas {
  private source: CanvasSource | null = null;
  private readonly frames = new Map<string, Texture>();
  private key = '';

  /** Repaints when the cell size or resolution changed. Returns true when textures were replaced. */
  public build(cell: number, resolution: number): boolean {
    const key = `${cell}@${resolution}`;
    if (key === this.key) return false;
    this.paint(cell, resolution);
    // Set last: a failed paint must be retried next time, not leave the board with empty frames.
    this.key = key;
    return true;
  }

  public get(name: string): Texture {
    return this.frames.get(name) ?? Texture.EMPTY;
  }

  private paint(cell: number, resolution: number): void {
    const px = Math.ceil(cell * resolution);
    const slot = px + PAD * 2;
    const names = [...PAINTERS.keys()];
    const perRow = Math.ceil(Math.sqrt(names.length));
    const width = perRow * slot;
    const height = Math.ceil(names.length / perRow) * slot;

    // Pixi sizes the canvas itself, so painting comes after: a canvas handed over already painted gets
    // resized (and wiped) when width / resolution * resolution misses the integer, as with dpr 1.33.
    for (const texture of this.frames.values()) texture.destroy(false);
    this.frames.clear();
    this.source?.destroy();
    this.source = new CanvasSource({ width: width / resolution, height: height / resolution, resolution });
    const canvas = this.source.resource as HTMLCanvasElement;
    const ctx = paintContext(canvas);

    const places = names.map((name, k) => {
      const x = (k % perRow) * slot + PAD;
      const y = Math.floor(k / perRow) * slot + PAD;
      ctx.save();
      ctx.translate(x, y);
      PAINTERS.get(name)!(ctx, px);
      ctx.restore();
      return { name, x, y };
    });

    for (const { name, x, y } of places) {
      const frame = new Rectangle(x / resolution, y / resolution, px / resolution, px / resolution);
      this.frames.set(name, new Texture({ source: this.source, frame }));
    }
  }
}
