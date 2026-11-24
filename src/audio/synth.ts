/**
 * Every sound the game plays, and its synthesized placeholder: played when no recording exists (see audio.ts).
 */

export const Sfx = {
  Button: 'button',
  /** a special on the calm board lights up to go off (last chance, finale) */
  Light: 'light',
  Swap: 'swap',
  SwapFail: 'swap-fail',
  Match: 'match',
  /** a match made a special */
  Create: 'create',
  /** finale: the moves left turn into specials */
  Transform: 'transform',
  LastChance: 'last-chance',
  Ray: 'ray',
  Burst: 'burst',
  Prism: 'prism',
  /** the rotors turn their rings */
  Rotor: 'rotor',
  /** the falling star booster: it falls, then strikes */
  FallingStar: 'falling-star',
  /** the meteor booster: a roar as it falls, then the impact */
  Meteor: 'meteor',
  /** a booster finished charging */
  Charged: 'charged',
  Frost: 'frost',
  Stone: 'stone',
  Lock: 'lock',
  Shuffle: 'shuffle',
  Star: 'star',
  Win: 'win',
  Lose: 'lose',
} as const;
export type Sfx = (typeof Sfx)[keyof typeof Sfx];

interface ToneOptions {
  type?: OscillatorType;
  from: number;
  to?: number;
  at?: number;
  duration: number;
  gain?: number;
  attack?: number;
}

interface NoiseOptions {
  filter: BiquadFilterType;
  from: number;
  to?: number;
  at?: number;
  duration: number;
  gain?: number;
  q?: number;
}

type Recipe = { duration: number; build: (ctx: OfflineAudioContext) => void };

function tone(ctx: OfflineAudioContext, o: ToneOptions): void {
  const at = o.at ?? 0;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.from, at);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, at + o.duration);
  const peak = o.gain ?? 0.3;
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(peak, at + (o.attack ?? 0.005));
  amp.gain.exponentialRampToValueAtTime(0.0001, at + o.duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + o.duration + 0.02);
}

function noise(ctx: OfflineAudioContext, o: NoiseOptions): void {
  const at = o.at ?? 0;
  const length = Math.ceil(ctx.sampleRate * o.duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = o.filter;
  filter.Q.value = o.q ?? 1;
  filter.frequency.setValueAtTime(o.from, at);
  if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, at + o.duration);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(o.gain ?? 0.3, at);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + o.duration);
  src.connect(filter).connect(amp).connect(ctx.destination);
  src.start(at);
}

function notes(ctx: OfflineAudioContext, freqs: number[], step: number, length: number, gain: number, type: OscillatorType = 'sine'): void {
  freqs.forEach((f, i) => {
    tone(ctx, { type, from: f, at: i * step, duration: length, gain });
    tone(ctx, { from: f * 2, at: i * step, duration: length * 0.6, gain: gain * 0.25 });
  });
}

const create: Recipe = {
  duration: 0.35,
  build: (c) => {
    tone(c, { from: 520, to: 1040, duration: 0.22, gain: 0.25 });
    notes(c, [1568, 2093], 0.08, 0.2, 0.08);
  },
};

export const RECIPES: Record<Sfx, Recipe> = {
  [Sfx.Button]: { duration: 0.08, build: (c) => tone(c, { from: 900, to: 700, duration: 0.07, gain: 0.2 }) },
  [Sfx.Light]: { duration: 0.06, build: (c) => tone(c, { from: 1300, to: 1500, duration: 0.05, gain: 0.12 }) },
  [Sfx.Swap]: {
    duration: 0.12,
    build: (c) => {
      tone(c, { type: 'triangle', from: 420, to: 640, duration: 0.1, gain: 0.22 });
      noise(c, { filter: 'highpass', from: 3000, duration: 0.06, gain: 0.05 });
    },
  },
  [Sfx.SwapFail]: {
    duration: 0.25,
    build: (c) => {
      tone(c, { type: 'triangle', from: 320, to: 220, duration: 0.1, gain: 0.25 });
      tone(c, { type: 'triangle', from: 260, to: 170, at: 0.11, duration: 0.12, gain: 0.22 });
    },
  },
  [Sfx.Match]: {
    duration: 0.22,
    build: (c) => {
      tone(c, { from: 660, to: 990, duration: 0.16, gain: 0.3 });
      tone(c, { type: 'triangle', from: 1320, to: 1980, duration: 0.12, gain: 0.08 });
    },
  },
  [Sfx.Create]: create,
  [Sfx.Transform]: create,
  [Sfx.LastChance]: create,
  [Sfx.Ray]: {
    duration: 0.35,
    build: (c) => {
      noise(c, { filter: 'bandpass', from: 1500, to: 7000, duration: 0.3, gain: 0.35, q: 2 });
      tone(c, { type: 'sawtooth', from: 220, to: 1400, duration: 0.25, gain: 0.08 });
    },
  },
  [Sfx.Burst]: {
    duration: 0.6,
    build: (c) => {
      noise(c, { filter: 'lowpass', from: 1200, to: 80, duration: 0.55, gain: 0.6 });
      tone(c, { from: 140, to: 40, duration: 0.45, gain: 0.5 });
    },
  },
  [Sfx.Prism]: {
    duration: 0.7,
    build: (c) => {
      notes(c, [660, 880, 1100, 1320, 1760], 0.06, 0.35, 0.16);
      noise(c, { filter: 'highpass', from: 5000, duration: 0.5, gain: 0.08 });
    },
  },
  // Timed with the fall on the board: the star strikes at 0.43 s, the meteor at 0.65 s.
  [Sfx.FallingStar]: {
    duration: 0.95,
    build: (c) => {
      tone(c, { from: 3200, to: 1400, duration: 0.42, gain: 0.07 });
      noise(c, { filter: 'bandpass', from: 6000, to: 2500, duration: 0.42, gain: 0.08, q: 4 });
      [1568, 2093, 2637].forEach((f, i) => tone(c, { from: f, at: 0.43 + i * 0.06, duration: 0.5, gain: 0.16 }));
    },
  },
  [Sfx.Meteor]: {
    duration: 1.6,
    build: (c) => {
      noise(c, { filter: 'lowpass', from: 300, to: 1800, duration: 0.66, gain: 0.35 });
      noise(c, { filter: 'lowpass', from: 1600, to: 60, at: 0.66, duration: 0.9, gain: 0.8 });
      tone(c, { from: 120, to: 32, at: 0.66, duration: 0.85, gain: 0.7 });
      tone(c, { type: 'triangle', from: 260, to: 70, at: 0.66, duration: 0.3, gain: 0.25 });
    },
  },
  [Sfx.Charged]: { duration: 0.8, build: (c) => notes(c, [784, 1175, 1568, 2349], 0.07, 0.5, 0.14) },
  [Sfx.Frost]: {
    duration: 0.2,
    build: (c) => {
      noise(c, { filter: 'highpass', from: 3500, duration: 0.14, gain: 0.3 });
      tone(c, { from: 2400, to: 1800, duration: 0.1, gain: 0.08 });
    },
  },
  [Sfx.Stone]: {
    duration: 0.25,
    build: (c) => {
      noise(c, { filter: 'lowpass', from: 700, to: 250, duration: 0.2, gain: 0.45 });
      tone(c, { type: 'triangle', from: 190, to: 110, duration: 0.15, gain: 0.25 });
    },
  },
  [Sfx.Lock]: {
    duration: 0.25,
    build: (c) => {
      tone(c, { type: 'square', from: 1250, duration: 0.07, gain: 0.06 });
      tone(c, { type: 'square', from: 1580, at: 0.08, duration: 0.1, gain: 0.05 });
    },
  },
  [Sfx.Rotor]: {
    duration: 0.4,
    build: (c) => {
      noise(c, { filter: 'bandpass', from: 900, to: 2400, duration: 0.3, gain: 0.16, q: 5 });
      notes(c, [784, 988, 1175], 0.05, 0.25, 0.07, 'triangle');
    },
  },
  [Sfx.Shuffle]: {
    duration: 0.5,
    build: (c) => noise(c, { filter: 'bandpass', from: 600, to: 3000, duration: 0.45, gain: 0.25, q: 3 }),
  },
  [Sfx.Star]: { duration: 0.5, build: (c) => notes(c, [1047, 1568], 0.03, 0.45, 0.18) },
  [Sfx.Win]: { duration: 1.0, build: (c) => notes(c, [523, 659, 784, 1047], 0.12, 0.5, 0.2) },
  [Sfx.Lose]: { duration: 0.9, build: (c) => notes(c, [440, 392, 330], 0.18, 0.45, 0.18, 'triangle') },
};

export async function renderRecipe(recipe: Recipe, sampleRate: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.ceil(sampleRate * recipe.duration), sampleRate);
  recipe.build(ctx);
  return ctx.startRendering();
}
