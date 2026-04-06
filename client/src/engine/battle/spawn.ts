// Spawn-point selection for battle start and ship re-entry.
// Pure functions — no side effects. World geometry is passed as parameters.

import type { ShipState } from '../ships/types';
import { DISPLAY_TO_WORLD } from '../velocity';
import { worldDelta, wrapWorldCoord } from './helpers';
import { RNG } from '../rng';

const GRAVITY_THRESHOLD_W    = DISPLAY_TO_WORLD(255);
const SPAWN_CONFLICT_RADIUS_W = DISPLAY_TO_WORLD(24);
const VUX_ENTRY_DIST_W        = DISPLAY_TO_WORLD((150 + 12 + 46) << 1);

function randomSpawnCoord(rng: RNG, worldSize: number): number {
  return (rng.rand(worldSize >> 2) << 2) % worldSize;
}

function inGravityWell(
  x: number, y: number,
  planetX: number, planetY: number,
  worldW: number, worldH: number,
): boolean {
  const { dx, dy } = worldDelta(x, y, planetX, planetY, worldW, worldH);
  return dx * dx + dy * dy <= GRAVITY_THRESHOLD_W * GRAVITY_THRESHOLD_W;
}

function conflictsWithShips(
  x: number, y: number,
  ships: ReadonlyArray<ShipState>,
  worldW: number, worldH: number,
): boolean {
  for (const ship of ships) {
    const { dx, dy } = worldDelta(x, y, ship.x, ship.y, worldW, worldH);
    if (dx * dx + dy * dy < SPAWN_CONFLICT_RADIUS_W * SPAWN_CONFLICT_RADIUS_W) return true;
  }
  return false;
}

export function pickSpawnPoint(
  rng: RNG,
  existingShips: ReadonlyArray<ShipState>,
  planetX: number,
  planetY: number,
  worldW: number,
  worldH: number,
): { x: number; y: number } {
  for (let attempt = 0; attempt < 256; attempt++) {
    const x = randomSpawnCoord(rng, worldW);
    const y = randomSpawnCoord(rng, worldH);
    if (!inGravityWell(x, y, planetX, planetY, worldW, worldH)
        && !conflictsWithShips(x, y, existingShips, worldW, worldH)) {
      return { x, y };
    }
  }
  // Fallback: preserve progress even if our approximation gets unlucky.
  return {
    x: wrapWorldCoord(planetX - DISPLAY_TO_WORLD(300), worldW),
    y: wrapWorldCoord(planetY, worldH),
  };
}

export function pickVuxSpawnPoint(
  rng: RNG,
  targetShip: ShipState,
  existingShips: ReadonlyArray<ShipState>,
  planetX: number,
  planetY: number,
  worldW: number,
  worldH: number,
): { x: number; y: number } {
  for (let attempt = 0; attempt < 256; attempt++) {
    const x = wrapWorldCoord(
      targetShip.x - (VUX_ENTRY_DIST_W >> 1) + rng.rand(VUX_ENTRY_DIST_W),
      worldW,
    );
    const y = wrapWorldCoord(
      targetShip.y - (VUX_ENTRY_DIST_W >> 1) + rng.rand(VUX_ENTRY_DIST_W),
      worldH,
    );
    if (!inGravityWell(x, y, planetX, planetY, worldW, worldH)
        && !conflictsWithShips(x, y, existingShips, worldW, worldH)) {
      return { x, y };
    }
  }
  return pickSpawnPoint(rng, existingShips, planetX, planetY, worldW, worldH);
}
