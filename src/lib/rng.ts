// Tiny deterministic PRNG. Seeding from an ORF id makes every derived value for
// a gene stable across sessions and machines — the same gene always renders the
// same representative data.

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  /** Approximately standard-normal (Box–Muller). */
  gauss(): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Random element. */
  pick<T>(items: readonly T[]): T;
}

export function rngFor(...keys: (string | number)[]): Rng {
  const seedFn = xmur3(keys.join('|'));
  const rand = mulberry32(seedFn());
  const rng: Rng = {
    next: rand,
    range: (min, max) => min + rand() * (max - min),
    int: (min, max) => Math.floor(min + rand() * (max - min + 1)),
    gauss: () => {
      const u = 1 - rand();
      const v = rand();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    chance: (p) => rand() < p,
    pick: (items) => items[Math.floor(rand() * items.length)],
  };
  return rng;
}
