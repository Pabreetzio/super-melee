import { COSINE, SINE, tableAngle } from '../sinetab';
import { setVelocityComponents } from '../velocity';
import type { ShipState } from '../ships/types';
import type { BattleState } from './types';

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

export function resolveShipCollision(a: ShipState, b: ShipState): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distSq = dx * dx + dy * dy;
  if (distSq === 0) return;

  const rvx = a.velocity.vx - b.velocity.vx;
  const rvy = a.velocity.vy - b.velocity.vy;
  const dot = rvx * dx + rvy * dy;
  if (dot <= 0) return;

  const imp = dot / distSq;
  setVelocityComponents(a.velocity, a.velocity.vx - imp * dx, a.velocity.vy - imp * dy);
  setVelocityComponents(b.velocity, b.velocity.vx + imp * dx, b.velocity.vy + imp * dy);
}

export function circleOverlap(
  ax: number, ay: number, ar: number,
  bx: number, by: number, br: number,
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
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
  return tableAngle(toX - fromX, toY - fromY);
}

export function applyGravity(
  ship: ShipState,
  planetX: number,
  planetY: number,
  gravityThresholdW: number,
): void {
  const dx = planetX - ship.x;
  const dy = planetY - ship.y;
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
  }
  h = hashStep(h, bs.missiles.length);
  for (const m of bs.missiles) {
    h = hashStep(h, m.x);
    h = hashStep(h, m.y);
    h = hashStep(h, m.facing);
    h = hashStep(h, m.life);
    h = hashStep(h, m.speed);
    h = hashStep(h, m.owner);
  }
  h = hashStep(h, bs.warpIn[0]);
  h = hashStep(h, bs.warpIn[1]);
  return h;
}
