import type { ShipId } from 'shared/types';
import { getAtlasFrameForUrl } from '../atlasAssets';
import { COSINE, SINE, tableAngle } from '../sinetab';
import { drawSprite, type SpriteFrame, type SpriteSet } from '../sprites';
import { DISPLAY_TO_WORLD, VELOCITY_TO_WORLD, WORLD_TO_VELOCITY, setVelocityComponents, type VelocityDesc } from '../velocity';
import { getShipDef } from '../ships';
import { SHIP_REGISTRY } from '../ships/registry';
import type { DrawContext, ShipState } from '../ships/types';
import { applyDirectMissileDamage } from './projectiles';
import type { BattleAsteroid, BattleState } from './types';
import { circleOverlap, resolveShipCollision, worldDelta, wrapWorldCoord } from './helpers';
import { PRESENTATION_SCALE, WORLD_H, WORLD_W } from './constants';

export const ASTEROID_COUNT = 5;
export const ASTEROID_MASS = 3;
export const ASTEROID_RADIUS_W = DISPLAY_TO_WORLD(10);
const ASTEROID_MIN_SPEED_W = DISPLAY_TO_WORLD(4);
const ASTEROID_MAX_SPEED_W = DISPLAY_TO_WORLD(11);
const ASTEROID_RUBBLE_FRAMES = 5;
const ASTEROID_FRAME_COUNT = 21;
const ASTEROID_ROTATION_FRAMES = 16;

const ASTEROID_BIG_HOTSPOTS: [number, number][] = [
  [11, 11], [11, 11], [11, 11], [11, 11], [11, 11], [11, 11], [11, 11], [11, 11],
  [11, 11], [11, 11], [11, 11], [11, 11], [11, 11], [11, 11], [11, 11], [11, 11],
  [8, 9], [10, 12], [11, 13], [14, 14], [15, 15],
];
const ASTEROID_MED_HOTSPOTS: [number, number][] = [
  [5, 5], [5, 5], [5, 5], [5, 5], [5, 5], [5, 5], [5, 5], [5, 5],
  [5, 5], [5, 5], [5, 5], [5, 5], [5, 5], [5, 5], [5, 5], [5, 5],
  [6, 6], [6, 7], [7, 8], [8, 8], [8, 8],
];
const ASTEROID_SML_HOTSPOTS: [number, number][] = [
  [3, 3], [3, 3], [3, 3], [3, 3], [3, 3], [3, 3], [3, 3], [3, 3],
  [3, 3], [3, 3], [3, 3], [3, 3], [3, 3], [3, 3], [3, 3], [3, 3],
  [2, 2], [3, 3], [4, 4], [4, 4], [0, 0],
];

export interface AsteroidSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
}

async function loadAsteroidSpriteSet(size: 'big' | 'med' | 'sml'): Promise<SpriteSet> {
  const frames: (SpriteFrame | null)[] = Array(ASTEROID_FRAME_COUNT).fill(null);
  const hotspots = size === 'big' ? ASTEROID_BIG_HOTSPOTS : size === 'med' ? ASTEROID_MED_HOTSPOTS : ASTEROID_SML_HOTSPOTS;
  await Promise.all(
    Array.from({ length: ASTEROID_FRAME_COUNT }, async (_, i) => {
      const url = `/battle/asteroid-${size}-${String(i).padStart(3, '0')}.png`;
      const frame = await getAtlasFrameForUrl(url);
      if (!frame) return;
      const [hotX, hotY] = hotspots[i] ?? [Math.floor(frame.width / 2), Math.floor(frame.height / 2)];
      frames[i] = {
        img: frame.img,
        width: frame.width,
        height: frame.height,
        hotX,
        hotY,
        sourceX: frame.x,
        sourceY: frame.y,
        sourceW: frame.width,
        sourceH: frame.height,
        mask: frame.mask,
      };
    }),
  );
  return { frames, count: ASTEROID_FRAME_COUNT };
}

export async function loadAsteroidSprites(): Promise<AsteroidSprites> {
  const [big, med, sml] = await Promise.all([
    loadAsteroidSpriteSet('big'),
    loadAsteroidSpriteSet('med'),
    loadAsteroidSpriteSet('sml'),
  ]);
  return { big, med, sml };
}

function randomEdgePosition(rand: (n: number) => number, worldW: number, worldH: number): { x: number; y: number } {
  const edge = rand(4);
  if (edge === 0) return { x: 0, y: rand(worldH >> 2) << 2 };
  if (edge === 1) return { x: worldW, y: rand(worldH >> 2) << 2 };
  if (edge === 2) return { x: rand(worldW >> 2) << 2, y: 0 };
  return { x: rand(worldW >> 2) << 2, y: worldH };
}

export function spawnAsteroid(
  rand: (n: number) => number,
  worldW = WORLD_W,
  worldH = WORLD_H,
): BattleAsteroid {
  const { x, y } = randomEdgePosition(rand, worldW, worldH);
  const angle = rand(64);
  const speedW = ASTEROID_MIN_SPEED_W + rand(ASTEROID_MAX_SPEED_W - ASTEROID_MIN_SPEED_W + 1);
  const velocity: VelocityDesc = { travelAngle: angle, vx: 0, vy: 0, ex: 0, ey: 0 };
  setVelocityComponents(
    velocity,
    COSINE(angle, WORLD_TO_VELOCITY(speedW)),
    SINE(angle, WORLD_TO_VELOCITY(speedW)),
  );
  return {
    prevX: wrapWorldCoord(x, worldW),
    prevY: wrapWorldCoord(y, worldH),
    x: wrapWorldCoord(x, worldW),
    y: wrapWorldCoord(y, worldH),
    facing: rand(16),
    velocity,
    turnWait: rand(4),
    spinRate: rand(4),
    spinReverse: (rand(2) & 1) === 1,
    rubbleFrames: 0,
  };
}

export function spawnInitialAsteroids(
  rand: (n: number) => number,
  worldW = WORLD_W,
  worldH = WORLD_H,
): BattleAsteroid[] {
  const asteroids: BattleAsteroid[] = [];
  for (let i = 0; i < ASTEROID_COUNT; i++) {
    asteroids.push(spawnAsteroid(rand, worldW, worldH));
  }
  return asteroids;
}

export function shatterAsteroid(asteroid: BattleAsteroid): void {
  asteroid.rubbleFrames = ASTEROID_RUBBLE_FRAMES;
  asteroid.prevX = asteroid.x;
  asteroid.prevY = asteroid.y;
  asteroid.velocity.vx = 0;
  asteroid.velocity.vy = 0;
  asteroid.velocity.ex = 0;
  asteroid.velocity.ey = 0;
}

export function advanceAsteroids(
  asteroids: BattleAsteroid[],
  rand: (n: number) => number,
  worldW = WORLD_W,
  worldH = WORLD_H,
): void {
  for (let i = 0; i < asteroids.length; i++) {
    const asteroid = asteroids[i];
    if (asteroid.rubbleFrames > 0) {
      asteroid.rubbleFrames--;
      if (asteroid.rubbleFrames <= 0) {
        asteroids[i] = spawnAsteroid(rand, worldW, worldH);
      }
      continue;
    }

    asteroid.prevX = asteroid.x;
    asteroid.prevY = asteroid.y;

    const fracX = Math.abs(asteroid.velocity.vx) & 31;
    asteroid.velocity.ex += fracX;
    const carryX = asteroid.velocity.ex >= 32 ? 1 : 0;
    asteroid.velocity.ex &= 31;
    asteroid.x += VELOCITY_TO_WORLD(Math.abs(asteroid.velocity.vx)) * Math.sign(asteroid.velocity.vx)
      + (asteroid.velocity.vx >= 0 ? carryX : -carryX);

    const fracY = Math.abs(asteroid.velocity.vy) & 31;
    asteroid.velocity.ey += fracY;
    const carryY = asteroid.velocity.ey >= 32 ? 1 : 0;
    asteroid.velocity.ey &= 31;
    asteroid.y += VELOCITY_TO_WORLD(Math.abs(asteroid.velocity.vy)) * Math.sign(asteroid.velocity.vy)
      + (asteroid.velocity.vy >= 0 ? carryY : -carryY);

    asteroid.x = wrapWorldCoord(asteroid.x, worldW);
    asteroid.y = wrapWorldCoord(asteroid.y, worldH);

    if (asteroid.turnWait > 0) asteroid.turnWait--;
    else {
      asteroid.facing = (asteroid.facing + (asteroid.spinReverse ? 15 : 1)) & 15;
      asteroid.turnWait = asteroid.spinRate;
    }
  }
}

export function harvestNearbyAsteroids(
  asteroids: BattleAsteroid[],
  x: number,
  y: number,
  rangeW: number,
  worldW = WORLD_W,
  worldH = WORLD_H,
): boolean {
  let harvested = false;
  const rangeSq = rangeW * rangeW;
  for (const asteroid of asteroids) {
    if (asteroid.rubbleFrames > 0) continue;
    const { dx, dy } = worldDelta(x, y, asteroid.x, asteroid.y, worldW, worldH);
    if (dx * dx + dy * dy > rangeSq) continue;
    shatterAsteroid(asteroid);
    harvested = true;
  }
  return harvested;
}

function getShipCollisionRadius(ship: ShipState, shipType: ShipId): number {
  const ctrl = SHIP_REGISTRY[shipType];
  return DISPLAY_TO_WORLD(ctrl.getCollisionRadius?.(ship) ?? getShipDef(shipType)?.radius ?? 14);
}

function getShipCollisionMass(ship: ShipState, shipType: ShipId): number {
  const ctrl = SHIP_REGISTRY[shipType];
  return ctrl.getCollisionMass?.(ship) ?? getShipDef(shipType)?.mass ?? 6;
}

export function handleAsteroidShipCollisions(
  asteroids: BattleAsteroid[],
  ships: [ShipState, ShipState],
  shipTypes: [ShipId, ShipId],
  inactive: [boolean, boolean],
): void {
  for (let side = 0 as 0 | 1; side < 2; side++) {
    if (inactive[side]) continue;
    const ship = ships[side];
    const shipType = shipTypes[side];
    if (SHIP_REGISTRY[shipType].isIntangible?.(ship)) continue;
    const shipRadius = getShipCollisionRadius(ship, shipType);
    for (const asteroid of asteroids) {
      if (asteroid.rubbleFrames > 0) continue;
      if (!circleOverlap(ship.x, ship.y, shipRadius, asteroid.x, asteroid.y, ASTEROID_RADIUS_W)) continue;

      const asteroidProxy = {
        x: asteroid.x,
        y: asteroid.y,
        velocity: asteroid.velocity,
        turnWait: 0,
        thrustWait: 0,
      } as ShipState;
      resolveShipCollision(ship, asteroidProxy, getShipCollisionMass(ship, shipType), ASTEROID_MASS);
      asteroid.x = wrapWorldCoord(asteroidProxy.x, WORLD_W);
      asteroid.y = wrapWorldCoord(asteroidProxy.y, WORLD_H);

      const { dx, dy } = worldDelta(ship.x, ship.y, asteroid.x, asteroid.y);
      const distSq = dx * dx + dy * dy;
      if (distSq <= 0) continue;
      const dist = Math.sqrt(distSq);
      const minDist = shipRadius + ASTEROID_RADIUS_W;
      if (dist >= minDist) continue;
      const overlap = minDist - dist;
      const push = Math.ceil(overlap / 2);
      const angle = tableAngle(dx, dy);
      const ox = COSINE(angle, push);
      const oy = SINE(angle, push);
      ship.x = wrapWorldCoord(ship.x - ox, WORLD_W);
      ship.y = wrapWorldCoord(ship.y - oy, WORLD_H);
      asteroid.x = wrapWorldCoord(asteroid.x + ox, WORLD_W);
      asteroid.y = wrapWorldCoord(asteroid.y + oy, WORLD_H);
    }
  }
}

export function handleAsteroidMissileCollisions(
  bs: BattleState,
  asteroids: BattleAsteroid[],
): void {
  for (const asteroid of asteroids) {
    if (asteroid.rubbleFrames > 0) continue;
    for (const missile of [...bs.missiles]) {
      if (missile.orzMarineMode === 'boarded') continue;
      if (missile.weaponType === 'dogi' && missile.dogiDeathTimer !== undefined) continue;
      if (!circleOverlap(missile.x, missile.y, DISPLAY_TO_WORLD(4), asteroid.x, asteroid.y, ASTEROID_RADIUS_W)) continue;

      let missileDestroyed = false;
      if (missile.hitPoints > 0) {
        missileDestroyed = applyDirectMissileDamage(bs, missile, ASTEROID_MASS);
      }
      if (missileDestroyed) {
        const idx = bs.missiles.indexOf(missile);
        if (idx !== -1) bs.missiles.splice(idx, 1);
      }

      if (missile.damage > 0) {
        shatterAsteroid(asteroid);
      }

      if (asteroid.rubbleFrames > 0) break;
    }
  }
}

function drawRockShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  facing: number,
  rubbleFrames: number,
): void {
  const angle = (facing * Math.PI) / 8;
  const pts = rubbleFrames > 0
    ? [0.55, 0.25, 0.4, 0.2, 0.35, 0.18]
    : [1.0, 0.78, 0.95, 0.7, 0.92, 0.75];
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const a = angle + (i / pts.length) * Math.PI * 2;
    const r = radius * pts[i];
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function renderAsteroids(
  dc: DrawContext,
  asteroids: BattleAsteroid[],
  tw2dx: (worldX: number) => number,
  tw2dy: (worldY: number) => number,
  sprites?: AsteroidSprites | null,
): void {
  const zoomDivisor = dc.zoomDivisor ?? (1 << (2 + dc.reduction));
  const radius = Math.max(2, Math.trunc((ASTEROID_RADIUS_W / zoomDivisor) * PRESENTATION_SCALE));
  for (const asteroid of asteroids) {
    const dx = tw2dx(asteroid.x);
    const dy = tw2dy(asteroid.y);
    if (dx < -radius * 3 || dx > dc.canvasW + radius * 3 || dy < -radius * 3 || dy > dc.canvasH + radius * 3) continue;

    if (sprites) {
      const set = dc.reduction >= 2 ? sprites.sml : dc.reduction === 1 ? sprites.med : sprites.big;
      const frameIndex = asteroid.rubbleFrames > 0
        ? ASTEROID_ROTATION_FRAMES + (ASTEROID_RUBBLE_FRAMES - asteroid.rubbleFrames)
        : asteroid.facing % ASTEROID_ROTATION_FRAMES;
      drawSprite(dc.ctx, set, frameIndex, asteroid.x, asteroid.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction, dc.worldW, dc.worldH);
      continue;
    }

    dc.ctx.save();
    if (asteroid.rubbleFrames > 0) {
      const alpha = asteroid.rubbleFrames / ASTEROID_RUBBLE_FRAMES;
      dc.ctx.globalAlpha = Math.max(0.25, alpha);
      drawRockShape(dc.ctx, dx, dy, Math.max(1, radius - 1), asteroid.facing, asteroid.rubbleFrames);
      dc.ctx.fillStyle = '#6a5846';
      dc.ctx.fill();
      dc.ctx.strokeStyle = '#b49974';
      dc.ctx.lineWidth = PRESENTATION_SCALE;
      dc.ctx.stroke();
    } else {
      drawRockShape(dc.ctx, dx, dy, radius, asteroid.facing, 0);
      dc.ctx.fillStyle = '#5c5348';
      dc.ctx.fill();
      dc.ctx.strokeStyle = '#a9967d';
      dc.ctx.lineWidth = PRESENTATION_SCALE;
      dc.ctx.stroke();
    }
    dc.ctx.restore();
  }
}
