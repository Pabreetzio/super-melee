import { applyInertialThrust } from '../velocity';
import type { ShipState } from './types';

export function applyShipInertialThrust(
  ship: ShipState,
  maxThrust: number,
  thrustIncrement: number,
  facing = ship.facing,
): void {
  const status = applyInertialThrust(
    ship.velocity,
    facing,
    maxThrust,
    thrustIncrement,
    ship.gravityWell ?? false,
    {
      atMax: ship.shipAtMaxSpeed ?? false,
      beyondMax: ship.shipBeyondMaxSpeed ?? false,
    },
  );
  ship.shipAtMaxSpeed = status.atMax;
  ship.shipBeyondMaxSpeed = status.beyondMax;
  ship.gravityWell = false;
}

export function clearShipSpeedFlags(ship: ShipState): void {
  ship.shipAtMaxSpeed = false;
  ship.shipBeyondMaxSpeed = false;
}
