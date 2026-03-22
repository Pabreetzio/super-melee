// Physics engine — integer-only, deterministic
// Faithful port of UQM collision and gravity from src/uqm/collide.c and battle.c
//
// STUB: This file contains the structure and gravity/collision stubs.
// Full ship movement physics will be filled in per-ship in the ship modules.

import { SINE, COSINE, FULL_CIRCLE, HALF_CIRCLE, QUADRANT } from './sinetab';
import { addImpulse, velocityMagnitude, setVelocityComponents } from './velocity';
import type { Element, Point } from './element';
import { GRAVITY_MASS } from './element';

// World dimensions (display pixels, centered at DISPLAY_WIDTH/2, DISPLAY_HEIGHT/2)
export const DISPLAY_WIDTH  = 640;
export const DISPLAY_HEIGHT = 480;
export const WORLD_WIDTH    = DISPLAY_WIDTH  * 2;
export const WORLD_HEIGHT   = DISPLAY_HEIGHT * 2;

// Gravity constants from UQM battle.c
export const GRAVITY_THRESHOLD = 255; // display pixels; within this → pull applies
export const GRAVITY_PULL      = 32;  // 1 world unit per tick in fixed-point (VELOCITY_UNIT scale)

// Planet position (center of play field)
export const PLANET_X = WORLD_WIDTH  >> 1;
export const PLANET_Y = WORLD_HEIGHT >> 1;

// Minimum post-collision speed (prevents objects from stopping dead)
const MIN_COLLISION_SPEED = 8; // VELOCITY_UNIT scale

/**
 * Apply gravity pull toward the planet for elements with GRAVITY_MASS flag.
 * Constant 1-unit pull within GRAVITY_THRESHOLD, step function (no falloff).
 */
export function applyGravity(el: Element): void {
  if (!(el.state_flags & GRAVITY_MASS)) return;

  const dx = PLANET_X - el.current.x;
  const dy = PLANET_Y - el.current.y;
  const dist = Math.round(Math.sqrt(dx * dx + dy * dy));

  if (dist === 0 || dist > GRAVITY_THRESHOLD) return;

  // Direction toward planet — use integer atan2 approximation
  // For now use angle derived from dx/dy components
  const angle = Math.round(Math.atan2(-dy, dx) * FULL_CIRCLE / (2 * Math.PI)) & 63;

  const ax = COSINE(angle, GRAVITY_PULL);
  const ay = -SINE(angle, GRAVITY_PULL); // screen Y is flipped

  addImpulse(el.velocity, ax, ay);
}

/**
 * Detect overlap between two circular elements.
 * Returns true if they overlap (collision occurred).
 * Uses integer distance-squared comparison with a combined radius.
 */
export function overlaps(a: Element, b: Element, radA: number, radB: number): boolean {
  const dx = a.next.x - b.next.x;
  const dy = a.next.y - b.next.y;
  const distSq = dx * dx + dy * dy;
  const radSum = radA + radB;
  return distSq < radSum * radSum;
}

/**
 * Resolve elastic collision between two elements.
 * Implements UQM's non-physical impulse formula from collide.c:
 *   impulse = SINE(directness, speed * 2) * mass ratio
 * Returns collision result: mutual damage, velocity exchange.
 *
 * "Directness" = angle between relative velocity and collision axis.
 * Glancing collision quirk: if directness <= QUADRANT or >= 3*QUADRANT,
 * element bounces back along its own travel direction (UQM quirk, faithful).
 */
export function resolveCollision(
  a: Element, b: Element,
  _radA: number, _radB: number,
): void {
  const speedA = velocityMagnitude(a.velocity);
  const speedB = velocityMagnitude(b.velocity);

  // Collision axis angle (a → b)
  const dx = b.current.x - a.current.x;
  const dy = b.current.y - a.current.y;
  const collisionAngle = Math.round(Math.atan2(-dy, dx) * FULL_CIRCLE / (2 * Math.PI)) & 63;

  // Compute impulse magnitudes (UQM formula)
  const totalMass = a.mass_points + b.mass_points;
  if (totalMass === 0) return;

  // Travel angle for A
  const vxA = (a.velocity.dx << 5) + a.velocity.xError;
  const vyA = (a.velocity.dy << 5) + a.velocity.yError;
  const travelAngleA = Math.round(Math.atan2(-vyA, vxA) * FULL_CIRCLE / (2 * Math.PI)) & 63;
  const directnessA = (collisionAngle - travelAngleA + FULL_CIRCLE) & 63;

  // Glancing collision check (UQM quirk)
  const glancingA = directnessA <= QUADRANT || directnessA >= HALF_CIRCLE + QUADRANT;

  if (glancingA) {
    // Bounce back along own travel direction
    setVelocityComponents(a.velocity, -vxA, -vyA);
  } else {
    // Normal collision: redirect toward collision axis with impulse
    const impulseA = Math.abs(SINE(directnessA, speedA * 2));
    const newSpeedA = Math.max(MIN_COLLISION_SPEED, impulseA * b.mass_points / totalMass);
    const newAngleA = (collisionAngle + HALF_CIRCLE) & 63; // reflect
    const newVxA = COSINE(newAngleA, newSpeedA);
    const newVyA = -SINE(newAngleA, newSpeedA);
    setVelocityComponents(a.velocity, newVxA, newVyA);
  }

  // Mirror for B
  const vxB = (b.velocity.dx << 5) + b.velocity.xError;
  const vyB = (b.velocity.dy << 5) + b.velocity.yError;
  const travelAngleB = Math.round(Math.atan2(-vyB, vxB) * FULL_CIRCLE / (2 * Math.PI)) & 63;
  const directnessB = ((collisionAngle + HALF_CIRCLE) - travelAngleB + FULL_CIRCLE) & 63;
  const glancingB = directnessB <= QUADRANT || directnessB >= HALF_CIRCLE + QUADRANT;

  if (glancingB) {
    setVelocityComponents(b.velocity, -vxB, -vyB);
  } else {
    const impulseB = Math.abs(SINE(directnessB, speedB * 2));
    const newSpeedB = Math.max(MIN_COLLISION_SPEED, impulseB * a.mass_points / totalMass);
    const newVxB = COSINE(collisionAngle, newSpeedB);
    const newVyB = -SINE(collisionAngle, newSpeedB);
    setVelocityComponents(b.velocity, newVxB, newVyB);
  }
}

/** Wrap position to world bounds (toroidal space) */
export function wrapPosition(p: Point): void {
  p.x = ((p.x % WORLD_WIDTH)  + WORLD_WIDTH)  % WORLD_WIDTH;
  p.y = ((p.y % WORLD_HEIGHT) + WORLD_HEIGHT) % WORLD_HEIGHT;
}

/** Advance element position by its velocity for one tick */
export function stepElement(el: Element): void {
  el.current.x = el.next.x;
  el.current.y = el.next.y;
  el.next.x = el.current.x + el.velocity.dx;
  el.next.y = el.current.y + el.velocity.dy;
  wrapPosition(el.next);
}
