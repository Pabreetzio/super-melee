// Yehat Terminator — ported from uqm-0.8.0/src/uqm/ships/yehat/yehat.c
//
// Primary: twin pulse cannon
// Special: force shield

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
import { drawSprite, loadYehatSprites, placeholderDot, type SpriteFrame, type YehatSprites } from '../sprites';
import type { AIDifficulty } from 'shared/types';
import type { BattleMissile, DrawContext, ShipController, ShipState, SpawnRequest } from './types';
import { worldAngle, worldDelta } from '../battle/helpers';

export const YEHAT_MAX_CREW = 20;
export const YEHAT_MAX_ENERGY = 10;
export const YEHAT_ENERGY_REGENERATION = 2;
export const YEHAT_ENERGY_WAIT = 6;
export const YEHAT_MAX_THRUST = 30;
export const YEHAT_THRUST_INCREMENT = 6;
export const YEHAT_THRUST_WAIT = 2;
export const YEHAT_TURN_WAIT = 2;
export const YEHAT_SHIP_MASS = 3;

export const YEHAT_WEAPON_ENERGY_COST = 1;
export const YEHAT_WEAPON_WAIT = 0;
export const YEHAT_OFFSET = DISPLAY_TO_WORLD(16);
export const YEHAT_LAUNCH_OFFS = DISPLAY_TO_WORLD(8);
export const YEHAT_MISSILE_SPEED = DISPLAY_TO_WORLD(20);
export const YEHAT_MISSILE_LIFE = 10;
export const YEHAT_MISSILE_HITS = 1;
export const YEHAT_MISSILE_DAMAGE = 1;

export const YEHAT_SPECIAL_ENERGY_COST = 3;
export const YEHAT_SPECIAL_WAIT = 2;
export const YEHAT_SHIELD_LIFE = 10;

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(YEHAT_MAX_THRUST) ** 2;

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

export function makeYehatShip(x: number, y: number): ShipState {
  return {
    x,
    y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: YEHAT_MAX_CREW,
    energy: YEHAT_MAX_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: false,
    yehatShieldFrames: 0,
  };
}

export function updateYehatShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];
  const shieldFrames = ship.yehatShieldFrames ?? 0;

  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing + 15) & 15;
      ship.turnWait = YEHAT_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) & 15;
      ship.turnWait = YEHAT_TURN_WAIT;
    }
  }

  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = YEHAT_THRUST_WAIT;

    const angle = (ship.facing * 4) & 63;
    const incV = WORLD_TO_VELOCITY(YEHAT_THRUST_INCREMENT);
    const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
    const newDx = curDx + COSINE(angle, incV);
    const newDy = curDy + SINE(angle, incV);
    const desiredSpeedSq = newDx * newDx + newDy * newDy;

    if (desiredSpeedSq <= MAX_SPEED_SQ) {
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else if (ship.velocity.travelAngle === angle) {
      setVelocityVector(ship.velocity, YEHAT_MAX_THRUST, ship.facing);
    }
  }

  advancePosition(ship);

  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < YEHAT_MAX_ENERGY) {
    ship.energy = Math.min(YEHAT_MAX_ENERGY, ship.energy + YEHAT_ENERGY_REGENERATION);
    ship.energyWait = YEHAT_ENERGY_WAIT;
  }

  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if (shieldFrames === 0 && (input & INPUT_FIRE1) && ship.energy >= YEHAT_WEAPON_ENERGY_COST) {
    ship.energy -= YEHAT_WEAPON_ENERGY_COST;
    const angle = (ship.facing * 4) & 63;
    const sideX = -SINE(angle, YEHAT_LAUNCH_OFFS);
    const sideY = COSINE(angle, YEHAT_LAUNCH_OFFS);
    const noseX = COSINE(angle, YEHAT_OFFSET);
    const noseY = SINE(angle, YEHAT_OFFSET);
    spawns.push({
      type: 'missile',
      x: ship.x + noseX + sideX,
      y: ship.y + noseY + sideY,
      facing: ship.facing,
      speed: YEHAT_MISSILE_SPEED,
      maxSpeed: YEHAT_MISSILE_SPEED,
      accel: 0,
      life: YEHAT_MISSILE_LIFE,
      hits: YEHAT_MISSILE_HITS,
      damage: YEHAT_MISSILE_DAMAGE,
      tracks: false,
      trackRate: 0,
    });
    spawns.push({
      type: 'missile',
      x: ship.x + noseX - sideX,
      y: ship.y + noseY - sideY,
      facing: ship.facing,
      speed: YEHAT_MISSILE_SPEED,
      maxSpeed: YEHAT_MISSILE_SPEED,
      accel: 0,
      life: YEHAT_MISSILE_LIFE,
      hits: YEHAT_MISSILE_HITS,
      damage: YEHAT_MISSILE_DAMAGE,
      tracks: false,
      trackRate: 0,
    });
  }

  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if (shieldFrames === 0 && (input & INPUT_FIRE2) && ship.energy >= YEHAT_SPECIAL_ENERGY_COST) {
    ship.energy -= YEHAT_SPECIAL_ENERGY_COST;
    ship.specialWait = YEHAT_SPECIAL_WAIT;
    ship.yehatShieldFrames = YEHAT_SHIELD_LIFE;
    spawns.push({ type: 'sound', sound: 'secondary' });
  }

  if (shieldFrames > 0) {
    ship.yehatShieldFrames = shieldFrames - 1;
  }

  return spawns;
}

export const yehatController: ShipController = {
  maxCrew: YEHAT_MAX_CREW,
  maxEnergy: YEHAT_MAX_ENERGY,

  make: makeYehatShip,
  update: updateYehatShip,

  loadSprites: () => loadYehatSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as YehatSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, '#ffcf8c', dc.reduction, dc.worldW, dc.worldH);
    }

    const shieldFrames = ship.yehatShieldFrames ?? 0;
    if (shieldFrames > 0) {
      const shieldSet = sp
        ? (dc.reduction >= 2 ? sp.shield.sml : dc.reduction === 1 ? sp.shield.med : sp.shield.big)
        : null;
      if (shieldSet) {
        drawSprite(dc.ctx, shieldSet, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
      }
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as YehatSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as YehatSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.missile.sml : dc.reduction === 1 ? sp.missile.med : sp.missile.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, m.facing, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 3, '#9fd7ff', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as YehatSprites | null;
    return sp?.missile.big.frames[m.facing] ?? null;
  },

  isIntangible(ship: ShipState): boolean {
    return (ship.yehatShieldFrames ?? 0) > 0;
  },

  computeAIInput(ship: ShipState, target: ShipState, missiles: BattleMissile[], aiSide: 0 | 1, aiLevel: AIDifficulty): number {
    let input = 0;
    const targetAngle = worldAngle(ship.x, ship.y, target.x, target.y);
    const targetFacing = ((targetAngle + 2) >> 2) & 15;
    const diff = (targetFacing - ship.facing + 16) % 16;
    if (diff >= 1 && diff <= 8) input |= INPUT_RIGHT;
    else if (diff > 8) input |= INPUT_LEFT;

    const delta = worldDelta(ship.x, ship.y, target.x, target.y);
    const distanceSq = delta.dx * delta.dx + delta.dy * delta.dy;
    if (distanceSq > DISPLAY_TO_WORLD(72) ** 2 || aiLevel !== 'cyborg_weak') {
      input |= INPUT_THRUST;
    }

    if ((ship.yehatShieldFrames ?? 0) === 0 && ship.energy >= YEHAT_SPECIAL_ENERGY_COST) {
      const defenseRange = DISPLAY_TO_WORLD(aiLevel === 'cyborg_awesome' ? 112 : aiLevel === 'cyborg_good' ? 92 : 76);
      const urgentThreat = missiles.some(m => {
        if (m.owner === aiSide) return false;
        const threat = worldDelta(ship.x, ship.y, m.x, m.y);
        return threat.dx * threat.dx + threat.dy * threat.dy <= defenseRange * defenseRange;
      });
      const shipClose = distanceSq <= DISPLAY_TO_WORLD(60) ** 2 && target.crew > ship.crew;
      if (urgentThreat || shipClose) {
        input |= INPUT_FIRE2;
      }
    }

    if ((ship.yehatShieldFrames ?? 0) === 0 && (diff <= 1 || diff >= 15)) {
      input |= INPUT_FIRE1;
    }

    return input;
  },
};
