// Zoq-Fot-Pik Stinger — ported from uqm-0.8.0/src/uqm/ships/zoqfot/zoqfot.c
//
// Primary: animated spit pellet
// Special: tongue / proboscis strike

import type { AIDifficulty } from 'shared/types';
import { INPUT_FIRE1, INPUT_FIRE2, INPUT_LEFT, INPUT_RIGHT, INPUT_THRUST } from '../game';
import { worldAngle, worldDelta } from '../battle/helpers';
import { SHIP_REGISTRY } from './registry';
import {
  DISPLAY_TO_WORLD,
  VELOCITY_TO_WORLD,
  WORLD_TO_VELOCITY,
  getCurrentVelocityComponents,
  setVelocityComponents,
  setVelocityVector,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import {
  drawSprite,
  loadZoqfotpikSprites,
  placeholderDot,
  type SpriteFrame,
  type ZoqfotpikSprites,
} from '../sprites';
import type {
  BattleMissile,
  DrawContext,
  MissileEffect,
  ShipController,
  ShipState,
  SpawnRequest,
} from './types';

export const ZOQFOTPIK_MAX_CREW = 10;
export const ZOQFOTPIK_MAX_ENERGY = 10;
export const ZOQFOTPIK_ENERGY_REGENERATION = 1;
export const ZOQFOTPIK_ENERGY_WAIT = 4;
export const ZOQFOTPIK_MAX_THRUST = 40;
export const ZOQFOTPIK_THRUST_INCREMENT = 10;
export const ZOQFOTPIK_THRUST_WAIT = 0;
export const ZOQFOTPIK_TURN_WAIT = 1;
export const ZOQFOTPIK_SHIP_MASS = 5;

export const ZOQFOTPIK_WEAPON_ENERGY_COST = 1;
export const ZOQFOTPIK_WEAPON_OFFSET = DISPLAY_TO_WORLD(13);
export const ZOQFOTPIK_WEAPON_LIFE = 10;
export const ZOQFOTPIK_WEAPON_DAMAGE = 1;
export const ZOQFOTPIK_WEAPON_HITS = 1;
export const ZOQFOTPIK_SPIT_WAIT = 2;
const ZOQFOTPIK_SPIT_FRAMES = 13;
const ZOQFOTPIK_SPIT_START_SPEED = DISPLAY_TO_WORLD(ZOQFOTPIK_SPIT_FRAMES) << 1;

export const ZOQFOTPIK_SPECIAL_ENERGY_COST = Math.floor(ZOQFOTPIK_MAX_ENERGY * 3 / 4);
export const ZOQFOTPIK_SPECIAL_WAIT = 6;
export const ZOQFOTPIK_TONGUE_DAMAGE = 12;
const ZOQFOTPIK_TONGUE_RANGE = DISPLAY_TO_WORLD(100);
const ZOQFOTPIK_TONGUE_WIDTH = DISPLAY_TO_WORLD(18);
const ZOQFOTPIK_SPIT_BIAS_SEQUENCE = [-1, 0, 1, 0] as const;

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(ZOQFOTPIK_MAX_THRUST) ** 2;

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

function spitFrame(m: BattleMissile): number {
  return Math.max(0, Math.min(ZOQFOTPIK_SPIT_FRAMES - 1, m.decelWait ?? 0));
}

function tongueHits(ship: ShipState, target: ShipState): boolean {
  const facingAngle = (ship.facing * 4) & 63;
  const forwardX = COSINE(facingAngle, 1024) / 1024;
  const forwardY = SINE(facingAngle, 1024) / 1024;
  const delta = worldDelta(ship.x, ship.y, target.x, target.y);
  const along = delta.dx * forwardX + delta.dy * forwardY;
  if (along < 0 || along > ZOQFOTPIK_TONGUE_RANGE) return false;
  const perp = Math.abs(delta.dx * forwardY - delta.dy * forwardX);
  return perp <= ZOQFOTPIK_TONGUE_WIDTH;
}

export function makeZoqfotpikShip(x: number, y: number): ShipState {
  return {
    x,
    y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: ZOQFOTPIK_MAX_CREW,
    energy: ZOQFOTPIK_MAX_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: false,
    zoqTongueFrames: 0,
    zoqSpitCycle: 0,
  };
}

export function updateZoqfotpikShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  if ((ship.zoqTongueFrames ?? 0) > 0) ship.zoqTongueFrames!--;

  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else if (input & INPUT_LEFT) {
    ship.facing = (ship.facing + 15) & 15;
    ship.turnWait = ZOQFOTPIK_TURN_WAIT;
  } else if (input & INPUT_RIGHT) {
    ship.facing = (ship.facing + 1) & 15;
    ship.turnWait = ZOQFOTPIK_TURN_WAIT;
  }

  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = ZOQFOTPIK_THRUST_WAIT;
    const angle = (ship.facing * 4) & 63;
    const incV = WORLD_TO_VELOCITY(ZOQFOTPIK_THRUST_INCREMENT);
    const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
    const newDx = curDx + COSINE(angle, incV);
    const newDy = curDy + SINE(angle, incV);
    const desiredSpeedSq = newDx * newDx + newDy * newDy;
    if (desiredSpeedSq <= MAX_SPEED_SQ) {
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else if (ship.velocity.travelAngle === angle) {
      setVelocityVector(ship.velocity, ZOQFOTPIK_MAX_THRUST, ship.facing);
    }
  }

  advancePosition(ship);

  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < ZOQFOTPIK_MAX_ENERGY) {
    ship.energy = Math.min(ZOQFOTPIK_MAX_ENERGY, ship.energy + ZOQFOTPIK_ENERGY_REGENERATION);
    ship.energyWait = ZOQFOTPIK_ENERGY_WAIT;
  }

  if ((input & INPUT_FIRE1) && ship.energy >= ZOQFOTPIK_WEAPON_ENERGY_COST) {
    ship.energy -= ZOQFOTPIK_WEAPON_ENERGY_COST;
    const angle = (ship.facing * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(angle, ZOQFOTPIK_WEAPON_OFFSET),
      y: ship.y + SINE(angle, ZOQFOTPIK_WEAPON_OFFSET),
      facing: ship.facing,
      speed: ZOQFOTPIK_SPIT_START_SPEED,
      maxSpeed: ZOQFOTPIK_SPIT_START_SPEED,
      accel: 0,
      life: ZOQFOTPIK_WEAPON_LIFE,
      hits: ZOQFOTPIK_WEAPON_HITS,
      damage: ZOQFOTPIK_WEAPON_DAMAGE,
      tracks: false,
      trackRate: 0,
      weaponType: 'zoqfotpik_spit',
    });
    ship.zoqSpitCycle = ((ship.zoqSpitCycle ?? 0) + 1) % ZOQFOTPIK_SPIT_BIAS_SEQUENCE.length;
  }

  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2) && ship.energy >= ZOQFOTPIK_SPECIAL_ENERGY_COST) {
    ship.energy -= ZOQFOTPIK_SPECIAL_ENERGY_COST;
    ship.specialWait = ZOQFOTPIK_SPECIAL_WAIT;
    ship.zoqTongueFrames = ZOQFOTPIK_SPECIAL_WAIT;
    spawns.push({ type: 'sound', sound: 'secondary' });
    spawns.push({ type: 'zoqfotpik_tongue' });
  }

  return spawns;
}

export const zoqfotpikController: ShipController = {
  maxCrew: ZOQFOTPIK_MAX_CREW,
  maxEnergy: ZOQFOTPIK_MAX_ENERGY,

  make: makeZoqfotpikShip,
  update: updateZoqfotpikShip,

  loadSprites: () => loadZoqfotpikSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as ZoqfotpikSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
      if ((ship.zoqTongueFrames ?? 0) > 0) {
        const proboscis = dc.reduction >= 2 ? sp?.proboscis.sml : dc.reduction === 1 ? sp?.proboscis.med : sp?.proboscis.big;
        if (proboscis) {
          drawSprite(dc.ctx, proboscis, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
        }
      }
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, '#95ff9c', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as ZoqfotpikSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as ZoqfotpikSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.spit.sml : dc.reduction === 1 ? sp.spit.med : sp.spit.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, spitFrame(m), m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 4, '#b8ff7c', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as ZoqfotpikSprites | null;
    return sp?.spit.big.frames[spitFrame(m)] ?? null;
  },

  processMissile(m: BattleMissile): MissileEffect {
    if (m.weaponType !== 'zoqfotpik_spit') return {};
    if (m.weaponWait === undefined) m.weaponWait = ZOQFOTPIK_SPIT_WAIT;
    if (m.decelWait === undefined) m.decelWait = 0;
    if (m.zoqSpitAngle === undefined) m.zoqSpitAngle = (m.facing * 4) & 63;

    if (m.weaponWait > 0) {
      m.weaponWait--;
    } else {
      m.decelWait = Math.min(ZOQFOTPIK_SPIT_FRAMES - 1, (m.decelWait ?? 0) + 1);
      m.weaponWait = ZOQFOTPIK_SPIT_WAIT;
    }

    const index = spitFrame(m);
    m.speed = DISPLAY_TO_WORLD(Math.max(1, ZOQFOTPIK_SPIT_FRAMES - index)) << 1;
    const angle = m.zoqSpitAngle ?? ((m.facing * 4) & 63);
    const velocityMag = WORLD_TO_VELOCITY(m.speed);
    setVelocityComponents(m.velocity, COSINE(angle, velocityMag), SINE(angle, velocityMag));
    return { skipVelocityUpdate: true };
  },

  applySpawn(
    s: SpawnRequest,
    ownShip: ShipState,
    enemyShip: ShipState,
    ownSide: 0 | 1,
    missiles: BattleMissile[],
    _addLaser: (l: never) => void,
    _addTractorShadow,
    _damageMissile: (m: BattleMissile, damage: number) => boolean,
    _emitSound: (sound: 'primary' | 'secondary') => void,
    enemyType,
  ): void {
    if (s.type === 'missile' && s.weaponType === 'zoqfotpik_spit') {
      const missile = [...missiles].reverse().find(m => m.owner === ownSide && m.weaponType === 'zoqfotpik_spit' && m.life === ZOQFOTPIK_WEAPON_LIFE);
      if (missile) {
        const cycleIndex = (((ownShip.zoqSpitCycle ?? 0) - 1) + ZOQFOTPIK_SPIT_BIAS_SEQUENCE.length) % ZOQFOTPIK_SPIT_BIAS_SEQUENCE.length;
        const bias = ZOQFOTPIK_SPIT_BIAS_SEQUENCE[cycleIndex];
        missile.zoqSpitAngle = ((missile.facing * 4) + bias + 64) & 63;
      }
      return;
    }
    if (s.type !== 'zoqfotpik_tongue') return;
    if (tongueHits(ownShip, enemyShip)) {
      const absorb = SHIP_REGISTRY[enemyType].absorbHit?.(enemyShip, { kind: 'laser', damage: ZOQFOTPIK_TONGUE_DAMAGE });
      if (!absorb?.absorbed) enemyShip.crew = Math.max(0, enemyShip.crew - ZOQFOTPIK_TONGUE_DAMAGE);
    }
  },

  computeAIInput(ship: ShipState, target: ShipState, _missiles: BattleMissile[], _aiSide: 0 | 1, aiLevel: AIDifficulty): number {
    let input = 0;
    const targetAngle = worldAngle(ship.x, ship.y, target.x, target.y);
    const targetFacing = ((targetAngle + 2) >> 2) & 15;
    const diff = (targetFacing - ship.facing + 16) % 16;
    if (diff >= 1 && diff <= 8) input |= INPUT_RIGHT;
    else if (diff > 8) input |= INPUT_LEFT;

    const { dx, dy } = worldDelta(ship.x, ship.y, target.x, target.y);
    const distanceSq = dx * dx + dy * dy;

    if (distanceSq <= DISPLAY_TO_WORLD(32) ** 2 && (diff === 0 || diff === 15 || diff === 1)) {
      input |= INPUT_FIRE2;
    } else {
      if (distanceSq <= DISPLAY_TO_WORLD(aiLevel === 'cyborg_awesome' ? 180 : 120) ** 2) input |= INPUT_FIRE1;
      if (distanceSq > DISPLAY_TO_WORLD(aiLevel === 'cyborg_weak' ? 90 : 60) ** 2) input |= INPUT_THRUST;
    }

    return input;
  },
};
