// Umgah Drone — ported from uqm-0.8.0/src/uqm/ships/umgah/umgah.c
//
// Primary: free antimatter cone that continuously fires while held and
// resets the battery recharge timer.
// Special: non-inertial backwards retropropulsion burst.

import type { AIDifficulty } from 'shared/types';
import { INPUT_FIRE1, INPUT_FIRE2, INPUT_LEFT, INPUT_RIGHT, INPUT_THRUST } from '../game';
import {
  VELOCITY_TO_WORLD,
  WORLD_TO_VELOCITY,
  getCurrentVelocityComponents,
  setVelocityComponents,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import {
  drawSprite,
  loadUmgahSprites,
  placeholderDot,
  type SpriteFrame,
  type UmgahSprites,
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
import { applyShipInertialThrust, clearShipSpeedFlags } from './thrust';

export const UMGAH_MAX_CREW = 10;
export const UMGAH_MAX_ENERGY = 30;
export const UMGAH_ENERGY_REGENERATION = UMGAH_MAX_ENERGY;
export const UMGAH_ENERGY_WAIT = 150;
export const UMGAH_MAX_THRUST = 18;
export const UMGAH_THRUST_INCREMENT = 6;
export const UMGAH_THRUST_WAIT = 3;
export const UMGAH_TURN_WAIT = 4;
export const UMGAH_SHIP_MASS = 1;

export const UMGAH_CONE_HITS = 100;
export const UMGAH_CONE_DAMAGE = 1;
export const UMGAH_CONE_LIFE = 2;

export const UMGAH_SPECIAL_ENERGY_COST = 1;
export const UMGAH_JUMP_DIST = 160;

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
  applyShipInertialThrust(ship, UMGAH_MAX_THRUST, UMGAH_THRUST_INCREMENT);
}

function resetRechargeTimer(ship: ShipState): void {
  ship.energyWait = UMGAH_ENERGY_WAIT;
}

function coneFrameIndex(ship: ShipState): number {
  const cycle = ship.umgahConeCycle ?? 0;
  return (cycle << 4) + (ship.facing & 15);
}

export function makeUmgahShip(x: number, y: number): ShipState {
  return {
    x,
    y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: UMGAH_MAX_CREW,
    energy: UMGAH_MAX_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: false,
    umgahConeCycle: 0,
    umgahZipPending: false,
  };
}

export function updateUmgahShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else if (input & INPUT_LEFT) {
    ship.facing = (ship.facing + 15) & 15;
    ship.turnWait = UMGAH_TURN_WAIT;
  } else if (input & INPUT_RIGHT) {
    ship.facing = (ship.facing + 1) & 15;
    ship.turnWait = UMGAH_TURN_WAIT;
  }

  ship.thrusting = false;

  const specialHeld = (input & INPUT_FIRE2) !== 0;
  if (specialHeld && ship.energy >= UMGAH_SPECIAL_ENERGY_COST) {
    ship.energy -= UMGAH_SPECIAL_ENERGY_COST;
    resetRechargeTimer(ship);
    const angle = ((ship.facing * 4) + 32) & 63;
    const { dx, dy } = getCurrentVelocityComponents(ship.velocity);
    setVelocityComponents(
      ship.velocity,
      dx + COSINE(angle, WORLD_TO_VELOCITY(UMGAH_JUMP_DIST)),
      dy + SINE(angle, WORLD_TO_VELOCITY(UMGAH_JUMP_DIST)),
    );
    clearShipSpeedFlags(ship);
    ship.umgahZipPending = true;
    spawns.push({ type: 'sound', sound: 'secondary' });
  } else if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = UMGAH_THRUST_WAIT;
    applyThrust(ship);
  }

  advancePosition(ship);

  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < UMGAH_MAX_ENERGY) {
    ship.energy = Math.min(UMGAH_MAX_ENERGY, ship.energy + UMGAH_ENERGY_REGENERATION);
  }

  if (input & INPUT_FIRE1) {
    resetRechargeTimer(ship);
    ship.umgahConeCycle = ((ship.umgahConeCycle ?? 0) + 1) % 3;
    spawns.push({
      type: 'missile',
      x: ship.x,
      y: ship.y,
      facing: coneFrameIndex(ship),
      speed: 0,
      maxSpeed: 0,
      accel: 0,
      life: UMGAH_CONE_LIFE,
      hits: UMGAH_CONE_HITS,
      damage: UMGAH_CONE_DAMAGE,
      tracks: false,
      trackRate: 0,
      preserveVelocity: true,
      weaponType: 'umgah_cone',
    });
  }

  return spawns;
}

export const umgahController: ShipController = {
  maxCrew: UMGAH_MAX_CREW,
  maxEnergy: UMGAH_MAX_ENERGY,

  make: makeUmgahShip,
  update: updateUmgahShip,

  loadSprites: () => loadUmgahSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as UmgahSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, '#f4c778', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as UmgahSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as UmgahSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.cone.sml : dc.reduction === 1 ? sp.cone.med : sp.cone.big)
      : null;
    if (set?.frames[m.facing]) {
      drawSprite(dc.ctx, set, m.facing, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 10, '#ffd67c', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as UmgahSprites | null;
    return sp?.cone.big.frames[m.facing] ?? null;
  },

  processMissile(m: BattleMissile, ownShip: ShipState): MissileEffect {
    if (m.weaponType !== 'umgah_cone') return {};
    m.x = ownShip.x;
    m.y = ownShip.y;
    setVelocityComponents(m.velocity, 0, 0);
    return { skipVelocityUpdate: true };
  },

  onMissileHit(m: BattleMissile): MissileHitEffect {
    if (m.weaponType !== 'umgah_cone') return {};
    return {
      keepMissileAlive: true,
      skipBlast: true,
    };
  },

  postUpdateShip(ship: ShipState): void {
    if (!ship.umgahZipPending) return;
    ship.umgahZipPending = false;
    setVelocityComponents(ship.velocity, 0, 0);
    clearShipSpeedFlags(ship);
  },

  computeAIInput(ship: ShipState, target: ShipState, missiles: BattleMissile[], aiSide: 0 | 1, aiLevel: AIDifficulty): number {
    let input = 0;

    const angleToTarget = worldAngle(ship.x, ship.y, target.x, target.y);
    const targetFacing = ((angleToTarget + 2) >> 2) & 15;
    const diff = (targetFacing - ship.facing + 16) % 16;
    if (diff >= 1 && diff <= 8) input |= INPUT_RIGHT;
    else if (diff > 8) input |= INPUT_LEFT;

    const { dx, dy } = worldDelta(ship.x, ship.y, target.x, target.y);
    const distanceSq = dx * dx + dy * dy;
    const closeRange = 240;
    const coneRange = 160;
    const threatRange = aiLevel === 'cyborg_awesome' ? 320 : aiLevel === 'cyborg_good' ? 260 : 220;
    const targetBehind = ((targetFacing + 8) & 15) === ship.facing || distanceSq <= closeRange * closeRange;
    const incoming = missiles.some(m => {
      if (m.owner === aiSide) return false;
      const delta = worldDelta(ship.x, ship.y, m.x, m.y);
      return delta.dx * delta.dx + delta.dy * delta.dy <= threatRange * threatRange;
    });

    if (distanceSq <= coneRange * coneRange && (diff <= 1 || diff >= 15)) {
      input |= INPUT_FIRE1;
    }

    if (ship.energy > 0 && (incoming || targetBehind)) {
      input |= INPUT_FIRE2;
    } else if (distanceSq > closeRange * closeRange) {
      input |= INPUT_THRUST;
    }

    return input;
  },
};
