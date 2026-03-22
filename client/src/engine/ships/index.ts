// Ship registry — placeholder stats for all 27 ships.
// Values are rough estimates; will be refined per UQM source deep-dives.
// Canonical reference: uqm-0.8.0/src/uqm/ships/<name>/<name>.c

import type { ShipId } from 'shared/types';

export interface ShipDef {
  id:         ShipId;
  name:       string;        // display name
  crew:       number;        // hit points
  energy:     number;        // battery / special energy capacity
  speed:      number;        // max speed (world units/tick, × VELOCITY_UNIT)
  turnRate:   number;        // angles per turn (64-unit circle)
  thrustDelay: number;       // frames between thrust applications
  turnDelay:  number;        // frames between turns
  mass:       number;        // collision mass
  radius:     number;        // collision radius (display pixels)
  // Weapons — stubs until ship deep-dives
  primaryDamage:   number;
  secondaryDamage: number;
}

// prettier-ignore
const SHIPS: ShipDef[] = [
  { id: 'androsynth', name: 'Androsynth Guardian', crew: 20, energy: 20, speed: 36, turnRate: 2, thrustDelay: 0, turnDelay: 1, mass: 5, radius: 15, primaryDamage: 3, secondaryDamage: 0 },
  { id: 'arilou',     name: 'Arilou Skiff',        crew:  6, energy: 20, speed: 48, turnRate: 4, thrustDelay: 0, turnDelay: 0, mass: 2, radius: 10, primaryDamage: 2, secondaryDamage: 0 },
  { id: 'chenjesu',   name: 'Chenjesu Broodhome',  crew: 30, energy: 20, speed: 18, turnRate: 2, thrustDelay: 2, turnDelay: 2, mass: 9, radius: 20, primaryDamage: 6, secondaryDamage: 0 },
  { id: 'chmmr',      name: 'Chmmr Avatar',        crew: 42, energy: 20, speed: 18, turnRate: 2, thrustDelay: 2, turnDelay: 2, mass: 9, radius: 22, primaryDamage: 9, secondaryDamage: 0 },
  { id: 'druuge',     name: 'Druuge Mauler',        crew:  4, energy: 20, speed: 36, turnRate: 3, thrustDelay: 1, turnDelay: 1, mass: 4, radius: 14, primaryDamage: 9, secondaryDamage: 0 },
  { id: 'human',      name: 'Earthling Cruiser',   crew: 18, energy: 20, speed: 30, turnRate: 2, thrustDelay: 1, turnDelay: 1, mass: 6, radius: 16, primaryDamage: 4, secondaryDamage: 0 },
  { id: 'ilwrath',    name: 'Ilwrath Avenger',     crew: 14, energy: 20, speed: 30, turnRate: 4, thrustDelay: 0, turnDelay: 0, mass: 4, radius: 12, primaryDamage: 3, secondaryDamage: 0 },
  { id: 'melnorme',   name: 'Melnorme Trader',     crew: 18, energy: 20, speed: 24, turnRate: 2, thrustDelay: 1, turnDelay: 1, mass: 6, radius: 16, primaryDamage: 5, secondaryDamage: 0 },
  { id: 'mmrnmhrm',   name: 'Mmrnmhrm X-Form',    crew: 14, energy: 20, speed: 40, turnRate: 4, thrustDelay: 0, turnDelay: 0, mass: 4, radius: 12, primaryDamage: 3, secondaryDamage: 0 },
  { id: 'mycon',      name: 'Mycon Podship',       crew: 20, energy: 20, speed: 24, turnRate: 2, thrustDelay: 1, turnDelay: 1, mass: 6, radius: 16, primaryDamage: 8, secondaryDamage: 0 },
  { id: 'orz',        name: 'Orz Nemesis',         crew: 22, energy: 20, speed: 30, turnRate: 2, thrustDelay: 1, turnDelay: 1, mass: 7, radius: 16, primaryDamage: 5, secondaryDamage: 0 },
  { id: 'pkunk',      name: 'Pkunk Fury',          crew:  6, energy: 20, speed: 42, turnRate: 4, thrustDelay: 0, turnDelay: 0, mass: 2, radius: 10, primaryDamage: 1, secondaryDamage: 0 },
  { id: 'shofixti',   name: 'Shofixti Scout',      crew:  4, energy: 20, speed: 36, turnRate: 4, thrustDelay: 0, turnDelay: 0, mass: 2, radius: 10, primaryDamage: 2, secondaryDamage: 0 },
  { id: 'slylandro',  name: 'Slylandro Probe',     crew: 18, energy: 20, speed: 48, turnRate: 2, thrustDelay: 0, turnDelay: 0, mass: 4, radius: 14, primaryDamage: 3, secondaryDamage: 0 },
  { id: 'spathi',     name: 'Spathi Eluder',       crew: 16, energy: 20, speed: 36, turnRate: 4, thrustDelay: 0, turnDelay: 0, mass: 4, radius: 14, primaryDamage: 3, secondaryDamage: 0 },
  { id: 'supox',      name: 'Supox Blade',         crew: 16, energy: 20, speed: 36, turnRate: 4, thrustDelay: 0, turnDelay: 0, mass: 4, radius: 14, primaryDamage: 3, secondaryDamage: 0 },
  { id: 'syreen',     name: 'Syreen Penetrator',   crew: 12, energy: 20, speed: 36, turnRate: 4, thrustDelay: 0, turnDelay: 0, mass: 3, radius: 12, primaryDamage: 3, secondaryDamage: 0 },
  { id: 'thraddash',  name: 'Thraddash Torch',     crew: 16, energy: 20, speed: 36, turnRate: 4, thrustDelay: 0, turnDelay: 0, mass: 4, radius: 14, primaryDamage: 4, secondaryDamage: 0 },
  { id: 'umgah',      name: 'Umgah Drone',         crew: 14, energy: 20, speed: 12, turnRate: 2, thrustDelay: 2, turnDelay: 2, mass: 6, radius: 16, primaryDamage: 5, secondaryDamage: 0 },
  { id: 'urquan',     name: "Ur-Quan Dreadnought", crew: 42, energy: 20, speed: 18, turnRate: 2, thrustDelay: 2, turnDelay: 2, mass: 9, radius: 22, primaryDamage: 9, secondaryDamage: 0 },
  { id: 'utwig',      name: 'Utwig Jugger',        crew: 22, energy: 20, speed: 30, turnRate: 2, thrustDelay: 1, turnDelay: 1, mass: 7, radius: 16, primaryDamage: 6, secondaryDamage: 0 },
  { id: 'vux',        name: 'VUX Intruder',        crew: 20, energy: 20, speed: 18, turnRate: 2, thrustDelay: 2, turnDelay: 2, mass: 6, radius: 16, primaryDamage: 5, secondaryDamage: 0 },
  { id: 'yehat',      name: 'Yehat Terminator',    crew: 20, energy: 20, speed: 36, turnRate: 4, thrustDelay: 0, turnDelay: 0, mass: 5, radius: 14, primaryDamage: 4, secondaryDamage: 0 },
  { id: 'zoqfotpik',  name: 'Zoq-Fot-Pik Stinger', crew: 8, energy: 20, speed: 42, turnRate: 4, thrustDelay: 0, turnDelay: 0, mass: 2, radius: 10, primaryDamage: 2, secondaryDamage: 0 },
  { id: 'blackurq',   name: 'Black Ur-Quan',       crew: 42, energy: 20, speed: 18, turnRate: 2, thrustDelay: 2, turnDelay: 2, mass: 9, radius: 22, primaryDamage: 9, secondaryDamage: 0 },
  { id: 'kohrah',     name: 'Kohr-Ah Marauder',    crew: 20, energy: 20, speed: 30, turnRate: 2, thrustDelay: 1, turnDelay: 1, mass: 7, radius: 18, primaryDamage: 7, secondaryDamage: 0 },
  { id: 'samatra',    name: 'Sa-Matra',            crew: 99, energy:  0, speed:  0, turnRate: 0, thrustDelay: 0, turnDelay: 0, mass:15, radius: 40, primaryDamage: 0, secondaryDamage: 0 },
];

const SHIP_MAP = new Map<ShipId, ShipDef>(SHIPS.map(s => [s.id, s]));

export function getShipDef(id: ShipId): ShipDef | undefined {
  return SHIP_MAP.get(id);
}

export function getAllShips(): ShipDef[] {
  return SHIPS;
}

export const SHIP_NAMES: Record<ShipId, string> = Object.fromEntries(
  SHIPS.map(s => [s.id, s.name])
) as Record<ShipId, string>;
