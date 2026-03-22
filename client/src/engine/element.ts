// Element types — port of UQM element/object model from src/uqm/element.h
// Elements are the universal game object: ships, weapons, planets, etc.

import type { Velocity } from './velocity';

// State flags (bit flags matching UQM ELEMENT_FLAGS)
export const PLAYER_CONTROL   = 0x0001; // controlled by a human player
export const FINITE_LIFE      = 0x0002; // expires when life_span reaches 0
export const DISAPPEARING     = 0x0004; // marked for removal this frame
export const COLLISION        = 0x0008; // participates in collision detection
export const BACKGROUND_OBJ   = 0x0010; // excluded from checksum (stars, etc.)
export const GRAVITY_MASS     = 0x0020; // affected by planet gravity
export const SHIP_OBJECT      = 0x0040; // this is a ship (not a weapon/debris)
export const WEAPON_OBJECT    = 0x0080; // this is a weapon

export type ElementFlags = number;

export interface Point {
  x: number;
  y: number;
}

export interface Element {
  // Identity
  id:          number;
  playerSide:  0 | 1 | -1; // which player owns this element (-1 = neutral)

  // State
  state_flags: ElementFlags;
  life_span:   number; // frames until expiry (if FINITE_LIFE)

  // Combat stats
  crew_level:  number; // hit points
  mass_points: number; // mass for collision physics

  // Movement control timers (in frames)
  turn_wait:   number;
  thrust_wait: number;

  // Position (world coords, integer)
  current:     Point;
  next:        Point; // predicted next position (before collision)

  // Velocity
  velocity:    Velocity;

  // Facing angle (0–63)
  facing:      number;

  // Ship-specific
  energy:      number; // special energy / battery
  maxEnergy:   number;
  maxCrew:     number;
}

let nextId = 1;
export function makeElement(side: 0 | 1 | -1, flags: ElementFlags): Element {
  return {
    id:          nextId++,
    playerSide:  side,
    state_flags: flags,
    life_span:   0,
    crew_level:  0,
    mass_points: 0,
    turn_wait:   0,
    thrust_wait: 0,
    current:     { x: 0, y: 0 },
    next:        { x: 0, y: 0 },
    velocity:    { xError: 0, yError: 0, dx: 0, dy: 0 },
    facing:      0,
    energy:      0,
    maxEnergy:   0,
    maxCrew:     0,
  };
}

export function isAlive(el: Element): boolean {
  return !(el.state_flags & DISAPPEARING) && el.crew_level > 0;
}
