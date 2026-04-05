// Melnorme Trader — ported from uqm-0.8.0/src/uqm/ships/melnorme/melnorme.c
//
// Primary: chargeable blaster pulse
// Special: confusion pulse

import {
  DISPLAY_TO_WORLD,
  VELOCITY_TO_WORLD,
  WORLD_TO_VELOCITY,
  getCurrentVelocityComponents,
  setVelocityComponents,
  setVelocityVector,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import { INPUT_FIRE1, INPUT_FIRE2, INPUT_LEFT, INPUT_RIGHT, INPUT_THRUST } from '../game';
import {
  drawSprite,
  loadMelnormeSprites,
  placeholderDot,
  type MelnormeSprites,
  type SpriteFrame,
} from '../sprites';
import type { BattleMissile, DrawContext, MissileEffect, MissileHitEffect, ShipController, ShipState, SpawnRequest } from './types';
import { worldAngle, worldDelta } from '../battle/helpers';
import type { AIDifficulty } from 'shared/types';

export const MELNORME_MAX_CREW = 20;
export const MELNORME_MAX_ENERGY = 42;
export const MELNORME_ENERGY_REGENERATION = 1;
export const MELNORME_ENERGY_WAIT = 4;
export const MELNORME_MAX_THRUST = 36;
export const MELNORME_THRUST_INCREMENT = 6;
export const MELNORME_THRUST_WAIT = 4;
export const MELNORME_TURN_WAIT = 4;
export const MELNORME_SHIP_MASS = 7;

export const MELNORME_WEAPON_ENERGY_COST = 5;
export const MELNORME_WEAPON_WAIT = 1;
export const MELNORME_OFFSET = DISPLAY_TO_WORLD(24);
export const LEVEL_COUNTER = 72;
export const MAX_PUMP = 4;
export const PUMPUP_SPEED = DISPLAY_TO_WORLD(45);
export const PUMPUP_LIFE = 10;
export const PUMPUP_DAMAGE = 2;
export const NUM_PUMP_ANIMS = 5;

export const MELNORME_SPECIAL_ENERGY_COST = 20;
export const MELNORME_SPECIAL_WAIT = 20;
export const CMISSILE_SPEED = DISPLAY_TO_WORLD(30);
export const CMISSILE_LIFE = 20;
export const CMISSILE_HITS = 200;

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(MELNORME_MAX_THRUST) ** 2;

function nextSeed(ship: ShipState): number {
  const seed = ship.melnormeSeed ?? 0x2468ace1;
  const next = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  ship.melnormeSeed = next;
  return next;
}

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

function pumpFrame(m: BattleMissile): number {
  const level = Math.max(0, Math.min(MAX_PUMP, Math.round(Math.log2(Math.max(1, m.damage / PUMPUP_DAMAGE)))));
  const anim = (m.decelWait ?? 0) % NUM_PUMP_ANIMS;
  return level * NUM_PUMP_ANIMS + anim;
}

export function makeMelnormeShip(x: number, y: number): ShipState {
  return {
    x,
    y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: MELNORME_MAX_CREW,
    energy: MELNORME_MAX_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: false,
    melnormeCharging: false,
    melnormePumpLevel: 0,
    melnormePumpTimer: 0,
    melnormeSeed: 0x2468ace1,
  };
}

export function updateMelnormeShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing + 15) & 15;
      ship.turnWait = MELNORME_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) & 15;
      ship.turnWait = MELNORME_TURN_WAIT;
    }
  }

  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = MELNORME_THRUST_WAIT;
    const angle = (ship.facing * 4) & 63;
    const incV = WORLD_TO_VELOCITY(MELNORME_THRUST_INCREMENT);
    const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
    const newDx = curDx + COSINE(angle, incV);
    const newDy = curDy + SINE(angle, incV);
    const desiredSpeedSq = newDx * newDx + newDy * newDy;
    if (desiredSpeedSq <= MAX_SPEED_SQ) {
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else if (ship.velocity.travelAngle === angle) {
      setVelocityVector(ship.velocity, MELNORME_MAX_THRUST, ship.facing);
    }
  }

  advancePosition(ship);

  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < MELNORME_MAX_ENERGY) {
    ship.energy = Math.min(MELNORME_MAX_ENERGY, ship.energy + MELNORME_ENERGY_REGENERATION);
    ship.energyWait = MELNORME_ENERGY_WAIT;
  }

  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  }

  const fireHeld = (input & INPUT_FIRE1) !== 0;
  if (!ship.melnormeCharging && fireHeld && ship.weaponWait === 0 && ship.energy >= MELNORME_WEAPON_ENERGY_COST) {
    ship.energy -= MELNORME_WEAPON_ENERGY_COST;
    ship.melnormeCharging = true;
    ship.melnormePumpLevel = 0;
    ship.melnormePumpTimer = LEVEL_COUNTER;
    spawns.push({ type: 'sound', sound: 'primary' });
  } else if (ship.melnormeCharging && fireHeld) {
    if ((ship.melnormePumpTimer ?? 0) > 0) {
      ship.melnormePumpTimer!--;
    } else if ((ship.melnormePumpLevel ?? 0) < MAX_PUMP) {
      ship.melnormePumpLevel = (ship.melnormePumpLevel ?? 0) + 1;
      ship.melnormePumpTimer = LEVEL_COUNTER;
      spawns.push({ type: 'sound', sound: 'primary' });
    }
  } else if (ship.melnormeCharging && !fireHeld) {
    const angle = (ship.facing * 4) & 63;
    const level = ship.melnormePumpLevel ?? 0;
    const damage = PUMPUP_DAMAGE << level;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(angle, MELNORME_OFFSET),
      y: ship.y + SINE(angle, MELNORME_OFFSET),
      facing: ship.facing,
      speed: PUMPUP_SPEED,
      maxSpeed: PUMPUP_SPEED,
      accel: 0,
      life: PUMPUP_LIFE,
      hits: damage,
      damage,
      tracks: false,
      trackRate: 0,
      weaponType: 'melnorme_pump',
    });
    ship.melnormeCharging = false;
    ship.melnormePumpLevel = 0;
    ship.melnormePumpTimer = 0;
    ship.weaponWait = MELNORME_WEAPON_WAIT;
  }

  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2) && ship.energy >= MELNORME_SPECIAL_ENERGY_COST) {
    ship.energy -= MELNORME_SPECIAL_ENERGY_COST;
    ship.specialWait = MELNORME_SPECIAL_WAIT;
    const angle = (ship.facing * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(angle, MELNORME_OFFSET),
      y: ship.y + SINE(angle, MELNORME_OFFSET),
      facing: ship.facing,
      speed: CMISSILE_SPEED,
      maxSpeed: CMISSILE_SPEED,
      accel: 0,
      life: CMISSILE_LIFE,
      hits: CMISSILE_HITS,
      damage: 0,
      tracks: false,
      trackRate: 0,
      weaponType: 'melnorme_confuse',
    });
    spawns.push({ type: 'sound', sound: 'secondary' });
  }

  return spawns;
}

export const melnormeController: ShipController = {
  maxCrew: MELNORME_MAX_CREW,
  maxEnergy: MELNORME_MAX_ENERGY,

  make: makeMelnormeShip,
  update: updateMelnormeShip,

  loadSprites: () => loadMelnormeSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as MelnormeSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, '#7df6e1', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as MelnormeSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as MelnormeSprites | null;
    const group = m.weaponType === 'melnorme_confuse' ? sp?.confuse : sp?.pump;
    const set = group
      ? (dc.reduction >= 2 ? group.sml : dc.reduction === 1 ? group.med : group.big)
      : null;
    const frame = m.weaponType === 'melnorme_confuse' ? ((CMISSILE_LIFE - m.life) & 15) : pumpFrame(m);
    if (set) {
      drawSprite(dc.ctx, set, frame, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, m.weaponType === 'melnorme_confuse' ? 5 : 6, '#9ff6ff', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as MelnormeSprites | null;
    if (m.weaponType === 'melnorme_confuse') return sp?.confuse.big.frames[(CMISSILE_LIFE - m.life) & 15] ?? null;
    return sp?.pump.big.frames[pumpFrame(m)] ?? null;
  },

  processMissile(m: BattleMissile, _ownShip: ShipState, _enemyShip: ShipState, _missiles: BattleMissile[], _input: number): MissileEffect {
    if (m.weaponType === 'melnorme_pump') {
      m.decelWait = ((m.decelWait ?? 0) + 1) % NUM_PUMP_ANIMS;
    }
    return {};
  },

  onMissileHit(m: BattleMissile, target: ShipState | null): MissileHitEffect {
    if (m.weaponType === 'melnorme_confuse' && target) {
      target.melnormeConfusionFrames = 400;
      target.melnormeConfusionInput = (nextSeed(target) & 1) === 0 ? INPUT_LEFT : INPUT_RIGHT;
      return { skipBlast: true };
    }
    return {};
  },

  computeAIInput(ship: ShipState, target: ShipState, _missiles: BattleMissile[], _aiSide: 0 | 1, aiLevel: AIDifficulty): number {
    let input = 0;
    const targetAngle = worldAngle(ship.x, ship.y, target.x, target.y);
    const targetFacing = ((targetAngle + 2) >> 2) & 15;
    const diff = (targetFacing - ship.facing + 16) % 16;
    if (diff >= 1 && diff <= 8) input |= INPUT_RIGHT;
    else if (diff > 8) input |= INPUT_LEFT;

    const delta = worldDelta(ship.x, ship.y, target.x, target.y);
    const distanceSq = delta.dx * delta.dx + delta.dy * delta.dy;
    if (distanceSq > DISPLAY_TO_WORLD(200) ** 2) input |= INPUT_THRUST;

    if (ship.energy >= MELNORME_SPECIAL_ENERGY_COST && ship.specialWait === 0 && distanceSq <= DISPLAY_TO_WORLD(180) ** 2 && aiLevel !== 'cyborg_weak') {
      input |= INPUT_FIRE2;
      return input;
    }

    if (distanceSq <= DISPLAY_TO_WORLD(260) ** 2) {
      input |= INPUT_FIRE1;
    }

    return input;
  },
};
