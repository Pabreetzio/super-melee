// Ur-Quan Dreadnought — ported from uqm-0.8.0/src/uqm/ships/urquan/urquan.c
//
// Primary (FIRES_FORE):  Fusion Blast — forward non-tracking missile
// Special (SEEKING_SPECIAL): Fighters — two autonomous craft launched from rear

import {
  WORLD_TO_VELOCITY, VELOCITY_TO_WORLD, DISPLAY_TO_WORLD,
  setVelocityVector,
  setVelocityComponents, getCurrentVelocityComponents,
} from '../velocity';
import { COSINE, SINE, tableAngle } from '../sinetab';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2 } from '../game';
import { loadUrquanSprites, drawSprite, placeholderDot, type UrquanSprites } from '../sprites';
import type { ShipState, SpawnRequest, BattleMissile, DrawContext, ShipController, MissileEffect } from './types';

export type { ShipState as HumanShipState };

// ─── Constants (from urquan.c) ────────────────────────────────────────────────

export const URQUAN_MAX_CREW            = 42;
export const URQUAN_MAX_ENERGY          = 42;
export const URQUAN_ENERGY_REGENERATION = 1;
export const URQUAN_ENERGY_WAIT         = 4;
export const URQUAN_MAX_THRUST          = 30;
export const URQUAN_THRUST_INCREMENT    = 6;
export const URQUAN_THRUST_WAIT         = 6;
export const URQUAN_TURN_WAIT           = 4;
export const URQUAN_SHIP_MASS           = 10;

// Fusion blast (primary)
export const URQUAN_WEAPON_ENERGY_COST = 6;
export const URQUAN_WEAPON_WAIT        = 6;
export const URQUAN_MISSILE_SPEED      = DISPLAY_TO_WORLD(20); // 80 world units
export const URQUAN_MISSILE_LIFE       = 20;
export const URQUAN_MISSILE_DAMAGE     = 6;
export const URQUAN_OFFSET             = DISPLAY_TO_WORLD(32); // 128 world units

// Fighters (special)
export const URQUAN_SPECIAL_ENERGY_COST = 8;
export const URQUAN_SPECIAL_WAIT        = 9;
export const FIGHTER_SPEED              = DISPLAY_TO_WORLD(8);  // 32 world units
export const FIGHTER_OFFSET             = DISPLAY_TO_WORLD(14); // 56 world units (spawn offset behind ship)
export const ONE_WAY_FLIGHT             = 125;  // frames before returning to mothership
export const FIGHTER_LIFE               = ONE_WAY_FLIGHT + ONE_WAY_FLIGHT + 150; // 400 frames
export const FIGHTER_LASER_RANGE        = DISPLAY_TO_WORLD(44); // 176 world units
export const FIGHTER_WEAPON_WAIT        = 8;

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(URQUAN_MAX_THRUST) ** 2;

// ─── Factory ──────────────────────────────────────────────────────────────────

export function makeUrquanShip(x: number, y: number): ShipState {
  return {
    x, y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew:   URQUAN_MAX_CREW,
    energy: URQUAN_MAX_ENERGY,
    thrustWait:  0,
    turnWait:    0,
    weaponWait:  0,
    specialWait: 0,
    energyWait:  0,
    thrusting: false,
  };
}

// ─── Per-frame update ─────────────────────────────────────────────────────────

export function updateUrquanShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  // ─── Turning ─────────────────────────────────────────────────────────────
  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing - 1 + 16) % 16;
      ship.turnWait = URQUAN_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) % 16;
      ship.turnWait = URQUAN_TURN_WAIT;
    }
  }

  // ─── Thrust ───────────────────────────────────────────────────────────────
  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = URQUAN_THRUST_WAIT;

    const angle = (ship.facing * 4) & 63;
    const incV  = WORLD_TO_VELOCITY(URQUAN_THRUST_INCREMENT);
    const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
    const newDx = curDx + COSINE(angle, incV);
    const newDy = curDy + SINE(angle, incV);
    const desiredSpeedSq = newDx * newDx + newDy * newDy;

    if (desiredSpeedSq <= MAX_SPEED_SQ) {
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else {
      if (ship.velocity.travelAngle === angle) {
        setVelocityVector(ship.velocity, URQUAN_MAX_THRUST, ship.facing);
      } else {
        setVelocityComponents(ship.velocity, newDx, newDy);
        const { vx, vy } = ship.velocity;
        const spd = Math.sqrt(vx * vx + vy * vy);
        if (spd > 0) {
          const scale = WORLD_TO_VELOCITY(URQUAN_MAX_THRUST) / spd;
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
  } else if (ship.energy < URQUAN_MAX_ENERGY) {
    ship.energy = Math.min(URQUAN_MAX_ENERGY, ship.energy + URQUAN_ENERGY_REGENERATION);
    ship.energyWait = URQUAN_ENERGY_WAIT;
  }

  // ─── Primary: Fusion Blast ────────────────────────────────────────────────
  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if ((input & INPUT_FIRE1) && ship.energy >= URQUAN_WEAPON_ENERGY_COST) {
    ship.energy -= URQUAN_WEAPON_ENERGY_COST;
    ship.weaponWait = URQUAN_WEAPON_WAIT;
    const angle = (ship.facing * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(angle, URQUAN_OFFSET),
      y: ship.y + SINE(angle, URQUAN_OFFSET),
      facing: ship.facing,
      speed:    URQUAN_MISSILE_SPEED,
      maxSpeed: URQUAN_MISSILE_SPEED,
      accel:    0,
      life:     URQUAN_MISSILE_LIFE,
      damage:   URQUAN_MISSILE_DAMAGE,
      tracks:   false,
      trackRate: 0,
    });
  }

  // ─── Special: Launch Fighters ─────────────────────────────────────────────
  // UQM spawns 2 fighters (if crew > 2) from rear, slightly offset L/R.
  // Each costs 1 crew on launch; SPECIAL_ENERGY_COST is reserved for cooldown.
  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2) && ship.energy >= URQUAN_SPECIAL_ENERGY_COST
             && ship.crew > 2) {
    ship.energy -= URQUAN_SPECIAL_ENERGY_COST;
    ship.specialWait = URQUAN_SPECIAL_WAIT;
    // Rear facing (180° from ship facing)
    const rearFacing = (ship.facing + 8) & 15;
    const rearAngle  = (rearFacing * 4) & 63;
    const dx = COSINE(rearAngle, FIGHTER_OFFSET);
    const dy = SINE(rearAngle, FIGHTER_OFFSET);

    // Two fighters: one slightly left, one slightly right of rear centerline
    const f1Facing = (rearFacing + 2) & 15;
    const f2Facing = (rearFacing - 2 + 16) & 15;

    // Spawn both — each costs 1 crew
    ship.crew -= 2;
    spawns.push({
      type: 'fighter',
      x: ship.x + dx - dy,
      y: ship.y + dy + dx,
      facing: f1Facing,
      speed: FIGHTER_SPEED,
      life: FIGHTER_LIFE,
    });
    spawns.push({
      type: 'fighter',
      x: ship.x + dx + dy,
      y: ship.y + dy - dx,
      facing: f2Facing,
      speed: FIGHTER_SPEED,
      life: FIGHTER_LIFE,
    });
  }

  return spawns;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function worldAngle(x1: number, y1: number, x2: number, y2: number): number {
  return tableAngle(x2 - x1, y2 - y1);
}

function trackFacing(facing: number, targetAngle: number): number {
  const targetFacing = ((targetAngle + 2) >> 2) & 15;
  const diff = (targetFacing - facing + 16) % 16;
  if (diff === 0) return facing;
  if (diff <= 8) return (facing + 1) % 16;
  return (facing - 1 + 16) % 16;
}

// ─── Ship controller ─────────────────────────────────────────────────────────

export const urquanController: ShipController = {
  maxCrew:   URQUAN_MAX_CREW,
  maxEnergy: URQUAN_MAX_ENERGY,

  make: makeUrquanShip,
  update: updateUrquanShip,

  loadSprites: () => loadUrquanSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as UrquanSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, '#4af', dc.reduction);
    }
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as UrquanSprites | null;
    if (m.weaponType === 'fighter') {
      // UrquanSprites has a .fighter sub-bundle
      const group = sp?.fighter ?? null;
      const set = group
        ? (dc.reduction >= 2 ? group.sml : dc.reduction === 1 ? group.med : group.big) as Parameters<typeof drawSprite>[1] | null
        : null;
      if (set) {
        drawSprite(dc.ctx, set, m.facing, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
      } else {
        placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 3, '#8ff', dc.reduction);
      }
      return;
    }
    // Fusion blast
    const group = sp ? sp.fusion : null;
    const set = group
      ? (dc.reduction >= 2 ? group.sml : dc.reduction === 1 ? group.med : group.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, m.facing, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 3, '#ff8', dc.reduction);
    }
  },

  processMissile(m: BattleMissile, ownShip: ShipState, enemyShip: ShipState, _input: number): MissileEffect {
    if (m.weaponType !== 'fighter') return {};

    // ── Fighter AI (ported from Battle.tsx fighter update block) ─────────────
    // Phase: if life is low enough to return, track mothership; else track enemy
    const returning = m.life < ONE_WAY_FLIGHT && ownShip.crew > 0;
    const navTarget = returning ? ownShip : enemyShip;

    // Turn toward nav target and set velocity
    const targetAngle = worldAngle(m.x, m.y, navTarget.x, navTarget.y);
    m.facing = trackFacing(m.facing, targetAngle);
    setVelocityVector(m.velocity, FIGHTER_SPEED, m.facing);

    const effect: MissileEffect = {
      skipDefaultTracking: true,
      skipVelocityUpdate:  true,  // fighter manages its own velocity above
    };

    // Weapon cooldown tick
    if ((m.weaponWait ?? 0) > 0) {
      m.weaponWait = (m.weaponWait ?? 0) - 1;
    }

    // Fighter laser: fire when enemy within 3/4 of laser range
    if (!returning && (m.weaponWait ?? 0) === 0) {
      const dx = enemyShip.x - m.x;
      const dy = enemyShip.y - m.y;
      const laserRangeSq = (FIGHTER_LASER_RANGE * 3 / 4) ** 2;
      if (dx * dx + dy * dy < laserRangeSq) {
        const laserAngle = worldAngle(m.x, m.y, enemyShip.x, enemyShip.y);
        const lx = COSINE(laserAngle, FIGHTER_LASER_RANGE);
        const ly = SINE(laserAngle, FIGHTER_LASER_RANGE);
        effect.lasers      = [{ x1: m.x, y1: m.y, x2: m.x + lx, y2: m.y + ly }];
        effect.damageEnemy = 1;
        effect.sounds      = ['fighter_laser'];
        m.weaponWait       = FIGHTER_WEAPON_WAIT;
      }
    }

    // Returning fighter: dock if it reaches mothership (restores 1 crew)
    if (returning) {
      const dx = ownShip.x - m.x;
      const dy = ownShip.y - m.y;
      if (dx * dx + dy * dy < DISPLAY_TO_WORLD(14) ** 2) { // SHIP_RADIUS = 14 px
        effect.destroy = true;
        effect.healOwn = 1;
        effect.sounds  = ['fighter_dock'];
      }
    }

    return effect;
  },
};
