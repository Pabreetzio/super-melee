// Ilwrath Avenger — ported from uqm-0.8.0/src/uqm/ships/ilwrath/ilwrath.c
//
// Primary: hellfire spout
// Special: cloaking device

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
  loadIlwrathSprites,
  placeholderDot,
  type IlwrathSprites,
  type SpriteFrame,
} from '../sprites';
import type {
  BattleMissile,
  DrawContext,
  LaserFlash,
  ShipController,
  ShipState,
  SpawnRequest,
} from './types';
import { worldAngle, worldDelta } from '../battle/helpers';
import type { AIDifficulty } from 'shared/types';

export const ILWRATH_MAX_CREW = 22;
export const ILWRATH_MAX_ENERGY = 16;
export const ILWRATH_ENERGY_REGENERATION = 4;
export const ILWRATH_ENERGY_WAIT = 4;
export const ILWRATH_MAX_THRUST = 25;
export const ILWRATH_THRUST_INCREMENT = 5;
export const ILWRATH_THRUST_WAIT = 0;
export const ILWRATH_TURN_WAIT = 2;
export const ILWRATH_SHIP_MASS = 7;

export const ILWRATH_WEAPON_ENERGY_COST = 1;
export const ILWRATH_WEAPON_WAIT = 0;
export const ILWRATH_MISSILE_LIFE = 8;
export const ILWRATH_OFFSET = DISPLAY_TO_WORLD(29);
export const ILWRATH_MISSILE_SPEED = ILWRATH_MAX_THRUST;
export const ILWRATH_MISSILE_HITS = 1;
export const ILWRATH_MISSILE_DAMAGE = 1;

export const ILWRATH_SPECIAL_ENERGY_COST = 3;
export const ILWRATH_SPECIAL_WAIT = 13;

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(ILWRATH_MAX_THRUST) ** 2;

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

export function makeIlwrathShip(x: number, y: number): ShipState {
  return {
    x,
    y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: ILWRATH_MAX_CREW,
    energy: ILWRATH_MAX_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: false,
    ilwrathCloaked: false,
    ilwrathUncloakShot: false,
  };
}

export function updateIlwrathShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];
  ship.ilwrathUncloakShot = false;

  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing + 15) & 15;
      ship.turnWait = ILWRATH_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) & 15;
      ship.turnWait = ILWRATH_TURN_WAIT;
    }
  }

  ship.thrusting = false;
  if (input & INPUT_THRUST) {
    ship.thrusting = true;
    const angle = (ship.facing * 4) & 63;
    const incV = WORLD_TO_VELOCITY(ILWRATH_THRUST_INCREMENT);
    const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
    const newDx = curDx + COSINE(angle, incV);
    const newDy = curDy + SINE(angle, incV);
    const desiredSpeedSq = newDx * newDx + newDy * newDy;
    if (desiredSpeedSq <= MAX_SPEED_SQ) {
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else if (ship.velocity.travelAngle === angle) {
      setVelocityVector(ship.velocity, ILWRATH_MAX_THRUST, ship.facing);
    }
  }

  advancePosition(ship);

  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < ILWRATH_MAX_ENERGY) {
    ship.energy = Math.min(ILWRATH_MAX_ENERGY, ship.energy + ILWRATH_ENERGY_REGENERATION);
    ship.energyWait = ILWRATH_ENERGY_WAIT;
  }

  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if ((input & INPUT_FIRE1) && ship.energy >= ILWRATH_WEAPON_ENERGY_COST) {
    if (ship.ilwrathCloaked) {
      ship.ilwrathCloaked = false;
      ship.ilwrathUncloakShot = true;
      spawns.push({ type: 'sound', sound: 'uncloak' });
    }
    ship.energy -= ILWRATH_WEAPON_ENERGY_COST;
    const angle = (ship.facing * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(angle, ILWRATH_OFFSET),
      y: ship.y + SINE(angle, ILWRATH_OFFSET),
      facing: ship.facing,
      speed: ILWRATH_MISSILE_SPEED,
      maxSpeed: ILWRATH_MISSILE_SPEED,
      accel: 0,
      life: ILWRATH_MISSILE_LIFE,
      hits: ILWRATH_MISSILE_HITS,
      damage: ILWRATH_MISSILE_DAMAGE,
      tracks: false,
      trackRate: 0,
      inheritVelocity: true,
    });
  }

  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2) && !ship.ilwrathCloaked && ship.energy >= ILWRATH_SPECIAL_ENERGY_COST) {
    ship.energy -= ILWRATH_SPECIAL_ENERGY_COST;
    ship.specialWait = ILWRATH_SPECIAL_WAIT;
    ship.ilwrathCloaked = true;
    spawns.push({ type: 'sound', sound: 'cloak' });
  }

  return spawns;
}

export const ilwrathController: ShipController = {
  maxCrew: ILWRATH_MAX_CREW,
  maxEnergy: ILWRATH_MAX_ENERGY,

  make: makeIlwrathShip,
  update: updateIlwrathShip,

  loadSprites: () => loadIlwrathSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    if (ship.ilwrathCloaked) return;
    const sp = sprites as IlwrathSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    if (!set) {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, '#7aa0ff', dc.reduction, dc.worldW, dc.worldH);
      return;
    }
    drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as IlwrathSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as IlwrathSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.fire.sml : dc.reduction === 1 ? sp.fire.med : sp.fire.big)
      : null;
    const frame = Math.min(7, ILWRATH_MISSILE_LIFE - m.life);
    if (set) {
      drawSprite(dc.ctx, set, frame, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 4, '#ff8a2b', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as IlwrathSprites | null;
    const frame = Math.min(7, ILWRATH_MISSILE_LIFE - m.life);
    return sp?.fire.big.frames[frame] ?? null;
  },

  applySpawn(
    s: SpawnRequest,
    ownShip: ShipState,
    enemyShip: ShipState,
    ownSide: 0 | 1,
    missiles: BattleMissile[],
    _addLaser: (l: LaserFlash) => void,
  ): void {
    if (s.type !== 'missile' || !ownShip.ilwrathUncloakShot) return;
    const missile = [...missiles].reverse().find(m => m.owner === ownSide && m.life === ILWRATH_MISSILE_LIFE && m.damage === ILWRATH_MISSILE_DAMAGE);
    if (!missile) return;

    const aimAngle = worldAngle(ownShip.x, ownShip.y, enemyShip.x, enemyShip.y);
    const aimFacing = (aimAngle >> 2) & 15;
    const offsetX = COSINE(aimAngle, ILWRATH_OFFSET);
    const offsetY = SINE(aimAngle, ILWRATH_OFFSET);
    const { dx: shipDx, dy: shipDy } = getCurrentVelocityComponents(ownShip.velocity);

    ownShip.facing = aimFacing;
    missile.facing = aimFacing;
    setVelocityVector(missile.velocity, ILWRATH_MISSILE_SPEED, aimFacing);
    missile.velocity.vx += shipDx;
    missile.velocity.vy += shipDy;
    missile.prevX = ownShip.x + offsetX;
    missile.prevY = ownShip.y + offsetY;
    missile.x = missile.prevX - VELOCITY_TO_WORLD(shipDx);
    missile.y = missile.prevY - VELOCITY_TO_WORLD(shipDy);
    ownShip.ilwrathUncloakShot = false;
  },

  computeAIInput(ship: ShipState, target: ShipState, missiles: BattleMissile[], aiSide: 0 | 1, _aiLevel: AIDifficulty): number {
    let input = 0;
    const targetAngle = worldAngle(ship.x, ship.y, target.x, target.y);
    const targetFacing = ((targetAngle + 2) >> 2) & 15;
    const diff = (targetFacing - ship.facing + 16) % 16;
    if (diff >= 1 && diff <= 8) input |= INPUT_RIGHT;
    else if (diff > 8) input |= INPUT_LEFT;

    const delta = worldDelta(ship.x, ship.y, target.x, target.y);
    const distanceSq = delta.dx * delta.dx + delta.dy * delta.dy;
    const threatClose = missiles.some(m => {
      if (m.owner === aiSide) return false;
      const d = worldDelta(ship.x, ship.y, m.x, m.y);
      return d.dx * d.dx + d.dy * d.dy <= DISPLAY_TO_WORLD(120) ** 2;
    });

    if (ship.ilwrathCloaked) {
      input |= INPUT_THRUST;
      if (distanceSq <= DISPLAY_TO_WORLD(120) ** 2) input |= INPUT_FIRE1;
      return input;
    }

    if (distanceSq <= DISPLAY_TO_WORLD(96) ** 2 || threatClose) {
      input |= INPUT_FIRE1;
    } else if (ship.specialWait === 0 && ship.energy >= ILWRATH_SPECIAL_ENERGY_COST) {
      input |= INPUT_FIRE2;
    } else {
      input |= INPUT_THRUST;
    }

    return input;
  },
};
