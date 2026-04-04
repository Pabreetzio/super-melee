// Mycon Podship — ported from uqm-0.8.0/src/uqm/ships/mycon/mycon.c
//
// Primary (SEEKING_WEAPON): Plasmoid — slow homing blob that decays in damage
// Special: Regeneration — spend a full battery to restore crew

import {
  WORLD_TO_VELOCITY, VELOCITY_TO_WORLD, DISPLAY_TO_WORLD,
  setVelocityVector,
  setVelocityComponents, getCurrentVelocityComponents,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2 } from '../game';
import { loadMyconSprites, drawSprite, placeholderDot, type MyconSprites, type SpriteFrame } from '../sprites';
import type { ShipState, SpawnRequest, BattleMissile, DrawContext, ShipController, MissileEffect, MissileHitEffect } from './types';
import { trackFacing } from './human';
import { worldAngle as battleWorldAngle } from '../battle/helpers';

export type { ShipState as HumanShipState };

// ─── Constants (from mycon.c) ────────────────────────────────────────────────

export const MYCON_MAX_CREW            = 20;
export const MYCON_MAX_ENERGY          = 40;
export const MYCON_ENERGY_REGENERATION = 1;
export const MYCON_ENERGY_WAIT         = 4;
export const MYCON_MAX_THRUST          = 27;
export const MYCON_THRUST_INCREMENT    = 9;
export const MYCON_THRUST_WAIT         = 6;
export const MYCON_TURN_WAIT           = 6;
export const MYCON_SHIP_MASS           = 7;

export const MYCON_WEAPON_ENERGY_COST = 20;
export const MYCON_WEAPON_WAIT        = 5;
export const MYCON_OFFSET             = DISPLAY_TO_WORLD(24);
export const MYCON_MISSILE_SPEED      = DISPLAY_TO_WORLD(8);
export const MYCON_MISSILE_DAMAGE     = 10;
export const MYCON_TRACK_WAIT         = 1;
export const NUM_PLASMAS              = 11;
export const PLASMA_DURATION          = 13;
export const MYCON_MISSILE_LIFE       = NUM_PLASMAS * PLASMA_DURATION;

export const MYCON_SPECIAL_ENERGY_COST = MYCON_MAX_ENERGY;
export const MYCON_SPECIAL_WAIT        = 0;
export const REGENERATION_AMOUNT       = 4;

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(MYCON_MAX_THRUST) ** 2;

// ─── Factory ──────────────────────────────────────────────────────────────────

export function makeMyconShip(x: number, y: number): ShipState {
  return {
    x, y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew:   MYCON_MAX_CREW,
    energy: MYCON_MAX_ENERGY,
    thrustWait:  0,
    turnWait:    0,
    weaponWait:  0,
    specialWait: 0,
    energyWait:  0,
    thrusting: false,
  };
}

// ─── Per-frame update ─────────────────────────────────────────────────────────

export function updateMyconShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing - 1 + 16) % 16;
      ship.turnWait = MYCON_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) % 16;
      ship.turnWait = MYCON_TURN_WAIT;
    }
  }

  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = MYCON_THRUST_WAIT;

    const angle = (ship.facing * 4) & 63;
    const incV  = WORLD_TO_VELOCITY(MYCON_THRUST_INCREMENT);
    const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
    const newDx = curDx + COSINE(angle, incV);
    const newDy = curDy + SINE(angle, incV);
    const desiredSpeedSq = newDx * newDx + newDy * newDy;

    if (desiredSpeedSq <= MAX_SPEED_SQ) {
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else if (ship.velocity.travelAngle === angle) {
      setVelocityVector(ship.velocity, MYCON_MAX_THRUST, ship.facing);
    } else {
      setVelocityComponents(ship.velocity, newDx, newDy);
      const { vx, vy } = ship.velocity;
      const spd = Math.sqrt(vx * vx + vy * vy);
      if (spd > 0) {
        const scale = WORLD_TO_VELOCITY(MYCON_MAX_THRUST) / spd;
        setVelocityComponents(ship.velocity, vx * scale, vy * scale);
      }
    }
  }

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

  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < MYCON_MAX_ENERGY) {
    ship.energy = Math.min(MYCON_MAX_ENERGY, ship.energy + MYCON_ENERGY_REGENERATION);
    ship.energyWait = MYCON_ENERGY_WAIT;
  }

  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if ((input & INPUT_FIRE1) && ship.energy >= MYCON_WEAPON_ENERGY_COST) {
    ship.energy -= MYCON_WEAPON_ENERGY_COST;
    ship.weaponWait = MYCON_WEAPON_WAIT;
    const angle = (ship.facing * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(angle, MYCON_OFFSET),
      y: ship.y + SINE(angle, MYCON_OFFSET),
      facing: ship.facing,
      speed: MYCON_MISSILE_SPEED,
      maxSpeed: MYCON_MISSILE_SPEED,
      accel: 0,
      life: MYCON_MISSILE_LIFE,
      hits: MYCON_MISSILE_DAMAGE,
      damage: MYCON_MISSILE_DAMAGE,
      tracks: true,
      trackRate: MYCON_TRACK_WAIT,
      initialTrackWait: MYCON_TRACK_WAIT + 2,
      weaponType: 'plasmoid',
    });
  }

  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2)
          && ship.energy >= MYCON_SPECIAL_ENERGY_COST
          && ship.crew < MYCON_MAX_CREW) {
    ship.energy -= MYCON_SPECIAL_ENERGY_COST;
    ship.specialWait = MYCON_SPECIAL_WAIT;
    ship.crew = Math.min(MYCON_MAX_CREW, ship.crew + REGENERATION_AMOUNT);
    spawns.push({ type: 'sound', sound: 'secondary' });
  }

  return spawns;
}

function plasmoidDamageFromLife(life: number): number {
  return Math.max(1, Math.ceil((life * MYCON_MISSILE_DAMAGE) / MYCON_MISSILE_LIFE));
}

function plasmoidRadiusDisplayPx(m: BattleMissile): number {
  const damage = plasmoidDamageFromLife(m.life);
  if (damage >= 9) return 7;
  if (damage >= 7) return 6;
  if (damage >= 5) return 5;
  if (damage >= 3) return 4;
  return 3;
}

function plasmoidFrameIndex(m: BattleMissile): number {
  const index = NUM_PLASMAS - Math.ceil(m.life / PLASMA_DURATION);
  return Math.max(0, Math.min(NUM_PLASMAS - 1, index));
}

// ─── Ship controller ─────────────────────────────────────────────────────────

export const myconController: ShipController = {
  maxCrew:   MYCON_MAX_CREW,
  maxEnergy: MYCON_MAX_ENERGY,

  make: makeMyconShip,
  update: updateMyconShip,

  loadSprites: () => loadMyconSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as MyconSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, '#4af', dc.reduction);
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as MyconSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    if (m.weaponType !== 'plasmoid') {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 3, '#ffb347', dc.reduction);
      return;
    }
    const sp = sprites as MyconSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.plasma.sml : dc.reduction === 1 ? sp.plasma.med : sp.plasma.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, plasmoidFrameIndex(m), m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, plasmoidRadiusDisplayPx(m), '#ff9a3c', dc.reduction);
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    if (m.weaponType !== 'plasmoid') return null;
    const sp = sprites as MyconSprites | null;
    return sp?.plasma.big.frames[plasmoidFrameIndex(m)] ?? null;
  },

  processMissile(m: BattleMissile, _ownShip: ShipState, enemyShip: ShipState, _input: number): MissileEffect {
    if (m.weaponType !== 'plasmoid') return {};

    // Replicate UQM's plasma_preprocess damage/HP decay.
    // m.damage holds last frame's hit_points. If the plasma was hit since last
    // frame, m.hitPoints < m.damage — shorten life span proportionally, exactly
    // as UQM does: life_span = hit_points * PLASMA_DURATION.
    if (m.damage > m.hitPoints) {
      m.life = m.hitPoints * PLASMA_DURATION;
    }
    // Both HP and damage decay together from the current (possibly shortened) life.
    const newHP = plasmoidDamageFromLife(m.life);
    m.hitPoints = newHP;
    m.damage = newHP;

    if (m.trackWait > 0) {
      m.trackWait--;
    } else {
      const targetAngle = battleWorldAngle(m.x, m.y, enemyShip.x, enemyShip.y);
      m.facing = trackFacing(m.facing, targetAngle);
      m.trackWait = m.trackRate;
    }

    return {
      skipDefaultTracking: true,
    };
  },

  onMissileHit(m: BattleMissile, _target: ShipState | null): MissileHitEffect {
    if (m.weaponType === 'plasmoid') return { explosionType: 'mycon_plasma' };
    return {};
  },
};
