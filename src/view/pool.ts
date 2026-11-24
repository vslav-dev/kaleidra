import { type BLEND_MODES, type Container, Sprite, type Texture } from 'pixi.js';

/**
 * Reused effect sprites: a blast takes a handful and gives them back, so effects allocate nothing
 * once warmed up and the garbage collector has nothing to pause a frame for.
 */
export class SpritePool {
  private readonly free: Sprite[] = [];

  public acquire(layer: Container, texture: Texture, blend: BLEND_MODES): Sprite {
    const s = this.free.pop() ?? new Sprite();
    s.texture = texture;
    s.anchor.set(0.5);
    s.pivot.set(0, 0);
    s.scale.set(1);
    s.rotation = 0;
    s.alpha = 1;
    s.tint = 0xffffff;
    s.blendMode = blend;
    s.visible = true;
    layer.addChild(s);
    return s;
  }

  /** A sprite destroyed meanwhile (the board was wiped) is dropped, not reused. */
  public release(s: Sprite): void {
    if (s.destroyed) return;
    s.parent?.removeChild(s);
    this.free.push(s);
  }
}
