// Orz Nemesis — ported from uqm-0.8.0/src/uqm/ships/orz/orz.c
//
// Primary: rotating howitzer turret with separate hull / turret art
// Special: space marines launched by holding special and pressing primary

import {
  WORLD_TO_VELOCITY, VELOCITY_TO_WORLD, DISPLAY_TO_WORLD,
  setVelocityVector, setVelocityComponents, getCurrentVelocityComponents,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2 } from '../game';
import { loadOrzSprites, drawSprite, placeholderDot, type OrzSprites, type SpriteFrame } from '../sprites';
import type { ShipState, SpawnRequest, BattleMissile, DrawContext, ShipController, MissileEffect, MissileHitEffect } from './types';
import { worldAngle, worldDelta } from '../battle/helpers';
import { trackFacing } from './human';
import type { AIDifficulty } from 'shared/types';

export const ORZ_MAX_CREW            = 16;
export const ORZ_MAX_ENERGY          = 20;
export const ORZ_ENERGY_REGENERATION = 1;
export const ORZ_ENERGY_WAIT         = 6;
export const ORZ_MAX_THRUST          = 35;
export const ORZ_THRUST_INCREMENT    = 5;
export const ORZ_THRUST_WAIT         = 0;
export const ORZ_TURN_WAIT           = 1;
export const ORZ_SHIP_MASS           = 4;

export const ORZ_WEAPON_ENERGY_COST  = ORZ_MAX_ENERGY / 3;
export const ORZ_WEAPON_WAIT         = 4;
export const ORZ_TURRET_OFFSET       = DISPLAY_TO_WORLD(14);
export const ORZ_HOWITZER_SPEED      = DISPLAY_TO_WORLD(30);
export const ORZ_HOWITZER_LIFE       = 12;
export const ORZ_HOWITZER_HITS       = 2;
export const ORZ_HOWITZER_DAMAGE     = 3;

export const ORZ_SPECIAL_WAIT        = 12;
export const ORZ_MARINE_MAX_THRUST   = 32;
export const ORZ_MARINE_THRUST_INC   = 8;
export const ORZ_MARINE_HITS         = 3;
export const ORZ_MAX_MARINES         = 8;
export const ORZ_MARINE_WAIT         = 12;
export const ORZ_TURRET_TURN_WAIT    = 3;

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(ORZ_MAX_THRUST) ** 2;
const MAX_MARINE_SPEED_SQ = WORLD_TO_VELOCITY(ORZ_MARINE_MAX_THRUST) ** 2;

function ensureOrzState(ship: ShipState): void {
  ship.orzTurretOffset ??= 0;
  ship.orzTurretTurnWait ??= 0;
  ship.orzTurretFlashFrames ??= 0;
  ship.orzMarineCount ??= 0;
  ship.orzMarineSeed ??= 0x13579bdf;
  ship.orzBoardSlots ??= Array(ORZ_MAX_MARINES).fill(false);
  ship.orzBoardDamageFlash ??= Array(ORZ_MAX_MARINES).fill(0);
}

function nextOrzSeed(seed: number): number {
  return (Math.imul(seed, 1103515245) + 12345) >>> 0;
}

function nextOrzByte(seed: number): { seed: number; value: number } {
  const next = nextOrzSeed(seed);
  return { seed: next, value: (next >>> 16) & 0xff };
}

function turretFacing(ship: ShipState): number {
  return ((ship.facing + (ship.orzTurretOffset ?? 0)) % 16 + 16) % 16;
}

function stepVelocity(
  velocity: ShipState['velocity'],
  angle: number,
  thrustIncrement: number,
  maxSpeedSq: number,
  maxSpeed: number,
  facing: number,
): void {
  const incV = WORLD_TO_VELOCITY(thrustIncrement);
  const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(velocity);
  const newDx = curDx + COSINE(angle, incV);
  const newDy = curDy + SINE(angle, incV);
  const desiredSpeedSq = newDx * newDx + newDy * newDy;

  if (desiredSpeedSq <= maxSpeedSq) {
    setVelocityComponents(velocity, newDx, newDy);
    return;
  }

  if (velocity.travelAngle === angle) {
    setVelocityVector(velocity, maxSpeed, facing);
    return;
  }

  setVelocityComponents(velocity, newDx, newDy);
  const { vx, vy } = velocity;
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed > 0) {
    const scale = WORLD_TO_VELOCITY(maxSpeed) / speed;
    setVelocityComponents(velocity, vx * scale, vy * scale);
  }
}

function advanceShipPosition(ship: ShipState): void {
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

function freeBoardSlot(ship: ShipState, slot: number | undefined): void {
  ensureOrzState(ship);
  if (slot === undefined || slot < 0 || slot >= ORZ_MAX_MARINES) return;
  ship.orzBoardSlots![slot] = false;
  ship.orzBoardDamageFlash![slot] = 0;
}

function claimBoardSlot(ship: ShipState): number {
  ensureOrzState(ship);
  const idx = ship.orzBoardSlots!.findIndex(slot => !slot);
  const slot = idx >= 0 ? idx : 0;
  ship.orzBoardSlots![slot] = true;
  ship.orzBoardDamageFlash![slot] = 0;
  return slot;
}

export function makeOrzShip(x: number, y: number, rng?: () => number): ShipState {
  const seed = ((rng?.() ?? Math.random()) * 0xffffffff) >>> 0;
  return {
    x, y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: ORZ_MAX_CREW,
    energy: ORZ_MAX_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: false,
    orzTurretOffset: 0,
    orzTurretTurnWait: 0,
    orzTurretFlashFrames: 0,
    orzMarineCount: 0,
    orzMarineSeed: seed,
    orzBoardSlots: Array(ORZ_MAX_MARINES).fill(false),
    orzBoardDamageFlash: Array(ORZ_MAX_MARINES).fill(0),
  };
}

export function updateOrzShip(ship: ShipState, input: number): SpawnRequest[] {
  ensureOrzState(ship);
  const spawns: SpawnRequest[] = [];
  const turretControl = (input & INPUT_FIRE2) !== 0 && (input & (INPUT_LEFT | INPUT_RIGHT)) !== 0;
  const launchMarine = (input & INPUT_FIRE1) !== 0 && (input & INPUT_FIRE2) !== 0;

  if (ship.orzTurretFlashFrames! > 0) ship.orzTurretFlashFrames!--;
  if (ship.orzTurretTurnWait! > 0) ship.orzTurretTurnWait!--;

  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else if (!turretControl) {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing - 1 + 16) % 16;
      ship.turnWait = ORZ_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) % 16;
      ship.turnWait = ORZ_TURN_WAIT;
    }
  }

  if (turretControl && ship.orzTurretTurnWait === 0) {
    if ((input & INPUT_RIGHT) && !(input & INPUT_LEFT)) ship.orzTurretOffset = ((ship.orzTurretOffset ?? 0) + 1 + 16) % 16;
    else if ((input & INPUT_LEFT) && !(input & INPUT_RIGHT)) ship.orzTurretOffset = ((ship.orzTurretOffset ?? 0) - 1 + 16) % 16;
    ship.orzTurretTurnWait = ORZ_TURRET_TURN_WAIT;
  }

  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = ORZ_THRUST_WAIT;
    const angle = (ship.facing * 4) & 63;
    stepVelocity(ship.velocity, angle, ORZ_THRUST_INCREMENT, MAX_SPEED_SQ, ORZ_MAX_THRUST, ship.facing);
  }

  advanceShipPosition(ship);

  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < ORZ_MAX_ENERGY) {
    ship.energy = Math.min(ORZ_MAX_ENERGY, ship.energy + ORZ_ENERGY_REGENERATION);
    ship.energyWait = ORZ_ENERGY_WAIT;
  }

  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if ((input & INPUT_FIRE1) && !launchMarine && ship.energy >= ORZ_WEAPON_ENERGY_COST) {
    ship.energy -= ORZ_WEAPON_ENERGY_COST;
    ship.weaponWait = ORZ_WEAPON_WAIT;
    ship.orzTurretFlashFrames = 4;
    const face = turretFacing(ship);
    const angle = (face * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(angle, ORZ_TURRET_OFFSET),
      y: ship.y + SINE(angle, ORZ_TURRET_OFFSET),
      facing: face,
      speed: ORZ_HOWITZER_SPEED,
      maxSpeed: ORZ_HOWITZER_SPEED,
      accel: 0,
      life: ORZ_HOWITZER_LIFE,
      hits: ORZ_HOWITZER_HITS,
      damage: ORZ_HOWITZER_DAMAGE,
      tracks: false,
      trackRate: 0,
      weaponType: 'orz_howitzer',
    });
  }

  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if (launchMarine && ship.crew > 1 && (ship.orzMarineCount ?? 0) < ORZ_MAX_MARINES) {
    const launchFacing = (ship.facing + 8) & 15;
    const { seed, value } = nextOrzByte(ship.orzMarineSeed ?? 0x13579bdf);
    ship.orzMarineSeed = seed;
    ship.orzMarineCount = (ship.orzMarineCount ?? 0) + 1;
    ship.crew--;
    ship.specialWait = ORZ_SPECIAL_WAIT;
    spawns.push({ type: 'sound', sound: 'secondary' });
    spawns.push({
      type: 'missile',
      x: ship.x - COSINE((ship.facing * 4) & 63, ORZ_TURRET_OFFSET),
      y: ship.y - SINE((ship.facing * 4) & 63, ORZ_TURRET_OFFSET),
      facing: launchFacing,
      speed: DISPLAY_TO_WORLD(1),
      maxSpeed: ORZ_MARINE_MAX_THRUST,
      accel: 0,
      life: 4096,
      hits: ORZ_MARINE_HITS,
      damage: 0,
      tracks: false,
      trackRate: 0,
      weaponType: 'orz_marine',
      orzSeed: value,
    });
  }

  return spawns;
}

function marineBackDot(m: BattleMissile, palette: 'default' | 'green'): MissileEffect['ionDots'] {
  const backAngle = ((m.facing * 4) + 32) & 63;
  return [{ x: m.x + COSINE(backAngle, DISPLAY_TO_WORLD(2)), y: m.y + SINE(backAngle, DISPLAY_TO_WORLD(2)), palette }];
}

export const orzController: ShipController = {
  maxCrew: ORZ_MAX_CREW,
  maxEnergy: ORZ_MAX_ENERGY,

  make: makeOrzShip,
  update: updateOrzShip,
  loadSprites: () => loadOrzSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    ensureOrzState(ship);
    const sp = sprites as OrzSprites | null;
    const body = sp ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big) : null;
    const turret = sp ? (dc.reduction >= 2 ? sp.turret.sml : dc.reduction === 1 ? sp.turret.med : sp.turret.big) : null;
    if (body) {
      drawSprite(dc.ctx, body, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, '#9ecbff', dc.reduction);
    }

    if (turret) {
      drawSprite(dc.ctx, turret, turretFacing(ship), ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
      const flashFrames = ship.orzTurretFlashFrames ?? 0;
      if (flashFrames > 0) {
        const flashIdx = Math.min(19, 16 + (4 - flashFrames));
        drawSprite(dc.ctx, turret, flashIdx, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
      }
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as OrzSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  getCollisionMass: () => ORZ_SHIP_MASS,

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as OrzSprites | null;
    if (m.weaponType === 'orz_howitzer') {
      const set = sp ? (dc.reduction >= 2 ? sp.howitzer.sml : dc.reduction === 1 ? sp.howitzer.med : sp.howitzer.big) : null;
      if (set) drawSprite(dc.ctx, set, m.facing, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
      else placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 3, '#8cf', dc.reduction);
      return;
    }

    if (m.weaponType === 'orz_marine') {
      const marineFrame = m.orzMarineMode === 'return' ? 21 : 20;
      const set = sp ? (dc.reduction >= 2 ? sp.turret.sml : dc.reduction === 1 ? sp.turret.med : sp.turret.big) : null;
      const frameSet = sp?.turret.big;
      if (set && marineFrame < set.count && set.frames[marineFrame]) {
        drawSprite(dc.ctx, set, marineFrame, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
      } else if (frameSet?.frames[marineFrame] && dc.reduction === 0) {
        drawSprite(dc.ctx, frameSet, marineFrame, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
      } else {
        placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 2, m.orzMarineMode === 'return' ? '#72ff72' : '#ff3a2f', dc.reduction);
      }
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as OrzSprites | null;
    if (m.weaponType === 'orz_howitzer') return sp?.howitzer.big.frames[m.facing] ?? null;
    if (m.weaponType === 'orz_marine') {
      const frame = m.orzMarineMode === 'return' ? 21 : 20;
      return sp?.turret.big.frames[frame] ?? null;
    }
    return null;
  },

  processMissile(m: BattleMissile, ownShip: ShipState, enemyShip: ShipState): MissileEffect {
    ensureOrzState(ownShip);
    ensureOrzState(enemyShip);
    if (m.weaponType !== 'orz_marine') return {};

    if (ownShip.crew <= 0) {
      if (m.orzMarineMode === 'boarded') freeBoardSlot(enemyShip, m.orzBoardSlot);
      ownShip.orzMarineCount = Math.max(0, (ownShip.orzMarineCount ?? 0) - 1);
      return { destroy: true, sounds: ['orz_marine_die'] };
    }

    if (m.orzMarineMode === 'boarded') {
      m.x = enemyShip.x;
      m.y = enemyShip.y;
      setVelocityComponents(m.velocity, 0, 0);

      if (enemyShip.crew <= 0) {
        freeBoardSlot(enemyShip, m.orzBoardSlot);
        m.orzBoardSlot = undefined;
        m.orzMarineMode = 'return';
        m.facing = ((m.orzSeed ?? 0) + ownShip.facing) & 15;
        return {};
      }

      if ((m.weaponWait ?? 0) > 0) {
        m.weaponWait = (m.weaponWait ?? 0) - 1;
        return { skipVelocityUpdate: true };
      }

      const rng = nextOrzByte(m.orzSeed ?? 0);
      m.orzSeed = rng.seed;
      if (rng.value < 0x10) {
        freeBoardSlot(enemyShip, m.orzBoardSlot);
        ownShip.orzMarineCount = Math.max(0, (ownShip.orzMarineCount ?? 0) - 1);
        return { destroy: true, skipVelocityUpdate: true, sounds: ['orz_marine_die'] };
      }
      if (rng.value < 0x90) {
        enemyShip.crew = Math.max(0, enemyShip.crew - 1);
        if (m.orzBoardSlot !== undefined) enemyShip.orzBoardDamageFlash![m.orzBoardSlot] = 2;
        m.weaponWait = ORZ_MARINE_WAIT + 1;
        return { skipVelocityUpdate: true, sounds: ['orz_marine_attack'] };
      }

      m.weaponWait = ORZ_MARINE_WAIT;
      return { skipVelocityUpdate: true };
    }

    if (m.orzMarineMode === 'return') {
      const targetAngle = worldAngle(m.x, m.y, ownShip.x, ownShip.y);
      const prevFacing = m.facing;
      const prevVx = m.velocity.vx;
      const prevVy = m.velocity.vy;
      m.facing = trackFacing(m.facing, targetAngle);
      stepVelocity(m.velocity, (m.facing * 4) & 63, ORZ_MARINE_THRUST_INC, MAX_MARINE_SPEED_SQ, ORZ_MARINE_MAX_THRUST, m.facing);
      const delta = worldDelta(m.x, m.y, ownShip.x, ownShip.y);
      if (delta.dx * delta.dx + delta.dy * delta.dy <= DISPLAY_TO_WORLD(14) ** 2) {
        ownShip.orzMarineCount = Math.max(0, (ownShip.orzMarineCount ?? 0) - 1);
        return { destroy: true, healOwn: 1 };
      }
      if (prevFacing !== m.facing || prevVx !== m.velocity.vx || prevVy !== m.velocity.vy) {
        return { skipVelocityUpdate: true, ionDots: marineBackDot(m, 'green') };
      }
      return { skipVelocityUpdate: true };
    }

    const targetAngle = worldAngle(m.x, m.y, enemyShip.x, enemyShip.y);
    const prevFacing = m.facing;
    const prevVx = m.velocity.vx;
    const prevVy = m.velocity.vy;
    m.facing = trackFacing(m.facing, targetAngle);
    stepVelocity(m.velocity, (m.facing * 4) & 63, ORZ_MARINE_THRUST_INC, MAX_MARINE_SPEED_SQ, ORZ_MARINE_MAX_THRUST, m.facing);
    if (prevFacing !== m.facing || prevVx !== m.velocity.vx || prevVy !== m.velocity.vy) {
      return { skipVelocityUpdate: true, ionDots: marineBackDot(m, 'default') };
    }
    return { skipVelocityUpdate: true };
  },

  onMissileHit(m: BattleMissile, target: ShipState | null): MissileHitEffect {
    if (m.weaponType === 'orz_howitzer') {
      return { skipBlast: true, explosionType: 'orz_howitzer', sounds: ['orz_howitzer_hit'] };
    }

    if (m.weaponType !== 'orz_marine') return {};
    if (!target) {
      return { skipBlast: true, sounds: ['orz_marine_die'] };
    }

    if (m.orzMarineMode === 'return') {
      return { skipBlast: true, keepMissileAlive: true };
    }

    ensureOrzState(target);
    const slot = claimBoardSlot(target);
    m.orzMarineMode = 'boarded';
    m.orzBoardSlot = slot;
    m.weaponWait = ORZ_MARINE_WAIT;
    target.crew = Math.max(0, target.crew - 1);
    return {
      skipBlast: true,
      keepMissileAlive: true,
      missileCooldown: ORZ_MARINE_WAIT,
      sounds: ['orz_marine_board'],
    };
  },

  computeAIInput(ship: ShipState, target: ShipState, missiles: BattleMissile[], aiSide: 0 | 1, aiLevel: AIDifficulty): number {
    ensureOrzState(ship);
    let input = 0;
    const shipToTarget = worldAngle(ship.x, ship.y, target.x, target.y);
    const shipFacing = ((shipToTarget + 2) >> 2) & 15;
    const bodyDiff = (shipFacing - ship.facing + 16) % 16;
    if (bodyDiff >= 1 && bodyDiff <= 8) input |= INPUT_RIGHT;
    else if (bodyDiff > 8) input |= INPUT_LEFT;

    const turretFace = turretFacing(ship);
    const turretDiff = ((((shipFacing - turretFace) % 16) + 16) % 16);
    const distance = worldDelta(ship.x, ship.y, target.x, target.y);
    const distanceSq = distance.dx * distance.dx + distance.dy * distance.dy;

    if (distanceSq > DISPLAY_TO_WORLD(aiLevel === 'cyborg_awesome' ? 50 : 70) ** 2) input |= INPUT_THRUST;

    if (distanceSq <= DISPLAY_TO_WORLD(180) ** 2 && ship.crew > 4 && (ship.orzMarineCount ?? 0) < 2) {
      input |= INPUT_FIRE1 | INPUT_FIRE2;
      return input;
    }

    if (turretDiff === 0 || turretDiff === 15 || turretDiff === 1) {
      input |= INPUT_FIRE1;
      return input;
    }

    input |= INPUT_FIRE2;
    if (turretDiff <= 8) input |= INPUT_RIGHT;
    else input |= INPUT_LEFT;

    for (const missile of missiles) {
      if (missile.owner === aiSide) continue;
      if (missile.weaponType === 'fighter') continue;
      const delta = worldDelta(ship.x, ship.y, missile.x, missile.y);
      if (delta.dx * delta.dx + delta.dy * delta.dy <= DISPLAY_TO_WORLD(80) ** 2) {
        input &= ~INPUT_FIRE2;
        if (bodyDiff <= 8) input |= INPUT_RIGHT;
        else input |= INPUT_LEFT;
        break;
      }
    }

    return input;
  },
};
