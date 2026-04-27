import { getShipDef } from '../ships';
import { SHIP_REGISTRY } from '../ships/registry';
import type { BattleMissile, ShipState } from '../ships/types';
import { COSINE, HALF_CIRCLE, QUADRANT, SINE } from '../sinetab';
import { DISPLAY_TO_WORLD } from '../velocity';
import { ASTEROID_RADIUS_W, shatterAsteroid } from './asteroids';
import { worldAngle, worldDelta } from './helpers';
import { missileRadius, applyDirectMissileDamage } from './projectiles';
import type { BattleAsteroid, BattleState } from './types';
import {
  SLYLANDRO_LIGHTNING_DAMAGE,
  SLYLANDRO_LIGHTNING_SEGMENT_LENGTH,
  SLYLANDRO_WEAPON_WAIT,
} from '../ships/slylandro';

export interface LightningRootRequest {
  owner: 0 | 1;
  playSound: boolean;
}

const SLYLANDRO_LIGHTNING_COLORS = [
  '#ffffff',
  '#b5bdff',
  '#313aff',
  '#0000c5',
] as const;

function normalizeFacing(facing: number): number {
  return ((facing % 16) + 16) % 16;
}

function angleToFacing(angle: number): number {
  return normalizeFacing((angle + 2) >> 2);
}

function facingToAngle(facing: number): number {
  return (normalizeFacing(facing) * 4) & 63;
}

function lightningColor(randWord: number): string {
  return SLYLANDRO_LIGHTNING_COLORS[(randWord >>> 8) & 3] ?? SLYLANDRO_LIGHTNING_COLORS[0];
}

function mirroredWeaponWait(weaponWait: number): number {
  let mirrored = weaponWait;
  if (mirrored === 0) mirrored = SLYLANDRO_WEAPON_WAIT;
  if (mirrored > (SLYLANDRO_WEAPON_WAIT >> 1)) {
    mirrored = SLYLANDRO_WEAPON_WAIT - mirrored;
  }
  return Math.max(0, mirrored);
}

function truncateWeaponWait(ship: ShipState, segmentTurnWait: number): void {
  ship.weaponWait = Math.max(0, mirroredWeaponWait(ship.weaponWait) - segmentTurnWait);
}

function isTrackingTargetDetectable(ship: ShipState): boolean {
  return ship.crew > 0 && !ship.ilwrathCloaked;
}

function stepFacingTowardTarget(
  startX: number,
  startY: number,
  facing: number,
  targetShip: ShipState,
  nextRandomWord: () => number,
): { deltaFacing: number; angle: number } {
  if (!isTrackingTargetDetectable(targetShip)) {
    return { deltaFacing: -1, angle: facingToAngle(facing) };
  }

  const targetFacing = angleToFacing(worldAngle(startX, startY, targetShip.x, targetShip.y));
  const deltaFacing = normalizeFacing(targetFacing - facing);
  let nextFacing = facing;

  if (deltaFacing > 0) {
    if (deltaFacing === angleToFacing(HALF_CIRCLE)) {
      nextFacing = normalizeFacing(facing + (((nextRandomWord() & 1) << 1) - 1));
    } else if (deltaFacing < angleToFacing(HALF_CIRCLE)) {
      nextFacing = normalizeFacing(facing + 1);
    } else {
      nextFacing = normalizeFacing(facing - 1);
    }
  }

  return { deltaFacing, angle: facingToAngle(nextFacing) };
}

function lineCircleImpactT(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  targetX: number,
  targetY: number,
  radius: number,
  worldW: number,
  worldH: number,
): number | null {
  const { dx: lineDx, dy: lineDy } = worldDelta(startX, startY, endX, endY, worldW, worldH);
  const a = lineDx * lineDx + lineDy * lineDy;
  if (a <= 0) return null;

  const { dx: targetDx, dy: targetDy } = worldDelta(startX, startY, targetX, targetY, worldW, worldH);
  const c = targetDx * targetDx + targetDy * targetDy - radius * radius;
  if (c <= 0) return 0;

  const dot = targetDx * lineDx + targetDy * lineDy;
  const b = -2 * dot;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);
  const t0 = (-b - sqrtDisc) / (2 * a);
  const t1 = (-b + sqrtDisc) / (2 * a);
  if (t0 >= 0 && t0 <= 1) return t0;
  if (t1 >= 0 && t1 <= 1) return t1;
  return null;
}

function shipCollisionRadius(bs: BattleState, side: 0 | 1): number {
  const ctrl = SHIP_REGISTRY[bs.shipTypes[side]];
  return DISPLAY_TO_WORLD(ctrl.getCollisionRadius?.(bs.ships[side]) ?? getShipDef(bs.shipTypes[side])?.radius ?? 14);
}

function findLightningCollision(
  bs: BattleState,
  owner: 0 | 1,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  planetX: number,
  planetY: number,
  planetRadiusW: number,
  worldW: number,
  worldH: number,
): {
  kind: 'ship' | 'missile' | 'asteroid' | 'planet';
  t: number;
  impactX: number;
  impactY: number;
  missile?: BattleMissile;
  asteroid?: BattleAsteroid;
} | null {
  let best: {
    kind: 'ship' | 'missile' | 'asteroid' | 'planet';
    t: number;
    impactX: number;
    impactY: number;
    missile?: BattleMissile;
    asteroid?: BattleAsteroid;
  } | null = null;

  const consider = (
    kind: 'ship' | 'missile' | 'asteroid' | 'planet',
    t: number | null,
    missile?: BattleMissile,
    asteroid?: BattleAsteroid,
  ) => {
    if (t === null || t < 0 || t > 1) return;
    if (best && t >= best.t) return;
    const { dx: lineDx, dy: lineDy } = worldDelta(startX, startY, endX, endY, worldW, worldH);
    best = {
      kind,
      t,
      impactX: startX + Math.round(lineDx * t),
      impactY: startY + Math.round(lineDy * t),
      missile,
      asteroid,
    };
  };

  const targetSide = owner === 0 ? 1 : 0;
  const targetShip = bs.ships[targetSide];
  if (
    targetShip.crew > 0
    && bs.warpIn[targetSide] === 0
    && bs.shipDestructions[targetSide] === null
    && !SHIP_REGISTRY[bs.shipTypes[targetSide]].isIntangible?.(targetShip)
  ) {
    consider(
      'ship',
      lineCircleImpactT(
        startX,
        startY,
        endX,
        endY,
        targetShip.x,
        targetShip.y,
        shipCollisionRadius(bs, targetSide),
        worldW,
        worldH,
      ),
    );
  }

  for (const missile of bs.missiles) {
    if (missile.owner === owner
      || missile.life <= 0
      || missile.hitPoints <= 0
      || missile.orzMarineMode === 'boarded'
      || (missile.weaponType === 'dogi' && missile.dogiDeathTimer !== undefined)) {
      continue;
    }
    consider(
      'missile',
      lineCircleImpactT(
        startX,
        startY,
        endX,
        endY,
        missile.x,
        missile.y,
        missileRadius(missile),
        worldW,
        worldH,
      ),
      missile,
    );
  }

  for (const asteroid of bs.asteroids) {
    if (asteroid.rubbleFrames > 0) continue;
    consider(
      'asteroid',
      lineCircleImpactT(
        startX,
        startY,
        endX,
        endY,
        asteroid.x,
        asteroid.y,
        ASTEROID_RADIUS_W,
        worldW,
        worldH,
      ),
      undefined,
      asteroid,
    );
  }

  consider(
    'planet',
    lineCircleImpactT(startX, startY, endX, endY, planetX, planetY, planetRadiusW, worldW, worldH),
  );

  return best;
}

type PendingSegment = {
  owner: 0 | 1;
  startX: number;
  startY: number;
  turnWait: number;
  color: string;
  randWord?: number;
  baseFacing?: number;
  baseAngle?: number;
};

export function processLightningRoots(
  bs: BattleState,
  roots: readonly LightningRootRequest[],
  nextRandomWord: () => number,
  planetX: number,
  planetY: number,
  planetRadiusW: number,
  worldW: number,
  worldH: number,
): Array<0 | 1> {
  bs.lightningSegments = [];

  const soundedOwners: Array<0 | 1> = [];

  for (const root of roots) {
    if (bs.shipTypes[root.owner] !== 'slylandro') continue;

    const ship = bs.ships[root.owner];
    if (
      ship.crew <= 0
      || ship.weaponWait <= 0
      || bs.warpIn[root.owner] > 0
      || bs.shipDestructions[root.owner] !== null
      || SHIP_REGISTRY[bs.shipTypes[root.owner]].isIntangible?.(ship)
    ) {
      continue;
    }

    if (root.playSound) soundedOwners.push(root.owner);

    const rootRandWord = nextRandomWord() >>> 0;
    const color = lightningColor(rootRandWord);
    const pending: PendingSegment[] = [{
      owner: root.owner,
      startX: ship.x,
      startY: ship.y,
      turnWait: mirroredWeaponWait(ship.weaponWait),
      color,
      randWord: rootRandWord,
      baseFacing: ship.facing,
    }];

    while (pending.length > 0) {
      const current = pending.shift()!;
      const ownerShip = bs.ships[current.owner];
      if (ownerShip.crew <= 0 || ownerShip.weaponWait <= 0) {
        continue;
      }

      const randWord = current.randWord ?? (nextRandomWord() >>> 0);
      const lowWord = randWord & 0xffff;
      const highWord = (randWord >>> 16) & 0xffff;
      const enemyShip = bs.ships[current.owner === 0 ? 1 : 0];
      const facing = current.baseFacing ?? angleToFacing(current.baseAngle ?? 0);
      const { deltaFacing, angle: trackedAngle } = stepFacingTowardTarget(
        current.startX,
        current.startY,
        facing,
        enemyShip,
        nextRandomWord,
      );

      let angle = trackedAngle;
      if (deltaFacing === -1 || deltaFacing === angleToFacing(HALF_CIRCLE)) {
        angle = (angle + lowWord) & 63;
      } else if (deltaFacing === 0) {
        angle = (angle + ((lowWord & 1) !== 0 ? -1 : 1) + 64) & 63;
      } else if (deltaFacing < angleToFacing(HALF_CIRCLE)) {
        angle = (angle + (lowWord & (QUADRANT - 1))) & 63;
      } else {
        angle = (angle - (lowWord & (QUADRANT - 1)) + 64) & 63;
      }

      const length = DISPLAY_TO_WORLD((highWord & (SLYLANDRO_LIGHTNING_SEGMENT_LENGTH - 1)) + 4);
      const intendedEndX = current.startX + COSINE(angle, length);
      const intendedEndY = current.startY + SINE(angle, length);
      const hit = findLightningCollision(
        bs,
        current.owner,
        current.startX,
        current.startY,
        intendedEndX,
        intendedEndY,
        planetX,
        planetY,
        planetRadiusW,
        worldW,
        worldH,
      );

      const segment = {
        owner: current.owner,
        x1: current.startX,
        y1: current.startY,
        x2: hit?.impactX ?? intendedEndX,
        y2: hit?.impactY ?? intendedEndY,
        color: current.color,
        turnWait: current.turnWait,
        collided: !!hit,
      };
      bs.lightningSegments.push(segment);

      if (hit) {
        truncateWeaponWait(ownerShip, current.turnWait);

        if (hit.kind === 'ship') {
          const targetSide = current.owner === 0 ? 1 : 0;
          const targetShip = bs.ships[targetSide];
          const absorb = SHIP_REGISTRY[bs.shipTypes[targetSide]].absorbHit?.(targetShip, {
            kind: 'laser',
            damage: SLYLANDRO_LIGHTNING_DAMAGE,
          });
          if (!absorb?.absorbed) {
            targetShip.crew = Math.max(0, targetShip.crew - SLYLANDRO_LIGHTNING_DAMAGE);
          }
        } else if (hit.kind === 'missile' && hit.missile) {
          if (applyDirectMissileDamage(bs, hit.missile, SLYLANDRO_LIGHTNING_DAMAGE)) {
            const index = bs.missiles.indexOf(hit.missile);
            if (index !== -1) bs.missiles.splice(index, 1);
          }
        } else if (hit.kind === 'asteroid' && hit.asteroid) {
          shatterAsteroid(hit.asteroid);
        }

        bs.explosions.push({ type: 'blast', x: hit.impactX, y: hit.impactY, frame: 0 });
        continue;
      }

      if (current.turnWait > 0) {
        pending.push({
          owner: current.owner,
          startX: segment.x2,
          startY: segment.y2,
          turnWait: current.turnWait - 1,
          color: current.color,
          baseAngle: angle,
        });
      }
    }
  }

  return soundedOwners;
}
