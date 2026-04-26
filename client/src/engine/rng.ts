// Park-Miller LCG — exact port of UQM src/libs/math/random.c
// seed range: 1 .. 2147483646 (never 0, never M)
// A=16807, M=2^31-1=2147483647, Q=M/A=127773, R=M%A=2836

const A = 16807;
const M = 2147483647;
const Q = 127773; // M / A
const R = 2836;   // M % A

export function nextRngSeed(seed: number): number {
  const clamped = ((seed % M) + M) % M || 1;
  const hi = Math.trunc(clamped / Q);
  const lo = clamped % Q;
  const val = A * lo - R * hi;
  return val > 0 ? val : val + M;
}

export class RNG {
  private seed: number;

  constructor(seed: number) {
    // Clamp to valid range
    this.seed = ((seed % M) + M) % M || 1;
  }

  /** Advance state and return next integer in [1, M-1] */
  next(): number {
    this.seed = nextRngSeed(this.seed);
    return this.seed;
  }

  /** Return a random integer in [0, range-1] */
  rand(range: number): number {
    if (range <= 0) return 0;
    return (this.next() >>> 0) % range;
  }

  /** Read current seed (for checksum) without advancing state */
  getSeed(): number {
    return this.seed;
  }

  /** Restore seed (after checksum read) */
  setSeed(seed: number): void {
    this.seed = seed;
  }
}
