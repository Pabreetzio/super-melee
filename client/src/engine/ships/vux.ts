// VUX Intruder — ported from uqm-0.8.0/src/uqm/ships/vux/vux.c
//
// Primary (FIRES_FORE, IMMEDIATE_WEAPON): Forward laser
// Special (SEEKING_SPECIAL): Limpets — tracking missiles; on hit apply movement impairment

import {
  WORLD_TO_VELOCITY, VELOCITY_TO_WORLD, DISPLAY_TO_WORLD,
  setVelocityVector,
  setVelocityComponents, getCurrentVelocityComponents,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2 } from '../game';
import type { HumanShipState } from './human';
import type { SpawnRequest } from './human';

// ─── Constants (from vux.c) ───────────────────────────────────────────────────

export const VUX_MAX_CREW            = 20;
export const VUX_MAX_ENERGY          = 40;
export const VUX_ENERGY_REGENERATION = 1;
export const VUX_ENERGY_WAIT         = 8;
export const VUX_MAX_THRUST          = 21;  // not DISPLAY_TO_WORLD — raw value
export const VUX_THRUST_INCREMENT    = 7;
export const VUX_THRUST_WAIT         = 4;
export const VUX_TURN_WAIT           = 6;
export const VUX_SHIP_MASS           = 6;

// Laser (primary)
export const VUX_WEAPON_ENERGY_COST = 1;
export const VUX_WEAPON_WAIT        = 0;
export const VUX_OFFSET             = DISPLAY_TO_WORLD(12);  // 48 world units
export const VUX_LASER_BASE         = 150; // display pixels
export const VUX_LASER_RANGE        = DISPLAY_TO_WORLD(VUX_LASER_BASE + 12); // 648 world units

// Limpets (special)
export const VUX_SPECIAL_ENERGY_COST = 2;
export const VUX_SPECIAL_WAIT        = 7;
export const LIMPET_SPEED            = 25; // world units (raw, not DISPLAY_TO_WORLD)
export const LIMPET_OFFSET           = DISPLAY_TO_WORLD(8); // 32 world units
export const LIMPET_LIFE             = 80;
export const LIMPET_DAMAGE           = 1;  // simplified: 1 crew on hit

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(VUX_MAX_THRUST) ** 2;

// ─── Factory ──────────────────────────────────────────────────────────────────

export function makeVuxShip(x: number, y: number): HumanShipState {
  return {
    x, y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew:   VUX_MAX_CREW,
    energy: VUX_MAX_ENERGY,
    thrustWait:  0,
    turnWait:    0,
    weaponWait:  0,
    specialWait: 0,
    energyWait:  0,
    thrusting: false,
  };
}

// ─── Per-frame update ─────────────────────────────────────────────────────────

export function updateVuxShip(ship: HumanShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  // ─── Turning ─────────────────────────────────────────────────────────────
  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing - 1 + 16) % 16;
      ship.turnWait = VUX_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) % 16;
      ship.turnWait = VUX_TURN_WAIT;
    }
  }

  // ─── Thrust ───────────────────────────────────────────────────────────────
  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = VUX_THRUST_WAIT;

    const angle = (ship.facing * 4) & 63;
    const incV  = WORLD_TO_VELOCITY(VUX_THRUST_INCREMENT);
    const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
    const newDx = curDx + COSINE(angle, incV);
    const newDy = curDy + SINE(angle, incV);
    const desiredSpeedSq = newDx * newDx + newDy * newDy;

    if (desiredSpeedSq <= MAX_SPEED_SQ) {
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else {
      if (ship.velocity.travelAngle === angle) {
        setVelocityVector(ship.velocity, VUX_MAX_THRUST, ship.facing);
      } else {
        setVelocityComponents(ship.velocity, newDx, newDy);
        const { vx, vy } = ship.velocity;
        const spd = Math.sqrt(vx * vx + vy * vy);
        if (spd > 0) {
          const scale = WORLD_TO_VELOCITY(VUX_MAX_THRUST) / spd;
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

  // ─── Energy regeneration ──────────────────────────────────────────────────
  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < VUX_MAX_ENERGY) {
    ship.energy = Math.min(VUX_MAX_ENERGY, ship.energy + VUX_ENERGY_REGENERATION);
    ship.energyWait = VUX_ENERGY_WAIT;
  }

  // ─── Primary: Forward laser ───────────────────────────────────────────────
  // Fires a laser line from ship in facing direction.
  // In Battle.tsx, applyVuxLaser handles collision + LaserFlash creation.
  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if ((input & INPUT_FIRE1) && ship.energy >= VUX_WEAPON_ENERGY_COST) {
    ship.energy -= VUX_WEAPON_ENERGY_COST;
    ship.weaponWait = VUX_WEAPON_WAIT;
    const angle = (ship.facing * 4) & 63;
    spawns.push({
      type: 'vux_laser',
      x: ship.x + COSINE(angle, VUX_OFFSET),
      y: ship.y + SINE(angle, VUX_OFFSET),
      facing: ship.facing,
    });
  }

  // ─── Special: Launch limpet ───────────────────────────────────────────────
  // Spawns from rear, tracks enemy. On hit: 1 crew damage + movement impairment.
  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2) && ship.energy >= VUX_SPECIAL_ENERGY_COST) {
    ship.energy -= VUX_SPECIAL_ENERGY_COST;
    ship.specialWait = VUX_SPECIAL_WAIT;
    const rearFacing = (ship.facing + 8) & 15;
    const rearAngle  = (rearFacing * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(rearAngle, LIMPET_OFFSET),
      y: ship.y + SINE(rearAngle, LIMPET_OFFSET),
      facing: rearFacing,
      speed:    LIMPET_SPEED,
      maxSpeed: LIMPET_SPEED,
      accel:    0,
      life:     LIMPET_LIFE,
      damage:   LIMPET_DAMAGE,
      tracks:   true,
      trackRate: 1,
      limpet:   true,
    });
  }

  return spawns;
}
