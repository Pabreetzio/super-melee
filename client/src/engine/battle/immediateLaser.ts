import type { BattleMissile, ShipState } from '../ships/types';
import type { BattleAsteroid } from './types';
import { ASTEROID_RADIUS_W } from './asteroids';
import { PLANET_RADIUS_W, PLANET_X, PLANET_Y, WORLD_H, WORLD_W } from './constants';
import { worldDelta } from './helpers';
import { missileCollisionRadius } from './weaponGeometry';

export interface ImmediateLaserHit {
  kind: 'ship' | 'missile' | 'asteroid' | 'planet';
  distance: number;
  x: number;
  y: number;
  missile?: BattleMissile;
  asteroid?: BattleAsteroid;
}

function rayCircleEntry(
  startX: number,
  startY: number,
  dirX: number,
  dirY: number,
  range: number,
  targetX: number,
  targetY: number,
  radius: number,
  worldW = WORLD_W,
  worldH = WORLD_H,
): ImmediateLaserHit | null {
  const delta = worldDelta(startX, startY, targetX, targetY, worldW, worldH);
  const along = delta.dx * dirX + delta.dy * dirY;
  if (along < 0 || along > range + radius) return null;

  const perpSq = delta.dx * delta.dx + delta.dy * delta.dy - along * along;
  const radiusSq = radius * radius;
  if (perpSq > radiusSq) return null;

  const entry = Math.max(0, along - Math.sqrt(radiusSq - Math.max(0, perpSq)));
  if (entry > range) return null;
  return {
    kind: 'ship',
    distance: entry,
    x: Math.round(startX + dirX * entry),
    y: Math.round(startY + dirY * entry),
  };
}

export function findImmediateLaserHit(params: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  owner: 0 | 1;
  enemyShip: ShipState;
  enemyShipRadius: number;
  missiles: BattleMissile[];
  asteroids?: BattleAsteroid[];
  planet?: { x: number; y: number; radius: number };
  worldW?: number;
  worldH?: number;
}): ImmediateLaserHit | null {
  const worldW = params.worldW ?? WORLD_W;
  const worldH = params.worldH ?? WORLD_H;
  const rayX = params.endX - params.startX;
  const rayY = params.endY - params.startY;
  const range = Math.sqrt(rayX * rayX + rayY * rayY);
  if (range <= 0) return null;

  const dirX = rayX / range;
  const dirY = rayY / range;
  let best = rayCircleEntry(
    params.startX,
    params.startY,
    dirX,
    dirY,
    range,
    params.enemyShip.x,
    params.enemyShip.y,
    params.enemyShipRadius,
    worldW,
    worldH,
  );

  for (const missile of params.missiles) {
    if (missile.owner === params.owner || missile.life <= 0 || missile.hitPoints <= 0) continue;
    const hit = rayCircleEntry(
      params.startX,
      params.startY,
      dirX,
      dirY,
      range,
      missile.x,
      missile.y,
      missileCollisionRadius(missile),
      worldW,
      worldH,
    );
    if (!hit) continue;
    hit.kind = 'missile';
    hit.missile = missile;
    if (!best || hit.distance < best.distance) best = hit;
  }

  for (const asteroid of params.asteroids ?? []) {
    if (asteroid.rubbleFrames > 0) continue;
    const hit = rayCircleEntry(
      params.startX,
      params.startY,
      dirX,
      dirY,
      range,
      asteroid.x,
      asteroid.y,
      ASTEROID_RADIUS_W,
      worldW,
      worldH,
    );
    if (!hit) continue;
    hit.kind = 'asteroid';
    hit.asteroid = asteroid;
    if (!best || hit.distance < best.distance) best = hit;
  }

  const planet = params.planet ?? { x: PLANET_X, y: PLANET_Y, radius: PLANET_RADIUS_W };
  const planetHit = rayCircleEntry(
    params.startX,
    params.startY,
    dirX,
    dirY,
    range,
    planet.x,
    planet.y,
    planet.radius,
    worldW,
    worldH,
  );
  if (planetHit) {
    planetHit.kind = 'planet';
    if (!best || planetHit.distance < best.distance) best = planetHit;
  }

  return best;
}
