// Androsynth Guardian — ported from uqm-0.8.0/src/uqm/ships/androsyn/androsyn.c
//
// Primary: homing acid bubbles
// Special: blazer form with constant high-speed collision damage

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
import { INPUT_FIRE1, INPUT_FIRE2, INPUT_LEFT, INPUT_RIGHT, INPUT_THRUST } from '../game';
import {
  drawSprite,
  loadAndrosynthSprites,
  placeholderDot,
  type AndrosynthSprites,
  type SpriteFrame,
} from '../sprites';
import type {
  BattleMissile,
  DrawContext,
  MissileEffect,
  ShipController,
  ShipState,
  SpawnRequest,
} from './types';
import { worldAngle, worldDelta } from '../battle/helpers';
import type { AIDifficulty } from 'shared/types';

export const ANDROSYNTH_MAX_CREW            = 20;
export const ANDROSYNTH_MAX_ENERGY          = 24;
export const ANDROSYNTH_ENERGY_REGENERATION = 1;
export const ANDROSYNTH_ENERGY_WAIT         = 8;
export const ANDROSYNTH_MAX_THRUST          = 24;
export const ANDROSYNTH_THRUST_INCREMENT    = 3;
export const ANDROSYNTH_TURN_WAIT           = 4;
export const ANDROSYNTH_THRUST_WAIT         = 0;
export const ANDROSYNTH_SHIP_MASS           = 6;
export const ANDROSYNTH_RADIUS              = 15;

export const ANDROSYNTH_WEAPON_ENERGY_COST = 3;
export const ANDROSYNTH_WEAPON_WAIT        = 0;
export const ANDROSYNTH_OFFSET             = 14;
export const BUBBLE_SPEED                  = DISPLAY_TO_WORLD(8);
export const BUBBLE_LIFE                   = 200;
export const BUBBLE_HITS                   = 3;
export const BUBBLE_DAMAGE                 = 2;
export const BUBBLE_TRACK_WAIT             = 2;

export const ANDROSYNTH_SPECIAL_ENERGY_COST = 2;
export const BLAZER_DAMAGE                  = 3;
export const BLAZER_THRUST                  = 60;
export const BLAZER_TURN_WAIT               = 1;
export const BLAZER_MASS                    = 1;
export const BLAZER_RADIUS                  = 10;

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(ANDROSYNTH_MAX_THRUST) ** 2;

function nextSeed(ship: ShipState): number {
  const seed = ship.androsynthSeed ?? 0x13579bdf;
  const next = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  ship.androsynthSeed = next;
  return next;
}

function randInt(ship: ShipState, n: number): number {
  if (n <= 1) return 0;
  return nextSeed(ship) % n;
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

function applyGuardianTurning(ship: ShipState, input: number): void {
  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing + 15) & 15;
      ship.turnWait = ANDROSYNTH_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) & 15;
      ship.turnWait = ANDROSYNTH_TURN_WAIT;
    }
  }
}

function applyGuardianThrust(ship: ShipState, input: number): void {
  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
    return;
  }
  if (!(input & INPUT_THRUST)) return;

  ship.thrusting = true;
  ship.thrustWait = ANDROSYNTH_THRUST_WAIT;
  const angle = (ship.facing * 4) & 63;
  const incV = WORLD_TO_VELOCITY(ANDROSYNTH_THRUST_INCREMENT);
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
      setVelocityVector(ship.velocity, ANDROSYNTH_MAX_THRUST, ship.facing);
    } else {
      setVelocityComponents(ship.velocity, newDx, newDy);
      const spd = Math.sqrt(velocitySquared(ship.velocity));
      if (spd > 0) {
        const scale = WORLD_TO_VELOCITY(ANDROSYNTH_MAX_THRUST) / spd;
        setVelocityComponents(ship.velocity, ship.velocity.vx * scale, ship.velocity.vy * scale);
      }
    }
  }
}

function bubbleFrame(m: BattleMissile): number {
  return (m.decelWait ?? 0) % 3;
}

export function makeAndrosynthShip(x: number, y: number, rng: () => number): ShipState {
  return {
    x, y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: ANDROSYNTH_MAX_CREW,
    energy: ANDROSYNTH_MAX_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: false,
    androsynthBlazer: false,
    androsynthSeed: ((rng() * 0x100000000) >>> 0) || 0x13579bdf,
  };
}

export function updateAndrosynthShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  if (ship.androsynthBlazer) {
    ship.thrusting = true;
    if (ship.turnWait > 0) {
      ship.turnWait--;
    }
    let facing = ship.facing;
    if (ship.turnWait === 0 && (input & (INPUT_LEFT | INPUT_RIGHT))) {
      facing = input & INPUT_LEFT ? ((facing + 15) & 15) : ((facing + 1) & 15);
      ship.facing = facing;
      ship.turnWait = BLAZER_TURN_WAIT;
    }

    setVelocityVector(ship.velocity, BLAZER_THRUST, facing);
    advancePosition(ship);

    if (ship.energyWait > 0) {
      ship.energyWait--;
    } else {
      ship.energy = Math.max(0, ship.energy - 1);
      ship.energyWait = ANDROSYNTH_ENERGY_WAIT;
    }

    if (ship.energy <= 0) {
      ship.androsynthBlazer = false;
      ship.turnWait = 0;
      ship.thrustWait = 0;
      ship.weaponWait = 0;
      ship.specialWait = 0;
      ship.thrusting = false;
      setVelocityComponents(ship.velocity, 0, 0);
      ship.velocity.ex = 0;
      ship.velocity.ey = 0;
    }

    return spawns;
  }

  applyGuardianTurning(ship, input);
  applyGuardianThrust(ship, input);
  advancePosition(ship);

  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < ANDROSYNTH_MAX_ENERGY) {
    ship.energy = Math.min(ANDROSYNTH_MAX_ENERGY, ship.energy + ANDROSYNTH_ENERGY_REGENERATION);
    ship.energyWait = ANDROSYNTH_ENERGY_WAIT;
  }

  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if ((input & INPUT_FIRE1) && ship.energy >= ANDROSYNTH_WEAPON_ENERGY_COST) {
    ship.energy -= ANDROSYNTH_WEAPON_ENERGY_COST;
    ship.weaponWait = ANDROSYNTH_WEAPON_WAIT;
    const angle = (ship.facing * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(angle, DISPLAY_TO_WORLD(ANDROSYNTH_OFFSET)),
      y: ship.y + SINE(angle, DISPLAY_TO_WORLD(ANDROSYNTH_OFFSET)),
      facing: ship.facing,
      speed: BUBBLE_SPEED,
      maxSpeed: BUBBLE_SPEED,
      accel: 0,
      life: BUBBLE_LIFE,
      hits: BUBBLE_HITS,
      damage: BUBBLE_DAMAGE,
      tracks: false,
      trackRate: BUBBLE_TRACK_WAIT,
      weaponType: 'bubble',
    });
  }

  if ((input & INPUT_FIRE2) && ship.energy >= ANDROSYNTH_SPECIAL_ENERGY_COST) {
    ship.androsynthBlazer = true;
    ship.turnWait = 0;
    ship.thrustWait = 0;
    ship.weaponWait = 0;
    ship.energyWait = ANDROSYNTH_ENERGY_WAIT;
    ship.thrusting = true;
    spawns.push({ type: 'sound', sound: 'secondary' });
  }

  return spawns;
}

export const androsynthController: ShipController = {
  maxCrew: ANDROSYNTH_MAX_CREW,
  maxEnergy: ANDROSYNTH_MAX_ENERGY,

  make(x: number, y: number, rng?: () => number): ShipState {
    return makeAndrosynthShip(x, y, rng ?? (() => Math.random()));
  },

  update: updateAndrosynthShip,

  loadSprites: () => loadAndrosynthSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as AndrosynthSprites | null;
    const group = ship.androsynthBlazer ? sp?.blazer : sp ? { big: sp.big, med: sp.med, sml: sp.sml } : null;
    const set = group
      ? (dc.reduction >= 2 ? group.sml : dc.reduction === 1 ? group.med : group.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, ship.androsynthBlazer ? '#ffb347' : '#70d8ff', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as AndrosynthSprites | null;
    if (ship.androsynthBlazer) return sp?.blazer.big.frames[ship.facing] ?? null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  getCollisionRadius(ship: ShipState): number {
    return ship.androsynthBlazer ? BLAZER_RADIUS : ANDROSYNTH_RADIUS;
  },

  getCollisionMass(ship: ShipState): number {
    return ship.androsynthBlazer ? BLAZER_MASS : ANDROSYNTH_SHIP_MASS;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as AndrosynthSprites | null;
    const group = sp?.bubble ?? null;
    const set = group
      ? (dc.reduction >= 2 ? group.sml : dc.reduction === 1 ? group.med : group.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, bubbleFrame(m), m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 4, '#7cf3ff', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as AndrosynthSprites | null;
    return sp?.bubble.big.frames[bubbleFrame(m)] ?? null;
  },

  processMissile(m: BattleMissile, ownShip: ShipState, enemyShip: ShipState, _input: number): MissileEffect {
    if (m.weaponType !== 'bubble') return {};

    if ((m.weaponWait ?? 0) > 0) {
      m.weaponWait = (m.weaponWait ?? 0) - 1;
    } else {
      m.decelWait = ((m.decelWait ?? 0) + 1) % 3;
      m.weaponWait = randInt(ownShip, 4);
    }

    if (m.trackWait > 0) {
      m.trackWait--;
    } else {
      const angle = worldAngle(m.x, m.y, enemyShip.x, enemyShip.y);
      const targetFacing = ((angle + 2) >> 2) & 15;
      let facing: number;
      if (enemyShip.crew <= 0) {
        facing = randInt(ownShip, 16);
      } else {
        const currentFacing = ((m.velocity.travelAngle + 2) >> 2) & 15;
        const diff = (targetFacing - currentFacing + 16) % 16;
        const jitter = randInt(ownShip, 8);
        facing = diff <= 8 ? ((targetFacing + jitter) & 15) : ((targetFacing - jitter + 16) & 15);
      }
      setVelocityVector(m.velocity, BUBBLE_SPEED, facing);
      m.trackWait = BUBBLE_TRACK_WAIT;
    }

    return { skipDefaultTracking: true, skipVelocityUpdate: true };
  },

  onShipCollision(ship: ShipState): { damageOther?: number } | void {
    if (ship.androsynthBlazer) return { damageOther: BLAZER_DAMAGE };
  },

  computeAIInput(ship: ShipState, target: ShipState, missiles: BattleMissile[], aiSide: 0 | 1, aiLevel: AIDifficulty): number {
    let input = 0;
    const angle = worldAngle(ship.x, ship.y, target.x, target.y);
    const targetFacing = ((angle + 2) >> 2) & 15;
    const diff = (targetFacing - ship.facing + 16) % 16;

    if (ship.androsynthBlazer) {
      if (diff >= 1 && diff <= 8) input |= INPUT_RIGHT;
      else if (diff > 8) input |= INPUT_LEFT;
      return input;
    }

    if (diff >= 1 && diff <= 8) input |= INPUT_RIGHT;
    else if (diff > 8) input |= INPUT_LEFT;

    const { dx, dy } = worldDelta(ship.x, ship.y, target.x, target.y);
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > DISPLAY_TO_WORLD(120) ** 2 || aiLevel !== 'cyborg_weak') input |= INPUT_THRUST;

    const dangerousWeapon = missiles.some(m => {
      if (m.owner === aiSide) return false;
      const d = worldDelta(ship.x, ship.y, m.x, m.y);
      return d.dx * d.dx + d.dy * d.dy <= DISPLAY_TO_WORLD(90) ** 2;
    });
    const shouldBlaze = ship.energy >= (ANDROSYNTH_MAX_ENERGY / 3)
      && (dangerousWeapon || distanceSq <= DISPLAY_TO_WORLD(aiLevel === 'cyborg_weak' ? 64 : 96) ** 2);
    if (shouldBlaze) return input | INPUT_FIRE2;

    const fireWindow = aiLevel === 'cyborg_awesome' ? 2 : 1;
    if (distanceSq <= DISPLAY_TO_WORLD(180) ** 2 && (diff <= fireWindow || diff >= 16 - fireWindow)) {
      input |= INPUT_FIRE1;
    }

    return input;
  },
};
