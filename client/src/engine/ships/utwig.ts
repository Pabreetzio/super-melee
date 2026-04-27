import type { AIDifficulty } from 'shared/types';
import { INPUT_FIRE1, INPUT_FIRE2, INPUT_LEFT, INPUT_RIGHT, INPUT_THRUST } from '../game';
import {
  VELOCITY_TO_WORLD,
} from '../velocity';
import { drawSprite, drawSpriteFill, loadUtwigSprites, placeholderDot, type SpriteFrame, type UtwigSprites } from '../sprites';
import { COSINE, SINE } from '../sinetab';
import type { BattleMissile, DrawContext, ShipController, ShipState, SpawnRequest } from './types';
import { worldAngle, worldDelta } from '../battle/helpers';
import { applyShipInertialThrust } from './thrust';

const UTWIG_MAX_CREW = 20;
const UTWIG_MAX_ENERGY = 20;
const UTWIG_START_ENERGY = 10;
const UTWIG_MAX_THRUST = 36;
const UTWIG_THRUST_INCREMENT = 6;
const UTWIG_THRUST_WAIT = 6;
const UTWIG_TURN_WAIT = 1;
const UTWIG_SHIP_MASS = 8;

const UTWIG_WEAPON_WAIT = 7;
const UTWIG_MISSILE_SPEED = 120;
const UTWIG_MISSILE_LIFE = 10;
const UTWIG_MISSILE_DAMAGE = 1;

const UTWIG_SPECIAL_COST = 1;
const UTWIG_SPECIAL_WAIT = 12;
const UTWIG_DRAIN_INTERVAL = UTWIG_SPECIAL_WAIT >> 1;
const UTWIG_SHIELD_COLORS = [
  'rgb(255,173,0)',
  'rgb(255,112,0)',
  'rgb(255,56,0)',
  'rgb(255,0,0)',
  'rgb(189,0,0)',
  'rgb(123,0,0)',
] as const;

const LAUNCH_OFFSETS: Array<[number, number]> = [
  [20, -72],
  [52, -36],
  [68, -16],
];

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
  applyShipInertialThrust(ship, UTWIG_MAX_THRUST, UTWIG_THRUST_INCREMENT);
}

function rotateOffset(facing: number, offsetX: number, offsetY: number): { x: number; y: number } {
  const angle = (facing * 4 + 16) & 63;
  const cos1cos0 = COSINE(angle, offsetX);
  const sin1sin0 = SINE(angle, offsetY);
  const sin1cos0 = SINE(angle, offsetX);
  const cos1sin0 = COSINE(angle, offsetY);
  return {
    x: cos1cos0 - sin1sin0,
    y: sin1cos0 + cos1sin0,
  };
}

function shieldActive(ship: ShipState): boolean {
  return (ship.utwigShieldFrames ?? 0) > 0;
}

export function makeUtwigShip(x: number, y: number): ShipState {
  return {
    x,
    y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: UTWIG_MAX_CREW,
    energy: UTWIG_START_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: false,
    utwigShieldFrames: 0,
    utwigShieldDrainWait: 0,
    utwigShieldCycle: 0,
  };
}

export function updateUtwigShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else if (input & INPUT_LEFT) {
    ship.facing = (ship.facing + 15) & 15;
    ship.turnWait = UTWIG_TURN_WAIT;
  } else if (input & INPUT_RIGHT) {
    ship.facing = (ship.facing + 1) & 15;
    ship.turnWait = UTWIG_TURN_WAIT;
  }

  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = UTWIG_THRUST_WAIT;
    applyThrust(ship);
  }

  advancePosition(ship);

  if (ship.weaponWait > 0) ship.weaponWait--;
  if (ship.specialWait > 0) ship.specialWait--;

  const shielding = (input & INPUT_FIRE2) !== 0 && ship.energy > 0;
  if (shielding) {
    const newlyRaised = !shieldActive(ship);
    ship.utwigShieldFrames = 1;
    ship.utwigShieldCycle = newlyRaised ? 0 : ((ship.utwigShieldCycle ?? 0) + 1) % UTWIG_SHIELD_COLORS.length;
    if (newlyRaised) {
      ship.utwigShieldDrainWait = UTWIG_DRAIN_INTERVAL;
      spawns.push({ type: 'sound', sound: 'secondary' });
    } else if ((ship.utwigShieldDrainWait ?? 0) > 0) {
      ship.utwigShieldDrainWait!--;
    } else if (ship.energy >= UTWIG_SPECIAL_COST) {
      ship.energy -= UTWIG_SPECIAL_COST;
      ship.utwigShieldDrainWait = UTWIG_DRAIN_INTERVAL;
    } else {
      ship.utwigShieldFrames = 0;
    }
  } else {
    ship.utwigShieldFrames = 0;
    ship.utwigShieldDrainWait = 0;
    ship.utwigShieldCycle = 0;
  }

  if (!shieldActive(ship) && ship.weaponWait === 0 && (input & INPUT_FIRE1)) {
    ship.weaponWait = UTWIG_WEAPON_WAIT;
    spawns.push({ type: 'sound', sound: 'primary' });
    for (const [ox, oy] of LAUNCH_OFFSETS) {
      const left = rotateOffset(ship.facing, ox, oy);
      const right = rotateOffset(ship.facing, -ox, oy);
      spawns.push(
        {
          type: 'missile',
          x: ship.x + left.x,
          y: ship.y + left.y,
          facing: ship.facing,
          speed: UTWIG_MISSILE_SPEED,
          maxSpeed: UTWIG_MISSILE_SPEED,
          accel: 0,
          life: UTWIG_MISSILE_LIFE,
          hits: 1,
          damage: UTWIG_MISSILE_DAMAGE,
          tracks: false,
          trackRate: 0,
        },
        {
          type: 'missile',
          x: ship.x + right.x,
          y: ship.y + right.y,
          facing: ship.facing,
          speed: UTWIG_MISSILE_SPEED,
          maxSpeed: UTWIG_MISSILE_SPEED,
          accel: 0,
          life: UTWIG_MISSILE_LIFE,
          hits: 1,
          damage: UTWIG_MISSILE_DAMAGE,
          tracks: false,
          trackRate: 0,
        },
      );
    }
  }

  return spawns;
}

export const utwigController: ShipController = {
  maxCrew: UTWIG_MAX_CREW,
  maxEnergy: UTWIG_MAX_ENERGY,

  make: makeUtwigShip,
  update: updateUtwigShip,

  loadSprites: () => loadUtwigSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as UtwigSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 9, '#d4a84f', dc.reduction, dc.worldW, dc.worldH);
    }

    if (set && shieldActive(ship)) {
      const cycle = ship.utwigShieldCycle ?? 0;
      drawSpriteFill(
        dc.ctx,
        set,
        ship.facing,
        ship.x,
        ship.y,
        dc.canvasW,
        dc.canvasH,
        dc.camX,
        dc.camY,
        UTWIG_SHIELD_COLORS[cycle],
        dc.reduction,
        dc.worldW,
        dc.worldH,
      );
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as UtwigSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as UtwigSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.lance.sml : dc.reduction === 1 ? sp.lance.med : sp.lance.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, m.facing, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 2, '#ffe28a', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as UtwigSprites | null;
    return sp?.lance.big.frames[m.facing] ?? null;
  },

  absorbHit(ship: ShipState, hit) {
    if (!shieldActive(ship)) return null;

    if (hit.kind === 'missile' && (hit.weaponType === 'orz_marine' || hit.limpet)) {
      return null;
    }

    const gain = Math.max(0, hit.damage);
    if (gain > 0) {
      ship.energy = Math.min(UTWIG_MAX_ENERGY, ship.energy + gain);
    }
    return { absorbed: true, destroyIncoming: true, sound: 'utwig_shield_gain' };
  },

  getCollisionMass(): number {
    return UTWIG_SHIP_MASS;
  },

  computeAIInput(ship: ShipState, target: ShipState, missiles: BattleMissile[], aiSide: 0 | 1, aiLevel: AIDifficulty): number {
    let input = 0;
    const angleToTarget = worldAngle(ship.x, ship.y, target.x, target.y);
    const targetFacing = ((angleToTarget + 2) >> 2) & 15;
    const diff = (targetFacing - ship.facing + 16) % 16;
    if (diff >= 1 && diff <= 8) input |= INPUT_RIGHT;
    else if (diff > 8) input |= INPUT_LEFT;

    const threatRange = aiLevel === 'cyborg_awesome' ? 180 : aiLevel === 'cyborg_good' ? 140 : 96;
    const underThreat = missiles.some(m => {
      if (m.owner === aiSide) return false;
      const delta = worldDelta(ship.x, ship.y, m.x, m.y);
      return delta.dx * delta.dx + delta.dy * delta.dy <= threatRange * threatRange;
    });
    if (underThreat && ship.energy > 0) input |= INPUT_FIRE2;
    else if (diff <= 1 || diff >= 15) input |= INPUT_FIRE1;

    const { dx, dy } = worldDelta(ship.x, ship.y, target.x, target.y);
    if (dx * dx + dy * dy > 100 * 100) input |= INPUT_THRUST;

    return input;
  },
};
