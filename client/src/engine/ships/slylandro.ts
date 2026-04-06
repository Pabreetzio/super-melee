import type { AIDifficulty } from 'shared/types';
import { INPUT_FIRE1, INPUT_FIRE2, INPUT_LEFT, INPUT_RIGHT, INPUT_THRUST } from '../game';
import { DISPLAY_TO_WORLD, VELOCITY_TO_WORLD, setVelocityVector } from '../velocity';
import { drawSprite, loadGenericShipSprites, placeholderDot, type SpriteFrame, type SpriteSet } from '../sprites';
import { COSINE, SINE } from '../sinetab';
import type { BattleMissile, DrawContext, ShipController, ShipState, SpawnRequest } from './types';
import { SHIP_REGISTRY } from './registry';
import { worldAngle, worldDelta } from '../battle/helpers';

const SLYLANDRO_MAX_CREW = 12;
const SLYLANDRO_MAX_ENERGY = 20;
const SLYLANDRO_MAX_THRUST = 60;
const SLYLANDRO_SHIP_MASS = 1;
const SLYLANDRO_WEAPON_COST = 2;
const SLYLANDRO_WEAPON_WAIT = 17;
const SLYLANDRO_LIGHTNING_RANGE = DISPLAY_TO_WORLD(36);

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

function lightningColor(cycle: number): string {
  return ['#ffffff', '#d6e2ff', '#9cb4ff', '#6d84ff'][cycle & 3];
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
    slylandroLightningCycle: 0,
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
  else if ((input & INPUT_FIRE1) && ship.energy >= SLYLANDRO_WEAPON_COST) {
    ship.energy -= SLYLANDRO_WEAPON_COST;
    ship.weaponWait = SLYLANDRO_WEAPON_WAIT;
    ship.slylandroLightningCycle = ((ship.slylandroLightningCycle ?? 0) + 1) & 3;
    spawns.push({ type: 'point_defense', x: ship.x, y: ship.y });
    spawns.push({ type: 'sound', sound: 'primary' });
  }

  if ((input & INPUT_FIRE2) && ship.energy < SLYLANDRO_MAX_ENERGY) {
    // Super Melee does not currently simulate free-floating space junk.
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

  applySpawn(
    s,
    ownShip,
    enemyShip,
    _ownSide,
    _missiles,
    addLaser,
    _damageMissile,
    _emitSound,
    enemyType,
  ): void {
    if (s.type !== 'point_defense') return;

    const delta = worldDelta(ownShip.x, ownShip.y, enemyShip.x, enemyShip.y);
    const distanceSq = delta.dx * delta.dx + delta.dy * delta.dy;
    if (distanceSq > SLYLANDRO_LIGHTNING_RANGE * SLYLANDRO_LIGHTNING_RANGE) return;

    const angleToTarget = worldAngle(ownShip.x, ownShip.y, enemyShip.x, enemyShip.y);
    const targetFacing = ((angleToTarget + 2) >> 2) & 15;
    const diff = (targetFacing - ownShip.facing + 16) % 16;
    if (diff > 3 && diff < 13) return;

    const color = lightningColor(ownShip.slylandroLightningCycle ?? 0);
    const steps = 3;
    let lastX = ownShip.x;
    let lastY = ownShip.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const jitterAngle = (angleToTarget + (i % 2 === 0 ? 8 : -8) + 64) & 63;
      const jitter = i === steps ? 0 : DISPLAY_TO_WORLD(2 + (i & 1));
      const nextX = i === steps ? enemyShip.x : ownShip.x + Math.round(delta.dx * t) + COSINE(jitterAngle, jitter);
      const nextY = i === steps ? enemyShip.y : ownShip.y + Math.round(delta.dy * t) + SINE(jitterAngle, jitter);
      addLaser({ x1: lastX, y1: lastY, x2: nextX, y2: nextY, color });
      lastX = nextX;
      lastY = nextY;
    }

    const absorb = SHIP_REGISTRY[enemyType].absorbHit?.(enemyShip, { kind: 'laser', damage: 3 });
    if (!absorb?.absorbed) {
      enemyShip.crew = Math.max(0, enemyShip.crew - 3);
    }
  },

  getCollisionMass(): number {
    return SLYLANDRO_SHIP_MASS;
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
    const closeRange = DISPLAY_TO_WORLD(aiLevel === 'cyborg_awesome' ? 44 : 36);
    if (distanceSq <= closeRange * closeRange && (diff <= 2 || diff >= 14)) {
      input |= INPUT_FIRE1;
    }

    return input;
  },
};
