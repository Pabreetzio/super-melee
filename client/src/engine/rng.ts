// Park-Miller LCG — exact port of UQM src/libs/math/random.c
// seed range: 1 .. 2147483646 (never 0, never M)
// A=16807, M=2^31-1=2147483647, Q=M/A=127773, R=M%A=2836

const A = 16807;
const M = 2147483647;
const Q = 127773; // M / A
const R = 2836;   // M % A

export class RNG {
  private seed: number;

  constructor(seed: number) {
    // Clamp to valid range
    this.seed = ((seed % M) + M) % M || 1;
  }

  /** Advance state and return next integer in [1, M-1] */
  next(): number {
    // Schrage's method — avoids 64-bit overflow using only 32-bit ints
    // seed = A*(seed%Q) - R*(seed/Q)
    const hi = Math.trunc(this.seed / Q);
    const lo = this.seed % Q;
    const val = A * lo - R * hi;
    this.seed = val > 0 ? val : val + M;
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
