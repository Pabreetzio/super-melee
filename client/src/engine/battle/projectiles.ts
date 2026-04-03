import { COSINE, SINE } from '../sinetab';
import { VELOCITY_TO_WORLD } from '../velocity';
import type { ShipState } from '../ships/types';
import type { BattleExplosion, IonDot } from './types';

export function advanceExplosions(
  explosions: BattleExplosion[],
  worldW: number,
  worldH: number,
): BattleExplosion[] {
  return explosions.filter(e => {
    if (e.type === 'splinter') {
      const vx = e.vx ?? 0;
      const vy = e.vy ?? 0;
      const fracX = Math.abs(vx) & 31;
      const newExX = (e.ex ?? 0) + fracX;
      e.ex = newExX & 31;
      const carryX = newExX >= 32 ? 1 : 0;
      e.x += VELOCITY_TO_WORLD(Math.abs(vx)) * Math.sign(vx) + (vx >= 0 ? carryX : -carryX);

      const fracY = Math.abs(vy) & 31;
      const newExY = (e.ey ?? 0) + fracY;
      e.ey = newExY & 31;
      const carryY = newExY >= 32 ? 1 : 0;
      e.y += VELOCITY_TO_WORLD(Math.abs(vy)) * Math.sign(vy) + (vy >= 0 ? carryY : -carryY);

      e.x = ((e.x % worldW) + worldW) % worldW;
      e.y = ((e.y % worldH) + worldH) % worldH;
    }
    e.frame++;
    return e.type === 'splinter' ? e.frame < 7 : e.type === 'boom' ? e.frame < 9 : e.frame < 8;
  });
}

export function updateIonTrails(
  ionTrails: [IonDot[], IonDot[]],
  ships: [ShipState, ShipState],
  warpIn: [number, number],
): void {
  for (let side = 0; side < 2; side++) {
    const ship = ships[side];
    for (const dot of ionTrails[side]) dot.age++;
    ionTrails[side] = ionTrails[side].filter(d => d.age < 12);
    if (ship.thrusting && warpIn[side] === 0 && ship.crew > 0) {
      const backAng = ((ship.facing * 4 + 32) & 63);
      ionTrails[side].push({
        x: ship.x + COSINE(backAng, 28),
        y: ship.y + SINE(backAng, 28),
        age: 0,
      });
    }
  }
}
