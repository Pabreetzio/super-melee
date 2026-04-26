import type { AIDifficulty } from 'shared/types';
import { INPUT_FIRE1, INPUT_FIRE2, INPUT_LEFT, INPUT_RIGHT, INPUT_THRUST } from '../game';
import { DISPLAY_TO_WORLD, VELOCITY_TO_WORLD, setVelocityVector } from '../velocity';
import { drawSprite, loadGenericShipSprites, placeholderDot, type SpriteFrame, type SpriteSet } from '../sprites';
import type { BattleMissile, DrawContext, ShipController, ShipState, SpawnRequest } from './types';
import { worldAngle, worldDelta } from '../battle/helpers';

const SLYLANDRO_MAX_CREW = 12;
const SLYLANDRO_MAX_ENERGY = 20;
const SLYLANDRO_MAX_THRUST = 60;
const SLYLANDRO_SHIP_MASS = 1;
const SLYLANDRO_WEAPON_COST = 2;
export const SLYLANDRO_WEAPON_WAIT = 17;
export const SLYLANDRO_LIGHTNING_DAMAGE = 1;
export const SLYLANDRO_LIGHTNING_SEGMENT_LENGTH = 32;
const SLYLANDRO_SPECIAL_WAIT = 20;
const SLYLANDRO_HARVEST_RANGE = DISPLAY_TO_WORLD(78);

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

function emitLightning(spawns: SpawnRequest[], playSound = false): void {
  spawns.push({ type: 'slylandro_lightning', playSound });
}

export function makeSlylandroShip(x: number, y: number): ShipState {
  const ship: ShipState = {
    x,
    y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: SLYLANDRO_MAX_CREW,
    energy: SLYLANDRO_MAX_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: true,
    slylandroReversePressed: false,
  };
  setVelocityVector(ship.velocity, SLYLANDRO_MAX_THRUST, ship.facing);
  return ship;
}

export function updateSlylandroShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  const reverseHeld = (input & INPUT_THRUST) !== 0;
  if (reverseHeld && !ship.slylandroReversePressed) {
    ship.facing = (ship.facing + 8) & 15;
  }
  ship.slylandroReversePressed = reverseHeld;

  if (input & INPUT_LEFT) ship.facing = (ship.facing + 15) & 15;
  else if (input & INPUT_RIGHT) ship.facing = (ship.facing + 1) & 15;

  ship.thrusting = true;
  setVelocityVector(ship.velocity, SLYLANDRO_MAX_THRUST, ship.facing);
  advancePosition(ship);

  if (ship.weaponWait > 0) ship.weaponWait--;
  if (ship.specialWait > 0) ship.specialWait--;
  if (ship.weaponWait === 0 && (input & INPUT_FIRE1) && ship.energy >= SLYLANDRO_WEAPON_COST) {
    ship.energy -= SLYLANDRO_WEAPON_COST;
    ship.weaponWait = SLYLANDRO_WEAPON_WAIT;
    emitLightning(spawns, true);
  } else if (ship.weaponWait > 0) {
    emitLightning(spawns);
  }

  return spawns;
}

export const slylandroController: ShipController = {
  maxCrew: SLYLANDRO_MAX_CREW,
  maxEnergy: SLYLANDRO_MAX_ENERGY,

  make: makeSlylandroShip,
  update: updateSlylandroShip,

  loadSprites: () => loadGenericShipSprites('slylandro'),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as { big: SpriteSet; med: SpriteSet; sml: SpriteSet } | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 9, '#89ccff', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as { big?: { frames: (SpriteFrame | null)[] } } | null;
    return sp?.big?.frames[ship.facing] ?? null;
  },

  isCrewImmune(): boolean {
    return true;
  },

  getCollisionMass(): number {
    return SLYLANDRO_SHIP_MASS;
  },

  interactWithEnvironment(ship, input, env) {
    if (!(input & INPUT_FIRE2) || ship.specialWait > 0 || ship.energy >= SLYLANDRO_MAX_ENERGY) {
      return;
    }
    if (!env.harvestNearbyJunk(ship.x, ship.y, SLYLANDRO_HARVEST_RANGE)) {
      return;
    }
    ship.energy = SLYLANDRO_MAX_ENERGY;
    ship.specialWait = SLYLANDRO_SPECIAL_WAIT;
    return { sounds: ['secondary'] };
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
    const fireRange = DISPLAY_TO_WORLD(aiLevel === 'cyborg_awesome' ? 168 : 132);
    if (distanceSq <= fireRange * fireRange) {
      input |= INPUT_FIRE1;
    }

    return input;
  },
};
