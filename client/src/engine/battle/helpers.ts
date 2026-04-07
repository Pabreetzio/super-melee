import { COSINE, SINE, tableAngle, HALF_CIRCLE, QUADRANT } from '../sinetab';
import { setVelocityComponents, deltaVelocityComponents, VELOCITY_TO_WORLD, WORLD_TO_VELOCITY, DISPLAY_TO_WORLD } from '../velocity';
import type { ShipState } from '../ships/types';
import type { BattleState } from './types';
import { WORLD_H as DEFAULT_WORLD_H, WORLD_W as DEFAULT_WORLD_W } from './constants';
const COLLISION_TURN_WAIT = 1;
const COLLISION_THRUST_WAIT = 3;
const MIN_COLLISION_SPEED = WORLD_TO_VELOCITY(DISPLAY_TO_WORLD(1)) - 1;

function normalizeAngle(angle: number): number {
  return ((angle % 64) + 64) % 64;
}

export function toroidalDelta(from: number, to: number, worldSize: number): number {
  let delta = to - from;
  if (delta > worldSize >> 1) delta -= worldSize;
  else if (delta < -(worldSize >> 1)) delta += worldSize;
  return delta;
}

export function worldDelta(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  worldW = DEFAULT_WORLD_W,
  worldH = DEFAULT_WORLD_H,
): { dx: number; dy: number } {
  return {
    dx: toroidalDelta(fromX, toX, worldW),
    dy: toroidalDelta(fromY, toY, worldH),
  };
}

export function wrapWorldCoord(value: number, worldSize: number): number {
  return ((value % worldSize) + worldSize) % worldSize;
}

export function calcReduction(
  ships: [ShipState, ShipState],
  current: number,
  canvasW: number,
  maxReduction: number,
  worldW: number,
  worldH: number,
): number {
  let dx = Math.abs(ships[1].x - ships[0].x);
  let dy = Math.abs(ships[1].y - ships[0].y);
  if (dx > worldW >> 1) dx = worldW - dx;
  if (dy > worldH >> 1) dy = worldH - dy;
  const sep = Math.max(dx, dy);

  const HYSTERESIS_W = 192;
  for (let candidate = 0; candidate < maxReduction; candidate++) {
    const halfView = canvasW << (1 + candidate);
    const threshold = candidate < current ? halfView - HYSTERESIS_W : halfView;
    if (sep < threshold) return candidate;
  }
  return maxReduction;
}

export function resolveShipCollision(
  a: ShipState,
  b: ShipState,
  massA: number,
  massB: number,
  worldW = DEFAULT_WORLD_W,
  worldH = DEFAULT_WORLD_H,
): void {
  const impact0Delta = worldDelta(b.x, b.y, a.x, a.y, worldW, worldH);
  const impactAngle0 = tableAngle(impact0Delta.dx, impact0Delta.dy);
  const impactAngle1 = normalizeAngle(impactAngle0 + HALF_CIRCLE);

  const dx0 = a.velocity.vx;
  const dy0 = a.velocity.vy;
  const dx1 = b.velocity.vx;
  const dy1 = b.velocity.vy;
  const travelAngle0 = a.velocity.travelAngle;
  const travelAngle1 = b.velocity.travelAngle;
  const relDx = dx0 - dx1;
  const relDy = dy0 - dy1;
  const relTravelAngle = tableAngle(relDx, relDy);
  const speed = Math.round(Math.sqrt(relDx * relDx + relDy * relDy));

  let directness = normalizeAngle(relTravelAngle - impactAngle0);
  let bounceAngle0 = impactAngle0;
  let bounceAngle1 = impactAngle1;
  if (directness <= QUADRANT || directness >= HALF_CIRCLE + QUADRANT) {
    directness = HALF_CIRCLE;
    bounceAngle0 = normalizeAngle(travelAngle0 + HALF_CIRCLE);
    bounceAngle1 = normalizeAngle(travelAngle1 + HALF_CIRCLE);
  }

  const impulseScalar = SINE(directness, speed << 1) * (massA * massB);
  const totalMass = massA + massB;
  if (totalMass <= 0) return;

  if (a.turnWait < COLLISION_TURN_WAIT) a.turnWait += COLLISION_TURN_WAIT;
  if (a.thrustWait < COLLISION_THRUST_WAIT) a.thrustWait += COLLISION_THRUST_WAIT;
  if (b.turnWait < COLLISION_TURN_WAIT) b.turnWait += COLLISION_TURN_WAIT;
  if (b.thrustWait < COLLISION_THRUST_WAIT) b.thrustWait += COLLISION_THRUST_WAIT;

  const speed0 = Math.trunc(impulseScalar / (massA * totalMass));
  deltaVelocityComponents(a.velocity, COSINE(bounceAngle0, speed0), SINE(bounceAngle0, speed0));
  if (VELOCITY_TO_WORLD(Math.abs(a.velocity.vx) + Math.abs(a.velocity.vy)) < DISPLAY_TO_WORLD(1)) {
    setVelocityComponents(a.velocity, COSINE(bounceAngle0, MIN_COLLISION_SPEED), SINE(bounceAngle0, MIN_COLLISION_SPEED));
  }

  const speed1 = Math.trunc(impulseScalar / (massB * totalMass));
  deltaVelocityComponents(b.velocity, COSINE(bounceAngle1, speed1), SINE(bounceAngle1, speed1));
  if (VELOCITY_TO_WORLD(Math.abs(b.velocity.vx) + Math.abs(b.velocity.vy)) < DISPLAY_TO_WORLD(1)) {
    setVelocityComponents(b.velocity, COSINE(bounceAngle1, MIN_COLLISION_SPEED), SINE(bounceAngle1, MIN_COLLISION_SPEED));
  }
}

export function circleOverlap(
  ax: number, ay: number, ar: number,
  bx: number, by: number, br: number,
  worldW = DEFAULT_WORLD_W,
  worldH = DEFAULT_WORLD_H,
): boolean {
  const { dx, dy } = worldDelta(ax, ay, bx, by, worldW, worldH);
  const r  = ar + br;
  return dx * dx + dy * dy < r * r;
}

export function applyAttachedLimpetPenalty(
  ship: ShipState,
  previous: { facing: number; vx: number; vy: number },
): void {
  const limpets = ship.limpetCount ?? 0;
  if (limpets <= 0) return;

  if (ship.facing !== previous.facing) {
    ship.turnWait = Math.min(30, ship.turnWait + limpets);
  }

  if (ship.thrusting) {
    ship.thrustWait = Math.min(30, ship.thrustWait + limpets);

    const thrustScale = Math.max(0.35, 1 - limpets * 0.12);
    const dvx = ship.velocity.vx - previous.vx;
    const dvy = ship.velocity.vy - previous.vy;
    setVelocityComponents(
      ship.velocity,
      previous.vx + dvx * thrustScale,
      previous.vy + dvy * thrustScale,
    );
  }
}

export function worldAngle(fromX: number, fromY: number, toX: number, toY: number): number {
  const { dx, dy } = worldDelta(fromX, fromY, toX, toY);
  return tableAngle(dx, dy);
}

export function applyGravity(
  ship: ShipState,
  planetX: number,
  planetY: number,
  gravityThresholdW: number,
): void {
  const { dx, dy } = worldDelta(ship.x, ship.y, planetX, planetY);
  const distSq = dx * dx + dy * dy;
  const threshSq = gravityThresholdW * gravityThresholdW;
  if (distSq === 0 || distSq > threshSq) return;

  const angle = worldAngle(ship.x, ship.y, planetX, planetY);
  const grav = 32;
  ship.velocity.vx += COSINE(angle, grav);
  ship.velocity.vy += SINE(angle, grav);
}

function hashStep(h: number, v: number): number {
  return Math.imul(h ^ (v | 0), 0x9e3779b9) >>> 0;
}

export function computeChecksum(bs: BattleState): number {
  let h = hashStep(0x811c9dc5, bs.frame);
  for (const ship of bs.ships) {
    h = hashStep(h, ship.x);
    h = hashStep(h, ship.y);
    h = hashStep(h, ship.velocity.vx);
    h = hashStep(h, ship.velocity.vy);
    h = hashStep(h, ship.velocity.travelAngle);
    h = hashStep(h, ship.crew);
    h = hashStep(h, ship.energy);
    h = hashStep(h, ship.facing);
    h = hashStep(h, ship.limpetCount ?? 0);
    h = hashStep(h, ship.orzTurretOffset ?? 0);
    h = hashStep(h, ship.orzTurretTurnWait ?? 0);
    h = hashStep(h, ship.orzTurretFlashFrames ?? 0);
    h = hashStep(h, ship.orzMarineCount ?? 0);
    h = hashStep(h, ship.orzMarineSeed ?? 0);
    const orzSlots = ship.orzBoardSlots ?? [];
    const orzFlashes = ship.orzBoardDamageFlash ?? [];
    for (let i = 0; i < 8; i++) {
      h = hashStep(h, orzSlots[i] ? 1 : 0);
      h = hashStep(h, orzFlashes[i] ?? 0);
    }
    h = hashStep(h, ship.canResurrect ? 1 : 0);
    h = hashStep(h, ship.arilouTeleportFrames ?? 0);
    h = hashStep(h, ship.arilouTeleportSeed ?? 0);
    h = hashStep(h, ship.androsynthBlazer ? 1 : 0);
    h = hashStep(h, ship.androsynthSeed ?? 0);
    h = hashStep(h, ship.chenjesuDogiCount ?? 0);
    h = hashStep(h, ship.chmmrLaserCycle ?? 0);
    h = hashStep(h, ship.chmmrSatellitesSpawned ? 1 : 0);
    h = hashStep(h, ship.ilwrathCloaked ? 1 : 0);
    h = hashStep(h, ship.ilwrathUncloakShot ? 1 : 0);
    h = hashStep(h, ship.shofixtiGloryFrames ?? 0);
    h = hashStep(h, ship.shofixtiSafetyLevel ?? 0);
    h = hashStep(h, ship.shofixtiPrevSpecialHeld ? 1 : 0);
    h = hashStep(h, ship.yehatShieldFrames ?? 0);
    h = hashStep(h, ship.melnormeCharging ? 1 : 0);
    h = hashStep(h, ship.melnormePumpLevel ?? 0);
    h = hashStep(h, ship.melnormePumpTimer ?? 0);
    h = hashStep(h, ship.melnormeConfusionFrames ?? 0);
    h = hashStep(h, ship.melnormeConfusionInput ?? 0);
    h = hashStep(h, ship.melnormeSeed ?? 0);
    h = hashStep(h, ship.mmrnmhrmForm === 'y' ? 2 : ship.mmrnmhrmForm === 'x' ? 1 : 0);
    h = hashStep(h, ship.slylandroReversePressed ? 1 : 0);
    h = hashStep(h, ship.slylandroLightningCycle ?? 0);
    h = hashStep(h, ship.umgahConeCycle ?? 0);
    h = hashStep(h, ship.umgahZipPending ? 1 : 0);
    h = hashStep(h, ship.utwigShieldFrames ?? 0);
    h = hashStep(h, ship.utwigShieldDrainWait ?? 0);
    h = hashStep(h, ship.utwigShieldCycle ?? 0);
  }
  h = hashStep(h, bs.asteroids.length);
  for (const asteroid of bs.asteroids) {
    h = hashStep(h, asteroid.prevX);
    h = hashStep(h, asteroid.prevY);
    h = hashStep(h, asteroid.x);
    h = hashStep(h, asteroid.y);
    h = hashStep(h, asteroid.facing);
    h = hashStep(h, asteroid.velocity.vx);
    h = hashStep(h, asteroid.velocity.vy);
    h = hashStep(h, asteroid.velocity.ex);
    h = hashStep(h, asteroid.velocity.ey);
    h = hashStep(h, asteroid.velocity.travelAngle);
    h = hashStep(h, asteroid.turnWait);
    h = hashStep(h, asteroid.spinRate);
    h = hashStep(h, asteroid.spinReverse ? 1 : 0);
    h = hashStep(h, asteroid.rubbleFrames);
  }
  h = hashStep(h, bs.missiles.length);
  for (const m of bs.missiles) {
    h = hashStep(h, m.prevX);
    h = hashStep(h, m.prevY);
    h = hashStep(h, m.x);
    h = hashStep(h, m.y);
    h = hashStep(h, m.facing);
    h = hashStep(h, m.life);
    h = hashStep(h, m.hitPoints);
    h = hashStep(h, m.damage);
    h = hashStep(h, m.speed);
    h = hashStep(h, m.trackWait);
    h = hashStep(h, m.trackRate);
    h = hashStep(h, m.owner);
    h = hashStep(
      h,
      m.weaponType === 'buzzsaw' ? 1
        : m.weaponType === 'gas_cloud' ? 2
        : m.weaponType === 'fighter' ? 3
        : m.weaponType === 'orz_howitzer' ? 4
        : m.weaponType === 'orz_marine' ? 5
        : m.weaponType === 'plasmoid' ? 6
        : m.weaponType === 'bubble' ? 7
        : m.weaponType === 'chenjesu_crystal' ? 8
        : m.weaponType === 'chenjesu_shard' ? 9
        : m.weaponType === 'dogi' ? 10
        : m.weaponType === 'chmmr_satellite' ? 11
        : m.weaponType === 'melnorme_pump' ? 12
        : m.weaponType === 'melnorme_confuse' ? 13
        : m.weaponType === 'thraddash_horn' ? 14
        : m.weaponType === 'thraddash_napalm' ? 15
        : m.weaponType === 'umgah_cone' ? 16
        : m.weaponType === 'zoqfotpik_spit' ? 17
        : m.weaponType === 'supox_glob' ? 18
        : 0,
    );
    h = hashStep(h, m.satelliteAngle ?? 0);
    h = hashStep(h, m.orzMarineMode === 'space' ? 1 : m.orzMarineMode === 'boarded' ? 2 : m.orzMarineMode === 'return' ? 3 : 0);
    h = hashStep(h, m.orzBoardSlot ?? -1);
    h = hashStep(h, m.orzFlashFrame ?? 0);
    h = hashStep(h, m.orzSeed ?? 0);
  }
  h = hashStep(h, bs.crewPods.length);
  for (const pod of bs.crewPods) {
    h = hashStep(h, pod.x);
    h = hashStep(h, pod.y);
    h = hashStep(h, pod.targetSide);
    h = hashStep(h, pod.life);
    h = hashStep(h, pod.collectDelay);
    h = hashStep(h, pod.blink ? 1 : 0);
  }
  h = hashStep(h, bs.warpIn[0]);
  h = hashStep(h, bs.warpIn[1]);
  h = hashStep(h, bs.rebirth[0]);
  h = hashStep(h, bs.rebirth[1]);
  return h;
}
