import type { AIDifficulty, ShipId } from 'shared/types';
import { INPUT_FIRE1, INPUT_FIRE2, INPUT_LEFT, INPUT_RIGHT, INPUT_THRUST } from '../game';
import {
  DISPLAY_TO_WORLD,
  VELOCITY_TO_WORLD,
  WORLD_TO_DISPLAY,
  WORLD_TO_VELOCITY,
  getCurrentVelocityComponents,
  setVelocityComponents,
  setVelocityVector,
  velocitySquared,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import { drawSprite, loadSyreenSprites, placeholderDot, type SpriteFrame, type SyreenSprites } from '../sprites';
import type { BattleMissile, DrawContext, ShipController, ShipState, SpawnRequest } from './types';
import { SHIP_REGISTRY } from './registry';
import { worldAngle, worldDelta } from '../battle/helpers';

const SYREEN_START_CREW = 12;
const SYREEN_MAX_CREW = 42;
const SYREEN_MAX_ENERGY = 16;
const SYREEN_ENERGY_REGEN = 1;
const SYREEN_ENERGY_WAIT = 6;
const SYREEN_MAX_THRUST = 36;
const SYREEN_THRUST_INCREMENT = 9;
const SYREEN_THRUST_WAIT = 1;
const SYREEN_TURN_WAIT = 1;
const SYREEN_SHIP_MASS = 2;

const SYREEN_WEAPON_COST = 1;
const SYREEN_WEAPON_WAIT = 8;
const SYREEN_OFFSET = DISPLAY_TO_WORLD(30);
const SYREEN_MISSILE_SPEED = DISPLAY_TO_WORLD(30);
const SYREEN_MISSILE_LIFE = 10;
const SYREEN_MISSILE_DAMAGE = 2;

const SYREEN_SPECIAL_COST = 5;
const SYREEN_SPECIAL_WAIT = 20;
const SYREEN_RANGE = 208;
const SYREEN_MAX_ABANDONERS = 8;
const SYREEN_CREW_POD_LIFE = 300;
const SYREEN_CREW_POD_COLLECT_DELAY = 8;
const SYREEN_CREW_POD_LAUNCH_DIST = DISPLAY_TO_WORLD(18);
const SYREEN_CREW_POD_SPREAD = DISPLAY_TO_WORLD(5);

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
  const angle = (ship.facing * 4) & 63;
  const incV = WORLD_TO_VELOCITY(SYREEN_THRUST_INCREMENT);
  const maxSpeedSq = WORLD_TO_VELOCITY(SYREEN_MAX_THRUST) ** 2;
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
    setVelocityVector(ship.velocity, SYREEN_MAX_THRUST, ship.facing);
  } else {
    setVelocityComponents(ship.velocity, newDx, newDy);
    const speed = Math.sqrt(velocitySquared(ship.velocity));
    if (speed > 0) {
      const scale = WORLD_TO_VELOCITY(SYREEN_MAX_THRUST) / speed;
      setVelocityComponents(ship.velocity, ship.velocity.vx * scale, ship.velocity.vy * scale);
    }
  }
}

function canStealCrew(enemyType: ShipId, enemyShip: ShipState): boolean {
  return enemyShip.crew > 1 && !SHIP_REGISTRY[enemyType].isCrewImmune?.(enemyShip);
}

export function makeSyreenShip(x: number, y: number): ShipState {
  return {
    x,
    y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: SYREEN_START_CREW,
    energy: SYREEN_MAX_ENERGY,
    thrustWait: 0,
    turnWait: 0,
    weaponWait: 0,
    specialWait: 0,
    energyWait: 0,
    thrusting: false,
  };
}

export function updateSyreenShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else if (input & INPUT_LEFT) {
    ship.facing = (ship.facing + 15) & 15;
    ship.turnWait = SYREEN_TURN_WAIT;
  } else if (input & INPUT_RIGHT) {
    ship.facing = (ship.facing + 1) & 15;
    ship.turnWait = SYREEN_TURN_WAIT;
  }

  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = SYREEN_THRUST_WAIT;
    applyThrust(ship);
  }

  advancePosition(ship);

  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < SYREEN_MAX_ENERGY) {
    ship.energy = Math.min(SYREEN_MAX_ENERGY, ship.energy + SYREEN_ENERGY_REGEN);
    ship.energyWait = SYREEN_ENERGY_WAIT;
  }

  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if ((input & INPUT_FIRE1) && ship.energy >= SYREEN_WEAPON_COST) {
    ship.energy -= SYREEN_WEAPON_COST;
    ship.weaponWait = SYREEN_WEAPON_WAIT;
    const angle = (ship.facing * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(angle, SYREEN_OFFSET),
      y: ship.y + SINE(angle, SYREEN_OFFSET),
      facing: ship.facing,
      speed: SYREEN_MISSILE_SPEED,
      maxSpeed: SYREEN_MISSILE_SPEED,
      accel: 0,
      life: SYREEN_MISSILE_LIFE,
      hits: 1,
      damage: SYREEN_MISSILE_DAMAGE,
      tracks: false,
      trackRate: 0,
    });
  }

  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2) && ship.energy >= SYREEN_SPECIAL_COST) {
    ship.energy -= SYREEN_SPECIAL_COST;
    ship.specialWait = SYREEN_SPECIAL_WAIT;
    spawns.push({ type: 'sound', sound: 'secondary' });
    spawns.push({ type: 'point_defense', x: ship.x, y: ship.y });
  }

  return spawns;
}

export const syreenController: ShipController = {
  maxCrew: SYREEN_MAX_CREW,
  maxEnergy: SYREEN_MAX_ENERGY,

  make: makeSyreenShip,
  update: updateSyreenShip,

  loadSprites: () => loadSyreenSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as SyreenSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 7, '#87d8ff', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as SyreenSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as SyreenSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.dagger.sml : dc.reduction === 1 ? sp.dagger.med : sp.dagger.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, m.facing, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 3, '#ffdca8', dc.reduction, dc.worldW, dc.worldH);
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as SyreenSprites | null;
    return sp?.dagger.big.frames[m.facing] ?? null;
  },

  applySpawn(
    s,
    ownShip,
    enemyShip,
    ownSide,
    _missiles,
    _addLaser,
    _damageMissile,
    _emitSound,
    enemyType,
    emitCrewPod,
  ): void {
    if (s.type !== 'point_defense' || !canStealCrew(enemyType, enemyShip)) return;

    const delta = worldDelta(ownShip.x, ownShip.y, enemyShip.x, enemyShip.y);
    const dx = Math.abs(WORLD_TO_DISPLAY(delta.dx));
    const dy = Math.abs(WORLD_TO_DISPLAY(delta.dy));
    if (dx > SYREEN_RANGE || dy > SYREEN_RANGE) return;

    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > SYREEN_RANGE) return;
    const worldDistance = Math.max(1, Math.hypot(delta.dx, delta.dy));
    const dirX = delta.dx / worldDistance;
    const dirY = delta.dy / worldDistance;
    const perpX = -dirY;
    const perpY = dirX;

    let crewLoss = Math.floor((SYREEN_MAX_ABANDONERS * (SYREEN_RANGE - distance)) / SYREEN_RANGE) + 1;
    crewLoss = Math.min(crewLoss, enemyShip.crew - 1);
    if (crewLoss <= 0) return;

    enemyShip.crew -= crewLoss;

    for (let i = 0; i < crewLoss; i++) {
      const lane = i - (crewLoss - 1) / 2;
      emitCrewPod?.({
        x: enemyShip.x + Math.round(dirX * SYREEN_CREW_POD_LAUNCH_DIST + perpX * lane * SYREEN_CREW_POD_SPREAD),
        y: enemyShip.y + Math.round(dirY * SYREEN_CREW_POD_LAUNCH_DIST + perpY * lane * SYREEN_CREW_POD_SPREAD),
        targetSide: ownSide,
        life: SYREEN_CREW_POD_LIFE,
        collectDelay: SYREEN_CREW_POD_COLLECT_DELAY,
        blink: (i & 1) === 0,
      });
    }
  },

  getCollisionMass(): number {
    return SYREEN_SHIP_MASS;
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
    if (distanceSq > DISPLAY_TO_WORLD(aiLevel === 'cyborg_awesome' ? 72 : 56) ** 2) input |= INPUT_THRUST;
    if (diff <= 1 || diff >= 15) input |= INPUT_FIRE1;
    if (target.crew > 1 && ship.energy >= SYREEN_SPECIAL_COST && distanceSq <= DISPLAY_TO_WORLD(180) ** 2) {
      input |= INPUT_FIRE2;
    }

    return input;
  },
};
