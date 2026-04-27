// Thraddash Torch — ported from uqm-0.8.0/src/uqm/ships/thradd/thradd.c
//
// Primary: ion blaster horn bolt
// Special: afterburner thrust that leaves damaging napalm behind

import type { AIDifficulty } from 'shared/types';
import { INPUT_FIRE1, INPUT_FIRE2, INPUT_LEFT, INPUT_RIGHT, INPUT_THRUST } from '../game';
import { worldAngle, worldDelta } from '../battle/helpers';
import {
  DISPLAY_TO_WORLD,
  VELOCITY_TO_WORLD,
  setVelocityComponents,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import {
  drawSprite,
  loadThraddashSprites,
  placeholderDot,
  type SpriteFrame,
  type ThraddashSprites,
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
import { applyShipInertialThrust } from './thrust';

export const THRADDASH_MAX_CREW = 8;
export const THRADDASH_MAX_ENERGY = 24;
export const THRADDASH_ENERGY_REGENERATION = 1;
export const THRADDASH_ENERGY_WAIT = 6;
export const THRADDASH_MAX_THRUST = 28;
export const THRADDASH_THRUST_INCREMENT = 7;
export const THRADDASH_THRUST_WAIT = 0;
export const THRADDASH_TURN_WAIT = 1;
export const THRADDASH_SHIP_MASS = 7;

export const THRADDASH_WEAPON_ENERGY_COST = 2;
export const THRADDASH_WEAPON_WAIT = 12;
export const THRADDASH_MISSILE_SPEED = DISPLAY_TO_WORLD(30);
export const THRADDASH_MISSILE_LIFE = 15;
export const THRADDASH_MISSILE_OFFSET = DISPLAY_TO_WORLD(9);
export const THRADDASH_MISSILE_HITS = 2;
export const THRADDASH_MISSILE_DAMAGE = 1;

export const THRADDASH_SPECIAL_ENERGY_COST = 1;
export const THRADDASH_SPECIAL_THRUST_INCREMENT = 12;
export const THRADDASH_SPECIAL_MAX_THRUST = 72;
export const THRADDASH_NAPALM_LIFE = 48;
export const THRADDASH_NAPALM_DAMAGE = 2;
export const THRADDASH_NAPALM_HITS = 1;
export const THRADDASH_NAPALM_DECAY_RATE = 5;

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

function applyThrust(ship: ShipState, maxThrust: number, thrustIncrement: number, obeyCooldown: boolean): void {
  if (obeyCooldown && ship.thrustWait > 0) {
    ship.thrustWait--;
    return;
  }

  if (obeyCooldown) {
    ship.thrustWait = THRADDASH_THRUST_WAIT;
  }

  applyShipInertialThrust(ship, maxThrust, thrustIncrement);
}

function napalmFrame(m: BattleMissile): number {
  return Math.max(0, Math.min(7, Math.floor((m.life - 1) / (THRADDASH_NAPALM_DECAY_RATE + 1))));
}

export function makeThraddashShip(x: number, y: number): ShipState {
  return {
    x,
    y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: THRADDASH_MAX_CREW,
    energy: THRADDASH_MAX_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: false,
  };
}

export function updateThraddashShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else if (input & INPUT_LEFT) {
    ship.facing = (ship.facing + 15) & 15;
    ship.turnWait = THRADDASH_TURN_WAIT;
  } else if (input & INPUT_RIGHT) {
    ship.facing = (ship.facing + 1) & 15;
    ship.turnWait = THRADDASH_TURN_WAIT;
  }

  ship.thrusting = false;
  if ((input & INPUT_FIRE2) && ship.energy >= THRADDASH_SPECIAL_ENERGY_COST) {
    ship.energy -= THRADDASH_SPECIAL_ENERGY_COST;
    applyThrust(ship, THRADDASH_SPECIAL_MAX_THRUST, THRADDASH_SPECIAL_THRUST_INCREMENT, false);
    spawns.push({
      type: 'missile',
      x: ship.x,
      y: ship.y,
      facing: 0,
      speed: 0,
      maxSpeed: 0,
      accel: 0,
      life: THRADDASH_NAPALM_LIFE,
      hits: THRADDASH_NAPALM_HITS,
      damage: THRADDASH_NAPALM_DAMAGE,
      tracks: false,
      trackRate: 0,
      preserveVelocity: true,
      weaponType: 'thraddash_napalm',
    });
    spawns.push({ type: 'sound', sound: 'secondary' });
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    applyThrust(ship, THRADDASH_MAX_THRUST, THRADDASH_THRUST_INCREMENT, true);
  } else if (ship.thrustWait > 0) {
    ship.thrustWait--;
  }

  advancePosition(ship);

  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < THRADDASH_MAX_ENERGY) {
    ship.energy = Math.min(THRADDASH_MAX_ENERGY, ship.energy + THRADDASH_ENERGY_REGENERATION);
    ship.energyWait = THRADDASH_ENERGY_WAIT;
  }

  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if ((input & INPUT_FIRE1) && ship.energy >= THRADDASH_WEAPON_ENERGY_COST) {
    ship.energy -= THRADDASH_WEAPON_ENERGY_COST;
    ship.weaponWait = THRADDASH_WEAPON_WAIT;
    const angle = (ship.facing * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(angle, THRADDASH_MISSILE_OFFSET),
      y: ship.y + SINE(angle, THRADDASH_MISSILE_OFFSET),
      facing: ship.facing,
      speed: THRADDASH_MISSILE_SPEED,
      maxSpeed: THRADDASH_MISSILE_SPEED,
      accel: 0,
      life: THRADDASH_MISSILE_LIFE,
      hits: THRADDASH_MISSILE_HITS,
      damage: THRADDASH_MISSILE_DAMAGE,
      tracks: false,
      trackRate: 0,
      weaponType: 'thraddash_horn',
    });
  }

  return spawns;
}

export const thraddashController: ShipController = {
  maxCrew: THRADDASH_MAX_CREW,
  maxEnergy: THRADDASH_MAX_ENERGY,

  make: makeThraddashShip,
  update: updateThraddashShip,

  loadSprites: () => loadThraddashSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as ThraddashSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, '#ff8a47', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as ThraddashSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as ThraddashSprites | null;
    if (!sp) {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, m.weaponType === 'thraddash_napalm' ? 4 : 3, '#ffb347', dc.reduction, dc.worldW, dc.worldH);
      return;
    }
    if (m.weaponType === 'thraddash_napalm') {
      const set = dc.reduction >= 2 ? sp.napalm.sml : dc.reduction === 1 ? sp.napalm.med : sp.napalm.big;
      drawSprite(dc.ctx, set, napalmFrame(m), m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
      return;
    }
    const set = dc.reduction >= 2 ? sp.horn.sml : dc.reduction === 1 ? sp.horn.med : sp.horn.big;
    drawSprite(dc.ctx, set, m.facing, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as ThraddashSprites | null;
    if (!sp) return null;
    if (m.weaponType === 'thraddash_napalm') return sp.napalm.big.frames[napalmFrame(m)] ?? null;
    return sp.horn.big.frames[m.facing] ?? null;
  },

  processMissile(m: BattleMissile): MissileEffect {
    if (m.weaponType !== 'thraddash_napalm') return {};
    m.x = m.prevX;
    m.y = m.prevY;
    setVelocityComponents(m.velocity, 0, 0);
    return { skipVelocityUpdate: true };
  },

  onMissileHit(m: BattleMissile, target: ShipState | null): MissileHitEffect {
    if (m.weaponType === 'thraddash_napalm' && target) {
      return { skipBlast: true };
    }
    return {};
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
    const danger = missiles.some(m => {
      if (m.owner === aiSide) return false;
      const d = worldDelta(ship.x, ship.y, m.x, m.y);
      return d.dx * d.dx + d.dy * d.dy <= DISPLAY_TO_WORLD(100) ** 2;
    });

    if (distanceSq <= DISPLAY_TO_WORLD(180) ** 2 && (diff === 0 || (aiLevel !== 'cyborg_weak' && (diff <= 1 || diff >= 15)))) {
      input |= INPUT_FIRE1;
    }

    if (danger || distanceSq > DISPLAY_TO_WORLD(aiLevel === 'cyborg_awesome' ? 180 : 140) ** 2) {
      input |= INPUT_FIRE2;
    } else if (distanceSq > DISPLAY_TO_WORLD(80) ** 2) {
      input |= INPUT_THRUST;
    }

    return input;
  },
};
