import { COSINE, SINE } from '../sinetab';
import { DISPLAY_TO_WORLD, WORLD_TO_VELOCITY } from '../velocity';
import { wrapWorldCoord } from './helpers';
import type { BattleExplosion, ShipDestructionState } from './types';

export const SHIP_DESTRUCTION_TOTAL_FRAMES = 36;
export const SHIP_DESTRUCTION_HIDE_FRAME = 15;

function spawnCountForFrame(frame: number): number {
  if (frame < 0 || frame > 25) return 0;
  if (frame <= 2 || frame >= 20) return 1;
  if (frame <= 5 || frame >= 18) return 2;
  return 3;
}

export function beginShipDestruction(x: number, y: number): ShipDestructionState {
  return { frame: 0, x, y };
}

export function shouldRenderExplodingShip(destruction: ShipDestructionState | null): boolean {
  return destruction === null || destruction.frame < SHIP_DESTRUCTION_HIDE_FRAME;
}

export function advanceShipDestruction(
  destruction: ShipDestructionState | null,
  explosions: BattleExplosion[],
  rand: (n: number) => number,
  worldW: number,
  worldH: number,
): ShipDestructionState | null {
  if (!destruction) return null;

  const burstCount = spawnCountForFrame(destruction.frame);
  for (let i = 0; i < burstCount; i++) {
    const spawnAngle = rand(64);
    let spawnDist = DISPLAY_TO_WORLD(rand(8));
    if (rand(3) === 0) spawnDist += DISPLAY_TO_WORLD(8);

    const velocityAngle = rand(64);
    const velocityMag = WORLD_TO_VELOCITY(DISPLAY_TO_WORLD(rand(5)));

    explosions.push({
      type: 'boom',
      x: wrapWorldCoord(destruction.x + COSINE(spawnAngle, spawnDist), worldW),
      y: wrapWorldCoord(destruction.y + SINE(spawnAngle, spawnDist), worldH),
      frame: 0,
      vx: COSINE(velocityAngle, velocityMag),
      vy: SINE(velocityAngle, velocityMag),
      ex: 0,
      ey: 0,
    });
  }

  destruction.frame++;
  return destruction.frame >= SHIP_DESTRUCTION_TOTAL_FRAMES ? null : destruction;
}
