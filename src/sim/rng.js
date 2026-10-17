// Seeded pseudo-random number generator (mulberry32). Use this everywhere in
// the simulation and map generation instead of Math.random so games and tests
// are reproducible from a seed.

/** Hash a string or number into a 32-bit unsigned seed. */
export function hashSeed(value) {
  const s = String(value);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export class RNG {
  /** @param {number|string} seed */
  constructor(seed = 1) {
    this.state = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** Float in [0, 1). */
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min, max) {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p) {
    return this.next() < p;
  }

  /** Random element of a non-empty array. */
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Shuffle an array in place and return it. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Independent child generator derived from this one. */
  fork(label = '') {
    return new RNG(hashSeed(`${this.state}:${label}`));
  }
}
