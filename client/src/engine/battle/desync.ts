// Desync diagnostics: frame snapshot ring buffer and mismatch logging.
// Snapshots are captured every frame in networked mode and stored in a ring
// buffer so when checksum_mismatch arrives we can print the divergence point.

import type { BattleState } from './types';
import { computeChecksum } from './helpers';
import type { BattleInputTraceEntry } from 'shared/types';

export interface FrameSnap {
  frame:    number;
  i0:       number;
  i1:       number;
  checksum: number;
  rngSeed:  number;
  shipTypes: [string, string];
  ships: Array<{
    x: number; y: number;
    vx: number; vy: number; ex: number; ey: number; travelAngle: number;
    facing: number; crew: number; energy: number;
    thrustWait: number; turnWait: number; weaponWait: number;
    specialWait: number; energyWait: number; thrusting: boolean;
    limpets?: number;
    shipAlive: boolean;
    destructionFrame: number | null;
  }>;
  asteroids: Array<{
    prevX: number; prevY: number;
    x: number; y: number;
    vx: number; vy: number; ex: number; ey: number; travelAngle: number;
    facing: number;
    turnWait: number; spinRate: number; spinReverse: boolean; rubbleFrames: number;
  }>;
  missiles: Array<{
    prevX: number; prevY: number;
    x: number; y: number; facing: number; life: number; hitPoints: number;
    speed: number; owner: number; tracks: boolean; weaponType?: string;
    vx: number; vy: number; ex: number; ey: number; travelAngle: number;
    dogiDeathTimer?: number;
  }>;
  lightning: Array<{
    owner: number; x1: number; y1: number; x2: number; y2: number;
    turnWait: number; collided: boolean;
  }>;
  crewPods: Array<{
    x: number; y: number; targetSide: number; life: number; collectDelay: number; blink: boolean;
  }>;
  warpIn:   [number, number];
  rebirth:  [number, number];
  pendingEnd: { winner: 0 | 1 | null; countdown: number } | null;
}

export function captureSnap(bs: BattleState, i0: number, i1: number): FrameSnap {
  return {
    frame: bs.frame,
    i0, i1,
    checksum: computeChecksum(bs),
    rngSeed: bs.rngSeed,
    shipTypes: [...bs.shipTypes] as [string, string],
    ships: bs.ships.map((s, side) => ({
      x: s.x, y: s.y,
      vx: s.velocity.vx, vy: s.velocity.vy,
      ex: s.velocity.ex, ey: s.velocity.ey,
      travelAngle: s.velocity.travelAngle,
      facing: s.facing,
      crew: s.crew, energy: s.energy,
      thrustWait: s.thrustWait, turnWait: s.turnWait,
      weaponWait: s.weaponWait, specialWait: s.specialWait,
      energyWait: s.energyWait, thrusting: s.thrusting,
      limpets: s.limpetCount,
      shipAlive: bs.shipAlive[side],
      destructionFrame: bs.shipDestructions[side]?.frame ?? null,
    })),
    asteroids: bs.asteroids.map(a => ({
      prevX: a.prevX, prevY: a.prevY,
      x: a.x, y: a.y,
      vx: a.velocity.vx, vy: a.velocity.vy,
      ex: a.velocity.ex, ey: a.velocity.ey,
      travelAngle: a.velocity.travelAngle,
      facing: a.facing,
      turnWait: a.turnWait,
      spinRate: a.spinRate,
      spinReverse: a.spinReverse,
      rubbleFrames: a.rubbleFrames,
    })),
    missiles: bs.missiles.map(m => ({
      prevX: m.prevX, prevY: m.prevY,
      x: m.x, y: m.y, facing: m.facing, life: m.life,
      hitPoints: m.hitPoints,
      speed: m.speed, owner: m.owner, tracks: m.tracks,
      weaponType: m.weaponType,
      vx: m.velocity.vx, vy: m.velocity.vy,
      ex: m.velocity.ex, ey: m.velocity.ey,
      travelAngle: m.velocity.travelAngle,
      dogiDeathTimer: m.dogiDeathTimer,
    })),
    lightning: bs.lightningSegments.map(segment => ({
      owner: segment.owner,
      x1: segment.x1,
      y1: segment.y1,
      x2: segment.x2,
      y2: segment.y2,
      turnWait: segment.turnWait,
      collided: segment.collided,
    })),
    crewPods: bs.crewPods.map(pod => ({
      x: pod.x,
      y: pod.y,
      targetSide: pod.targetSide,
      life: pod.life,
      collectDelay: pod.collectDelay,
      blink: pod.blink,
    })),
    warpIn:  [...bs.warpIn]  as [number, number],
    rebirth: [...bs.rebirth] as [number, number],
    pendingEnd: bs.pendingEnd
      ? { winner: bs.pendingEnd.winner, countdown: bs.pendingEnd.countdown }
      : null,
  };
}

export interface DesyncServerContext {
  frame: number;
  hostCrc?: number;
  oppCrc?: number;
  roomCode?: string;
  inputTrace?: BattleInputTraceEntry[];
}

export interface DesyncReport {
  schema: 1;
  createdAt: string;
  yourSide: 0 | 1;
  mismatchCount: number;
  mismatch: DesyncServerContext;
  currentFrame: number;
  userAgent: string;
  capturedFrameRange: { first: number | null; last: number | null };
  snapshotCount: number;
  timeline: CompactFrameSnap[];
  snapshots: FrameSnap[];
}

export interface CompactFrameSnap {
  frame: number;
  i0: number;
  i1: number;
  checksum: number;
  rngSeed: number;
  ship0: CompactShipSnap;
  ship1: CompactShipSnap;
  counts: {
    asteroids: number;
    missiles: number;
    lightning: number;
    crewPods: number;
  };
  warpIn: [number, number];
  rebirth: [number, number];
}

interface CompactShipSnap {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  crew: number;
  energy: number;
  turnWait: number;
  thrustWait: number;
  weaponWait: number;
}

function compactSnap(s: FrameSnap): CompactFrameSnap {
  const ship0 = s.ships[0];
  const ship1 = s.ships[1];
  return {
    frame: s.frame,
    i0: s.i0,
    i1: s.i1,
    checksum: s.checksum,
    rngSeed: s.rngSeed,
    ship0: compactShip(ship0),
    ship1: compactShip(ship1),
    counts: {
      asteroids: s.asteroids.length,
      missiles: s.missiles.length,
      lightning: s.lightning.length,
      crewPods: s.crewPods.length,
    },
    warpIn: s.warpIn,
    rebirth: s.rebirth,
  };
}

function compactShip(ship: FrameSnap['ships'][number]): CompactShipSnap {
  return {
    x: ship.x,
    y: ship.y,
    vx: ship.vx,
    vy: ship.vy,
    facing: ship.facing,
    crew: ship.crew,
    energy: ship.energy,
    turnWait: ship.turnWait,
    thrustWait: ship.thrustWait,
    weaponWait: ship.weaponWait,
  };
}

export function buildDesyncReport(
  snapHistory: FrameSnap[],
  mismatch: DesyncServerContext,
  cur: number,
  yourSide: 0 | 1,
  mismatchN: number,
): DesyncReport {
  const timeline = snapHistory.slice(-120).map(compactSnap);
  const mismatchFrame = mismatch.frame;
  let snapshots = snapHistory.filter(s => s.frame >= mismatchFrame - 12 && s.frame <= mismatchFrame + 4);
  if (snapshots.length === 0) snapshots = snapHistory.slice(-24);

  return {
    schema: 1,
    createdAt: new Date().toISOString(),
    yourSide,
    mismatchCount: mismatchN,
    mismatch,
    currentFrame: cur,
    userAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
    capturedFrameRange: {
      first: snapHistory[0]?.frame ?? null,
      last: snapHistory[snapHistory.length - 1]?.frame ?? null,
    },
    snapshotCount: snapshots.length,
    timeline,
    snapshots,
  };
}

export function formatDesyncReport(report: DesyncReport): string {
  return JSON.stringify(report, null, 2);
}

export function logDesyncEvent(
  snapHistory: FrameSnap[],
  mismatch: DesyncServerContext,
  cur: number,
  yourSide: 0 | 1,
  mismatchN: number,
): void {
  const mf = mismatch.frame;
  const snap = snapHistory.find(s => s.frame === mf);
  console.group(
    `%c[DESYNC #${mismatchN}] Checksum mismatch — diverged at frame ${mf}, currently at frame ${cur}`,
    'color:orange;font-weight:bold;font-size:14px',
  );
  console.log('yourSide:', yourSide, 'server:', mismatch);
  // Compact per-frame table: both players paste this; compare row-by-row to find first divergence.
  console.log('--- FRAME HISTORY (compact) ---');
  console.log('frm  crc        rng        i0 i1 | s0.facing s0.turnW s0.vx  s0.vy  | s1.facing s1.turnW s1.vx  s1.vy  s1.trvlA');
  for (const s of snapHistory) {
    const s0 = s.ships[0]; const s1 = s.ships[1];
    const mark = s.frame === mf ? '*** ' : '    ';
    console.log(
      mark + String(s.frame).padStart(3) + '  ' +
      s.checksum.toString(16).padStart(8, '0') + ' ' +
      String(s.rngSeed).padStart(10) + ' ' +
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
    console.log('ASTEROIDS:', snap.asteroids.length, JSON.stringify(snap.asteroids));
    console.log('MISSILES:', snap.missiles.length, JSON.stringify(snap.missiles));
    console.log('LIGHTNING:', snap.lightning.length, JSON.stringify(snap.lightning));
    console.log('CREW PODS:', snap.crewPods.length, JSON.stringify(snap.crewPods));
    console.log('warpIn:', snap.warpIn, ' inputs(i0,i1):', snap.i0, snap.i1);
  } else {
    console.warn('Mismatch frame not in ring buffer — RTT too high?');
    console.log('Oldest buffered frame:', snapHistory[0]?.frame);
  }
  console.groupEnd();
}
