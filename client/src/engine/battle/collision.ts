import { playBlast } from '../audio';
import { COSINE, SINE, tableAngle } from '../sinetab';
import { DISPLAY_TO_WORLD } from '../velocity';
import type { ShipState } from '../ships/types';
import { resolveShipCollision, worldAngle } from './helpers';

export function handleShipShipCollision(
  ships: [ShipState, ShipState],
  warpIn: [number, number],
  shipRadius: number,
): void {
  const r = DISPLAY_TO_WORLD(shipRadius);
  const dx = ships[1].x - ships[0].x;
  const dy = ships[1].y - ships[0].y;
  const distSq = dx * dx + dy * dy;
  const minDist = r + r;
  if (warpIn[0] !== 0 || warpIn[1] !== 0 || distSq >= minDist * minDist || distSq === 0) return;

  resolveShipCollision(ships[0], ships[1]);
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
  }

  ships[0].crew = Math.max(0, ships[0].crew - 1);
  ships[1].crew = Math.max(0, ships[1].crew - 1);
}

export function handleShipPlanetCollisions(
  ships: [ShipState, ShipState],
  planetX: number,
  planetY: number,
  planetRadiusW: number,
  shipRadius: number,
): void {
  const minDist = DISPLAY_TO_WORLD(shipRadius) + planetRadiusW;
  const minDistSq = minDist * minDist;

  for (const ship of ships) {
    const pdx = ship.x - planetX;
    const pdy = ship.y - planetY;
    const distSq = pdx * pdx + pdy * pdy;
    if (distSq >= minDistSq || distSq === 0) continue;

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
    }

    const damage = Math.max(1, ship.crew >> 2);
    ship.crew = Math.max(0, ship.crew - damage);

    const soundFrame = damage <= 1 ? 1 : damage <= 3 ? 3 : damage <= 5 ? 5 : 7;
    playBlast(soundFrame);
  }
}
