import type { AIDifficulty } from 'shared/types';
import { INPUT_FIRE1, INPUT_FIRE2, INPUT_LEFT, INPUT_RIGHT, INPUT_THRUST } from '../game';
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
import { drawSprite, loadMmrnmhrmSprites, placeholderDot, type MmrnmhrmSprites, type SpriteFrame } from '../sprites';
import type { BattleMissile, DrawContext, ShipController, ShipState, SpawnRequest } from './types';
import { SHIP_REGISTRY } from './registry';
import { worldAngle, worldDelta } from '../battle/helpers';

const MMRNMHRM_MAX_CREW = 20;
const MMRNMHRM_MAX_ENERGY = 10;
const X_ENERGY_REGEN = 2;
const X_ENERGY_WAIT = 6;
const X_MAX_THRUST = 20;
const X_THRUST_INCREMENT = 5;
const X_THRUST_WAIT = 1;
const X_TURN_WAIT = 2;
const Y_ENERGY_REGEN = 1;
const Y_ENERGY_WAIT = 6;
const Y_MAX_THRUST = 50;
const Y_THRUST_INCREMENT = 10;
const Y_THRUST_WAIT = 0;
const Y_TURN_WAIT = 14;
const MMRNMHRM_SHIP_MASS = 3;

const X_WEAPON_ENERGY_COST = 1;
const X_CENTER_OFFS = DISPLAY_TO_WORLD(4);
const X_WING_OFFS = DISPLAY_TO_WORLD(10);
const X_LASER_RANGE = DISPLAY_TO_WORLD(141);

const Y_WEAPON_ENERGY_COST = 1;
const Y_WEAPON_WAIT = 20;
const Y_LAUNCH_OFFS = DISPLAY_TO_WORLD(4);
const Y_MISSILE_SPEED = DISPLAY_TO_WORLD(20);
const Y_MISSILE_LIFE = 40;
const Y_MISSILE_DAMAGE = 1;
const Y_TRACK_WAIT = 5;

const TRANSFORM_COST = MMRNMHRM_MAX_ENERGY;

function isYForm(ship: ShipState): boolean {
  return ship.mmrnmhrmForm === 'y';
}

function getMaxThrust(ship: ShipState): number {
  return isYForm(ship) ? Y_MAX_THRUST : X_MAX_THRUST;
}

function getThrustIncrement(ship: ShipState): number {
  return isYForm(ship) ? Y_THRUST_INCREMENT : X_THRUST_INCREMENT;
}

function getTurnWait(ship: ShipState): number {
  return isYForm(ship) ? Y_TURN_WAIT : X_TURN_WAIT;
}

function getThrustWait(ship: ShipState): number {
  return isYForm(ship) ? Y_THRUST_WAIT : X_THRUST_WAIT;
}

function getEnergyRegen(ship: ShipState): number {
  return isYForm(ship) ? Y_ENERGY_REGEN : X_ENERGY_REGEN;
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

function applyThrust(ship: ShipState): void {
  const maxSpeed = getMaxThrust(ship);
  const angle = (ship.facing * 4) & 63;
  const incV = WORLD_TO_VELOCITY(getThrustIncrement(ship));
  const maxSpeedSq = WORLD_TO_VELOCITY(maxSpeed) ** 2;
  const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
  const newDx = curDx + COSINE(angle, incV);
  const newDy = curDy + SINE(angle, incV);
  const desiredSpeedSq = newDx * newDx + newDy * newDy;

  if (desiredSpeedSq <= maxSpeedSq) {
    setVelocityComponents(ship.velocity, newDx, newDy);
    return;
  }

  const currentSpeedSq = velocitySquared(ship.velocity);
  if (desiredSpeedSq < currentSpeedSq) {
    setVelocityComponents(ship.velocity, newDx, newDy);
  } else if (ship.velocity.travelAngle === angle) {
    setVelocityVector(ship.velocity, maxSpeed, ship.facing);
  } else {
    setVelocityComponents(ship.velocity, newDx, newDy);
    const speed = Math.sqrt(velocitySquared(ship.velocity));
    if (speed > 0) {
      const scale = WORLD_TO_VELOCITY(maxSpeed) / speed;
      setVelocityComponents(ship.velocity, ship.velocity.vx * scale, ship.velocity.vy * scale);
    }
  }
}

function pointToSegmentDistance(x: number, y: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lenSq));
  const px = x1 + dx * t;
  const py = y1 + dy * t;
  return Math.hypot(x - px, y - py);
}

export function makeMmrnmhrmShip(x: number, y: number): ShipState {
  return {
    x,
    y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: MMRNMHRM_MAX_CREW,
    energy: MMRNMHRM_MAX_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: false,
    mmrnmhrmForm: 'x',
  };
}

export function updateMmrnmhrmShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else if (input & INPUT_LEFT) {
    ship.facing = (ship.facing + 15) & 15;
    ship.turnWait = getTurnWait(ship);
  } else if (input & INPUT_RIGHT) {
    ship.facing = (ship.facing + 1) & 15;
    ship.turnWait = getTurnWait(ship);
  }

  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = getThrustWait(ship);
    applyThrust(ship);
  }

  advancePosition(ship);

  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < MMRNMHRM_MAX_ENERGY) {
    ship.energy = Math.min(MMRNMHRM_MAX_ENERGY, ship.energy + getEnergyRegen(ship));
    ship.energyWait = isYForm(ship) ? Y_ENERGY_WAIT : X_ENERGY_WAIT;
  }

  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if (input & INPUT_FIRE1) {
    if (isYForm(ship)) {
      if (ship.energy >= Y_WEAPON_ENERGY_COST) {
        ship.energy -= Y_WEAPON_ENERGY_COST;
        ship.weaponWait = Y_WEAPON_WAIT;
        const centerAngle = (ship.facing * 4) & 63;
        const leftFacing = (ship.facing + 15) & 15;
        const rightFacing = (ship.facing + 1) & 15;
        const leftAngle = (leftFacing * 4) & 63;
        const cx = ship.x + COSINE(centerAngle, X_CENTER_OFFS);
        const cy = ship.y + SINE(centerAngle, X_CENTER_OFFS);
        const leftOffX = -SINE(leftAngle, Y_LAUNCH_OFFS);
        const leftOffY = COSINE(leftAngle, Y_LAUNCH_OFFS);
        spawns.push(
          {
            type: 'missile',
            x: cx + leftOffX,
            y: cy + leftOffY,
            facing: leftFacing,
            speed: Y_MISSILE_SPEED,
            maxSpeed: Y_MISSILE_SPEED,
            accel: 0,
            life: Y_MISSILE_LIFE,
            hits: 1,
            damage: Y_MISSILE_DAMAGE,
            tracks: true,
            trackRate: Y_TRACK_WAIT,
            initialTrackWait: Y_TRACK_WAIT,
          },
          {
            type: 'missile',
            x: cx - leftOffX,
            y: cy - leftOffY,
            facing: rightFacing,
            speed: Y_MISSILE_SPEED,
            maxSpeed: Y_MISSILE_SPEED,
            accel: 0,
            life: Y_MISSILE_LIFE,
            hits: 1,
            damage: Y_MISSILE_DAMAGE,
            tracks: true,
            trackRate: Y_TRACK_WAIT,
            initialTrackWait: Y_TRACK_WAIT,
          },
          { type: 'sound', sound: 'mmrnmhrm_primary_y' },
        );
      }
    } else if (ship.energy >= X_WEAPON_ENERGY_COST) {
      ship.energy -= X_WEAPON_ENERGY_COST;
      spawns.push({ type: 'point_defense', x: ship.x, y: ship.y });
      spawns.push({ type: 'sound', sound: 'mmrnmhrm_primary_x' });
    }
  }

  if ((input & INPUT_FIRE2) && ship.energy >= TRANSFORM_COST) {
    const wasYForm = isYForm(ship);
    ship.energy -= TRANSFORM_COST;
    ship.weaponWait = 0;
    ship.turnWait = 0;
    ship.thrustWait = 0;
    ship.energyWait = wasYForm ? X_ENERGY_WAIT : Y_ENERGY_WAIT;
    ship.mmrnmhrmForm = wasYForm ? 'x' : 'y';
    spawns.push({ type: 'sound', sound: wasYForm ? 'mmrnmhrm_secondary_y' : 'mmrnmhrm_secondary_x' });
  }

  return spawns;
}

export const mmrnmhrmController: ShipController = {
  maxCrew: MMRNMHRM_MAX_CREW,
  maxEnergy: MMRNMHRM_MAX_ENERGY,

  make: makeMmrnmhrmShip,
  update: updateMmrnmhrmShip,

  loadSprites: () => loadMmrnmhrmSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as MmrnmhrmSprites | null;
    const bodySet = isYForm(ship) ? sp?.ywing : sp;
    const set = bodySet
      ? (dc.reduction >= 2 ? bodySet.sml : dc.reduction === 1 ? bodySet.med : bodySet.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, isYForm(ship) ? '#9eff9d' : '#ff8a8a', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as MmrnmhrmSprites | null;
    const bodySet = isYForm(ship) ? sp?.ywing : sp;
    return bodySet?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as MmrnmhrmSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.torpedo.sml : dc.reduction === 1 ? sp.torpedo.med : sp.torpedo.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, m.facing, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 3, '#98ffb2', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as MmrnmhrmSprites | null;
    return sp?.torpedo.big.frames[m.facing] ?? null;
  },

  applySpawn(
    s,
    ownShip,
    enemyShip,
    _ownSide,
    _missiles,
    addLaser,
    _addTractorShadow,
    _damageMissile,
    _emitSound,
    enemyType,
  ): void {
    if (s.type !== 'point_defense') return;

    const angle = (ownShip.facing * 4) & 63;
    const cx = ownShip.x + COSINE(angle, X_CENTER_OFFS);
    const cy = ownShip.y + SINE(angle, X_CENTER_OFFS);
    const ex = cx + COSINE(angle, X_LASER_RANGE);
    const ey = cy + SINE(angle, X_LASER_RANGE);
    const offsX = -SINE(angle, X_WING_OFFS);
    const offsY = COSINE(angle, X_WING_OFFS);
    const delta = worldDelta(cx, cy, enemyShip.x, enemyShip.y);

    const beams = [
      { x1: cx + offsX, y1: cy + offsY, x2: ex, y2: ey },
      { x1: cx - offsX, y1: cy - offsY, x2: ex, y2: ey },
    ];

    let totalDamage = 0;
    for (const beam of beams) {
      addLaser({ x1: beam.x1, y1: beam.y1, x2: beam.x2, y2: beam.y2, color: '#ff7a7a' });
      const distance = pointToSegmentDistance(delta.dx + cx, delta.dy + cy, beam.x1, beam.y1, beam.x2, beam.y2);
      if (distance <= DISPLAY_TO_WORLD(8)) totalDamage++;
    }

    if (totalDamage > 0) {
      const absorb = SHIP_REGISTRY[enemyType].absorbHit?.(enemyShip, { kind: 'laser', damage: totalDamage });
      if (!absorb?.absorbed) {
        enemyShip.crew = Math.max(0, enemyShip.crew - totalDamage);
      }
    }
  },

  getCollisionMass(): number {
    return MMRNMHRM_SHIP_MASS;
  },

  computeAIInput(ship: ShipState, target: ShipState, _missiles: BattleMissile[], _aiSide: 0 | 1, aiLevel: AIDifficulty): number {
    let input = 0;
    const angleToTarget = worldAngle(ship.x, ship.y, target.x, target.y);
    const targetFacing = ((angleToTarget + 2) >> 2) & 15;
    const diff = (targetFacing - ship.facing + 16) % 16;
    if (diff >= 1 && diff <= 8) input |= INPUT_RIGHT;
    else if (diff > 8) input |= INPUT_LEFT;

    const { dx, dy } = worldDelta(ship.x, ship.y, target.x, target.y);
    const distanceSq = dx * dx + dy * dy;
    const wantYForm = distanceSq > DISPLAY_TO_WORLD(aiLevel === 'cyborg_awesome' ? 140 : 110) ** 2;
    if ((wantYForm && !isYForm(ship)) || (!wantYForm && isYForm(ship))) {
      if (ship.energy >= TRANSFORM_COST) input |= INPUT_FIRE2;
    }

    if (!wantYForm || aiLevel !== 'cyborg_weak') input |= INPUT_THRUST;
    if (diff <= (isYForm(ship) ? 1 : 2) || diff >= 15) input |= INPUT_FIRE1;

    return input;
  },
};
