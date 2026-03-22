// Bresenham-based velocity accumulator — port of UQM velocity system
// VELOCITY_SHIFT = 5 → world units are in 1/32 display pixels
// Each tick: add velocity to error accumulators; every VELOCITY_UNIT (32) accumulated
// error → advance position by 1 world unit.

export const VELOCITY_SHIFT = 5;
export const VELOCITY_UNIT  = 1 << VELOCITY_SHIFT; // 32

export interface Velocity {
  xError: number; // fractional accumulator (signed, integer)
  yError: number;
  dx:     number; // whole world-units per tick (after division)
  dy:     number;
}

/** Create a zero velocity */
export function zeroVelocity(): Velocity {
  return { xError: 0, yError: 0, dx: 0, dy: 0 };
}

/**
 * Set velocity from angle + speed (in world units/tick scaled by VELOCITY_UNIT).
 * speedFixed = speed * VELOCITY_UNIT (integer, e.g. speed=2 → speedFixed=64)
 */
export function setVelocityComponents(v: Velocity, vx: number, vy: number): void {
  v.dx     = vx >> VELOCITY_SHIFT;
  v.dy     = vy >> VELOCITY_SHIFT;
  v.xError = vx - (v.dx << VELOCITY_SHIFT);
  v.yError = vy - (v.dy << VELOCITY_SHIFT);
}

/**
 * Advance position by one tick of velocity.
 * Returns {dx, dy} in world units to add to element position.
 */
export function applyVelocity(v: Velocity): { dx: number; dy: number } {
  let dx = v.dx;
  let dy = v.dy;

  // Accumulate fractional parts
  v.xError += v.xError >= 0
    ? (v.xError >= VELOCITY_UNIT ? -VELOCITY_UNIT : 0)
    : (v.xError < 0 ? VELOCITY_UNIT : 0);

  // Simplified Bresenham step: accumulate and carry
  const newXErr = v.xError + (v.dx >= 0 ? v.xError : -v.xError);
  void newXErr; // TODO: full Bresenham port after physics deep-dive

  return { dx, dy };
}

/**
 * Add an impulse (acceleration) to velocity.
 * ax, ay are in the same fixed-point scale as vx, vy above.
 */
export function addImpulse(v: Velocity, ax: number, ay: number): void {
  // Reconstruct full fixed-point velocity, add, decompose
  const vx = (v.dx << VELOCITY_SHIFT) + v.xError + ax;
  const vy = (v.dy << VELOCITY_SHIFT) + v.yError + ay;
  setVelocityComponents(v, vx, vy);
}

/** Compute the speed (magnitude) of a velocity vector, in VELOCITY_UNIT scale */
export function velocityMagnitude(v: Velocity): number {
  const vx = (v.dx << VELOCITY_SHIFT) + v.xError;
  const vy = (v.dy << VELOCITY_SHIFT) + v.yError;
  return Math.round(Math.sqrt(vx * vx + vy * vy));
}
