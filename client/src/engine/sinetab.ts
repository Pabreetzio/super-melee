// Exact 64-entry sine table from UQM src/uqm/trans.c
// FLT_ADJUST(x) = Math.trunc(x * 16384)
// Index 0 = angle 0 = facing North/up → SINE(0) = -16384 (moving up = negative Y)
// COSINE(a) = SINE((a + 16) & 63)
// Usage: SINE(angle, magnitude) = (sinetab[angle & 63] * magnitude) >> 14

export const SINE_SCALE = 16384; // 2^14 — divisor for fixed-point results
export const FULL_CIRCLE = 64;
export const HALF_CIRCLE = 32;
export const QUADRANT    = 16;
export const OCTANT      = 8;

// prettier-ignore
export const sinetab: readonly number[] = [
  -16384, -16305, -16069, -15679, -15137, -14449, -13623, -12665,
  -11585, -10393,  -9102,  -7723,  -6270,  -4756,  -3196,  -1606,
       0,   1606,   3196,   4756,   6270,   7723,   9102,  10393,
   11585,  12665,  13623,  14449,  15137,  15679,  16069,  16305,
   16384,  16305,  16069,  15679,  15137,  14449,  13623,  12665,
   11585,  10393,   9102,   7723,   6270,   4756,   3196,   1606,
       0,  -1606,  -3196,  -4756,  -6270,  -7723,  -9102, -10393,
  -11585, -12665, -13623, -14449, -15137, -15679, -16069, -16305,
];

/** SINE(angle, magnitude) — returns fixed-point Y component of motion */
export function SINE(angle: number, magnitude: number): number {
  return (sinetab[angle & 63] * magnitude) >> 14;
}

/** COSINE(angle, magnitude) — returns fixed-point X component of motion */
export function COSINE(angle: number, magnitude: number): number {
  return (sinetab[(angle + QUADRANT) & 63] * magnitude) >> 14;
}
