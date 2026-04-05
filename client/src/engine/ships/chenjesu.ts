// Chenjesu Broodhome — ported from uqm-0.8.0/src/uqm/ships/chenjesu/chenjesu.c
//
// Primary: Photon crystal that persists while fire is held, then shatters
// into shrapnel on release or impact.
// Special: DOGI — autonomous energy-draining helper.

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
  loadChenjesuSprites,
  placeholderDot,
  type ChenjesuSprites,
  type SpriteFrame,
} from '../sprites';
import type {
  BattleMissile,
  DrawContext,
  MissileEffect,
  MissileHitEffect,
  ShipController,
  ShipState,
  SpawnRequest,
} from './types';
import { worldAngle, worldDelta } from '../battle/helpers';
import { trackFacing } from './human';
import type { AIDifficulty } from 'shared/types';

export const CHENJESU_MAX_CREW = 36;
export const CHENJESU_MAX_ENERGY = 30;
export const CHENJESU_ENERGY_REGENERATION = 1;
export const CHENJESU_ENERGY_WAIT = 4;
export const CHENJESU_MAX_THRUST = 27;
export const CHENJESU_THRUST_INCREMENT = 3;
export const CHENJESU_THRUST_WAIT = 4;
export const CHENJESU_TURN_WAIT = 6;
export const CHENJESU_SHIP_MASS = 10;

export const CHENJESU_WEAPON_ENERGY_COST = 5;
export const CHENJESU_WEAPON_WAIT = 0;
export const CHENJESU_OFFSET = 16;
export const CHENJESU_MISSILE_SPEED = DISPLAY_TO_WORLD(16);
export const CHENJESU_MISSILE_LIFE = 90;
export const CHENJESU_MISSILE_HITS = 10;
export const CHENJESU_MISSILE_DAMAGE = 6;
export const NUM_SPARKLES = 8;

export const NUM_FRAGMENTS = 8;
export const FRAGMENT_LIFE = 10;
export const FRAGMENT_SPEED = CHENJESU_MISSILE_SPEED;
export const FRAGMENT_HITS = 1;
export const FRAGMENT_DAMAGE = 2;
export const FRAGMENT_RANGE = FRAGMENT_LIFE * FRAGMENT_SPEED;

export const CHENJESU_SPECIAL_ENERGY_COST = CHENJESU_MAX_ENERGY;
export const DOGGY_SPEED = DISPLAY_TO_WORLD(8);
export const DOGGY_HITS = 3;
export const DOGGY_MASS = 4;
export const DOGGY_OFFSET = 18;
export const DOGGY_ENERGY_DRAIN = 10;
export const MAX_DOGGIES = 4;
const DOGGY_LIFE = 255;
const COLLISION_THRUST_WAIT = 3;

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(CHENJESU_MAX_THRUST) ** 2;

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

function crystalFrameIndex(m: BattleMissile): number {
  return m.weaponType === 'chenjesu_shard' ? 1 : 0;
}

function doggyFrameIndex(m: BattleMissile): number {
  return (m.decelWait ?? 0) % 7;
}

function spawnFragments(m: BattleMissile): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];
  for (let facing = 0; facing < 16; facing += 2) {
    spawns.push({
      type: 'missile',
      x: m.x,
      y: m.y,
      facing,
      speed: FRAGMENT_SPEED,
      maxSpeed: FRAGMENT_SPEED,
      accel: 0,
      life: FRAGMENT_LIFE,
      hits: FRAGMENT_HITS,
      damage: FRAGMENT_DAMAGE,
      tracks: false,
      trackRate: 0,
      weaponType: 'chenjesu_shard',
    });
  }
  return spawns;
}

export function makeChenjesuShip(x: number, y: number): ShipState {
  return {
    x,
    y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: CHENJESU_MAX_CREW,
    energy: CHENJESU_MAX_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: false,
    prevFireHeld: false,
    chenjesuDogiCount: 0,
  };
}

export function updateChenjesuShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing + 15) & 15;
      ship.turnWait = CHENJESU_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) & 15;
      ship.turnWait = CHENJESU_TURN_WAIT;
    }
  }

  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = CHENJESU_THRUST_WAIT;

    const angle = (ship.facing * 4) & 63;
    const incV = WORLD_TO_VELOCITY(CHENJESU_THRUST_INCREMENT);
    const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
    const newDx = curDx + COSINE(angle, incV);
    const newDy = curDy + SINE(angle, incV);
    const desiredSpeedSq = newDx * newDx + newDy * newDy;

    if (desiredSpeedSq <= MAX_SPEED_SQ) {
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else if (ship.velocity.travelAngle === angle) {
      setVelocityVector(ship.velocity, CHENJESU_MAX_THRUST, ship.facing);
    } else {
      setVelocityComponents(ship.velocity, newDx, newDy);
      const speed = Math.sqrt(ship.velocity.vx * ship.velocity.vx + ship.velocity.vy * ship.velocity.vy);
      if (speed > 0) {
        const scale = WORLD_TO_VELOCITY(CHENJESU_MAX_THRUST) / speed;
        setVelocityComponents(ship.velocity, ship.velocity.vx * scale, ship.velocity.vy * scale);
      }
    }
  }

  advancePosition(ship);

  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < CHENJESU_MAX_ENERGY) {
    ship.energy = Math.min(CHENJESU_MAX_ENERGY, ship.energy + CHENJESU_ENERGY_REGENERATION);
    ship.energyWait = CHENJESU_ENERGY_WAIT;
  }

  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  }
  const fireHeld = (input & INPUT_FIRE1) !== 0;
  if (!ship.prevFireHeld && fireHeld && ship.weaponWait === 0 && ship.energy >= CHENJESU_WEAPON_ENERGY_COST) {
    ship.energy -= CHENJESU_WEAPON_ENERGY_COST;
    ship.weaponWait = CHENJESU_WEAPON_WAIT;
    const angle = (ship.facing * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(angle, DISPLAY_TO_WORLD(CHENJESU_OFFSET)),
      y: ship.y + SINE(angle, DISPLAY_TO_WORLD(CHENJESU_OFFSET)),
      facing: ship.facing,
      speed: CHENJESU_MISSILE_SPEED,
      maxSpeed: CHENJESU_MISSILE_SPEED,
      accel: 0,
      life: CHENJESU_MISSILE_LIFE,
      hits: CHENJESU_MISSILE_HITS,
      damage: CHENJESU_MISSILE_DAMAGE,
      tracks: false,
      trackRate: 0,
      weaponType: 'chenjesu_crystal',
    });
  }
  ship.prevFireHeld = fireHeld;

  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2) && ship.energy >= CHENJESU_SPECIAL_ENERGY_COST && (ship.chenjesuDogiCount ?? 0) < MAX_DOGGIES) {
    ship.energy -= CHENJESU_SPECIAL_ENERGY_COST;
    ship.chenjesuDogiCount = (ship.chenjesuDogiCount ?? 0) + 1;
    const rearFacing = (ship.facing + 8) & 15;
    const rearAngle = (rearFacing * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(rearAngle, DISPLAY_TO_WORLD(CHENJESU_OFFSET + DOGGY_OFFSET)),
      y: ship.y + SINE(rearAngle, DISPLAY_TO_WORLD(CHENJESU_OFFSET + DOGGY_OFFSET)),
      facing: rearFacing,
      speed: DOGGY_SPEED,
      maxSpeed: DOGGY_SPEED,
      accel: 0,
      life: DOGGY_LIFE,
      hits: DOGGY_HITS,
      damage: 0,
      tracks: false,
      trackRate: 0,
      weaponType: 'dogi',
    });
  }

  return spawns;
}

export const chenjesuController: ShipController = {
  maxCrew: CHENJESU_MAX_CREW,
  maxEnergy: CHENJESU_MAX_ENERGY,

  make: makeChenjesuShip,
  update: updateChenjesuShip,

  loadSprites: () => loadChenjesuSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as ChenjesuSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 10, '#9fd6ff', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as ChenjesuSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as ChenjesuSprites | null;
    if (m.weaponType === 'dogi') {
      const set = sp
        ? (dc.reduction >= 2 ? sp.doggy.sml : dc.reduction === 1 ? sp.doggy.med : sp.doggy.big)
        : null;
      if (set) {
        drawSprite(dc.ctx, set, doggyFrameIndex(m), m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
      } else {
        placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 5, '#9be3ff', dc.reduction, dc.worldW, dc.worldH);
      }
      return;
    }

    if (m.weaponType === 'chenjesu_crystal' || m.weaponType === 'chenjesu_shard') {
      const set = sp
        ? (dc.reduction >= 2 ? sp.spark.sml : dc.reduction === 1 ? sp.spark.med : sp.spark.big)
        : null;
      if (set) {
        drawSprite(dc.ctx, set, crystalFrameIndex(m), m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
      } else {
        placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, m.weaponType === 'chenjesu_crystal' ? 5 : 3, '#d6fbff', dc.reduction, dc.worldW, dc.worldH);
      }
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as ChenjesuSprites | null;
    if (m.weaponType === 'dogi') return sp?.doggy.big.frames[doggyFrameIndex(m)] ?? null;
    if (m.weaponType === 'chenjesu_crystal' || m.weaponType === 'chenjesu_shard') {
      return sp?.spark.big.frames[crystalFrameIndex(m)] ?? null;
    }
    return null;
  },

  processMissile(m: BattleMissile, ownShip: ShipState, enemyShip: ShipState, input: number): MissileEffect {
    if (m.weaponType === 'chenjesu_crystal') {
      if ((input & INPUT_FIRE1) && ownShip.crew > 0) {
        m.life++;
      } else {
        return { destroy: true, resolveAsHit: true };
      }
      return {};
    }

    if (m.weaponType === 'dogi') {
      m.decelWait = ((m.decelWait ?? 0) + 1) % 7;
      if ((m.weaponWait ?? 0) > 0) {
        m.weaponWait = (m.weaponWait ?? 0) - 1;
        return { skipDefaultTracking: true, skipVelocityUpdate: true };
      }

      const doggyAngle = worldAngle(m.x, m.y, enemyShip.x, enemyShip.y);
      let targetFacing = ((doggyAngle + 2) >> 2) & 15;
      const enemyFacingDiff = (targetFacing - enemyShip.facing + 16) % 16;
      if (enemyFacingDiff > 6 && enemyFacingDiff < 10) {
        targetFacing = (targetFacing + (enemyFacingDiff >= 8 ? -4 : 4) + 16) & 15;
      }

      m.facing = trackFacing(m.facing, targetFacing << 2);
      setVelocityVector(m.velocity, DOGGY_SPEED, m.facing);
      return { skipDefaultTracking: true, skipVelocityUpdate: true };
    }

    return {};
  },

  onMissileHit(m: BattleMissile, target: ShipState | null): MissileHitEffect {
    if (m.weaponType === 'chenjesu_crystal') {
      return {
        skipBlast: true,
        explosionType: 'chenjesu_spark',
        sounds: ['chenjesu_shrapnel'],
        spawnMissiles: spawnFragments(m),
      };
    }

    if (m.weaponType === 'dogi') {
      if (target) {
        return {
          skipBlast: true,
          keepMissileAlive: true,
          drainTargetEnergy: DOGGY_ENERGY_DRAIN,
          missileCooldown: COLLISION_THRUST_WAIT << 1,
          sounds: ['chenjesu_dogi_bark'],
        };
      }
      return {
        skipBlast: true,
        sounds: ['chenjesu_dogi_die'],
      };
    }

    return {};
  },

  getCollisionMass(): number {
    return CHENJESU_SHIP_MASS;
  },

  computeAIInput(ship: ShipState, target: ShipState, missiles: BattleMissile[], aiSide: 0 | 1, aiLevel: AIDifficulty): number {
    let input = 0;
    const targetAngle = worldAngle(ship.x, ship.y, target.x, target.y);
    const targetFacing = ((targetAngle + 2) >> 2) & 15;
    const diff = (targetFacing - ship.facing + 16) % 16;
    if (diff >= 1 && diff <= 8) input |= INPUT_RIGHT;
    else if (diff > 8) input |= INPUT_LEFT;

    const { dx, dy } = worldDelta(ship.x, ship.y, target.x, target.y);
    const distanceSq = dx * dx + dy * dy;
    const activeCrystal = missiles.find(m => m.owner === aiSide && m.weaponType === 'chenjesu_crystal');
    const hostileMissileClose = missiles.some(m => {
      if (m.owner === aiSide) return false;
      const d = worldDelta(ship.x, ship.y, m.x, m.y);
      return d.dx * d.dx + d.dy * d.dy <= DISPLAY_TO_WORLD(140) ** 2;
    });

    if (!hostileMissileClose || aiLevel !== 'cyborg_weak') input |= INPUT_THRUST;

    if (activeCrystal) {
      const crystalDelta = worldDelta(activeCrystal.x, activeCrystal.y, target.x, target.y);
      const crystalDistanceSq = crystalDelta.dx * crystalDelta.dx + crystalDelta.dy * crystalDelta.dy;
      const shouldHold = crystalDistanceSq > (FRAGMENT_RANGE >> 1) * (FRAGMENT_RANGE >> 1) && !hostileMissileClose;
      if (shouldHold) input |= INPUT_FIRE1;
    } else {
      const fireWindow = aiLevel === 'cyborg_awesome' ? 1 : 0;
      if (distanceSq <= DISPLAY_TO_WORLD(280) ** 2 && (diff <= fireWindow || diff >= 16 - fireWindow)) {
        input |= INPUT_FIRE1;
      }
    }

    if (!activeCrystal
      && ship.energy >= CHENJESU_SPECIAL_ENERGY_COST
      && (ship.chenjesuDogiCount ?? 0) < MAX_DOGGIES
      && !(input & INPUT_FIRE1)
    ) {
      const launchDistance = aiLevel === 'cyborg_weak' ? DISPLAY_TO_WORLD(120) : DISPLAY_TO_WORLD(220);
      if (distanceSq >= launchDistance * launchDistance || hostileMissileClose) {
        input |= INPUT_FIRE2;
      }
    }

    return input;
  },
};
