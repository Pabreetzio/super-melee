// Supox Blade — ported from uqm-0.8.0/src/uqm/ships/supox/supox.c
//
// Primary: forward glob launcher
// Special: free lateral / reverse inertial thrust that repurposes move inputs

import type { AIDifficulty } from 'shared/types';
import { INPUT_FIRE1, INPUT_FIRE2, INPUT_LEFT, INPUT_RIGHT, INPUT_THRUST } from '../game';
import {
  DISPLAY_TO_WORLD,
  VELOCITY_TO_WORLD,
  WORLD_TO_VELOCITY,
  getCurrentVelocityComponents,
  setVelocityComponents,
  setVelocityVector,
  velocitySquared,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import {
  drawSprite,
  loadSupoxSprites,
  placeholderDot,
  type SpriteFrame,
  type SupoxSprites,
} from '../sprites';
import type {
  BattleMissile,
  DrawContext,
  MissileHitEffect,
  ShipController,
  ShipState,
  SpawnRequest,
} from './types';
import { worldAngle, worldDelta } from '../battle/helpers';

export const SUPOX_MAX_CREW = 12;
export const SUPOX_MAX_ENERGY = 16;
export const SUPOX_ENERGY_REGENERATION = 1;
export const SUPOX_ENERGY_WAIT = 4;
export const SUPOX_MAX_THRUST = 40;
export const SUPOX_THRUST_INCREMENT = 8;
export const SUPOX_THRUST_WAIT = 0;
export const SUPOX_TURN_WAIT = 1;

export const SUPOX_WEAPON_ENERGY_COST = 1;
export const SUPOX_WEAPON_WAIT = 2;
export const SUPOX_WEAPON_OFFSET = DISPLAY_TO_WORLD(23);
export const SUPOX_MISSILE_SPEED = DISPLAY_TO_WORLD(30);
export const SUPOX_MISSILE_LIFE = 10;
export const SUPOX_MISSILE_HITS = 1;
export const SUPOX_MISSILE_DAMAGE = 1;

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(SUPOX_MAX_THRUST) ** 2;

function advancePosition(ship: ShipState): void {
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

function applyThrustAlongFacing(ship: ShipState, facing: number): void {
  const angle = (facing * 4) & 63;
  const incV = WORLD_TO_VELOCITY(SUPOX_THRUST_INCREMENT);
  const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
  const newDx = curDx + COSINE(angle, incV);
  const newDy = curDy + SINE(angle, incV);
  const desiredSpeedSq = newDx * newDx + newDy * newDy;

  if (desiredSpeedSq <= MAX_SPEED_SQ) {
    setVelocityComponents(ship.velocity, newDx, newDy);
    return;
  }

  const currentSpeedSq = velocitySquared(ship.velocity);
  if (desiredSpeedSq < currentSpeedSq) {
    setVelocityComponents(ship.velocity, newDx, newDy);
  } else if (ship.velocity.travelAngle === angle) {
    setVelocityVector(ship.velocity, SUPOX_MAX_THRUST, facing);
  } else {
    setVelocityComponents(ship.velocity, newDx, newDy);
    const speed = Math.sqrt(velocitySquared(ship.velocity));
    if (speed > 0) {
      const scale = WORLD_TO_VELOCITY(SUPOX_MAX_THRUST) / speed;
      setVelocityComponents(ship.velocity, ship.velocity.vx * scale, ship.velocity.vy * scale);
    }
  }
}

function getSpecialThrustFacing(ship: ShipState, input: number): number | null {
  let addFacing = 0;

  if (input & INPUT_THRUST) {
    addFacing = 8;
    if (ship.thrustWait === 0) ship.thrustWait = 1;
  }
  if (input & INPUT_LEFT) {
    if (ship.turnWait === 0) ship.turnWait = SUPOX_TURN_WAIT;
    addFacing = addFacing !== 0 ? addFacing + 2 : -4;
  } else if (input & INPUT_RIGHT) {
    if (ship.turnWait === 0) ship.turnWait = SUPOX_TURN_WAIT;
    addFacing = addFacing !== 0 ? addFacing - 2 : 4;
  }

  if (addFacing === 0) return null;
  return (ship.facing + addFacing + 16) & 15;
}

function globFrame(missile: BattleMissile): number {
  return missile.facing & 15;
}

export function makeSupoxShip(x: number, y: number): ShipState {
  return {
    x,
    y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: SUPOX_MAX_CREW,
    energy: SUPOX_MAX_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: false,
  };
}

export function updateSupoxShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];
  const specialHeld = (input & INPUT_FIRE2) !== 0;

  ship.thrusting = false;

  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else if (!specialHeld) {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing + 15) & 15;
      ship.turnWait = SUPOX_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) & 15;
      ship.turnWait = SUPOX_TURN_WAIT;
    }
  }

  const specialFacing = specialHeld ? getSpecialThrustFacing(ship, input) : null;
  if (specialFacing !== null) {
    ship.thrusting = true;
    applyThrustAlongFacing(ship, specialFacing);
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    applyThrustAlongFacing(ship, ship.facing);
  }

  advancePosition(ship);

  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < SUPOX_MAX_ENERGY) {
    ship.energy = Math.min(SUPOX_MAX_ENERGY, ship.energy + SUPOX_ENERGY_REGENERATION);
    ship.energyWait = SUPOX_ENERGY_WAIT;
  }

  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if ((input & INPUT_FIRE1) && ship.energy >= SUPOX_WEAPON_ENERGY_COST) {
    ship.energy -= SUPOX_WEAPON_ENERGY_COST;
    ship.weaponWait = SUPOX_WEAPON_WAIT;
    const angle = (ship.facing * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(angle, SUPOX_WEAPON_OFFSET),
      y: ship.y + SINE(angle, SUPOX_WEAPON_OFFSET),
      facing: ship.facing,
      speed: SUPOX_MISSILE_SPEED,
      maxSpeed: SUPOX_MISSILE_SPEED,
      accel: 0,
      life: SUPOX_MISSILE_LIFE,
      hits: SUPOX_MISSILE_HITS,
      damage: SUPOX_MISSILE_DAMAGE,
      tracks: false,
      trackRate: 0,
      weaponType: 'supox_glob',
    });
  }

  return spawns;
}

export const supoxController: ShipController = {
  maxCrew: SUPOX_MAX_CREW,
  maxEnergy: SUPOX_MAX_ENERGY,

  make: makeSupoxShip,
  update: updateSupoxShip,

  loadSprites: () => loadSupoxSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as SupoxSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, '#7cff6b', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as SupoxSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, missile: BattleMissile, sprites: unknown): void {
    const sp = sprites as SupoxSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.glob.sml : dc.reduction === 1 ? sp.glob.med : sp.glob.big)
      : null;
    const frame = globFrame(missile);
    if (set?.frames[frame]) {
      drawSprite(dc.ctx, set, frame, missile.x, missile.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, missile.x, missile.y, dc.camX, dc.camY, 3, '#b8ff5f', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getMissileCollisionFrame(missile: BattleMissile, sprites: unknown): SpriteFrame | null {
    void missile;
    void sprites;
    // Use broad-phase circle collision for globs. The sprite masks are very
    // small and make ship hits feel unreliable compared with UQM.
    return null;
  },

  onMissileHit(): MissileHitEffect {
    return {
      skipBlast: true,
      explosionType: 'supox_glob',
      sounds: ['supox_glob_hit'],
    };
  },

  computeAIInput(ship: ShipState, target: ShipState, missiles: BattleMissile[], aiSide: 0 | 1, aiLevel: AIDifficulty): number {
    let input = 0;
    const angleToTarget = worldAngle(ship.x, ship.y, target.x, target.y);
    const targetFacing = ((angleToTarget + 2) >> 2) & 15;
    const diff = (targetFacing - ship.facing + 16) % 16;
    if (diff >= 1 && diff <= 8) input |= INPUT_RIGHT;
    else if (diff > 8) input |= INPUT_LEFT;

    const { dx, dy } = worldDelta(ship.x, ship.y, target.x, target.y);
    const distanceSq = dx * dx + dy * dy;
    const closeRange = DISPLAY_TO_WORLD(aiLevel === 'cyborg_awesome' ? 110 : 80);
    const missileRange = DISPLAY_TO_WORLD(aiLevel === 'cyborg_awesome' ? 220 : aiLevel === 'cyborg_good' ? 180 : 140);
    const incoming = missiles.some(m => {
      if (m.owner === aiSide) return false;
      const delta = worldDelta(ship.x, ship.y, m.x, m.y);
      return delta.dx * delta.dx + delta.dy * delta.dy <= DISPLAY_TO_WORLD(100) ** 2;
    });

    if (distanceSq <= missileRange * missileRange && (diff === 0 || (aiLevel !== 'cyborg_weak' && (diff <= 1 || diff >= 15)))) {
      input |= INPUT_FIRE1;
    }

    if (incoming || distanceSq <= closeRange * closeRange) {
      input |= INPUT_FIRE2;
      const awayFacing = (targetFacing + 8) & 15;
      const backDiff = (awayFacing - ship.facing + 16) % 16;
      if (backDiff <= 1 || backDiff >= 15) input |= INPUT_THRUST;
      else if (backDiff <= 4) input |= INPUT_RIGHT;
      else if (backDiff >= 12) input |= INPUT_LEFT;
    } else if (distanceSq > DISPLAY_TO_WORLD(aiLevel === 'cyborg_awesome' ? 140 : 100) ** 2) {
      input |= INPUT_THRUST;
    }

    return input;
  },
};
