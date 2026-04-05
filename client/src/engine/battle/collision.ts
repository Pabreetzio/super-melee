import { playBlast } from '../audio';
import { COSINE, SINE, tableAngle } from '../sinetab';
import { DISPLAY_TO_WORLD } from '../velocity';
import type { ShipState } from '../ships/types';
import type { ShipId } from 'shared/types';
import type { SpriteFrame } from '../sprites';
import { getShipDef } from '../ships';
import { SHIP_REGISTRY } from '../ships/registry';
import { resolveShipCollision, worldAngle, worldDelta, wrapWorldCoord } from './helpers';
import { spriteMasksOverlap, spriteMaskIntersectsCircle } from './maskCollision';

function getShipCollisionFrame(
  ship: ShipState,
  shipType: ShipId,
  shipSprites: Map<string, unknown>,
): SpriteFrame | null {
  const ctrl = SHIP_REGISTRY[shipType];
  return ctrl.getShipCollisionFrame?.(ship, shipSprites.get(shipType) ?? null) ?? null;
}

function getShipCollisionRadius(
  ship: ShipState,
  shipType: ShipId,
): number {
  const ctrl = SHIP_REGISTRY[shipType];
  return DISPLAY_TO_WORLD(ctrl.getCollisionRadius?.(ship) ?? getShipDef(shipType)?.radius ?? 14);
}

function getShipCollisionMass(
  ship: ShipState,
  shipType: ShipId,
): number {
  const ctrl = SHIP_REGISTRY[shipType];
  return ctrl.getCollisionMass?.(ship) ?? getShipDef(shipType)?.mass ?? 6;
}

export function handleShipShipCollision(
  ships: [ShipState, ShipState],
  warpIn: [number, number],
  shipTypes: [ShipId, ShipId],
  shipSprites: Map<string, unknown>,
): void {
  if (SHIP_REGISTRY[shipTypes[0]].isIntangible?.(ships[0]) || SHIP_REGISTRY[shipTypes[1]].isIntangible?.(ships[1])) {
    return;
  }
  const r0 = getShipCollisionRadius(ships[0], shipTypes[0]);
  const r1 = getShipCollisionRadius(ships[1], shipTypes[1]);
  const { dx, dy } = worldDelta(ships[0].x, ships[0].y, ships[1].x, ships[1].y);
  const distSq = dx * dx + dy * dy;
  const minDist = r0 + r1;
  if (warpIn[0] !== 0 || warpIn[1] !== 0 || distSq >= minDist * minDist || distSq === 0) return;
  const frame0 = getShipCollisionFrame(ships[0], shipTypes[0], shipSprites);
  const frame1 = getShipCollisionFrame(ships[1], shipTypes[1], shipSprites);
  if (frame0 && frame1 && !spriteMasksOverlap(frame0, ships[0].x, ships[0].y, frame1, ships[1].x, ships[1].y, 20480, 15360)) return;

  const ctrl0 = SHIP_REGISTRY[shipTypes[0]];
  const ctrl1 = SHIP_REGISTRY[shipTypes[1]];
  resolveShipCollision(
    ships[0],
    ships[1],
    getShipCollisionMass(ships[0], shipTypes[0]),
    getShipCollisionMass(ships[1], shipTypes[1]),
  );
  const distInt = Math.round(Math.sqrt(distSq));
  const overlap = minDist - distInt;
  if (overlap > 0) {
    const push = Math.ceil(overlap / 2);
    const sepAngle = tableAngle(dx, dy);
    const ox = COSINE(sepAngle, push);
    const oy = SINE(sepAngle, push);
    ships[0].x -= ox;
    ships[0].y -= oy;
    ships[1].x += ox;
    ships[1].y += oy;
    ships[0].x = wrapWorldCoord(ships[0].x, 20480);
    ships[0].y = wrapWorldCoord(ships[0].y, 15360);
    ships[1].x = wrapWorldCoord(ships[1].x, 20480);
    ships[1].y = wrapWorldCoord(ships[1].y, 15360);
  }

  const fx0 = ctrl0.onShipCollision?.(ships[0], ships[1]);
  const fx1 = ctrl1.onShipCollision?.(ships[1], ships[0]);
  if (fx0?.damageOther) {
    ships[1].crew = Math.max(0, ships[1].crew - fx0.damageOther);
    playBlast(Math.max(1, fx0.damageOther));
  }
  if (fx1?.damageOther) {
    ships[0].crew = Math.max(0, ships[0].crew - fx1.damageOther);
    playBlast(Math.max(1, fx1.damageOther));
  }

}

export function handleShipPlanetCollisions(
  ships: [ShipState, ShipState],
  shipTypes: [ShipId, ShipId],
  shipSprites: Map<string, unknown>,
  planetX: number,
  planetY: number,
  planetRadiusW: number,
  inactive: [boolean, boolean] = [false, false],
): void {
  for (let side = 0; side < 2; side++) {
    if (inactive[side]) continue;
    const ship = ships[side];
    if (SHIP_REGISTRY[shipTypes[side]].isIntangible?.(ship)) continue;
    const shipRadiusW = getShipCollisionRadius(ship, shipTypes[side]);
    const minDist = shipRadiusW + planetRadiusW;
    const minDistSq = minDist * minDist;
    const { dx: pdx, dy: pdy } = worldDelta(planetX, planetY, ship.x, ship.y);
    const distSq = pdx * pdx + pdy * pdy;
    if (distSq >= minDistSq || distSq === 0) continue;
    const frame = getShipCollisionFrame(ship, shipTypes[side], shipSprites);
    if (frame && !spriteMaskIntersectsCircle(frame, ship.x, ship.y, planetX, planetY, planetRadiusW, 20480, 15360)) continue;

    const angle = worldAngle(planetX, planetY, ship.x, ship.y);
    const cx = COSINE(angle, 64);
    const cy = SINE(angle, 64);
    const dot = ship.velocity.vx * cx + ship.velocity.vy * cy;
    if (dot < 0) {
      ship.velocity.vx = Math.trunc(ship.velocity.vx - 2 * dot * cx / 4096);
      ship.velocity.vy = Math.trunc(ship.velocity.vy - 2 * dot * cy / 4096);
    }

    const distInt = Math.round(Math.sqrt(distSq));
    const pushAmt = minDist - distInt;
    if (pushAmt > 0) {
      ship.x += COSINE(angle, pushAmt);
      ship.y += SINE(angle, pushAmt);
      ship.x = wrapWorldCoord(ship.x, 20480);
      ship.y = wrapWorldCoord(ship.y, 15360);
    }

    const damage = Math.max(1, ship.crew >> 2);
    ship.crew = Math.max(0, ship.crew - damage);

    const soundFrame = damage <= 1 ? 1 : damage <= 3 ? 3 : damage <= 5 ? 5 : 7;
    playBlast(soundFrame);
  }
}
