// Desync diagnostics: frame snapshot ring buffer and mismatch logging.
// Snapshots are captured every frame in networked mode and stored in a ring
// buffer so when checksum_mismatch arrives we can print the divergence point.

import type { BattleState } from './types';

export interface FrameSnap {
  frame:    number;
  i0:       number;
  i1:       number;
  ships: Array<{
    x: number; y: number;
    vx: number; vy: number; ex: number; ey: number; travelAngle: number;
    facing: number; crew: number; energy: number;
    thrustWait: number; turnWait: number; weaponWait: number;
    specialWait: number; energyWait: number; thrusting: boolean;
  }>;
  missiles: Array<{ x: number; y: number; facing: number; life: number; speed: number; owner: number; tracks: boolean }>;
  warpIn:   [number, number];
  rebirth:  [number, number];
}

export function captureSnap(bs: BattleState, i0: number, i1: number): FrameSnap {
  return {
    frame: bs.frame,
    i0, i1,
    ships: bs.ships.map(s => ({
      x: s.x, y: s.y,
      vx: s.velocity.vx, vy: s.velocity.vy,
      ex: s.velocity.ex, ey: s.velocity.ey,
      travelAngle: s.velocity.travelAngle,
      facing: s.facing,
      crew: s.crew, energy: s.energy,
      thrustWait: s.thrustWait, turnWait: s.turnWait,
      weaponWait: s.weaponWait, specialWait: s.specialWait,
      energyWait: s.energyWait, thrusting: s.thrusting,
    })),
    missiles: bs.missiles.map(m => ({
      x: m.x, y: m.y, facing: m.facing, life: m.life,
      speed: m.speed, owner: m.owner, tracks: m.tracks,
    })),
    warpIn:  [...bs.warpIn]  as [number, number],
    rebirth: [...bs.rebirth] as [number, number],
  };
}

export function logDesyncEvent(
  snapHistory: FrameSnap[],
  mf: number,
  cur: number,
  yourSide: 0 | 1,
  mismatchN: number,
): void {
  const snap = snapHistory.find(s => s.frame === mf);
  console.group(
    `%c[DESYNC #${mismatchN}] Checksum mismatch — diverged at frame ${mf}, currently at frame ${cur}`,
    'color:orange;font-weight:bold;font-size:14px',
  );
  console.log('yourSide:', yourSide, '— game continues (states may drift)');
  // Compact per-frame table: both players paste this; compare row-by-row to find first divergence.
  console.log('--- FRAME HISTORY (compact) ---');
  console.log('frm  i0 i1 | s0.facing s0.turnW s0.vx  s0.vy  | s1.facing s1.turnW s1.vx  s1.vy  s1.trvlA');
  for (const s of snapHistory) {
    const s0 = s.ships[0]; const s1 = s.ships[1];
    const mark = s.frame === mf ? '*** ' : '    ';
    console.log(
      mark + String(s.frame).padStart(3) + '  ' +
      String(s.i0).padStart(2) + ' ' + String(s.i1).padStart(2) + ' | ' +
      String(s0.facing).padStart(9) + ' ' + String(s0.turnWait).padStart(7) + ' ' +
      String(s0.vx).padStart(6) + ' ' + String(s0.vy).padStart(6) + ' | ' +
      String(s1.facing).padStart(9) + ' ' + String(s1.turnWait).padStart(7) + ' ' +
      String(s1.vx).padStart(6) + ' ' + String(s1.vy).padStart(6) + ' ' +
      String(s1.travelAngle).padStart(7),
    );
  }
  console.log('--- MISMATCH FRAME FULL STATE ---');
  if (snap) {
    console.log('SHIP 0:', JSON.stringify(snap.ships[0]));
    console.log('SHIP 1:', JSON.stringify(snap.ships[1]));
    console.log('MISSILES:', snap.missiles.length, JSON.stringify(snap.missiles));
    console.log('warpIn:', snap.warpIn, ' inputs(i0,i1):', snap.i0, snap.i1);
  } else {
    console.warn('Mismatch frame not in ring buffer — RTT too high?');
    console.log('Oldest buffered frame:', snapHistory[0]?.frame);
  }
  console.groupEnd();
}
