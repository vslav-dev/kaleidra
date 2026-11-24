import { RECIPES, renderRecipe, Sfx } from '@/audio/synth';

const MAX_VOICES = 12;

/** Recordings picked from Glimmerfall's library, by sound: sfx/<sound>.m4a. Sounds without one are synthesized. */
const FILES = import.meta.glob<string>('./sfx/*.m4a', { eager: true, query: '?url', import: 'default' });

/** Synthesized on purpose: the swap and the special's birth are silent, the rest is the recipe. */
const SILENT = new Set<Sfx>([Sfx.Swap, Sfx.Create]);

/**
 * Plays short buffers. Sounds load on the first user gesture, which mobile browsers require anyway;
 * a sound still loading is skipped.
 */
export class AudioBus {
  public enabled = true;
  private ctx: AudioContext | null = null;
  private readonly ready = new Map<Sfx, AudioBuffer>();
  private voices = 0;

  /** Call from a user gesture. Safe to call repeatedly. */
  public unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    void this.ctx.resume();
    for (const id of Object.values(Sfx)) if (!SILENT.has(id)) void this.load(this.ctx, id);
  }

  /** `rate` shifts pitch (cascades climb), `gain` scales volume. */
  public play(id: Sfx, rate = 1, gain = 1): void {
    const ctx = this.ctx;
    const buffer = this.ready.get(id);
    if (!this.enabled || !ctx || !buffer || ctx.state !== 'running' || this.voices >= MAX_VOICES) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    src.connect(amp).connect(ctx.destination);
    this.voices++;
    src.onended = () => this.voices--;
    src.start();
  }

  public suspend(): void {
    void this.ctx?.suspend();
  }

  public resume(): void {
    void this.ctx?.resume();
  }

  private async load(ctx: AudioContext, id: Sfx): Promise<void> {
    const url = FILES[`./sfx/${id}.m4a`];
    try {
      const buffer = url ? await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer()) : await renderRecipe(RECIPES[id], ctx.sampleRate);
      this.ready.set(id, buffer);
    } catch {
      // A recording the browser cannot decode falls back to its recipe.
      this.ready.set(id, await renderRecipe(RECIPES[id], ctx.sampleRate));
    }
  }
}
