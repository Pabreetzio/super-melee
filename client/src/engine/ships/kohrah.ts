// Kohr-Ah Mauler — ported from uqm-0.8.0/src/uqm/ships/blackurq/blackurq.c
//
// Primary (FIRES_FORE): Buzzsaw — spinning disk projectiles that move while
//   fire is held, then home to enemies when released
// Special (SEEKING_SPECIAL): F.R.I.E.D. — ring of 16 fireballs expanding outward

import {
  WORLD_TO_VELOCITY, VELOCITY_TO_WORLD, DISPLAY_TO_WORLD,
  setVelocityVector, setVelocityComponents, getCurrentVelocityComponents,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2 } from '../game';
import type { HumanShipState } from './human';
import type { SpawnRequest } from './human';

// ─── Ship constants (from blackurq.c) ──────────────────────────────────────────

export const KOHRAH_MAX_CREW            = 42;
export const KOHRAH_MAX_ENERGY          = 42;
export const KOHRAH_ENERGY_REGENERATION = 1;
export const KOHRAH_ENERGY_WAIT         = 4;
export const KOHRAH_MAX_THRUST          = 30;
export const KOHRAH_THRUST_INCREMENT    = 6;
export const KOHRAH_THRUST_WAIT         = 6;
export const KOHRAH_TURN_WAIT           = 4;
export const KOHRAH_SHIP_MASS           = 10;

// Buzzsaw (primary)
export const BUZZSAW_ENERGY_COST = 6;
export const BUZZSAW_WAIT        = 6;
export const BUZZSAW_SPEED       = 64;  // world units — raw value from UQM, NOT display pixels
export const BUZZSAW_LIFE        = 64;       // frames while button held
export const BUZZSAW_HITS        = 10;       // HP
export const BUZZSAW_DAMAGE      = 4;
export const MAX_BUZZSAWS        = 8;
export const BUZZSAW_OFFSET      = DISPLAY_TO_WORLD(28);   // spawn offset from ship (pixoffs)
export const ACTIVATE_RANGE      = 224;                     // display pixels — UQM checks WORLD_TO_DISPLAY(delta) vs this
export const BUZZSAW_TRACK_WAIT  = 4;                       // frames between homing nudges (TRACK_WAIT)
export const BUZZSAW_TRACK_SPEED = DISPLAY_TO_WORLD(2);     // very slow homing speed (UQM: DISPLAY_TO_WORLD(2) = 8 world units)

// F.R.I.E.D. (special)
export const FRIED_ENERGY_COST   = KOHRAH_MAX_ENERGY / 2; // 10
export const FRIED_WAIT          = 9;
export const GAS_SPEED           = 16;  // world units — raw value from UQM, NOT display pixels
export const GAS_DAMAGE          = 3;
export const GAS_HITS            = 100;
export const NUM_GAS_CLOUDS      = 16;       // ring of 16 fireballs
export const GAS_OFFSET          = DISPLAY_TO_WORLD(2);   // spawn offset

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(KOHRAH_MAX_THRUST) ** 2;

// ─── Factory ──────────────────────────────────────────────────────────────────

export function makeKohrahShip(x: number, y: number): HumanShipState {
  return {
    x, y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: KOHRAH_MAX_CREW,
    energy: KOHRAH_MAX_ENERGY,
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
 * Update Kohr-Ah ship state for one simulation frame.
 * Returns array of spawned weapons (buzzsaws, gas clouds) to add to the world.
 */
export function updateKohrahShip(ship: HumanShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  // ─── Turning ──────────────────────────────────────────────────────────────
  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing - 1 + 16) % 16;
      ship.turnWait = KOHRAH_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) % 16;
      ship.turnWait = KOHRAH_TURN_WAIT;
    }
  }

  // ─── Thrust ───────────────────────────────────────────────────────────────
  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = KOHRAH_THRUST_WAIT;

    const angle = (ship.facing * 4) & 63;
    const incV  = WORLD_TO_VELOCITY(KOHRAH_THRUST_INCREMENT);
    const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
    const newDx = curDx + COSINE(angle, incV);
    const newDy = curDy + SINE(angle, incV);
    const desiredSpeedSq = newDx * newDx + newDy * newDy;

    if (desiredSpeedSq <= MAX_SPEED_SQ) {
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else {
      const currentSpeedSq = ship.velocity.vx ** 2 + ship.velocity.vy ** 2;
      if (desiredSpeedSq < currentSpeedSq) {
        setVelocityComponents(ship.velocity, newDx, newDy);
      } else if (ship.velocity.travelAngle === angle) {
        setVelocityVector(ship.velocity, KOHRAH_MAX_THRUST, ship.facing);
      } else {
        setVelocityComponents(ship.velocity, newDx, newDy);
        const spd = Math.sqrt(ship.velocity.vx ** 2 + ship.velocity.vy ** 2);
        if (spd > 0) {
          const scale = WORLD_TO_VELOCITY(KOHRAH_MAX_THRUST) / spd;
          setVelocityComponents(
            ship.velocity,
            ship.velocity.vx * scale,
            ship.velocity.vy * scale,
          );
        }
      }
    }
  }

  // ─── Position advance ──────────────────────────────────────────────────────
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

  // ─── Energy regeneration ───────────────────────────────────────────────────
  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < KOHRAH_MAX_ENERGY) {
    ship.energy = Math.min(KOHRAH_MAX_ENERGY, ship.energy + KOHRAH_ENERGY_REGENERATION);
    ship.energyWait = KOHRAH_ENERGY_WAIT;
  }

  // ─── Primary weapon: Buzzsaw ──────────────────────────────────────────────
  // One buzzsaw per key-press (edge-triggered). Holding fire keeps the existing
  // buzzsaw alive; releasing lets it stop and home. A new one fires only on the
  // next key-down after a release.
  const fireNow = !!(input & INPUT_FIRE1);
  const fireJustPressed = fireNow && !ship.prevFireHeld;
  ship.prevFireHeld = fireNow;

  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if (fireJustPressed && ship.energy >= BUZZSAW_ENERGY_COST) {
    ship.energy -= BUZZSAW_ENERGY_COST;
    ship.weaponWait = BUZZSAW_WAIT;
    const launchAngle = (ship.facing * 4) & 63;
    const offsetW = BUZZSAW_OFFSET;
    spawns.push({
      type: 'buzzsaw',
      facing: ship.facing,
      x: ship.x + COSINE(launchAngle, offsetW),
      y: ship.y + SINE(launchAngle, offsetW),
      speed: BUZZSAW_SPEED,
      life: BUZZSAW_LIFE,
      damage: BUZZSAW_DAMAGE,
      hits: BUZZSAW_HITS,
      fireHeld: true,
    });
  }

  // ─── Secondary weapon: F.R.I.E.D. (ring of gas clouds) ─────────────────────
  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2) && ship.energy >= FRIED_ENERGY_COST) {
    ship.energy -= FRIED_ENERGY_COST;
    ship.specialWait = FRIED_WAIT;

    // Spawn a ring of 16 gas clouds
    const angleStep = 64 / NUM_GAS_CLOUDS; // 4 angle units per cloud
    for (let i = 0; i < NUM_GAS_CLOUDS; i++) {
      const cloudAngle = (i * angleStep) & 63;
      spawns.push({
        type: 'gas_cloud',
        x: ship.x,
        y: ship.y,
        facing: (cloudAngle * 16) / 64, // convert angle to facing
        speed: GAS_SPEED,
        damage: GAS_DAMAGE,
        hits: GAS_HITS,
        shipVelocity: { vx: ship.velocity.vx, vy: ship.velocity.vy },
      });
    }
  }

  return spawns;
}

// ─── Spawn request types ───────────────────────────────────────────────────────

// These are added to the SpawnRequest union type in human.ts
// buzzsaw: spinning disk projectile
// gas_cloud: fireball from F.R.I.E.D. ring
