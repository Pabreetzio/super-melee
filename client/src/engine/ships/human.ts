// Earthling Cruiser physics — ported from uqm-0.8.0/src/uqm/ships/human/human.c
// and the common ship movement in uqm-0.8.0/src/uqm/ship.c (inertial_thrust).

import {
  WORLD_TO_VELOCITY, VELOCITY_TO_WORLD, DISPLAY_TO_WORLD,
  setVelocityVector, velocitySquared,
  setVelocityComponents, getCurrentVelocityComponents,
  type VelocityDesc,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2 } from '../game';

// ─── Ship constants (from human.c) ───────────────────────────────────────────

export const MAX_CREW            = 18;
export const MAX_ENERGY          = 18;
export const ENERGY_REGENERATION = 1;
export const ENERGY_WAIT         = 8;    // regenerate every ENERGY_WAIT+1 frames
export const MAX_THRUST          = 24;   // world units (= DISPLAY_TO_WORLD(6))
export const THRUST_INCREMENT    = 3;    // world units per thrust application
export const THRUST_WAIT         = 4;    // frames between thrust applications
export const TURN_WAIT           = 1;    // frames between turns
export const SHIP_MASS           = 6;
export const SHIP_RADIUS         = 14;   // display pixels (approximate)

// Nuke
export const WEAPON_ENERGY_COST = 9;
export const WEAPON_WAIT        = 10;
export const MISSILE_LIFE       = 60;
export const MIN_MISSILE_SPEED  = DISPLAY_TO_WORLD(10); // 40 world units
export const MAX_MISSILE_SPEED  = DISPLAY_TO_WORLD(20); // 80 world units
export const MISSILE_SPEED      = Math.max(MAX_THRUST, MIN_MISSILE_SPEED); // 40
export const THRUST_SCALE       = DISPLAY_TO_WORLD(1);  // 4 world units acceleration/frame
export const MISSILE_DAMAGE     = 4;
export const TRACK_WAIT         = 3;
export const HUMAN_OFFSET       = 42;   // display pixels — nuke spawn offset from ship

// Point defense
export const SPECIAL_ENERGY_COST = 4;
export const SPECIAL_WAIT        = 9;
export const LASER_RANGE         = 100; // display pixels

// In velocity-unit² — threshold for capping acceleration at max speed
const MAX_SPEED_SQ = WORLD_TO_VELOCITY(MAX_THRUST) ** 2; // 768² = 589824

// ─── Ship state ───────────────────────────────────────────────────────────────

export interface HumanShipState {
  // Position (world units)
  x: number;
  y: number;

  // Velocity
  velocity: VelocityDesc;

  // Orientation
  facing: number; // 0–15 (16 sprite frames / facings)

  // Combat stats
  crew: number;
  energy: number;

  // Countdown timers (frames remaining until action available; 0 = available)
  thrustWait:   number;
  turnWait:     number;
  weaponWait:   number;
  specialWait:  number;
  energyWait:   number;

  // Status flags
  thrusting: boolean;
}

export function makeHumanShip(x: number, y: number): HumanShipState {
  return {
    x, y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: MAX_CREW,
    energy: MAX_ENERGY,
    thrustWait:  0,
    turnWait:    0,
    weaponWait:  0,
    specialWait: 0,
    energyWait:  0,
    thrusting: false,
  };
}

// ─── Per-frame update ─────────────────────────────────────────────────────────

/**
 * Update ship state for one simulation frame.
 * input: bitmask of INPUT_* constants.
 * Returns array of spawned objects (missiles, lasers) to add to the world.
 */
export function updateHumanShip(ship: HumanShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  // ─── Turning ─────────────────────────────────────────────────────────────
  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing - 1 + 16) % 16;
      ship.turnWait = TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) % 16;
      ship.turnWait = TURN_WAIT;
    }
  }

  // ─── Thrust (inertial_thrust from ship.c) ────────────────────────────────
  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = THRUST_WAIT;

    const angle = (ship.facing * 4) & 63; // FACING_TO_ANGLE
    const incV  = WORLD_TO_VELOCITY(THRUST_INCREMENT); // 96 velocity units
    const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
    const newDx = curDx + COSINE(angle, incV);
    const newDy = curDy + SINE(angle, incV);
    const desiredSpeedSq = newDx * newDx + newDy * newDy;

    if (desiredSpeedSq <= MAX_SPEED_SQ) {
      // Normal acceleration
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else {
      const currentSpeedSq = velocitySquared(ship.velocity);
      if (desiredSpeedSq < currentSpeedSq) {
        // Gravity deceleration — allow through
        setVelocityComponents(ship.velocity, newDx, newDy);
      } else if (ship.velocity.travelAngle === angle) {
        // Same direction — clamp to max
        setVelocityVector(ship.velocity, MAX_THRUST, ship.facing);
      } else {
        // Thrusting at angle while at max speed — blend (simplified)
        // Full UQM implementation: subtract half of old travel vector, add new.
        // Simplified: apply and then renormalize to max speed.
        setVelocityComponents(ship.velocity, newDx, newDy);
        const spd = Math.sqrt(velocitySquared(ship.velocity));
        if (spd > 0) {
          const scale = WORLD_TO_VELOCITY(MAX_THRUST) / spd;
          setVelocityComponents(
            ship.velocity,
            ship.velocity.vx * scale,
            ship.velocity.vy * scale,
          );
        }
      }
    }
  }

  // ─── Position advance ─────────────────────────────────────────────────────
  // Apply velocity (Bresenham sub-pixel)
  const fracX = Math.abs(ship.velocity.vx) & 31;
  ship.velocity.ex += fracX;
  const carryX = ship.velocity.ex >= 32 ? 1 : 0;
  ship.velocity.ex &= 31;
  ship.x += VELOCITY_TO_WORLD(Math.abs(ship.velocity.vx)) * Math.sign(ship.velocity.vx) + (ship.velocity.vx >= 0 ? carryX : -carryX);

  const fracY = Math.abs(ship.velocity.vy) & 31;
  ship.velocity.ey += fracY;
  const carryY = ship.velocity.ey >= 32 ? 1 : 0;
  ship.velocity.ey &= 31;
  ship.y += VELOCITY_TO_WORLD(Math.abs(ship.velocity.vy)) * Math.sign(ship.velocity.vy) + (ship.velocity.vy >= 0 ? carryY : -carryY);

  // ─── Energy regeneration ──────────────────────────────────────────────────
  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < MAX_ENERGY) {
    ship.energy = Math.min(MAX_ENERGY, ship.energy + ENERGY_REGENERATION);
    ship.energyWait = ENERGY_WAIT;
  }

  // ─── Primary weapon: nuclear missile ─────────────────────────────────────
  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if ((input & INPUT_FIRE1) && ship.energy >= WEAPON_ENERGY_COST) {
    ship.energy -= WEAPON_ENERGY_COST;
    ship.weaponWait = WEAPON_WAIT;
    const launchAngle = (ship.facing * 4) & 63;
    const offsetW = DISPLAY_TO_WORLD(HUMAN_OFFSET); // 42 display px → 168 world units
    spawns.push({
      type: 'nuke',
      facing: ship.facing,
      x: ship.x + COSINE(launchAngle, offsetW),
      y: ship.y + SINE(launchAngle, offsetW),
      life: MISSILE_LIFE,
    });
  }

  // ─── Secondary weapon: point-defense laser ────────────────────────────────
  // Energy and cooldown are NOT deducted here. UQM spawn_point_defense only
  // pays when the laser actually hits something (PaidFor flag). applyPointDefense
  // in Battle.tsx handles deduction. We just gate on energy availability so
  // we don't spawn the check when the battery is empty.
  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2) && ship.energy >= SPECIAL_ENERGY_COST) {
    spawns.push({ type: 'point_defense', x: ship.x, y: ship.y });
  }

  return spawns;
}

// ─── Spawn request types ──────────────────────────────────────────────────────

export type SpawnRequest =
  | { type: 'nuke';         x: number; y: number; facing: number; life: number }
  | { type: 'point_defense'; x: number; y: number };

// ─── Shared tracking helper (mirrors UQM TrackShip ±1-facing-per-cycle logic) ─

/**
 * Turn facing one step toward targetAngle.
 * facing:      0–15  (ship/missile facing, 16 steps per full circle)
 * targetAngle: 0–63  (UQM world angle returned by worldAngle / TrackShip)
 *
 * Faithful to UQM weapon.c TrackShip: each call rotates by exactly ±1 facing
 * unit (= 4 angle units). Exported so every seeking-missile ship can reuse it.
 */
export function trackFacing(facing: number, targetAngle: number): number {
  const targetFacing = ((targetAngle + 2) >> 2) & 15; // angle → nearest facing
  const diff = (targetFacing - facing + 16) % 16;
  if (diff === 0) return facing;
  // diff 1–8 → clockwise is shorter (or equal at 8 — always go CW)
  if (diff <= 8) return (facing + 1) % 16;
  return (facing - 1 + 16) % 16;
}

// ─── Nuke preprocess (called each frame for a live missile) ──────────────────

export interface NukeState {
  x: number;
  y: number;
  facing: number;  // 0–15
  trackWait: number;
  life: number;    // frames remaining
  velocity: VelocityDesc;
}

export function makeNuke(x: number, y: number, facing: number): NukeState {
  const v: VelocityDesc = { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 };
  setVelocityVector(v, MISSILE_SPEED, facing);
  return { x, y, facing, trackWait: TRACK_WAIT, life: MISSILE_LIFE, velocity: v };
}

export function updateNuke(nuke: NukeState, targetAngle: number | null): boolean {
  nuke.life--;
  if (nuke.life <= 0) return false; // expired

  // Tracking
  if (nuke.trackWait > 0) {
    nuke.trackWait--;
  } else if (targetAngle !== null) {
    nuke.facing = trackFacing(nuke.facing, targetAngle);
    nuke.trackWait = TRACK_WAIT;
  }

  // Accelerate toward max speed
  const elapsed = MISSILE_LIFE - nuke.life;
  const speed = Math.min(MISSILE_SPEED + elapsed * THRUST_SCALE, MAX_MISSILE_SPEED);
  setVelocityVector(nuke.velocity, speed, nuke.facing);

  // Advance position
  const fracX = Math.abs(nuke.velocity.vx) & 31;
  nuke.velocity.ex += fracX;
  const carryX = nuke.velocity.ex >= 32 ? 1 : 0;
  nuke.velocity.ex &= 31;
  nuke.x += VELOCITY_TO_WORLD(Math.abs(nuke.velocity.vx)) * Math.sign(nuke.velocity.vx) + (nuke.velocity.vx >= 0 ? carryX : -carryX);

  const fracY = Math.abs(nuke.velocity.vy) & 31;
  nuke.velocity.ey += fracY;
  const carryY = nuke.velocity.ey >= 32 ? 1 : 0;
  nuke.velocity.ey &= 31;
  nuke.y += VELOCITY_TO_WORLD(Math.abs(nuke.velocity.vy)) * Math.sign(nuke.velocity.vy) + (nuke.velocity.vy >= 0 ? carryY : -carryY);

  return true; // still alive
}
