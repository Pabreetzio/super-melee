// Pkunk Fury — ported from uqm-0.8.0/src/uqm/ships/pkunk/pkunk.c
//
// Primary (FIRES_FORE | FIRES_LEFT | FIRES_RIGHT): Triple bug-gun burst
// Special: Taunt (2 energy, cosmetic — no combat effect in this port)
// Passive: Resurrection — 50% chance to respawn with full stats on death

import {
  WORLD_TO_VELOCITY, VELOCITY_TO_WORLD, DISPLAY_TO_WORLD,
  setVelocityVector,
  setVelocityComponents, getCurrentVelocityComponents,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2 } from '../game';
import type { HumanShipState } from './human';
import type { SpawnRequest } from './human';

// ─── Constants (from pkunk.c) ─────────────────────────────────────────────────

export const PKUNK_MAX_CREW            = 8;
export const PKUNK_MAX_ENERGY          = 12;
export const PKUNK_ENERGY_REGENERATION = 0;  // NO regen
export const PKUNK_MAX_THRUST          = 64;
export const PKUNK_THRUST_INCREMENT    = 16;
export const PKUNK_THRUST_WAIT         = 0;  // instant thrust
export const PKUNK_TURN_WAIT           = 0;  // instant turn
export const PKUNK_SHIP_MASS           = 1;

// Triple bug-gun (primary)
export const PKUNK_WEAPON_ENERGY_COST = 1;
export const PKUNK_WEAPON_WAIT        = 0;   // fires every frame while held
export const PKUNK_OFFSET             = DISPLAY_TO_WORLD(15); // 60 world units
export const PKUNK_MISSILE_SPEED      = DISPLAY_TO_WORLD(24); // 96 world units
export const PKUNK_MISSILE_LIFE       = 5;
export const PKUNK_MISSILE_DAMAGE     = 1;

// Taunt (special — cosmetic in this port)
export const PKUNK_SPECIAL_ENERGY_COST = 2;
export const PKUNK_SPECIAL_WAIT        = 0;

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(PKUNK_MAX_THRUST) ** 2;

// ─── Extended state ───────────────────────────────────────────────────────────

// Pkunk needs a `canResurrect` flag beyond the base HumanShipState fields.
// We store it as a side-channel here; Battle.tsx reads it on crew==0.
export interface PkunkShipState extends HumanShipState {
  canResurrect: boolean;
}

export function makePkunkShip(x: number, y: number, rng: () => number): PkunkShipState {
  return {
    x, y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew:   PKUNK_MAX_CREW,
    energy: PKUNK_MAX_ENERGY,
    thrustWait:  0,
    turnWait:    0,
    weaponWait:  0,
    specialWait: 0,
    energyWait:  0,
    thrusting: false,
    canResurrect: rng() < 0.5, // 50% chance, rolled at spawn
  };
}

// ─── Per-frame update ─────────────────────────────────────────────────────────

export function updatePkunkShip(
  ship: HumanShipState,
  input: number,
): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  // ─── Turning (TURN_WAIT = 0, instant) ────────────────────────────────────
  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing - 1 + 16) % 16;
      ship.turnWait = PKUNK_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) % 16;
      ship.turnWait = PKUNK_TURN_WAIT;
    }
  }

  // ─── Thrust (THRUST_WAIT = 0, instant) ───────────────────────────────────
  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = PKUNK_THRUST_WAIT;

    const angle = (ship.facing * 4) & 63;
    const incV  = WORLD_TO_VELOCITY(PKUNK_THRUST_INCREMENT);
    const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
    const newDx = curDx + COSINE(angle, incV);
    const newDy = curDy + SINE(angle, incV);
    const desiredSpeedSq = newDx * newDx + newDy * newDy;

    if (desiredSpeedSq <= MAX_SPEED_SQ) {
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else {
      if (ship.velocity.travelAngle === angle) {
        setVelocityVector(ship.velocity, PKUNK_MAX_THRUST, ship.facing);
      } else {
        setVelocityComponents(ship.velocity, newDx, newDy);
        const { vx, vy } = ship.velocity;
        const spd = Math.sqrt(vx * vx + vy * vy);
        if (spd > 0) {
          const scale = WORLD_TO_VELOCITY(PKUNK_MAX_THRUST) / spd;
          setVelocityComponents(ship.velocity, vx * scale, vy * scale);
        }
      }
    }
  }

  // ─── Position advance ─────────────────────────────────────────────────────
  {
    const fracX = Math.abs(ship.velocity.vx) & 31;
    ship.velocity.ex += fracX;
    const carryX = ship.velocity.ex >= 32 ? 1 : 0;
    ship.velocity.ex &= 31;
    ship.x += VELOCITY_TO_WORLD(Math.abs(ship.velocity.vx)) * Math.sign(ship.velocity.vx)
              + (ship.velocity.vx >= 0 ? carryX : -carryX);

    const fracY = Math.abs(ship.velocity.vy) & 31;
    ship.velocity.ey += fracY;
    const carryY = ship.velocity.ey >= 32 ? 1 : 0;
    ship.velocity.ey &= 31;
    ship.y += VELOCITY_TO_WORLD(Math.abs(ship.velocity.vy)) * Math.sign(ship.velocity.vy)
              + (ship.velocity.vy >= 0 ? carryY : -carryY);
  }

  // No energy regeneration for Pkunk (ENERGY_REGENERATION = 0)

  // ─── Primary: Triple bug-gun ──────────────────────────────────────────────
  // Fires 3 missiles: forward, +90° (right), -90° (left)
  // Each missile inherits ship velocity (inheritVelocity: true)
  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if ((input & INPUT_FIRE1) && ship.energy >= PKUNK_WEAPON_ENERGY_COST) {
    ship.energy -= PKUNK_WEAPON_ENERGY_COST;
    ship.weaponWait = PKUNK_WEAPON_WAIT;

    // Three facings: forward (0), right (+4), left (+12)
    const facingOffsets = [0, 4, 12] as const;
    for (const offset of facingOffsets) {
      const face = (ship.facing + offset) & 15;
      const angle = (face * 4) & 63;
      spawns.push({
        type: 'missile',
        x: ship.x + COSINE(angle, PKUNK_OFFSET),
        y: ship.y + SINE(angle, PKUNK_OFFSET),
        facing: face,
        speed:    PKUNK_MISSILE_SPEED,
        maxSpeed: PKUNK_MISSILE_SPEED,
        accel:    0,
        life:     PKUNK_MISSILE_LIFE,
        damage:   PKUNK_MISSILE_DAMAGE,
        tracks:   false,
        trackRate: 0,
        inheritVelocity: true,
      });
    }
  }

  // ─── Special: Taunt ───────────────────────────────────────────────────────
  // Cosmetic only in this port (no gameplay effect).
  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2) && ship.energy >= PKUNK_SPECIAL_ENERGY_COST) {
    ship.energy -= PKUNK_SPECIAL_ENERGY_COST;
    ship.specialWait = PKUNK_SPECIAL_WAIT;
    // No spawn — Taunt is cosmetic
  }

  return spawns;
}
