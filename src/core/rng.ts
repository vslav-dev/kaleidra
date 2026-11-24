/** Anything that carries a mulberry32 state. Boards and generators both use it, so state lives in plain data. */
export interface RngHolder {
  rng: number;
}

export function random(h: RngHolder): number {
  h.rng = (h.rng + 0x6d2b79f5) | 0;
  let t = h.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(h: RngHolder, n: number): number {
  return Math.floor(random(h) * n);
}

export function pick<T>(h: RngHolder, items: readonly T[]): T {
  return items[randInt(h, items.length)];
}

export function shuffleInPlace<T>(h: RngHolder, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randInt(h, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Derives an independent stream seed, so changing one generation step never shifts the others. */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h = Math.imul(h ^ (p | 0), 0x01000193);
    h ^= h >>> 13;
  }
  return h | 0;
}
