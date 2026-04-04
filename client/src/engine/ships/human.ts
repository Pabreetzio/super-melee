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
import { loadCruiserSprites, drawSprite, placeholderDot, type CruiserSprites, type SpriteFrame } from '../sprites';
import type { ShipState, SpawnRequest, BattleMissile, DrawContext, ShipController, LaserFlash } from './types';

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
export const MISSILE_HITS       = 1;
export const MISSILE_DAMAGE     = 4;
export const TRACK_WAIT         = 3;
export const HUMAN_OFFSET       = 42;   // display pixels — nuke spawn offset from ship

// Point defense
export const SPECIAL_ENERGY_COST = 4;
export const SPECIAL_WAIT        = 9;
export const LASER_RANGE         = 100; // display pixels

// In velocity-unit² — threshold for capping acceleration at max speed
const MAX_SPEED_SQ = WORLD_TO_VELOCITY(MAX_THRUST) ** 2; // 768² = 589824

// ─── Backward-compat alias ────────────────────────────────────────────────────
// External code that imported HumanShipState or SpawnRequest from this module
// continues to work; new code should import from './types' directly.

export type { ShipState as HumanShipState };
export type { SpawnRequest };

// ─── Factory ──────────────────────────────────────────────────────────────────

export function makeHumanShip(x: number, y: number): ShipState {
  return {
    x, y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew:   MAX_CREW,
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

export function updateHumanShip(ship: ShipState, input: number): SpawnRequest[] {
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
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else {
      const currentSpeedSq = velocitySquared(ship.velocity);
      if (desiredSpeedSq < currentSpeedSq) {
        setVelocityComponents(ship.velocity, newDx, newDy);
      } else if (ship.velocity.travelAngle === angle) {
        setVelocityVector(ship.velocity, MAX_THRUST, ship.facing);
      } else {
        setVelocityComponents(ship.velocity, newDx, newDy);
        const spd = Math.sqrt(velocitySquared(ship.velocity));
        if (spd > 0) {
          const scale = WORLD_TO_VELOCITY(MAX_THRUST) / spd;
          setVelocityComponents(ship.velocity, ship.velocity.vx * scale, ship.velocity.vy * scale);
        }
      }
    }
  }

  // ─── Position advance ─────────────────────────────────────────────────────
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
    const offsetW = DISPLAY_TO_WORLD(HUMAN_OFFSET);
    spawns.push({
      type: 'missile',
      facing: ship.facing,
      x: ship.x + COSINE(launchAngle, offsetW),
      y: ship.y + SINE(launchAngle, offsetW),
      speed:    MISSILE_SPEED,
      maxSpeed: MAX_MISSILE_SPEED,
      accel:    THRUST_SCALE,
      life:     MISSILE_LIFE,
      hits:     MISSILE_HITS,
      damage:   MISSILE_DAMAGE,
      tracks:   true,
      trackRate: TRACK_WAIT,
    });
  }

  // ─── Secondary weapon: point-defense laser ────────────────────────────────
  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2) && ship.energy >= SPECIAL_ENERGY_COST) {
    spawns.push({ type: 'point_defense', x: ship.x, y: ship.y });
  }

  return spawns;
}

// ─── Shared tracking helper ───────────────────────────────────────────────────

export function trackFacing(facing: number, targetAngle: number): number {
  const targetFacing = ((targetAngle + 2) >> 2) & 15;
  const diff = (targetFacing - facing + 16) % 16;
  if (diff === 0) return facing;
  if (diff <= 8) return (facing + 1) % 16;
  return (facing - 1 + 16) % 16;
}

// ─── Nuke preprocess ─────────────────────────────────────────────────────────

export interface NukeState {
  x: number; y: number;
  facing: number;
  trackWait: number;
  life: number;
  velocity: VelocityDesc;
}

export function makeNuke(x: number, y: number, facing: number): NukeState {
  const v: VelocityDesc = { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 };
  setVelocityVector(v, MISSILE_SPEED, facing);
  return { x, y, facing, trackWait: TRACK_WAIT, life: MISSILE_LIFE, velocity: v };
}

export function updateNuke(nuke: NukeState, targetAngle: number | null): boolean {
  nuke.life--;
  if (nuke.life <= 0) return false;

  if (nuke.trackWait > 0) {
    nuke.trackWait--;
  } else if (targetAngle !== null) {
    nuke.facing = trackFacing(nuke.facing, targetAngle);
    nuke.trackWait = TRACK_WAIT;
  }

  const elapsed = MISSILE_LIFE - nuke.life;
  const speed = Math.min(MISSILE_SPEED + elapsed * THRUST_SCALE, MAX_MISSILE_SPEED);
  setVelocityVector(nuke.velocity, speed, nuke.facing);

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

  return true;
}

// ─── Ship controller ─────────────────────────────────────────────────────────

export const humanController: ShipController = {
  maxCrew:   MAX_CREW,
  maxEnergy: MAX_ENERGY,

  make: makeHumanShip,
  update: updateHumanShip,

  loadSprites: () => loadCruiserSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as CruiserSprites | null;
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
    const sp = sprites as CruiserSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as CruiserSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.nuke.sml : dc.reduction === 1 ? sp.nuke.med : sp.nuke.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, m.facing, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 3, '#ff8', dc.reduction);
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as CruiserSprites | null;
    return sp?.nuke.big.frames[m.facing] ?? null;
  },

  applySpawn(
    s: SpawnRequest,
    ownShip: ShipState,
    enemyShip: ShipState,
    ownSide: 0 | 1,
    missiles: BattleMissile[],
    addLaser: (l: LaserFlash) => void,
  ): void {
    if (s.type !== 'point_defense') return;

    // Faithful port of UQM spawn_point_defense (human.c).
    //
    // Fires at every collidable object within LASER_RANGE display px:
    //   • enemy missiles (destroyed on hit)
    //   • enemy ship (1 crew damage on hit)
    //
    // Energy and cooldown use a PaidFor flag — deducted only on the FIRST hit.
    // If nothing is in range: no energy spent, no cooldown set (free to spam).
    const rangeWSq = DISPLAY_TO_WORLD(LASER_RANGE) ** 2;
    let paidFor = false;

    function payOnce() {
      if (paidFor) return;
      ownShip.energy -= SPECIAL_ENERGY_COST;
      ownShip.specialWait = SPECIAL_WAIT;
      paidFor = true;
    }

    // Enemy missiles
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      if (m.owner === ownSide) continue; // never fire at own missiles
      const dx = m.x - ownShip.x;
      const dy = m.y - ownShip.y;
      if (dx * dx + dy * dy <= rangeWSq) {
        payOnce();
        addLaser({ x1: ownShip.x, y1: ownShip.y, x2: m.x, y2: m.y });
        missiles.splice(i, 1);
      }
    }

    // Enemy ship
    {
      const dx = enemyShip.x - ownShip.x;
      const dy = enemyShip.y - ownShip.y;
      if (dx * dx + dy * dy <= rangeWSq) {
        payOnce();
        addLaser({ x1: ownShip.x, y1: ownShip.y, x2: enemyShip.x, y2: enemyShip.y });
        enemyShip.crew = Math.max(0, enemyShip.crew - 1);
      }
    }
  },
};
