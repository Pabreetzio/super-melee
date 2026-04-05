// Druuge Mauler — ported from uqm-0.8.0/src/uqm/ships/druuge/druuge.c
//
// Primary: mass-driver cannon with recoil
// Special: furnace that burns crew into battery

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
  loadDruugeSprites,
  placeholderDot,
  type DruugeSprites,
  type SpriteFrame,
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
import type { AIDifficulty } from 'shared/types';

export const DRUUGE_MAX_CREW = 14;
export const DRUUGE_MAX_ENERGY = 32;
export const DRUUGE_ENERGY_REGENERATION = 1;
export const DRUUGE_ENERGY_WAIT = 50;
export const DRUUGE_MAX_THRUST = 20;
export const DRUUGE_THRUST_INCREMENT = 2;
export const DRUUGE_THRUST_WAIT = 1;
export const DRUUGE_TURN_WAIT = 4;
export const DRUUGE_SHIP_MASS = 5;

export const DRUUGE_WEAPON_ENERGY_COST = 4;
export const DRUUGE_WEAPON_WAIT = 10;
export const DRUUGE_OFFSET = DISPLAY_TO_WORLD(24);
export const DRUUGE_MISSILE_SPEED = DISPLAY_TO_WORLD(30);
export const DRUUGE_MISSILE_LIFE = 20;
export const DRUUGE_MISSILE_HITS = 4;
export const DRUUGE_MISSILE_DAMAGE = 6;
export const RECOIL_VELOCITY = WORLD_TO_VELOCITY(DISPLAY_TO_WORLD(6));
export const MAX_RECOIL_VELOCITY = RECOIL_VELOCITY * 4;

export const DRUUGE_SPECIAL_ENERGY_COST = 16;
export const DRUUGE_SPECIAL_WAIT = 30;

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(DRUUGE_MAX_THRUST) ** 2;

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

function clampVelocity(ship: ShipState, maxVelocityUnits: number): void {
  const speedSq = ship.velocity.vx * ship.velocity.vx + ship.velocity.vy * ship.velocity.vy;
  const maxSq = maxVelocityUnits * maxVelocityUnits;
  if (speedSq <= maxSq) return;
  const scale = maxVelocityUnits / Math.sqrt(speedSq);
  setVelocityComponents(ship.velocity, ship.velocity.vx * scale, ship.velocity.vy * scale);
}

function applyRecoil(ship: ShipState, facing: number): void {
  const angle = ((facing * 4) + 32) & 63;
  const { dx, dy } = getCurrentVelocityComponents(ship.velocity);
  setVelocityComponents(ship.velocity, dx + COSINE(angle, RECOIL_VELOCITY), dy + SINE(angle, RECOIL_VELOCITY));
  clampVelocity(ship, MAX_RECOIL_VELOCITY);
}

export function makeDruugeShip(x: number, y: number): ShipState {
  return {
    x,
    y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: DRUUGE_MAX_CREW,
    energy: DRUUGE_MAX_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: false,
  };
}

export function updateDruugeShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing + 15) & 15;
      ship.turnWait = DRUUGE_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) & 15;
      ship.turnWait = DRUUGE_TURN_WAIT;
    }
  }

  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = DRUUGE_THRUST_WAIT;
    const angle = (ship.facing * 4) & 63;
    const incV = WORLD_TO_VELOCITY(DRUUGE_THRUST_INCREMENT);
    const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
    const newDx = curDx + COSINE(angle, incV);
    const newDy = curDy + SINE(angle, incV);
    const desiredSpeedSq = newDx * newDx + newDy * newDy;

    if (desiredSpeedSq <= MAX_SPEED_SQ) {
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else if (ship.velocity.travelAngle === angle) {
      setVelocityVector(ship.velocity, DRUUGE_MAX_THRUST, ship.facing);
    } else {
      setVelocityComponents(ship.velocity, newDx, newDy);
      const speed = Math.sqrt(ship.velocity.vx * ship.velocity.vx + ship.velocity.vy * ship.velocity.vy);
      if (speed > 0) {
        const scale = WORLD_TO_VELOCITY(DRUUGE_MAX_THRUST) / speed;
        setVelocityComponents(ship.velocity, ship.velocity.vx * scale, ship.velocity.vy * scale);
      }
    }
  }

  advancePosition(ship);

  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < DRUUGE_MAX_ENERGY) {
    ship.energy = Math.min(DRUUGE_MAX_ENERGY, ship.energy + DRUUGE_ENERGY_REGENERATION);
    ship.energyWait = DRUUGE_ENERGY_WAIT;
  }

  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if ((input & INPUT_FIRE1) && ship.energy >= DRUUGE_WEAPON_ENERGY_COST) {
    ship.energy -= DRUUGE_WEAPON_ENERGY_COST;
    ship.weaponWait = DRUUGE_WEAPON_WAIT;
    const angle = (ship.facing * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(angle, DRUUGE_OFFSET),
      y: ship.y + SINE(angle, DRUUGE_OFFSET),
      facing: ship.facing,
      speed: DRUUGE_MISSILE_SPEED,
      maxSpeed: DRUUGE_MISSILE_SPEED,
      accel: 0,
      life: DRUUGE_MISSILE_LIFE,
      hits: DRUUGE_MISSILE_HITS,
      damage: DRUUGE_MISSILE_DAMAGE,
      tracks: false,
      trackRate: 0,
    });
    applyRecoil(ship, ship.facing);
  }

  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2) && ship.crew > 1 && ship.energy < DRUUGE_MAX_ENERGY) {
    ship.specialWait = DRUUGE_SPECIAL_WAIT;
    ship.crew -= 1;
    ship.energy = Math.min(DRUUGE_MAX_ENERGY, ship.energy + DRUUGE_SPECIAL_ENERGY_COST);
    spawns.push({ type: 'sound', sound: 'secondary' });
  }

  return spawns;
}

export const druugeController: ShipController = {
  maxCrew: DRUUGE_MAX_CREW,
  maxEnergy: DRUUGE_MAX_ENERGY,

  make: makeDruugeShip,
  update: updateDruugeShip,

  loadSprites: () => loadDruugeSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as DruugeSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, '#f6a85c', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as DruugeSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as DruugeSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.cannon.sml : dc.reduction === 1 ? sp.cannon.med : sp.cannon.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, m.facing, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 4, '#ffe0a0', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as DruugeSprites | null;
    return sp?.cannon.big.frames[m.facing] ?? null;
  },

  onMissileHit(m: BattleMissile, target: ShipState | null): MissileHitEffect {
    if (!target) return {};
    const angle = (m.facing * 4) & 63;
    return {
      targetVelocityDelta: {
        vx: COSINE(angle, RECOIL_VELOCITY),
        vy: SINE(angle, RECOIL_VELOCITY),
        maxSpeed: MAX_RECOIL_VELOCITY,
      },
    };
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
    if (distanceSq <= DISPLAY_TO_WORLD(450) ** 2 && ship.weaponWait === 0) {
      input |= INPUT_FIRE1;
    } else if (!(ship.velocity.vx * ship.velocity.vx + ship.velocity.vy * ship.velocity.vy > MAX_RECOIL_VELOCITY * MAX_RECOIL_VELOCITY)) {
      input |= INPUT_THRUST;
    }

    const incoming = missiles.some(m => {
      if (m.owner === aiSide) return false;
      const d = worldDelta(ship.x, ship.y, m.x, m.y);
      return d.dx * d.dx + d.dy * d.dy <= DISPLAY_TO_WORLD(160) ** 2;
    });
    if ((input & INPUT_FIRE1) && ship.energy < DRUUGE_WEAPON_ENERGY_COST && ship.crew > 1) {
      input |= INPUT_FIRE2;
    } else if (incoming && ship.energy < DRUUGE_WEAPON_ENERGY_COST * 2 && ship.crew > 2) {
      input |= INPUT_FIRE2;
    }

    return input;
  },
};
