// Chmmr Avatar — ported from uqm-0.8.0/src/uqm/ships/chmmr/chmmr.c
//
// Primary: megawatt laser with cycling color phases
// Special: tractor beam
// Passive: 3 orbiting satellites with autonomous point defense

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
import {
  drawSprite,
  loadChmmrSprites,
  placeholderDot,
  type ChmmrSprites,
  type SpriteFrame,
} from '../sprites';
import type {
  BattleMissile,
  DrawContext,
  LaserFlash,
  MissileEffect,
  MissileHitEffect,
  ShipController,
  ShipState,
  SpawnRequest,
} from './types';
import { worldAngle, worldDelta } from '../battle/helpers';
import { SHIP_REGISTRY } from './registry';
import type { AIDifficulty } from 'shared/types';

export const CHMMR_MAX_CREW = 42;
export const CHMMR_MAX_ENERGY = 42;
export const CHMMR_ENERGY_REGENERATION = 1;
export const CHMMR_ENERGY_WAIT = 1;
export const CHMMR_MAX_THRUST = 35;
export const CHMMR_THRUST_INCREMENT = 7;
export const CHMMR_THRUST_WAIT = 5;
export const CHMMR_TURN_WAIT = 3;
export const CHMMR_SHIP_MASS = 10;

export const CHMMR_WEAPON_ENERGY_COST = 2;
export const CHMMR_WEAPON_WAIT = 0;
export const CHMMR_OFFSET = 18;
export const CHMMR_LASER_RANGE = DISPLAY_TO_WORLD(150);
export const CHMMR_LASER_DAMAGE = 2;

export const CHMMR_SPECIAL_ENERGY_COST = 1;
export const CHMMR_SPECIAL_WAIT = 0;

export const NUM_SATELLITES = 3;
export const SATELLITE_OFFSET = DISPLAY_TO_WORLD(64);
export const SATELLITE_HITPOINTS = 10;
export const SATELLITE_MASS = 10;
export const DEFENSE_RANGE = 64;
export const DEFENSE_WAIT = 2;
const SATELLITE_LIFE = 255;

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(CHMMR_MAX_THRUST) ** 2;
const LASER_COLORS = ['#7a0000', '#ff2200', '#ffbb00', '#ff2200'] as const;
const TRACTOR_COLOR = '#2344ff';
const SATELLITE_LASER_COLOR = '#2a5cff';

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

function pointHitsShip(x1: number, y1: number, x2: number, y2: number, ship: ShipState, radius: number): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0) return false;
  const sx = ship.x - x1;
  const sy = ship.y - y1;
  const t = Math.max(0, Math.min(1, (sx * dx + sy * dy) / lenSq));
  const closestX = x1 + dx * t;
  const closestY = y1 + dy * t;
  const miss = worldDelta(closestX, closestY, ship.x, ship.y);
  return miss.dx * miss.dx + miss.dy * miss.dy <= radius * radius;
}

export function makeChmmrShip(x: number, y: number): ShipState {
  return {
    x,
    y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: CHMMR_MAX_CREW,
    energy: CHMMR_MAX_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: false,
    chmmrLaserCycle: 0,
    chmmrSatellitesSpawned: false,
  };
}

export function updateChmmrShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  if (!ship.chmmrSatellitesSpawned) {
    ship.chmmrSatellitesSpawned = true;
    for (let i = 0; i < NUM_SATELLITES; i++) {
      const angle = Math.floor((i * 64 + (NUM_SATELLITES >> 1)) / NUM_SATELLITES);
      spawns.push({
        type: 'missile',
        x: ship.x + COSINE(angle, SATELLITE_OFFSET),
        y: ship.y + SINE(angle, SATELLITE_OFFSET),
        facing: i & 7,
        speed: 0,
        maxSpeed: angle,
        accel: 0,
        life: SATELLITE_LIFE,
        hits: SATELLITE_HITPOINTS,
        damage: 0,
        tracks: false,
        trackRate: 0,
        weaponType: 'chmmr_satellite',
      });
    }
  }

  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing + 15) & 15;
      ship.turnWait = CHMMR_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) & 15;
      ship.turnWait = CHMMR_TURN_WAIT;
    }
  }

  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = CHMMR_THRUST_WAIT;
    const angle = (ship.facing * 4) & 63;
    const incV = WORLD_TO_VELOCITY(CHMMR_THRUST_INCREMENT);
    const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
    const newDx = curDx + COSINE(angle, incV);
    const newDy = curDy + SINE(angle, incV);
    const desiredSpeedSq = newDx * newDx + newDy * newDy;

    if (desiredSpeedSq <= MAX_SPEED_SQ) {
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else if (ship.velocity.travelAngle === angle) {
      setVelocityVector(ship.velocity, CHMMR_MAX_THRUST, ship.facing);
    } else {
      setVelocityComponents(ship.velocity, newDx, newDy);
      const speed = Math.sqrt(ship.velocity.vx * ship.velocity.vx + ship.velocity.vy * ship.velocity.vy);
      if (speed > 0) {
        const scale = WORLD_TO_VELOCITY(CHMMR_MAX_THRUST) / speed;
        setVelocityComponents(ship.velocity, ship.velocity.vx * scale, ship.velocity.vy * scale);
      }
    }
  }

  advancePosition(ship);

  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < CHMMR_MAX_ENERGY) {
    ship.energy = Math.min(CHMMR_MAX_ENERGY, ship.energy + CHMMR_ENERGY_REGENERATION);
    ship.energyWait = CHMMR_ENERGY_WAIT;
  }

  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if ((input & INPUT_FIRE1) && ship.energy >= CHMMR_WEAPON_ENERGY_COST) {
    ship.energy -= CHMMR_WEAPON_ENERGY_COST;
    spawns.push({ type: 'chmmr_laser', x: ship.x, y: ship.y, facing: ship.facing });
  }

  if ((input & INPUT_FIRE2) && ship.energy >= CHMMR_SPECIAL_ENERGY_COST) {
    ship.energy -= CHMMR_SPECIAL_ENERGY_COST;
    spawns.push({ type: 'chmmr_tractor', x: ship.x, y: ship.y, facing: ship.facing });
  }

  return spawns;
}

export const chmmrController: ShipController = {
  maxCrew: CHMMR_MAX_CREW,
  maxEnergy: CHMMR_MAX_ENERGY,

  make: makeChmmrShip,
  update: updateChmmrShip,

  loadSprites: () => loadChmmrSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as ChmmrSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 10, '#ffe37a', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as ChmmrSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as ChmmrSprites | null;
    if (m.weaponType !== 'chmmr_satellite') return;
    const set = sp
      ? (dc.reduction >= 2 ? sp.satellite.sml : dc.reduction === 1 ? sp.satellite.med : sp.satellite.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, m.facing & 7, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 4, '#85a8ff', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    if (m.weaponType !== 'chmmr_satellite') return null;
    const sp = sprites as ChmmrSprites | null;
    return sp?.satellite.big.frames[m.facing & 7] ?? null;
  },

  processMissile(m: BattleMissile, ownShip: ShipState, enemyShip: ShipState, missiles: BattleMissile[], _input: number): MissileEffect {
    if (m.weaponType !== 'chmmr_satellite') return {};
    if (ownShip.crew <= 0) return { destroy: true };

    m.life++;
    m.facing = (m.facing + 1) & 7;
    m.satelliteAngle = ((m.satelliteAngle ?? m.maxSpeed) + 1) & 63;
    m.x = ownShip.x + COSINE(m.satelliteAngle, SATELLITE_OFFSET);
    m.y = ownShip.y + SINE(m.satelliteAngle, SATELLITE_OFFSET);
    setVelocityComponents(m.velocity, 0, 0);

    if (m.trackWait > 0) {
      m.trackWait--;
      return { skipDefaultTracking: true, skipVelocityUpdate: true };
    }

    let best: BattleMissile | null = null;
    let bestDist = Infinity;
    for (const other of missiles) {
      if (other === m || other.owner === m.owner || other.life <= 0 || other.hitPoints <= 0) continue;
      const delta = worldDelta(m.x, m.y, other.x, other.y);
      const dxDisp = Math.abs(WORLD_TO_DISPLAY(delta.dx));
      const dyDisp = Math.abs(WORLD_TO_DISPLAY(delta.dy));
      const dist = dxDisp * dxDisp + dyDisp * dyDisp;
      if (dxDisp <= DEFENSE_RANGE && dyDisp <= DEFENSE_RANGE && dist <= DEFENSE_RANGE * DEFENSE_RANGE) {
        if (other.hitPoints < (best?.hitPoints ?? 999) || (other.hitPoints === (best?.hitPoints ?? 999) && dist < bestDist)) {
          best = other;
          bestDist = dist;
        }
      }
    }

    if (best) {
      m.trackWait = DEFENSE_WAIT;
      return {
        lasers: [{ x1: m.x, y1: m.y, x2: best.x, y2: best.y, color: SATELLITE_LASER_COLOR }],
        damageMissiles: [{ missile: best, damage: 1 }],
        skipDefaultTracking: true,
        skipVelocityUpdate: true,
      };
    }

    const enemyDelta = worldDelta(m.x, m.y, enemyShip.x, enemyShip.y);
    const edx = Math.abs(WORLD_TO_DISPLAY(enemyDelta.dx));
    const edy = Math.abs(WORLD_TO_DISPLAY(enemyDelta.dy));
    if (edx <= DEFENSE_RANGE && edy <= DEFENSE_RANGE && edx * edx + edy * edy <= DEFENSE_RANGE * DEFENSE_RANGE) {
      m.trackWait = DEFENSE_WAIT;
      return {
        lasers: [{ x1: m.x, y1: m.y, x2: enemyShip.x, y2: enemyShip.y, color: SATELLITE_LASER_COLOR }],
        damageEnemy: 1,
        skipDefaultTracking: true,
        skipVelocityUpdate: true,
      };
    }

    return { skipDefaultTracking: true, skipVelocityUpdate: true };
  },

  onMissileHit(m: BattleMissile, target: ShipState | null): MissileHitEffect {
    if (m.weaponType === 'chmmr_satellite' && target) {
      return { skipBlast: true, keepMissileAlive: true };
    }
    return {};
  },

  applySpawn(
    s: SpawnRequest,
    ownShip: ShipState,
    enemyShip: ShipState,
    _ownSide: 0 | 1,
    _missiles: BattleMissile[],
    addLaser: (l: LaserFlash) => void,
    _damageMissile: (m: BattleMissile, damage: number) => boolean,
    _emitSound: (sound: 'primary' | 'secondary') => void,
    enemyType,
  ): void {
    if (s.type === 'chmmr_laser') {
      const angle = (s.facing * 4) & 63;
      const startX = ownShip.x + COSINE(angle, DISPLAY_TO_WORLD(CHMMR_OFFSET));
      const startY = ownShip.y + SINE(angle, DISPLAY_TO_WORLD(CHMMR_OFFSET));
      const endX = startX + COSINE(angle, CHMMR_LASER_RANGE);
      const endY = startY + SINE(angle, CHMMR_LASER_RANGE);
      if (pointHitsShip(startX, startY, endX, endY, enemyShip, DISPLAY_TO_WORLD(18))) {
        const absorb = SHIP_REGISTRY[enemyType].absorbHit?.(enemyShip, { kind: 'laser', damage: CHMMR_LASER_DAMAGE });
        if (!absorb?.absorbed) enemyShip.crew = Math.max(0, enemyShip.crew - CHMMR_LASER_DAMAGE);
      }
      addLaser({ x1: startX, y1: startY, x2: endX, y2: endY, color: LASER_COLORS[ownShip.chmmrLaserCycle ?? 0] });
      ownShip.chmmrLaserCycle = ((ownShip.chmmrLaserCycle ?? 0) + 1) % LASER_COLORS.length;
      return;
    }

    if (s.type === 'chmmr_tractor') {
      const angle = (ownShip.facing * 4) & 63;
      const focusX = ownShip.x + COSINE(angle, CHMMR_LASER_RANGE / 3 + DISPLAY_TO_WORLD(CHMMR_OFFSET));
      const focusY = ownShip.y + SINE(angle, CHMMR_LASER_RANGE / 3 + DISPLAY_TO_WORLD(CHMMR_OFFSET));
      const toward = worldAngle(enemyShip.x, enemyShip.y, focusX, focusY);
      const pull = Math.max(1, Math.floor(WORLD_TO_VELOCITY(12) / CHMMR_SHIP_MASS));
      const { dx: evx, dy: evy } = getCurrentVelocityComponents(enemyShip.velocity);
      setVelocityComponents(enemyShip.velocity, evx + COSINE(toward, pull), evy + SINE(toward, pull));
      addLaser({ x1: ownShip.x, y1: ownShip.y, x2: enemyShip.x, y2: enemyShip.y, color: TRACTOR_COLOR });
    }
  },

  computeAIInput(ship: ShipState, target: ShipState, _missiles: BattleMissile[], _aiSide: 0 | 1, _aiLevel: AIDifficulty): number {
    let input = 0;
    const targetAngle = worldAngle(ship.x, ship.y, target.x, target.y);
    const targetFacing = ((targetAngle + 2) >> 2) & 15;
    const diff = (targetFacing - ship.facing + 16) % 16;
    if (diff >= 1 && diff <= 8) input |= INPUT_RIGHT;
    else if (diff > 8) input |= INPUT_LEFT;

    const delta = worldDelta(ship.x, ship.y, target.x, target.y);
    const distanceSq = delta.dx * delta.dx + delta.dy * delta.dy;
    if (distanceSq > DISPLAY_TO_WORLD(110) ** 2) input |= INPUT_THRUST;

    if (distanceSq <= DISPLAY_TO_WORLD(180) ** 2) input |= INPUT_FIRE1;
    if (distanceSq > DISPLAY_TO_WORLD(120) ** 2) input |= INPUT_FIRE2;

    return input;
  },
};
