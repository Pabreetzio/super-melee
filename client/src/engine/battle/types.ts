import type { ShipId } from 'shared/types';
import type { ShipState, BattleMissile, LaserFlash } from '../ships/types';

// Cosmetic explosion animation (not included in checksum; purely visual)
export interface BattleExplosion {
  type: 'boom' | 'blast' | 'splinter' | 'mycon_plasma' | 'chenjesu_spark' | 'supox_glob';
  x: number;
  y: number;
  frame: number;
  vx?: number;
  vy?: number;
  ex?: number;
  ey?: number;
}

export interface ShipDestructionState {
  frame: number;
  x: number;
  y: number;
}

// Cosmetic ion trail dot emitted while thrusting (not checksummed)
export interface IonDot {
  x: number;
  y: number;
  age: number;
}

// Winner ship state preserved between rounds (offline modes only)
export interface WinnerShipState {
  side: 0 | 1;
  crew: number;
  energy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  persistedMissiles?: BattleMissile[];
}

export interface BattleState {
  ships:     [ShipState, ShipState];
  shipTypes: [ShipId, ShipId];
  missiles:  BattleMissile[];
  lasers:    LaserFlash[];
  explosions: BattleExplosion[];
  shipDestructions: [ShipDestructionState | null, ShipDestructionState | null];
  ionTrails:  [IonDot[], IonDot[]];
  warpIn:     [number, number];
  rebirth:    [number, number];
  shipAlive:  [boolean, boolean];
  frame: number;
  inputBuf: [Map<number, number>, Map<number, number>];
  pendingEnd: { winner: 0 | 1 | null; countdown: number; dittyStarted: boolean } | null;
}
