// Bresenham velocity accumulator — exact port of UQM src/uqm/velocity.c
//
// Coordinate system:
//   ONE_SHIFT       = 2  → 1 display pixel = 4 world units
//   VELOCITY_SHIFT  = 5  → 1 world unit stored as 32 velocity units
//   So velocity units per display pixel = 4 * 32 = 128
//
// Internal storage: vx, vy are in velocity units (world_units * 32), signed.
// Position advances by vx/32 world units per frame, with Bresenham sub-pixel
// carries handling the fractional part.

import { SINE, COSINE, tableAngle } from './sinetab';

export const VELOCITY_SHIFT  = 5;
export const VELOCITY_SCALE  = 1 << VELOCITY_SHIFT; // 32
export const ONE_SHIFT       = 2;                    // world/display scale
export const DISPLAY_TO_WORLD = (x: number) => x << ONE_SHIFT;   // x * 4
export const WORLD_TO_DISPLAY = (x: number) => x >> ONE_SHIFT;   // x / 4
export const WORLD_TO_VELOCITY = (x: number) => x << VELOCITY_SHIFT; // x * 32
export const VELOCITY_TO_WORLD = (x: number) => x >> VELOCITY_SHIFT; // x / 32

export interface VelocityDesc {
  travelAngle: number; // 0–63
  vx: number;          // velocity units, signed (positive = rightward)
  vy: number;          // velocity units, signed (positive = downward)
  ex: number;          // Bresenham X error accumulator 0..31
  ey: number;          // Bresenham Y error accumulator 0..31
}

export function zeroVelocity(): VelocityDesc {
  return { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 };
}

/** Reconstruct current velocity components in velocity units */
export function getCurrentVelocityComponents(v: VelocityDesc): { dx: number; dy: number } {
  return { dx: v.vx, dy: v.vy };
}

/** Pack dx, dy (velocity units) into the descriptor — equivalent to SetVelocityComponents */
export function setVelocityComponents(v: VelocityDesc, dx: number, dy: number): void {
  v.vx = Math.trunc(dx);
  v.vy = Math.trunc(dy);
  v.ex = 0;
  v.ey = 0;
  // Use integer table lookup on the already-truncated vx/vy so travelAngle is
  // identical on every platform (Math.atan2 is not guaranteed bit-identical
  // for non-integer inputs and is the root cause of multiplayer desyncs).
  v.travelAngle = tableAngle(v.vx, v.vy);
}

/**
 * SetVelocityVector — set velocity from angle (0–63) and magnitude (world units).
 * Equivalent to UQM SetVelocityVector.
 */
export function setVelocityVector(v: VelocityDesc, magnitude: number, facing: number): void {
  const angle = (facing * 4) & 63; // FACING_TO_ANGLE: facing * 4
  const magV = WORLD_TO_VELOCITY(magnitude);
  // COSINE = horizontal (rightward positive), SINE = vertical (downward positive in screen coords)
  // Note: UQM screen Y flips from world Y — handled in rendering
  const dx = COSINE(angle, magV);
  const dy = SINE(angle, magV);
  setVelocityComponents(v, dx, dy);
  v.travelAngle = angle;
}

/**
 * DeltaVelocityComponents — add dx, dy (velocity units) to current velocity.
 * Equivalent to UQM DeltaVelocityComponents.
 */
export function deltaVelocityComponents(v: VelocityDesc, dx: number, dy: number): void {
  setVelocityComponents(v, v.vx + dx, v.vy + dy);
}

/**
 * Advance position by one frame of velocity. Returns displacement in world units.
 * Bresenham sub-pixel carry: fractional part accumulates in ex/ey;
 * when it hits 32, an extra ±1 world unit is added.
 */
export function applyVelocity(v: VelocityDesc): { dx: number; dy: number } {
  const whole_x = VELOCITY_TO_WORLD(Math.abs(v.vx)) * Math.sign(v.vx);
  const fract_x = Math.abs(v.vx) & (VELOCITY_SCALE - 1);
  v.ex += fract_x;
  const carry_x = v.ex >= VELOCITY_SCALE ? 1 : 0;
  v.ex &= (VELOCITY_SCALE - 1);
  const dx = whole_x + (v.vx >= 0 ? carry_x : -carry_x);

  const whole_y = VELOCITY_TO_WORLD(Math.abs(v.vy)) * Math.sign(v.vy);
  const fract_y = Math.abs(v.vy) & (VELOCITY_SCALE - 1);
  v.ey += fract_y;
  const carry_y = v.ey >= VELOCITY_SCALE ? 1 : 0;
  v.ey &= (VELOCITY_SCALE - 1);
  const dy = whole_y + (v.vy >= 0 ? carry_y : -carry_y);

  return { dx, dy };
}

/** Speed squared in velocity units (for comparison with max_speed^2) */
export function velocitySquared(v: VelocityDesc): number {
  return v.vx * v.vx + v.vy * v.vy;
}

/** Speed magnitude in velocity units */
export function velocityMagnitude(v: VelocityDesc): number {
  return Math.round(Math.sqrt(velocitySquared(v)));
}

/** Add impulse (dx, dy in velocity units) to current velocity */
export function addImpulse(v: VelocityDesc, dx: number, dy: number): void {
  setVelocityComponents(v, v.vx + dx, v.vy + dy);
}

export interface InertialThrustStatus {
  atMax: boolean;
  beyondMax: boolean;
}

/**
 * UQM-style inertial thrust.
 *
 * This preserves the "gravity whip" feel by allowing ships inside the gravity
 * well to continue accelerating beyond ordinary max thrust, while still
 * keeping the normal top-speed clamp outside the well.
 */
export function applyInertialThrust(
  v: VelocityDesc,
  facing: number,
  maxThrust: number,
  thrustIncrement: number,
  inGravityWell: boolean,
  currentStatus: InertialThrustStatus = { atMax: false, beyondMax: false },
): InertialThrustStatus {
  const angle = (facing * 4) & 63;
  const travelAngle = v.travelAngle;

  if (thrustIncrement === maxThrust) {
    setVelocityVector(v, maxThrust, facing);
    return { atMax: true, beyondMax: false };
  }

  if (
    travelAngle === angle
    && (currentStatus.atMax || currentStatus.beyondMax)
    && !inGravityWell
  ) {
    return currentStatus;
  }

  const incV = WORLD_TO_VELOCITY(thrustIncrement);
  const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(v);
  const currentSpeedSq = curDx * curDx + curDy * curDy;
  const newDx = curDx + COSINE(angle, incV);
  const newDy = curDy + SINE(angle, incV);
  const desiredSpeedSq = newDx * newDx + newDy * newDy;
  const maxSpeedSq = WORLD_TO_VELOCITY(maxThrust) ** 2;
  const gravityWhipCapSq = WORLD_TO_VELOCITY(DISPLAY_TO_WORLD(18)) ** 2;

  if (desiredSpeedSq <= maxSpeedSq) {
    setVelocityComponents(v, newDx, newDy);
    return { atMax: false, beyondMax: false };
  }

  if ((inGravityWell && desiredSpeedSq <= gravityWhipCapSq) || desiredSpeedSq < currentSpeedSq) {
    setVelocityComponents(v, newDx, newDy);
    return { atMax: true, beyondMax: true };
  }

  if (travelAngle === angle) {
    if (currentSpeedSq <= maxSpeedSq) {
      setVelocityVector(v, maxThrust, facing);
    }
    return { atMax: true, beyondMax: false };
  }

  const adjusted = { ...v };
  deltaVelocityComponents(
    adjusted,
    COSINE(angle, incV >> 1) - COSINE(travelAngle, incV),
    SINE(angle, incV >> 1) - SINE(travelAngle, incV),
  );
  const adjustedSpeedSq = adjusted.vx * adjusted.vx + adjusted.vy * adjusted.vy;
  if (adjustedSpeedSq > maxSpeedSq) {
    if (adjustedSpeedSq < currentSpeedSq) {
      v.travelAngle = adjusted.travelAngle;
      v.vx = adjusted.vx;
      v.vy = adjusted.vy;
      v.ex = adjusted.ex;
      v.ey = adjusted.ey;
    }
    return { atMax: true, beyondMax: true };
  }

  v.travelAngle = adjusted.travelAngle;
  v.vx = adjusted.vx;
  v.vy = adjusted.vy;
  v.ex = adjusted.ex;
  v.ey = adjusted.ey;
  return { atMax: false, beyondMax: false };
}

/** Type alias for compatibility */
export type Velocity = VelocityDesc;
