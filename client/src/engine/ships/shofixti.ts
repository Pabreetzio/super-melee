// Shofixti Scout — ported from uqm-0.8.0/src/uqm/ships/shofixti/shofixti.c
//
// Primary: dart gun
// Special: glory device

import {
  DISPLAY_TO_WORLD,
  VELOCITY_TO_WORLD,
  WORLD_TO_DISPLAY,
  WORLD_TO_VELOCITY,
  getCurrentVelocityComponents,
  setVelocityComponents,
  setVelocityVector,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import { INPUT_FIRE1, INPUT_FIRE2, INPUT_LEFT, INPUT_RIGHT, INPUT_THRUST } from '../game';
import { drawSprite, loadShofixtiSprites, placeholderDot, type ShofixtiSprites, type SpriteFrame } from '../sprites';
import type { AIDifficulty } from 'shared/types';
import type { BattleMissile, DrawContext, ShipController, ShipState, SpawnRequest } from './types';
import { worldAngle, worldDelta } from '../battle/helpers';
import { SHIP_REGISTRY } from './registry';

export const SHOFIXTI_MAX_CREW = 6;
export const SHOFIXTI_MAX_ENERGY = 4;
export const SHOFIXTI_ENERGY_REGENERATION = 1;
export const SHOFIXTI_ENERGY_WAIT = 9;
export const SHOFIXTI_MAX_THRUST = 35;
export const SHOFIXTI_THRUST_INCREMENT = 5;
export const SHOFIXTI_THRUST_WAIT = 0;
export const SHOFIXTI_TURN_WAIT = 1;
export const SHOFIXTI_SHIP_MASS = 1;

export const SHOFIXTI_WEAPON_ENERGY_COST = 1;
export const SHOFIXTI_WEAPON_WAIT = 3;
export const SHOFIXTI_OFFSET = DISPLAY_TO_WORLD(15);
export const SHOFIXTI_MISSILE_SPEED = DISPLAY_TO_WORLD(24);
export const SHOFIXTI_MISSILE_LIFE = 10;
export const SHOFIXTI_MISSILE_HITS = 1;
export const SHOFIXTI_MISSILE_DAMAGE = 1;

export const SHOFIXTI_DESTRUCT_RANGE = 180;
export const SHOFIXTI_MAX_DESTRUCTION = SHOFIXTI_DESTRUCT_RANGE / 10;
export const SHOFIXTI_GLORY_FRAMES = 3;
export const SHOFIXTI_SAFETY_STAGES = 3;

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(SHOFIXTI_MAX_THRUST) ** 2;

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

export function makeShofixtiShip(x: number, y: number): ShipState {
  return {
    x,
    y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: SHOFIXTI_MAX_CREW,
    energy: SHOFIXTI_MAX_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: false,
    shofixtiSafetyLevel: 0,
    shofixtiPrevSpecialHeld: false,
    shofixtiGloryFrames: 0,
  };
}

export function updateShofixtiShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];
  const gloryFrames = ship.shofixtiGloryFrames ?? 0;
  const safetyLevel = ship.shofixtiSafetyLevel ?? 0;
  const specialHeld = (input & INPUT_FIRE2) !== 0;
  const specialPressed = specialHeld && !ship.shofixtiPrevSpecialHeld;
  ship.shofixtiPrevSpecialHeld = specialHeld;

  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else if (gloryFrames === 0) {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing + 15) & 15;
      ship.turnWait = SHOFIXTI_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) & 15;
      ship.turnWait = SHOFIXTI_TURN_WAIT;
    }
  }

  ship.thrusting = false;
  if (gloryFrames === 0 && (input & INPUT_THRUST)) {
    ship.thrusting = true;
    const angle = (ship.facing * 4) & 63;
    const incV = WORLD_TO_VELOCITY(SHOFIXTI_THRUST_INCREMENT);
    const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
    const newDx = curDx + COSINE(angle, incV);
    const newDy = curDy + SINE(angle, incV);
    const desiredSpeedSq = newDx * newDx + newDy * newDy;
    if (desiredSpeedSq <= MAX_SPEED_SQ) {
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else if (ship.velocity.travelAngle === angle) {
      setVelocityVector(ship.velocity, SHOFIXTI_MAX_THRUST, ship.facing);
    }
  }

  advancePosition(ship);

  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < SHOFIXTI_MAX_ENERGY) {
    ship.energy = Math.min(SHOFIXTI_MAX_ENERGY, ship.energy + SHOFIXTI_ENERGY_REGENERATION);
    ship.energyWait = SHOFIXTI_ENERGY_WAIT;
  }

  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if (gloryFrames === 0 && (input & INPUT_FIRE1) && ship.energy >= SHOFIXTI_WEAPON_ENERGY_COST) {
    ship.energy -= SHOFIXTI_WEAPON_ENERGY_COST;
    ship.weaponWait = SHOFIXTI_WEAPON_WAIT;
    const angle = (ship.facing * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(angle, SHOFIXTI_OFFSET),
      y: ship.y + SINE(angle, SHOFIXTI_OFFSET),
      facing: ship.facing,
      speed: SHOFIXTI_MISSILE_SPEED,
      maxSpeed: SHOFIXTI_MISSILE_SPEED,
      accel: 0,
      life: SHOFIXTI_MISSILE_LIFE,
      hits: SHOFIXTI_MISSILE_HITS,
      damage: SHOFIXTI_MISSILE_DAMAGE,
      tracks: false,
      trackRate: 0,
    });
  }

  if (gloryFrames > 0) {
    ship.shofixtiGloryFrames = gloryFrames - 1;
    if (gloryFrames === 1) {
      spawns.push({ type: 'sound', sound: 'secondary' });
      spawns.push({ type: 'shofixti_glory', x: ship.x, y: ship.y });
      ship.crew = 0;
      ship.thrusting = false;
      ship.shofixtiSafetyLevel = 0;
    }
  } else if (specialPressed && ship.crew > 0) {
    if (safetyLevel + 1 >= SHOFIXTI_SAFETY_STAGES) {
      ship.shofixtiSafetyLevel = SHOFIXTI_SAFETY_STAGES;
      ship.shofixtiGloryFrames = SHOFIXTI_GLORY_FRAMES;
    } else {
      ship.shofixtiSafetyLevel = safetyLevel + 1;
      spawns.push({ type: 'sound', sound: 'secondary' });
    }
  }

  return spawns;
}

export const shofixtiController: ShipController = {
  maxCrew: SHOFIXTI_MAX_CREW,
  maxEnergy: SHOFIXTI_MAX_ENERGY,

  make: makeShofixtiShip,
  update: updateShofixtiShip,

  loadSprites: () => loadShofixtiSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as ShofixtiSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    const gloryFrames = ship.shofixtiGloryFrames ?? 0;
    const safetyLevel = ship.shofixtiSafetyLevel ?? 0;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, '#ffd28a', dc.reduction, dc.worldW, dc.worldH);
    }

    if (safetyLevel > 0) {
      const sx = (((ship.x - dc.camX) % dc.worldW) + dc.worldW) % dc.worldW;
      const sy = (((ship.y - dc.camY) % dc.worldH) + dc.worldH) % dc.worldH;
      const px = Math.floor((sx > dc.worldW / 2 ? sx - dc.worldW : sx) / (1 << (2 + dc.reduction)));
      const py = Math.floor((sy > dc.worldH / 2 ? sy - dc.worldH : sy) / (1 << (2 + dc.reduction)));
      dc.ctx.save();
      for (let i = 0; i < SHOFIXTI_SAFETY_STAGES; i++) {
        dc.ctx.fillStyle = i < safetyLevel ? '#ffcf6a' : 'rgba(80,40,20,0.55)';
        dc.ctx.fillRect(px - 8 + i * 6, py - 14, 4, 4);
      }
      dc.ctx.restore();
    }

    if (gloryFrames > 0) {
      const sx = (((ship.x - dc.camX) % dc.worldW) + dc.worldW) % dc.worldW;
      const sy = (((ship.y - dc.camY) % dc.worldH) + dc.worldH) % dc.worldH;
      const px = Math.floor((sx > dc.worldW / 2 ? sx - dc.worldW : sx) / (1 << (2 + dc.reduction)));
      const py = Math.floor((sy > dc.worldH / 2 ? sy - dc.worldH : sy) / (1 << (2 + dc.reduction)));
      dc.ctx.save();
      dc.ctx.globalAlpha = 0.35 + (4 - gloryFrames) * 0.15;
      dc.ctx.fillStyle = gloryFrames === 1 ? '#fff4a0' : '#ff9b4a';
      dc.ctx.beginPath();
      dc.ctx.arc(px, py, Math.max(6, (16 - gloryFrames * 2) >> dc.reduction), 0, Math.PI * 2);
      dc.ctx.fill();
      dc.ctx.restore();
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as ShofixtiSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as ShofixtiSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.missile.sml : dc.reduction === 1 ? sp.missile.med : sp.missile.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, m.facing, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 3, '#ffe08f', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as ShofixtiSprites | null;
    return sp?.missile.big.frames[m.facing] ?? null;
  },

  applySpawn(
    s: SpawnRequest,
    ownShip: ShipState,
    enemyShip: ShipState,
    _ownSide: 0 | 1,
    missiles: BattleMissile[],
    _addLaser,
    damageMissile,
    _emitSound,
    enemyType,
  ): void {
    if (s.type !== 'shofixti_glory') return;

    const damageAt = (x: number, y: number): number => {
      const delta = worldDelta(s.x, s.y, x, y);
      const dx = Math.abs(WORLD_TO_DISPLAY(delta.dx));
      const dy = Math.abs(WORLD_TO_DISPLAY(delta.dy));
      if (dx > SHOFIXTI_DESTRUCT_RANGE || dy > SHOFIXTI_DESTRUCT_RANGE) return 0;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > SHOFIXTI_DESTRUCT_RANGE) return 0;
      return 1 + Math.floor((SHOFIXTI_MAX_DESTRUCTION * (SHOFIXTI_DESTRUCT_RANGE - dist)) / SHOFIXTI_DESTRUCT_RANGE);
    };

    const enemyDamage = damageAt(enemyShip.x, enemyShip.y);
    if (enemyDamage > 0) {
      const absorb = SHIP_REGISTRY[enemyType].absorbHit?.(enemyShip, { kind: 'missile', damage: enemyDamage });
      if (!absorb?.absorbed) enemyShip.crew = Math.max(0, enemyShip.crew - enemyDamage);
    }

    for (const missile of [...missiles]) {
      if (damageAt(missile.x, missile.y) > 0) {
        damageMissile(missile, 99);
      }
    }

    ownShip.shofixtiGloryFrames = 0;
  },

  computeAIInput(ship: ShipState, target: ShipState, missiles: BattleMissile[], aiSide: 0 | 1, aiLevel: AIDifficulty): number {
    if ((ship.shofixtiGloryFrames ?? 0) > 0) {
      return INPUT_THRUST;
    }

    let input = 0;
    const targetAngle = worldAngle(ship.x, ship.y, target.x, target.y);
    const targetFacing = ((targetAngle + 2) >> 2) & 15;
    const diff = (targetFacing - ship.facing + 16) % 16;
    if (diff >= 1 && diff <= 8) input |= INPUT_RIGHT;
    else if (diff > 8) input |= INPUT_LEFT;

    const delta = worldDelta(ship.x, ship.y, target.x, target.y);
    const distanceSq = delta.dx * delta.dx + delta.dy * delta.dy;
    const detonationRange = DISPLAY_TO_WORLD(aiLevel === 'cyborg_awesome' ? 96 : aiLevel === 'cyborg_good' ? 80 : 64);
    const panicRange = DISPLAY_TO_WORLD(aiLevel === 'cyborg_awesome' ? 110 : 84);
    const lethalThreat = missiles.some(m => {
      if (m.owner === aiSide) return false;
      const threat = worldDelta(ship.x, ship.y, m.x, m.y);
      return threat.dx * threat.dx + threat.dy * threat.dy <= panicRange * panicRange && m.damage >= ship.crew;
    });

    if (ship.crew <= (aiLevel === 'cyborg_weak' ? 1 : 2) && (distanceSq <= detonationRange * detonationRange || lethalThreat)) {
      return ship.shofixtiPrevSpecialHeld ? input : (input | INPUT_FIRE2);
    }

    if (distanceSq <= DISPLAY_TO_WORLD(140) ** 2 && (diff <= 1 || diff >= 15)) {
      input |= INPUT_FIRE1;
    }
    input |= INPUT_THRUST;
    return input;
  },
};
