/**
 * Deterministic, seedable RNG (mulberry32).
 *
 * Every anomaly roll goes through this so a run can be reproduced from its seed,
 * which matters both for debugging and for the "no two identical loops in a row"
 * bias control in AnomalyManager.
 */
export class RNG {
  private state: number;

  constructor(seed: number = (Math.random() * 0xffffffff) >>> 0) {
    this.state = seed >>> 0;
  }

  get seed(): number {
    return this.state;
  }

  /** float in [0,1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** float in [min,max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** integer in [min,max] */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  bool(chance = 0.5): boolean {
    return this.next() < chance;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Weighted pick. Returns null when every weight is <= 0. */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T | null {
    let total = 0;
    for (const it of items) total += Math.max(0, weightOf(it));
    if (total <= 0) return null;
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weightOf(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1] ?? null;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** Shared "cosmetic" randomness — dirt placement, flicker phases, etc. */
export const cosmeticRNG = new RNG(0x5eed1013);
