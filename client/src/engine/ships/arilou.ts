// Arilou Skiff — ported from uqm-0.8.0/src/uqm/ships/arilou/arilou.c
//
// Primary (IMMEDIATE_WEAPON): short auto-aim tracking laser
// Special: hyper-jump teleport with brief intangibility
// Movement: non-inertial; velocity snaps to zero when not thrusting

import {
  DISPLAY_TO_WORLD,
  VELOCITY_TO_WORLD,
  setVelocityComponents,
  setVelocityVector,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import { INPUT_FIRE1, INPUT_FIRE2, INPUT_LEFT, INPUT_RIGHT, INPUT_THRUST } from '../game';
import { loadGenericShipSprites, drawSprite, placeholderDot, type ShipSpriteSet, type SpriteFrame } from '../sprites';
import type { BattleMissile, DrawContext, LaserFlash, ShipController, ShipState, SpawnRequest } from './types';
import { toroidalDelta, worldAngle, worldDelta, wrapWorldCoord } from '../battle/helpers';
import type { AIDifficulty } from 'shared/types';

// ─── Constants (from arilou.c) ───────────────────────────────────────────────

export const ARILOU_MAX_CREW            = 6;
export const ARILOU_MAX_ENERGY          = 20;
export const ARILOU_ENERGY_REGENERATION = 1;
export const ARILOU_ENERGY_WAIT         = 6;
export const ARILOU_MAX_THRUST          = 40;
export const ARILOU_THRUST_INCREMENT    = ARILOU_MAX_THRUST;
export const ARILOU_THRUST_WAIT         = 0;
export const ARILOU_TURN_WAIT           = 0;

export const ARILOU_WEAPON_ENERGY_COST = 2;
export const ARILOU_WEAPON_WAIT        = 1;
export const ARILOU_OFFSET             = 9;
export const ARILOU_LASER_RANGE        = DISPLAY_TO_WORLD(100 + ARILOU_OFFSET);
const ARILOU_LASER_COLOR               = '#ffff66';

export const ARILOU_SPECIAL_ENERGY_COST = 3;
export const ARILOU_SPECIAL_WAIT        = 2;
export const ARILOU_HYPER_LIFE          = 5;

const WORLD_W = 20480;
const WORLD_H = 15360;

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

function turnToward(facing: number, targetFacing: number): number {
  const diff = (targetFacing - facing + 16) % 16;
  if (diff === 0) return facing;
  if (diff === 8) return (facing + 1) & 15;
  return diff < 8 ? ((facing + 1) & 15) : ((facing + 15) & 15);
}

function autoAimFacing(ship: ShipState, enemyShip: ShipState): number {
  const aimed = turnToward(ship.facing, ((worldAngle(ship.x, ship.y, enemyShip.x, enemyShip.y) + 2) >> 2) & 15);
  return aimed;
}

function nextTeleportSeed(ship: ShipState): number {
  const current = ship.arilouTeleportSeed ?? 0x41c64e6d;
  const next = (Math.imul(current, 1664525) + 1013904223) >>> 0;
  ship.arilouTeleportSeed = next;
  return next;
}

function randomTeleportCoord(ship: ShipState, worldSize: number): number {
  return (nextTeleportSeed(ship) >>> 2) % worldSize;
}

function isThreateningMissile(m: BattleMissile, ship: ShipState): boolean {
  const { dx, dy } = worldDelta(m.x, m.y, ship.x, ship.y, WORLD_W, WORLD_H);
  const distanceSq = dx * dx + dy * dy;
  const closeRangeW = DISPLAY_TO_WORLD(120);
  if (distanceSq <= closeRangeW * closeRangeW) return true;

  const mvx = VELOCITY_TO_WORLD(m.velocity.vx);
  const mvy = VELOCITY_TO_WORLD(m.velocity.vy);
  const dot = dx * mvx + dy * mvy;
  if (dot <= 0) return false;

  const relSpeedSq = mvx * mvx + mvy * mvy;
  if (relSpeedSq === 0) return false;

  const proj = dot / Math.sqrt(relSpeedSq);
  return proj < DISPLAY_TO_WORLD(160);
}

function drawTeleportEffect(dc: DrawContext, ship: ShipState, sprites: ShipSpriteSet | null): void {
  const set = sprites
    ? (dc.reduction >= 2 ? sprites.sml : dc.reduction === 1 ? sprites.med : sprites.big)
    : null;
  const phase = ship.arilouTeleportFrames ?? 0;
  const alpha = phase >= 3 ? 0.65 : 0.45;
  const trailCount = phase >= 3 ? 3 : 2;

  dc.ctx.save();
  dc.ctx.globalAlpha = alpha;
  for (let i = 0; i < trailCount; i++) {
    const offset = DISPLAY_TO_WORLD(5 * (i + 1));
    const warpX = wrapWorldCoord(ship.x - COSINE((ship.facing * 4) & 63, offset), dc.worldW);
    const warpY = wrapWorldCoord(ship.y - SINE((ship.facing * 4) & 63, offset), dc.worldH);
    dc.ctx.save();
    dc.ctx.globalAlpha = alpha * (1 - i * 0.2);
    dc.ctx.filter = 'sepia(1) saturate(7) hue-rotate(-28deg) brightness(0.92)';
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, warpX, warpY, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, warpX, warpY, dc.camX, dc.camY, 8, '#ffd36a', dc.reduction, dc.worldW, dc.worldH);
    }
    dc.ctx.restore();
  }

  if (phase !== 3) {
    dc.ctx.globalAlpha = phase >= 4 ? 0.8 : 0.35;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, '#ffea7a', dc.reduction, dc.worldW, dc.worldH);
    }
  }
  dc.ctx.restore();
}

export function makeArilouShip(x: number, y: number, rng: () => number): ShipState {
  return {
    x, y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: ARILOU_MAX_CREW,
    energy: ARILOU_MAX_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: false,
    arilouTeleportFrames: 0,
    arilouTeleportSeed: ((rng() * 0x100000000) >>> 0) || 0x41c64e6d,
  };
}

export function updateArilouShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  if ((ship.arilouTeleportFrames ?? 0) > 0) {
    ship.thrusting = false;
    setVelocityComponents(ship.velocity, 0, 0);
    ship.velocity.ex = 0;
    ship.velocity.ey = 0;

    if (ship.arilouTeleportFrames === 3) {
      ship.x = randomTeleportCoord(ship, WORLD_W);
      ship.y = randomTeleportCoord(ship, WORLD_H);
    }

    ship.arilouTeleportFrames!--;
    if ((ship.arilouTeleportFrames ?? 0) === 0) {
      setVelocityComponents(ship.velocity, 0, 0);
      ship.velocity.ex = 0;
      ship.velocity.ey = 0;
    }
    return spawns;
  }

  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing + 15) & 15;
      ship.turnWait = ARILOU_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) & 15;
      ship.turnWait = ARILOU_TURN_WAIT;
    }
  }

  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  }
  if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = ARILOU_THRUST_WAIT;
    setVelocityVector(ship.velocity, ARILOU_MAX_THRUST, ship.facing);
  } else if (ship.thrustWait === 0) {
    setVelocityComponents(ship.velocity, 0, 0);
    ship.velocity.ex = 0;
    ship.velocity.ey = 0;
  }

  advancePosition(ship);

  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < ARILOU_MAX_ENERGY) {
    ship.energy = Math.min(ARILOU_MAX_ENERGY, ship.energy + ARILOU_ENERGY_REGENERATION);
    ship.energyWait = ARILOU_ENERGY_WAIT;
  }

  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if ((input & INPUT_FIRE1) && ship.energy >= ARILOU_WEAPON_ENERGY_COST) {
    ship.energy -= ARILOU_WEAPON_ENERGY_COST;
    ship.weaponWait = ARILOU_WEAPON_WAIT;
    spawns.push({ type: 'arilou_laser', x: ship.x, y: ship.y, facing: ship.facing });
  }

  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2) && ship.energy >= ARILOU_SPECIAL_ENERGY_COST) {
    ship.energy -= ARILOU_SPECIAL_ENERGY_COST;
    ship.specialWait = ARILOU_SPECIAL_WAIT;
    ship.arilouTeleportFrames = ARILOU_HYPER_LIFE;
    ship.thrusting = false;
    setVelocityComponents(ship.velocity, 0, 0);
    ship.velocity.ex = 0;
    ship.velocity.ey = 0;
    spawns.push({ type: 'sound', sound: 'secondary' });
  }

  return spawns;
}

export const arilouController: ShipController = {
  maxCrew: ARILOU_MAX_CREW,
  maxEnergy: ARILOU_MAX_ENERGY,

  make(x: number, y: number, rng?: () => number): ShipState {
    return makeArilouShip(x, y, rng ?? (() => Math.random()));
  },

  update: updateArilouShip,

  loadSprites: () => loadGenericShipSprites('arilou').then(sp => sp ?? null),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as ShipSpriteSet | null;
    if ((ship.arilouTeleportFrames ?? 0) > 0) {
      drawTeleportEffect(dc, ship, sp);
      return;
    }

    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, '#c8ff7a', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    if ((ship.arilouTeleportFrames ?? 0) > 0) return null;
    const sp = sprites as ShipSpriteSet | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  applySpawn(
    s: SpawnRequest,
    ownShip: ShipState,
    enemyShip: ShipState,
    _ownSide: 0 | 1,
    _missiles: BattleMissile[],
    addLaser: (l: LaserFlash) => void,
    _damageMissile: (m: BattleMissile, damage: number) => boolean,
    emitSound: (sound: 'primary' | 'secondary') => void,
  ): void {
    if (s.type !== 'arilou_laser') return;

    const aimedFacing = autoAimFacing(ownShip, enemyShip);
    const angle = (aimedFacing * 4) & 63;
    const startX = ownShip.x + COSINE(angle, DISPLAY_TO_WORLD(ARILOU_OFFSET));
    const startY = ownShip.y + SINE(angle, DISPLAY_TO_WORLD(ARILOU_OFFSET));
    const endX = ownShip.x + COSINE(angle, ARILOU_LASER_RANGE);
    const endY = ownShip.y + SINE(angle, ARILOU_LASER_RANGE);

    const { dx, dy } = worldDelta(startX, startY, enemyShip.x, enemyShip.y, WORLD_W, WORLD_H);
    const segX = endX - startX;
    const segY = endY - startY;
    const lenSq = segX * segX + segY * segY;
    if (lenSq > 0) {
      const t = Math.max(0, Math.min(1, (dx * segX + dy * segY) / lenSq));
      const closestX = startX + segX * t;
      const closestY = startY + segY * t;
      const miss = worldDelta(closestX, closestY, enemyShip.x, enemyShip.y, WORLD_W, WORLD_H);
      const shipRadiusW = DISPLAY_TO_WORLD(10);
      if (miss.dx * miss.dx + miss.dy * miss.dy <= shipRadiusW * shipRadiusW) {
        enemyShip.crew = Math.max(0, enemyShip.crew - 2);
      }
    }

    addLaser({ x1: startX, y1: startY, x2: endX, y2: endY, color: ARILOU_LASER_COLOR });
    emitSound('primary');
  },

  isIntangible(ship: ShipState): boolean {
    return (ship.arilouTeleportFrames ?? 0) > 0;
  },

  computeAIInput(ship: ShipState, target: ShipState, missiles: BattleMissile[], aiSide: 0 | 1, aiLevel: AIDifficulty): number {
    let input = INPUT_THRUST;
    const delta = worldDelta(ship.x, ship.y, target.x, target.y, WORLD_W, WORLD_H);
    const distanceSq = delta.dx * delta.dx + delta.dy * delta.dy;
    const targetAngle = worldAngle(ship.x, ship.y, target.x, target.y);
    const targetFacing = ((targetAngle + 2) >> 2) & 15;

    let desiredFacing = targetFacing;
    if (distanceSq <= (ARILOU_LASER_RANGE * ARILOU_LASER_RANGE)) {
      const orbitRight = toroidalDelta(ship.facing, targetFacing, 16) >= 0;
      desiredFacing = orbitRight ? ((targetFacing + 4) & 15) : ((targetFacing + 12) & 15);
      if (distanceSq <= DISPLAY_TO_WORLD(64) ** 2) desiredFacing = (targetFacing + 8) & 15;
    }

    const facingDiff = (desiredFacing - ship.facing + 16) % 16;
    if (facingDiff >= 1 && facingDiff <= 8) input |= INPUT_RIGHT;
    else if (facingDiff > 8) input |= INPUT_LEFT;

    const enemyMissiles = missiles.filter(m => m.owner !== aiSide);
    const imminentThreat = enemyMissiles.some(m => isThreateningMissile(m, ship));
    const reserve = aiLevel === 'cyborg_awesome' ? ARILOU_SPECIAL_ENERGY_COST : ARILOU_SPECIAL_ENERGY_COST << 1;
    if ((ship.arilouTeleportFrames ?? 0) === 0 && ship.specialWait === 0 && ship.energy >= reserve && imminentThreat) {
      return INPUT_FIRE2;
    }

    const fireFacing = autoAimFacing(ship, target);
    const fireDiff = (fireFacing - ship.facing + 16) % 16;
    const fireRange = DISPLAY_TO_WORLD(112);
    const fireWindow = aiLevel === 'cyborg_weak' ? 0 : 1;
    if (ship.energy > reserve && distanceSq <= fireRange * fireRange && (fireDiff <= fireWindow || fireDiff >= 16 - fireWindow)) {
      input |= INPUT_FIRE1;
    }

    return input;
  },
};
