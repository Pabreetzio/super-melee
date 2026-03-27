// Battle screen — canvas game loop with UQM physics and sprite rendering.
// Human (Earthling Cruiser) ship is fully implemented.
// Other ships fall back to a colored placeholder.

import { useEffect, useRef, useState } from 'react';
import type { FullRoomState, FleetSlot } from 'shared/types';
import { client } from '../net/client';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2, BATTLE_FPS } from '../engine/game';
import { COSINE, SINE, tableAngle } from '../engine/sinetab';
import { DISPLAY_TO_WORLD } from '../engine/velocity';
import {
  makeHumanShip, updateHumanShip,
  MAX_CREW, MAX_ENERGY, SHIP_RADIUS, LASER_RANGE,
  SPECIAL_ENERGY_COST, SPECIAL_WAIT,
  type HumanShipState, type SpawnRequest,
} from '../engine/ships/human';
import { makeSpathiShip, updateSpathiShip, SPATHI_MAX_CREW, SPATHI_MAX_ENERGY } from '../engine/ships/spathi';
import {
  makeUrquanShip, updateUrquanShip, URQUAN_MAX_CREW, URQUAN_MAX_ENERGY,
  FIGHTER_LIFE, ONE_WAY_FLIGHT, FIGHTER_SPEED, FIGHTER_LASER_RANGE, FIGHTER_WEAPON_WAIT,
} from '../engine/ships/urquan';
import {
  makePkunkShip, updatePkunkShip, PKUNK_MAX_CREW, PKUNK_MAX_ENERGY,
  type PkunkShipState,
} from '../engine/ships/pkunk';
import {
  makeVuxShip, updateVuxShip, VUX_MAX_CREW, VUX_MAX_ENERGY, VUX_LASER_RANGE,
} from '../engine/ships/vux';
import {
  loadCruiserSprites, loadSpathiSprites, loadUrquanSprites, loadPkunkSprites, loadVuxSprites,
  loadGenericShipSprites, loadExplosionSprites, drawSprite,
  type CruiserSprites, type SpathiSprites, type UrquanSprites, type PkunkSprites, type VuxSprites,
  type ShipSpriteSet, type ExplosionSprites,
} from '../engine/sprites';
import {
  setVelocityVector, VELOCITY_TO_WORLD, type VelocityDesc,
} from '../engine/velocity';
import { trackFacing } from '../engine/ships/human';
import { RNG } from '../engine/rng';
import type { ShipId } from 'shared/types';
import HUD from './HUD';
import { preloadBattleSounds, playShipDies, playBlast, playPrimary, playSecondary, playFighterLaser } from '../engine/audio';

// ─── Constants ────────────────────────────────────────────────────────────────

// Display dimensions
const CANVAS_W = 640;
const CANVAS_H = 480;

// Zoom system: 4 discrete levels (reduction 0–3 → 1×/2×/4×/8×).
// Arena = 1 screen at max zoom (8×). At min zoom (1×) you see 1/8 of arena.
// Source: UQM units.h, arena = SPACE_WIDTH * 32 × SPACE_HEIGHT * 32 world units.
const MAX_REDUCTION = 3;
const WORLD_W = CANVAS_W << (2 + MAX_REDUCTION); // 640 * 32 = 20480
const WORLD_H = CANVAS_H << (2 + MAX_REDUCTION); // 480 * 32 = 15360

// Planet at world center
const PLANET_X = WORLD_W >> 1; // 10240
const PLANET_Y = WORLD_H >> 1; // 7680

// Planet visual radius in world units (= 40 display px at 1× zoom)
const PLANET_RADIUS_W = 160;

// Gravity threshold in world units = 255 display pixels * 4
const GRAVITY_THRESHOLD_W = DISPLAY_TO_WORLD(255);

const FRAME_MS = 1000 / BATTLE_FPS;

// Star field: 3 tiers matching UQM galaxy.c (BIG=30, MED=60, SML=90)
const STAR_COUNTS = [30, 60, 90] as const;

// Oolite planet sprite hotspots from oolite-{big|med|sml}.ani
// Format: <file> 0 -1 <hotX> <hotY>  (hotspot = sprite center)
const PLANET_HOT: Record<'big' | 'med' | 'sml', [number, number]> = {
  big: [37, 33],
  med: [19, 17],
  sml: [9, 8],
};

// Keyboard → input bit maps, keyed by event.code (layout-independent).
// Bindings match the official UQM uqm.key defaults (base/uqm.key in content package).
//   P1 "Arrows": Up=thrust  Left/Right=turn  RCtrl=weapon  RShift=special
//                Enter=weapon(alt)  Numpad0=special(alt)
//   P2 "WASD":   W=thrust   A/D=turn         V=weapon      B=special
//                Space=weapon(alt)
const KEY_MAP_P1: Record<string, number> = {
  ArrowUp:      INPUT_THRUST,
  ArrowLeft:    INPUT_LEFT,
  ArrowRight:   INPUT_RIGHT,
  ControlRight: INPUT_FIRE1,
  Enter:        INPUT_FIRE1,   // alt — from uqm.key weapon.2
  ShiftRight:   INPUT_FIRE2,
  Numpad0:      INPUT_FIRE2,   // alt — from uqm.key special.2
};

const KEY_MAP_P2: Record<string, number> = {
  KeyW:       INPUT_THRUST,
  KeyA:       INPUT_LEFT,
  KeyD:       INPUT_RIGHT,
  KeyV:       INPUT_FIRE1,
  Space:      INPUT_FIRE1,  // alt
  KeyB:       INPUT_FIRE2,
  ShiftLeft:  INPUT_FIRE2,  // alt
};

// Keys to preventDefault on (avoids browser shortcuts / scroll)
const GAME_KEYS = new Set([
  ...Object.keys(KEY_MAP_P1),
  ...Object.keys(KEY_MAP_P2),
]);

// ─── Types ────────────────────────────────────────────────────────────────────

// General missile — covers nukes, BUTT, limpets, and all future ship weapons.
// All fields come from the ship's SpawnRequest + initial velocity state.
interface BattleMissile {
  x: number; y: number;
  facing: number;      // 0–15
  velocity: VelocityDesc;
  life: number;
  speed: number;       // current speed (world units)
  maxSpeed: number;
  accel: number;       // speed increase per frame
  damage: number;
  tracks: boolean;
  trackWait: number;   // frames until next tracking step
  trackRate: number;   // reset value for trackWait
  owner: 0 | 1;
  limpet?: boolean;    // VUX limpet: applies movement impairment on hit
}

// One-frame laser line (point-defense flash or fighter laser), world coords
interface LaserFlash {
  x1: number; y1: number;
  x2: number; y2: number;
}

// Ur-Quan autonomous fighter craft
interface BattleFighter {
  x: number; y: number;
  facing: number;
  velocity: VelocityDesc;
  life: number;    // counts down; 0 = dead
  weaponWait: number;
  owner: 0 | 1;
}

// Cosmetic explosion animation (not included in checksum; purely visual)
interface BattleExplosion {
  type: 'boom' | 'blast';
  x: number;
  y: number;
  frame: number; // current frame index; advances each sim tick
}

// Cosmetic ion trail dot emitted while thrusting (not checksummed)
interface IonDot {
  x: number; y: number; age: number; // age 0–11; fades and colors cycle
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
}

interface BattleState {
  ships:     [HumanShipState, HumanShipState];
  shipTypes: [ShipId, ShipId];
  missiles:  BattleMissile[];
  fighters:  BattleFighter[];
  lasers:    LaserFlash[];      // cleared each sim frame; rendered as 1-frame flashes
  explosions: BattleExplosion[]; // cosmetic; not checksum'd
  ionTrails:  [IonDot[], IonDot[]]; // cosmetic thruster exhaust dots; not checksum'd
  warpIn:     [number, number];     // countdown 15→0; ship invisible + nonsolid during warp-in
  shipAlive:  [boolean, boolean]; // tracks alive→dead transition for boom spawn
  frame: number;
  // Input buffers: [myInputs, opponentInputs], indexed by frame number
  inputBuf: [Map<number, number>, Map<number, number>];
  // Pending battle end: counts down after death to let explosion animate
  pendingEnd: { winner: 0 | 1 | null; countdown: number } | null;
}

interface Props {
  room:        FullRoomState;
  yourSide:    0 | 1;
  seed:        number;
  inputDelay:  number;
  isAI?:       boolean;
  isLocal2P?:  boolean;
  winnerState?: WinnerShipState | null;
  onBattleEnd: (winner: 0 | 1 | null, winnerState?: WinnerShipState) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Battle({ room, yourSide, seed: _seed, inputDelay, isAI = false, isLocal2P = false, winnerState = null, onBattleEnd }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const stateRef     = useRef<BattleState | null>(null);
  const keysRef      = useRef(new Set<string>());
  const rafRef       = useRef<number | null>(null);
  const lastTimeRef  = useRef(0);
  const accumRef     = useRef(0);
  const spritesRef       = useRef<CruiserSprites | null>(null);
  const spathiSpritesRef = useRef<SpathiSprites | null>(null);
  const urquanSpritesRef = useRef<UrquanSprites | null>(null);
  const pkunkSpritesRef  = useRef<PkunkSprites  | null>(null);
  const vuxSpritesRef         = useRef<VuxSprites       | null>(null);
  const explosionSpritesRef   = useRef<ExplosionSprites | null>(null);
  // Cache for generic ship sprites (ships without specific weapon sprite loaders)
  const genericSpritesRef = useRef<Map<string, ShipSpriteSet>>(new Map());
  const reductionRef = useRef(0); // current zoom level 0–MAX_REDUCTION
  // Stars: flat array [big×30, med×60, sml×90] of {x,y} world-unit positions
  const starsRef = useRef<{ x: number; y: number }[]>([]);
  const rngRef   = useRef<RNG | null>(null);

  // ─── Desync diagnostics ──────────────────────────────────────────────────
  // Ring buffer: last 64 frames of full game state + inputs used.
  // Populated every frame; read when checksum_mismatch arrives from server.
  interface FrameSnap {
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
    fighters: Array<{ x: number; y: number; facing: number; life: number; weaponWait: number; owner: number }>;
    warpIn:   [number, number];
  }
  const snapHistoryRef = useRef<FrameSnap[]>([]);

  function captureSnap(bs: BattleState, i0: number, i1: number): FrameSnap {
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
      fighters: bs.fighters.map(f => ({
        x: f.x, y: f.y, facing: f.facing, life: f.life,
        weaponWait: f.weaponWait, owner: f.owner,
      })),
      warpIn: [...bs.warpIn] as [number, number],
    };
  }

  // Planet sprite images (oolite big/med/sml); null until loaded
  const planetImgRef = useRef<{ big: HTMLImageElement; med: HTMLImageElement; sml: HTMLImageElement } | null>(null);
  const [hudData, setHudData] = useState({ myCrewPct: 1, oppCrewPct: 1, myEnergyPct: 1, oppEnergyPct: 1 });
  // uiScale: ratio of physical display pixels to logical 640×480 game pixels.
  // Stored in a ref so the render loop always sees the current value without
  // needing to re-bind the tick/render closures on every resize.
  const uiScaleRef  = useRef(1);
  const [displaySize, setDisplaySize] = useState({ w: CANVAS_W, h: CANVAS_H });

  // Initialize battle state
  useEffect(() => {
    // Determine each player's active ship type from their fleet.
    // fleet0 = host (ship 0), fleet1 = opponent (ship 1) — always absolute,
    // never relative to yourSide. Both clients must compute the same types
    // for the lockstep simulation to remain in sync.
    const fleet0 = room.host.fleet;
    const fleet1 = room.opponent?.fleet ?? [];
    const type0 = (fleet0.find(Boolean) ?? 'human') as ShipId;
    const type1 = (fleet1.find(Boolean) ?? 'human') as ShipId;

    const rng = new RNG(_seed || 1);
    rngRef.current = rng;
    // Generate star field using seed for determinism.
    {
      const stars: { x: number; y: number }[] = [];
      for (let i = 0; i < STAR_COUNTS[0] + STAR_COUNTS[1] + STAR_COUNTS[2]; i++) {
        stars.push({ x: rng.rand(WORLD_W), y: rng.rand(WORLD_H) });
      }
      starsRef.current = stars;
    }

    const makeShip = (type: ShipId, x: number, y: number) => {
      if (type === 'spathi') return makeSpathiShip(x, y);
      if (type === 'urquan') return makeUrquanShip(x, y);
      if (type === 'pkunk')  return makePkunkShip(x, y, () => rng.rand(1000) / 1000);
      if (type === 'vux')    return makeVuxShip(x, y);
      return makeHumanShip(x, y);
    };

    const s0 = makeShip(type0, PLANET_X - DISPLAY_TO_WORLD(300), PLANET_Y);
    const s1 = makeShip(type1, PLANET_X + DISPLAY_TO_WORLD(300), PLANET_Y);
    s1.facing = 8; // face the other direction

    // Apply winner state if this is a continuation battle (offline modes).
    // Winner keeps exact crew/energy/position/velocity from previous fight.
    // The loser's new ship starts at the default spawn position (above).
    let warpIn0 = 15;
    let warpIn1 = 15;
    if (winnerState) {
      const ws = winnerState;
      const wShip = ws.side === 0 ? s0 : s1;
      wShip.crew    = ws.crew;
      wShip.energy  = ws.energy;
      wShip.x       = ws.x;
      wShip.y       = ws.y;
      wShip.velocity.vx = ws.vx;
      wShip.velocity.vy = ws.vy;
      wShip.facing  = ws.facing;
      // Winner skips warp-in (they're already in the arena)
      if (ws.side === 0) warpIn0 = 0; else warpIn1 = 0;
    }

    // Pre-seed input buffers for frames 0..inputDelay-1 with zero input.
    // Both sides agree that the game starts with no input held, so we can
    // fill these locally without network communication. Without this, the
    // lockstep stalls forever because sendFrame = frame + inputDelay means
    // we never enqueue anything for the earliest frames.
    const inputBuf: [Map<number,number>, Map<number,number>] = [new Map(), new Map()];
    for (let f = 0; f < inputDelay; f++) {
      inputBuf[0].set(f, 0);
      inputBuf[1].set(f, 0);
    }

    stateRef.current = {
      ships: [s0, s1],
      shipTypes: [type0, type1],
      missiles: [],
      fighters: [],
      lasers: [],
      explosions: [],
      ionTrails: [[], []],
      warpIn: [warpIn0, warpIn1],
      shipAlive: [true, true],
      frame: 0,
      inputBuf,
      pendingEnd: null,
    };

    // Preload sounds (non-blocking; silently ignored if files are missing)
    preloadBattleSounds([type0, type1]);

    // Load sprites (non-blocking; canvas falls back to placeholder if unavailable)
    loadCruiserSprites().then(sp => { spritesRef.current = sp; }).catch(() => {});
    loadSpathiSprites().then(sp => { spathiSpritesRef.current = sp; }).catch(() => {});
    loadUrquanSprites().then(sp => { urquanSpritesRef.current = sp; }).catch(() => {});
    loadPkunkSprites().then(sp => { pkunkSpritesRef.current = sp; }).catch(() => {});
    loadVuxSprites().then(sp => { vuxSpritesRef.current = sp; }).catch(() => {});
    loadExplosionSprites().then(sp => { explosionSpritesRef.current = sp; }).catch(() => {});

    // Load generic sprites for any ship types without specific weapon loaders
    const handledTypes = new Set(['human', 'spathi', 'urquan', 'pkunk', 'vux']);
    for (const t of [type0, type1]) {
      if (!handledTypes.has(t)) {
        loadGenericShipSprites(t).then(sp => {
          if (sp) genericSpritesRef.current.set(t, sp);
        }).catch(() => {});
      }
    }

    // Load oolite planet sprites (non-blocking)
    {
      const big = new Image(); big.src = '/assets/battle/oolite-big-000.png';
      const med = new Image(); med.src = '/assets/battle/oolite-med-000.png';
      const sml = new Image(); sml.src = '/assets/battle/oolite-sml-000.png';
      let n = 0;
      const done = () => { if (++n === 3) planetImgRef.current = { big, med, sml }; };
      big.onload = med.onload = sml.onload = done;
    }

    // Tell server which ship slot we're entering with (first occupied slot)
    const myFleet = yourSide === 0 ? room.host.fleet : room.opponent?.fleet ?? [];
    const firstSlot = myFleet.findIndex(s => s !== null);
    if (firstSlot >= 0) {
      client.send({ type: 'ship_select', slot: firstSlot });
    }

    // Subscribe to net messages (not used in AI mode)
    const unsub = isAI ? () => {} : client.onMessage(msg => {
      if (msg.type === 'battle_input' && stateRef.current) {
        const opSide = yourSide === 0 ? 1 : 0;
        stateRef.current.inputBuf[opSide].set(msg.frame, msg.input);
      } else if (msg.type === 'battle_over') {
        // Don't end immediately — let the explosion animation play out.
        const bs = stateRef.current;
        if (bs) {
          if (!bs.pendingEnd) {
            bs.pendingEnd = { winner: msg.winner, countdown: 10 };
          } else {
            bs.pendingEnd.winner = msg.winner; // server's winner is authoritative
          }
        } else {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          onBattleEnd(msg.winner);
        }
      } else if (msg.type === 'checksum_mismatch') {
        const mf = msg.frame;
        const cur = stateRef.current?.frame ?? -1;
        const allSnaps = snapHistoryRef.current;
        const snap = allSnaps.find(s => s.frame === mf);
        console.group(
          `%c[DESYNC] Checksum mismatch — diverged at frame ${mf}, currently at frame ${cur}`,
          'color:red;font-weight:bold;font-size:14px'
        );
        console.log('yourSide:', yourSide);
        // Compact per-frame table: find where Ship 1 state first changed unusually.
        // Both players paste this; compare row-by-row to find first divergence.
        console.log('--- FRAME HISTORY (compact) ---');
        console.log('frm  i0 i1 | s0.facing s0.turnW s0.vx  s0.vy  | s1.facing s1.turnW s1.vx  s1.vy  s1.trvlA');
        for (const s of allSnaps) {
          const s0 = s.ships[0]; const s1 = s.ships[1];
          const mark = s.frame === mf ? '*** ' : '    ';
          console.log(
            mark + String(s.frame).padStart(3) + '  ' +
            String(s.i0).padStart(2) + ' ' + String(s.i1).padStart(2) + ' | ' +
            String(s0.facing).padStart(9) + ' ' + String(s0.turnWait).padStart(7) + ' ' +
            String(s0.vx).padStart(6) + ' ' + String(s0.vy).padStart(6) + ' | ' +
            String(s1.facing).padStart(9) + ' ' + String(s1.turnWait).padStart(7) + ' ' +
            String(s1.vx).padStart(6) + ' ' + String(s1.vy).padStart(6) + ' ' +
            String(s1.travelAngle).padStart(7)
          );
        }
        console.log('--- MISMATCH FRAME FULL STATE ---');
        if (snap) {
          console.log('SHIP 0:', JSON.stringify(snap.ships[0]));
          console.log('SHIP 1:', JSON.stringify(snap.ships[1]));
          console.log('MISSILES:', snap.missiles.length, JSON.stringify(snap.missiles));
          console.log('FIGHTERS:', snap.fighters.length, JSON.stringify(snap.fighters));
          console.log('warpIn:', snap.warpIn, ' inputs(i0,i1):', snap.i0, snap.i1);
        } else {
          console.warn('Mismatch frame not in ring buffer — RTT too high?');
          console.log('Oldest buffered frame:', allSnaps[0]?.frame);
        }
        console.groupEnd();
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        onBattleEnd(null);
      }
    });

    // Keyboard — track by event.code so bindings are layout-independent
    // and we can distinguish Left/RightCtrl, Left/RightShift, etc.
    const onDown = (e: KeyboardEvent) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      keysRef.current.add(e.code);
    };
    const onUp = (e: KeyboardEvent) => { keysRef.current.delete(e.code); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup',   onUp);

    // Start loop
    lastTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup',   onUp);
      unsub();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Fill screen ─────────────────────────────────────────────────────────
  // We render to a native-resolution canvas (no CSS scaling) so sprites are
  // drawn at physical screen pixels. ctx.scale(uiScale) is applied each frame
  // so all game logic stays in the 640×480 logical coordinate space.
  useEffect(() => {
    function updateScale() {
      const s = Math.min(window.innerWidth / CANVAS_W, window.innerHeight / CANVAS_H);
      uiScaleRef.current = s;
      const w = Math.round(CANVAS_W * s);
      const h = Math.round(CANVAS_H * s);
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width  = w;
        canvas.height = h;
      }
      setDisplaySize({ w, h });
    }
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // ─── Game loop ───────────────────────────────────────────────────────────

  function computeInput(keyMap: Record<string, number>): number {
    let bits = 0;
    for (const code of keysRef.current) bits |= keyMap[code] ?? 0;
    return bits;
  }

  function tick(now: number) {
    rafRef.current = requestAnimationFrame(tick);
    accumRef.current += now - lastTimeRef.current;
    lastTimeRef.current = now;

    while (accumRef.current >= FRAME_MS) {
      accumRef.current -= FRAME_MS;
      advance();
    }

    render();
  }

  function advance() {
    const bs = stateRef.current;
    if (!bs) return;

    const mySide = yourSide;
    const opSide: 0 | 1 = yourSide === 0 ? 1 : 0;
    // P1 always uses KEY_MAP_P1; P2 always uses KEY_MAP_P2
    const myInput = computeInput(mySide === 0 ? KEY_MAP_P1 : KEY_MAP_P2);

    let i0: number;
    let i1: number;

    if (isLocal2P) {
      // Both players on same keyboard — no network, no delay
      i0 = computeInput(KEY_MAP_P1);
      i1 = computeInput(KEY_MAP_P2);
    } else if (isAI) {
      // AI mode: no network — compute both inputs locally, no delay
      const aiInput = computeAIInput(bs.ships[opSide], bs.ships[mySide], bs.missiles, opSide);
      i0 = mySide === 0 ? myInput : aiInput;
      i1 = mySide === 1 ? myInput : aiInput;
    } else {
      // Lockstep: buffer my input for a future frame, wait for opponent's
      const sendFrame = bs.frame + inputDelay;
      bs.inputBuf[mySide].set(sendFrame, myInput);
      client.send({ type: 'battle_input', frame: sendFrame, input: myInput });

      const p0 = bs.inputBuf[0].get(bs.frame);
      const p1 = bs.inputBuf[1].get(bs.frame);
      if (p0 === undefined || p1 === undefined) return; // stall

      bs.inputBuf[0].delete(bs.frame);
      bs.inputBuf[1].delete(bs.frame);
      i0 = p0; i1 = p1;
    }

    // Simulate one frame
    simulateFrame(bs, i0, i1);
    bs.frame++;

    // Record snapshot for desync diagnostics (networked mode only)
    const isOffline = isAI || isLocal2P;
    if (!isOffline) {
      const snaps = snapHistoryRef.current;
      snaps.push(captureSnap(bs, i0, i1));
      if (snaps.length > 64) snaps.shift();
    }

    // Checksums / battle-over (only in networked mode)
    if (!isOffline) {
      client.send({ type: 'checksum', frame: bs.frame, crc: computeChecksum(bs) });
    }

    // Pkunk resurrection: if a Pkunk's crew hits 0 and canResurrect is set,
    // respawn it at a random position with full stats (UQM new_pkunk behavior).
    for (let side = 0; side < 2; side++) {
      const ship = bs.ships[side];
      if (ship.crew <= 0 && bs.shipTypes[side] === 'pkunk') {
        const pkunk = ship as PkunkShipState;
        if (pkunk.canResurrect) {
          pkunk.canResurrect = false; // one resurrection per life
          pkunk.crew = PKUNK_MAX_CREW;
          pkunk.energy = PKUNK_MAX_ENERGY;
          // Random respawn position in world
          const rng = rngRef.current!;
          pkunk.x = rng.rand(WORLD_W);
          pkunk.y = rng.rand(WORLD_H);
          pkunk.velocity = { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 };
          pkunk.facing = rng.rand(16);
        }
      }
    }

    // Detect battle end and start countdown to let explosion animate.
    // pendingEnd is set once (when the first ship death is detected) and then
    // counts down to 0 before calling onBattleEnd. Both offline and online modes
    // use this path; online mode also receives an authoritative winner from server.
    const s0dead = bs.ships[0].crew <= 0;
    const s1dead = bs.ships[1].crew <= 0;
    if ((s0dead || s1dead) && !bs.pendingEnd) {
      const winner: 0 | 1 | null = s0dead && s1dead ? null : s0dead ? 1 : 0;
      bs.pendingEnd = { winner, countdown: 10 }; // ~10 frames ≈ 415 ms
      if (!isAI && !isLocal2P) {
        client.send({ type: 'battle_over_ack' });
      }
    }
    if (bs.pendingEnd) {
      bs.pendingEnd.countdown--;
      if (bs.pendingEnd.countdown <= 0) {
        const w = bs.pendingEnd.winner;
        let ws: WinnerShipState | undefined;
        if (w !== null) {
          const wShip = bs.ships[w];
          ws = {
            side: w,
            crew:    wShip.crew,
            energy:  wShip.energy,
            x:       wShip.x,
            y:       wShip.y,
            vx:      wShip.velocity.vx,
            vy:      wShip.velocity.vy,
            facing:  wShip.facing,
          };
        }
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        onBattleEnd(w, ws);
        return;
      }
    }

    // Update HUD (use per-ship max stats)
    const maxCrewFor  = (t: ShipId) =>
      t === 'spathi' ? SPATHI_MAX_CREW   : t === 'urquan' ? URQUAN_MAX_CREW   : t === 'pkunk' ? PKUNK_MAX_CREW   : t === 'vux' ? VUX_MAX_CREW   : MAX_CREW;
    const maxEnergyFor = (t: ShipId) =>
      t === 'spathi' ? SPATHI_MAX_ENERGY : t === 'urquan' ? URQUAN_MAX_ENERGY : t === 'pkunk' ? PKUNK_MAX_ENERGY : t === 'vux' ? VUX_MAX_ENERGY : MAX_ENERGY;
    setHudData({
      myCrewPct:    bs.ships[mySide].crew    / maxCrewFor(bs.shipTypes[mySide]),
      oppCrewPct:   bs.ships[opSide].crew    / maxCrewFor(bs.shipTypes[opSide]),
      myEnergyPct:  bs.ships[mySide].energy  / maxEnergyFor(bs.shipTypes[mySide]),
      oppEnergyPct: bs.ships[opSide].energy  / maxEnergyFor(bs.shipTypes[opSide]),
    });
  }

  function simulateFrame(bs: BattleState, input0: number, input1: number) {
    bs.lasers = []; // clear previous frame's laser flashes

    // Apply gravity to both ships
    applyGravity(bs.ships[0]);
    applyGravity(bs.ships[1]);

    // Decrement warp-in countdown (ship is invisible and nonsolid during this)
    if (bs.warpIn[0] > 0) bs.warpIn[0]--;
    if (bs.warpIn[1] > 0) bs.warpIn[1]--;

    // Update ships — dispatch to correct ship update function.
    // Ships still warping in cannot act (no weapons, no steering).
    const updateShip = (ship: HumanShipState, input: number, type: ShipId, warping: boolean): SpawnRequest[] => {
      if (warping) return []; // frozen during warp-in
      if (type === 'spathi') return updateSpathiShip(ship, input);
      if (type === 'urquan') return updateUrquanShip(ship, input);
      if (type === 'pkunk')  return updatePkunkShip(ship, input);
      if (type === 'vux')    return updateVuxShip(ship, input);
      return updateHumanShip(ship, input);
    };
    const spawns0 = updateShip(bs.ships[0], input0, bs.shipTypes[0], bs.warpIn[0] > 0);
    const spawns1 = updateShip(bs.ships[1], input1, bs.shipTypes[1], bs.warpIn[1] > 0);

    // Wrap positions
    bs.ships[0].x = ((bs.ships[0].x % WORLD_W) + WORLD_W) % WORLD_W;
    bs.ships[0].y = ((bs.ships[0].y % WORLD_H) + WORLD_H) % WORLD_H;
    bs.ships[1].x = ((bs.ships[1].x % WORLD_W) + WORLD_W) % WORLD_W;
    bs.ships[1].y = ((bs.ships[1].y % WORLD_H) + WORLD_H) % WORLD_H;

    // Spawn weapons
    const spawnRequest = (s: SpawnRequest, owner: 0 | 1) => {
      if (s.type === 'missile') {
        const v: VelocityDesc = { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 };
        setVelocityVector(v, s.speed, s.facing);
        // Pkunk bug-gun: add ship velocity to missile velocity (UQM DeltaVelocityComponents)
        if (s.inheritVelocity) {
          const ownerShip = bs.ships[owner];
          v.vx += ownerShip.velocity.vx;
          v.vy += ownerShip.velocity.vy;
        }
        bs.missiles.push({
          x: s.x, y: s.y, facing: s.facing, velocity: v,
          life: s.life, speed: s.speed, maxSpeed: s.maxSpeed,
          accel: s.accel, damage: s.damage,
          tracks: s.tracks, trackWait: s.trackRate, trackRate: s.trackRate,
          owner,
        });
      } else if (s.type === 'fighter') {
        const v: VelocityDesc = { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 };
        setVelocityVector(v, FIGHTER_SPEED, s.facing);
        bs.fighters.push({
          x: s.x, y: s.y, facing: s.facing, velocity: v,
          life: FIGHTER_LIFE, weaponWait: 0, owner,
        });
      } else if (s.type === 'vux_laser') {
        applyVuxLaser(bs, owner, s.x, s.y, s.facing);
      }
    };
    for (const s of spawns0) {
      spawnRequest(s, 0);
      if (s.type === 'point_defense') { applyPointDefense(bs, 0); playSecondary(bs.shipTypes[0]); }
      else if (s.type === 'missile')  playPrimary(bs.shipTypes[0]);
      else if (s.type === 'vux_laser') playPrimary(bs.shipTypes[0]);
    }
    for (const s of spawns1) {
      spawnRequest(s, 1);
      if (s.type === 'point_defense') { applyPointDefense(bs, 1); playSecondary(bs.shipTypes[1]); }
      else if (s.type === 'missile')  playPrimary(bs.shipTypes[1]);
      else if (s.type === 'vux_laser') playPrimary(bs.shipTypes[1]);
    }

    // Update missiles
    const aliveMissiles: BattleMissile[] = [];
    for (const m of bs.missiles) {
      m.life--;
      if (m.life <= 0) continue;

      // Tracking
      if (m.tracks) {
        const targetShip = bs.ships[m.owner === 0 ? 1 : 0];
        const targetAngle = worldAngle(m.x, m.y, targetShip.x, targetShip.y);
        if (m.trackWait > 0) {
          m.trackWait--;
        } else {
          m.facing = trackFacing(m.facing, targetAngle);
          m.trackWait = m.trackRate;
        }
      }

      // Acceleration (nuke) or fixed speed (BUTT / Spathi gun)
      m.speed = Math.min(m.speed + m.accel, m.maxSpeed);
      setVelocityVector(m.velocity, m.speed, m.facing);

      // Position advance (Bresenham sub-pixel, same as ships)
      {
        const fracX = Math.abs(m.velocity.vx) & 31;
        m.velocity.ex += fracX;
        const carryX = m.velocity.ex >= 32 ? 1 : 0;
        m.velocity.ex &= 31;
        m.x += VELOCITY_TO_WORLD(Math.abs(m.velocity.vx)) * Math.sign(m.velocity.vx)
              + (m.velocity.vx >= 0 ? carryX : -carryX);

        const fracY = Math.abs(m.velocity.vy) & 31;
        m.velocity.ey += fracY;
        const carryY = m.velocity.ey >= 32 ? 1 : 0;
        m.velocity.ey &= 31;
        m.y += VELOCITY_TO_WORLD(Math.abs(m.velocity.vy)) * Math.sign(m.velocity.vy)
              + (m.velocity.vy >= 0 ? carryY : -carryY);
      }

      // Wrap
      m.x = ((m.x % WORLD_W) + WORLD_W) % WORLD_W;
      m.y = ((m.y % WORLD_H) + WORLD_H) % WORLD_H;

      // Collision with ships (missile only hits the opposing side; skip if target is warping in)
      let hit = false;
      const targetSide = m.owner === 0 ? 1 : 0;
      const targetShip = bs.ships[targetSide];
      if (bs.warpIn[targetSide] === 0 && circleOverlap(m.x, m.y, 4, targetShip.x, targetShip.y, DISPLAY_TO_WORLD(SHIP_RADIUS))) {
        targetShip.crew = Math.max(0, targetShip.crew - m.damage);
        bs.explosions.push({ type: 'blast', x: m.x, y: m.y, frame: 0 });
        playBlast(m.damage);
        // VUX limpet: apply movement impairment (increase turn/thrust wait)
        if (m.limpet) {
          targetShip.turnWait  = Math.min(15, targetShip.turnWait  + 1);
          targetShip.thrustWait = Math.min(15, targetShip.thrustWait + 1);
        }
        hit = true;
      }
      if (!hit) aliveMissiles.push(m);
    }
    bs.missiles = aliveMissiles;

    // Update fighters (Ur-Quan autonomous craft)
    {
      const aliveFighters: BattleFighter[] = [];
      for (const f of bs.fighters) {
        f.life--;
        if (f.life <= 0) continue;

        const motherShip = bs.ships[f.owner];
        const enemyShip  = bs.ships[f.owner === 0 ? 1 : 0];

        // Phase: if enough life left to return, track enemy; else track mothership
        const returning = f.life < ONE_WAY_FLIGHT && motherShip.crew > 0;
        const navTarget = returning ? motherShip : enemyShip;

        // Turn toward target
        const targetAngle = worldAngle(f.x, f.y, navTarget.x, navTarget.y);
        f.facing = trackFacing(f.facing, targetAngle);

        // Set velocity
        setVelocityVector(f.velocity, FIGHTER_SPEED, f.facing);

        // Advance position
        {
          const fracX = Math.abs(f.velocity.vx) & 31;
          f.velocity.ex += fracX;
          const carryX = f.velocity.ex >= 32 ? 1 : 0;
          f.velocity.ex &= 31;
          f.x += VELOCITY_TO_WORLD(Math.abs(f.velocity.vx)) * Math.sign(f.velocity.vx)
                + (f.velocity.vx >= 0 ? carryX : -carryX);

          const fracY = Math.abs(f.velocity.vy) & 31;
          f.velocity.ey += fracY;
          const carryY = f.velocity.ey >= 32 ? 1 : 0;
          f.velocity.ey &= 31;
          f.y += VELOCITY_TO_WORLD(Math.abs(f.velocity.vy)) * Math.sign(f.velocity.vy)
                + (f.velocity.vy >= 0 ? carryY : -carryY);
        }
        f.x = ((f.x % WORLD_W) + WORLD_W) % WORLD_W;
        f.y = ((f.y % WORLD_H) + WORLD_H) % WORLD_H;

        // Fighter laser: fire when enemy within 3/4 of laser range
        const laserRangeSq = (FIGHTER_LASER_RANGE * 3 / 4) ** 2;
        if (!returning && f.weaponWait === 0) {
          const dx = enemyShip.x - f.x;
          const dy = enemyShip.y - f.y;
          if (dx * dx + dy * dy < laserRangeSq) {
            const laserAngle = worldAngle(f.x, f.y, enemyShip.x, enemyShip.y);
            const ex = COSINE(laserAngle, FIGHTER_LASER_RANGE);
            const ey = SINE(laserAngle, FIGHTER_LASER_RANGE);
            bs.lasers.push({ x1: f.x, y1: f.y, x2: f.x + ex, y2: f.y + ey });
            enemyShip.crew = Math.max(0, enemyShip.crew - 1);
            f.weaponWait = FIGHTER_WEAPON_WAIT;
            playFighterLaser();
          }
        }
        if (f.weaponWait > 0) f.weaponWait--;

        // Returning fighter: die if it reaches mothership (restores 1 crew)
        if (returning) {
          const dx = motherShip.x - f.x;
          const dy = motherShip.y - f.y;
          if (dx * dx + dy * dy < DISPLAY_TO_WORLD(SHIP_RADIUS) ** 2) {
            motherShip.crew = Math.min(motherShip.crew + 1, URQUAN_MAX_CREW);
            continue; // removed (don't push to aliveFighters)
          }
        }

        aliveFighters.push(f);
      }
      bs.fighters = aliveFighters;
    }

    // Advance cosmetic explosions (advance 1 frame per sim tick, remove when done)
    bs.explosions = bs.explosions.filter(e => {
      e.frame++;
      return e.frame < (e.type === 'boom' ? 9 : 8);
    });

    // Ship–ship collision (skip if either ship is still warping in)
    {
      const r = DISPLAY_TO_WORLD(SHIP_RADIUS);
      const dx = bs.ships[1].x - bs.ships[0].x;
      const dy = bs.ships[1].y - bs.ships[0].y;
      const distSq = dx * dx + dy * dy;
      const minDist = r + r;
      if (bs.warpIn[0] === 0 && bs.warpIn[1] === 0 && distSq < minDist * minDist && distSq > 0) {
        resolveShipCollision(bs.ships[0], bs.ships[1]);
        // Push ships apart so they don't re-trigger next frame
        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        if (overlap > 0) {
          const push = Math.ceil(overlap / 2);
          bs.ships[0].x -= Math.round((dx / dist) * push);
          bs.ships[0].y -= Math.round((dy / dist) * push);
          bs.ships[1].x += Math.round((dx / dist) * push);
          bs.ships[1].y += Math.round((dy / dist) * push);
        }
        bs.ships[0].crew = Math.max(0, bs.ships[0].crew - 1);
        bs.ships[1].crew = Math.max(0, bs.ships[1].crew - 1);
      }
    }

    // Ship–planet collision (UQM misc.c / ship.c behavior):
    //   damage = ship.crew >> 2  (25% current HP, min 1)
    //   planet has DEFY_PHYSICS — ship bounces, planet doesn't move
    {
      const minDist = DISPLAY_TO_WORLD(SHIP_RADIUS) + PLANET_RADIUS_W;
      const minDistSq = minDist * minDist;
      for (let side = 0; side < 2; side++) {
        const ship = bs.ships[side];
        const pdx = ship.x - PLANET_X;
        const pdy = ship.y - PLANET_Y;
        const distSq = pdx * pdx + pdy * pdy;
        if (distSq >= minDistSq || distSq === 0) continue;

        // Bounce: reflect velocity away from planet center using COSINE/SINE tables
        // (integer-safe; same trig tables used everywhere in UQM port)
        const angle = worldAngle(PLANET_X, PLANET_Y, ship.x, ship.y); // away from planet
        const cx = COSINE(angle, 64);
        const cy = SINE(angle, 64);
        const dot = ship.velocity.vx * cx + ship.velocity.vy * cy; // projected onto away-normal
        if (dot < 0) {
          // Approaching — reflect the toward-planet component
          ship.velocity.vx = Math.trunc(ship.velocity.vx - 2 * dot * cx / 4096);
          ship.velocity.vy = Math.trunc(ship.velocity.vy - 2 * dot * cy / 4096);
        }

        // Push ship outside collision radius
        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        ship.x += Math.round((pdx / dist) * overlap);
        ship.y += Math.round((pdy / dist) * overlap);

        // Damage: 25% current HP, min 1
        const damage = Math.max(1, ship.crew >> 2);
        ship.crew = Math.max(0, ship.crew - damage);
      }
    }

    // Spawn boom explosion when a ship transitions alive→dead
    for (let side = 0; side < 2; side++) {
      const alive = bs.ships[side].crew > 0;
      if (bs.shipAlive[side] && !alive) {
        bs.explosions.push({ type: 'boom', x: bs.ships[side].x, y: bs.ships[side].y, frame: 0 });
        playShipDies();
      }
      bs.shipAlive[side] = alive;
    }

    // Update ion trail dots (cosmetic thruster exhaust; not checksummed).
    // Colors cycle from orange → red → dark red per UQM cycle_ion_trail.
    for (let side = 0; side < 2; side++) {
      const ship = bs.ships[side];
      // Advance age and cull expired dots
      for (const dot of bs.ionTrails[side]) dot.age++;
      bs.ionTrails[side] = bs.ionTrails[side].filter(d => d.age < 12);
      // Spawn a new dot behind the ship when thrusting and not warping in
      if (ship.thrusting && bs.warpIn[side] === 0 && ship.crew > 0) {
        const backAng = ((ship.facing * 4 + 32) & 63);
        bs.ionTrails[side].push({
          x: ship.x + COSINE(backAng, 28), // ~7 display px at 1× zoom
          y: ship.y + SINE(backAng, 28),
          age: 0,
        });
      }
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  function render() {
    const canvas = canvasRef.current;
    const bs     = stateRef.current;
    if (!canvas || !bs) return;
    const ctx = canvas.getContext('2d')!;
    const sp  = spritesRef.current;

    // Scale all canvas operations to physical pixels.
    // All game coordinates remain in the logical 640×480 space.
    // imageSmoothingEnabled = false gives nearest-neighbor scaling for
    // sprites — crisp pixel art without blur, same as UQM's original output.
    const s = uiScaleRef.current;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // ── Zoom level ───────────────────────────────────────────────────────
    reductionRef.current = calcReduction(bs.ships, reductionRef.current);
    const r = reductionRef.current;

    // w2d: world-space offset → display pixels at current zoom
    const w2d = (n: number) => n >> (2 + r);

    // ── Camera: wrap-aware midpoint, then offset by half-view ────────────
    let ax = bs.ships[0].x, bx = bs.ships[1].x;
    let ay = bs.ships[0].y, by = bs.ships[1].y;
    if (Math.abs(bx - ax) > WORLD_W >> 1) bx -= Math.sign(bx - ax) * WORLD_W;
    if (Math.abs(by - ay) > WORLD_H >> 1) by -= Math.sign(by - ay) * WORLD_H;
    const midX = ((((ax + bx) >> 1) % WORLD_W) + WORLD_W) % WORLD_W;
    const midY = ((((ay + by) >> 1) % WORLD_H) + WORLD_H) % WORLD_H;

    // Top-left of camera window in world coords
    const camX = midX - (CANVAS_W << (1 + r));
    const camY = midY - (CANVAS_H << (1 + r));

    // ── Background ───────────────────────────────────────────────────────
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // ── Stars ────────────────────────────────────────────────────────────
    // 180 stars placed in world space (fixed, like UQM's galaxy.c stars).
    // 3 tiers: big (2×2 white), med (1×1 light), sml (1×1 dim).
    // Stars scroll with the camera; wrap toroidally at world edges.
    {
      const worldDW = WORLD_W >> (2 + r); // world width in display pixels
      const worldDH = WORLD_H >> (2 + r);
      const stars = starsRef.current;
      const med0 = STAR_COUNTS[0];
      const sml0 = STAR_COUNTS[0] + STAR_COUNTS[1];
      const total = sml0 + STAR_COUNTS[2];
      for (let i = 0; i < total; i++) {
        let sx = (stars[i].x - camX) >> (2 + r);
        let sy = (stars[i].y - camY) >> (2 + r);
        // Wrap single step — world is always >= screen width at any zoom
        if (sx < 0) sx += worldDW; else if (sx >= CANVAS_W) sx -= worldDW;
        if (sy < 0) sy += worldDH; else if (sy >= CANVAS_H) sy -= worldDH;
        if (sx < 0 || sx >= CANVAS_W || sy < 0 || sy >= CANVAS_H) continue;
        if (i < med0) {
          // Big star: 2×2 bright white
          ctx.fillStyle = '#fff';
          ctx.fillRect(sx - 1, sy - 1, 2, 2);
        } else if (i < sml0) {
          // Med star: 1×1 light grey
          ctx.fillStyle = '#ccc';
          ctx.fillRect(sx, sy, 1, 1);
        } else {
          // Small star: 1×1 dim grey
          ctx.fillStyle = '#777';
          ctx.fillRect(sx, sy, 1, 1);
        }
      }
    }

    // ── Planet ───────────────────────────────────────────────────────────
    // Oolite sprite: big at r=0, med at r=1, sml at r≥2.
    // Hotspot (sprite center) from oolite-{big|med|sml}.ani.
    // Falls back to a grey circle if images aren't loaded yet.
    {
      const pDX = w2d(PLANET_X - camX);
      const pDY = w2d(PLANET_Y - camY);
      const pi = planetImgRef.current;
      const sizeKey = r === 0 ? 'big' : r === 1 ? 'med' : 'sml';
      const planetR = Math.max(2, PLANET_RADIUS_W >> (2 + r));
      if (pDX > -planetR * 4 && pDX < CANVAS_W + planetR * 4) {
        if (pi) {
          const img = pi[sizeKey];
          const [hx, hy] = PLANET_HOT[sizeKey];
          ctx.drawImage(img, pDX - hx, pDY - hy);
        } else {
          ctx.beginPath();
          ctx.arc(pDX, pDY, planetR, 0, Math.PI * 2);
          ctx.fillStyle = '#1a1a1a';
          ctx.fill();
          ctx.strokeStyle = '#444';
          ctx.lineWidth = Math.max(1, 2 >> r);
          ctx.stroke();
        }
      }
    }

    // ── Missiles ─────────────────────────────────────────────────────────
    {
      const spSp = spathiSpritesRef.current;
      const uqSp = urquanSpritesRef.current;
      const pkSp = pkunkSpritesRef.current;
      const nukeSet    = sp   ? (r >= 2 ? sp.nuke.sml      : r === 1 ? sp.nuke.med      : sp.nuke.big)      : null;
      const buttSet    = spSp ? (r >= 2 ? spSp.butt.sml    : r === 1 ? spSp.butt.med    : spSp.butt.big)    : null;
      const sMissSet   = spSp ? (r >= 2 ? spSp.missile.sml : r === 1 ? spSp.missile.med : spSp.missile.big) : null;
      const fusionSet  = uqSp ? (r >= 2 ? uqSp.fusion.sml  : r === 1 ? uqSp.fusion.med  : uqSp.fusion.big)  : null;
      const bugSet     = pkSp ? (r >= 2 ? pkSp.bug.sml     : r === 1 ? pkSp.bug.med     : pkSp.bug.big)     : null;
      const vxSp      = vuxSpritesRef.current;
      const limpetSet  = vxSp ? (r >= 2 ? vxSp.limpets.sml : r === 1 ? vxSp.limpets.med : vxSp.limpets.big) : null;

      for (const m of bs.missiles) {
        let mset = nukeSet;
        if (bs.shipTypes[m.owner] === 'spathi') {
          mset = m.tracks ? buttSet : sMissSet;
        } else if (bs.shipTypes[m.owner] === 'urquan') {
          mset = fusionSet;
        } else if (bs.shipTypes[m.owner] === 'pkunk') {
          mset = bugSet;
        } else if (bs.shipTypes[m.owner] === 'vux') {
          // Limpet missiles cycle through their 4 animation frames
          mset = limpetSet;
        }
        if (mset) {
          // Limpets cycle through animation frames; others use facing for rotation
          const frameIdx = (bs.shipTypes[m.owner] === 'vux' && m.limpet)
            ? (FIGHTER_LIFE - m.life) & 3  // cycle 0–3 based on age
            : m.facing;
          drawSprite(ctx, mset, frameIdx, m.x, m.y, CANVAS_W, CANVAS_H, camX, camY, r);
        } else {
          placeholderDot(ctx, m.x, m.y, camX, camY, 3, '#ff8', r);
        }
      }
    }

    // ── Fighters ─────────────────────────────────────────────────────────
    {
      const uqSp = urquanSpritesRef.current;
      const fighterSet = uqSp ? (r >= 2 ? uqSp.fighter.sml : r === 1 ? uqSp.fighter.med : uqSp.fighter.big) : null;
      for (const f of bs.fighters) {
        if (fighterSet) {
          drawSprite(ctx, fighterSet, f.facing, f.x, f.y, CANVAS_W, CANVAS_H, camX, camY, r);
        } else {
          placeholderDot(ctx, f.x, f.y, camX, camY, 3, '#8ff', r);
        }
      }
    }

    // ── Point-defense laser flashes (1 frame, white lines) ───────────────
    if (bs.lasers.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const lz of bs.lasers) {
        ctx.moveTo(w2d(lz.x1 - camX), w2d(lz.y1 - camY));
        ctx.lineTo(w2d(lz.x2 - camX), w2d(lz.y2 - camY));
      }
      ctx.stroke();
      ctx.restore();
    }

    // ── Ion trails (thruster exhaust dots) ──────────────────────────────
    // UQM-style: small 1×1 dots cycling orange → red → dark red → gone.
    // Colors from UQM tactrans.c cycle_ion_trail colorTab (RGB15 values).
    {
      // Per-age color: [r, g, b] — 12 steps matching UQM colorTab
      const ION_COLORS: [number, number, number][] = [
        [255, 171,  0], // age 0  (0x1F,0x15,0x00)
        [255, 142,  0], // age 1  (0x1F,0x11,0x00)
        [255, 113,  0], // age 2  (0x1F,0x0E,0x00)
        [255,  85,  0], // age 3  (0x1F,0x0A,0x00)
        [255,  57,  0], // age 4  (0x1F,0x07,0x00)
        [255,  28,  0], // age 5  (0x1F,0x03,0x00)
        [255,   0,  0], // age 6  (0x1F,0x00,0x00)
        [219,   0,  0], // age 7  (0x1B,0x00,0x00)
        [183,   0,  0], // age 8  (0x17,0x00,0x00)
        [147,   0,  0], // age 9  (0x13,0x00,0x00)
        [111,   0,  0], // age 10 (0x0F,0x00,0x00)
        [ 75,   0,  0], // age 11 (0x0B,0x00,0x00)
      ];
      for (let side = 0; side < 2; side++) {
        for (const dot of bs.ionTrails[side]) {
          const [cr, cg, cb] = ION_COLORS[Math.min(dot.age, 11)];
          const dotDX = w2d(dot.x - camX);
          const dotDY = w2d(dot.y - camY);
          if (dotDX < -1 || dotDX > CANVAS_W + 1 || dotDY < -1 || dotDY > CANVAS_H + 1) continue;
          ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
          ctx.fillRect(dotDX, dotDY, 1, 1);
        }
      }
    }

    // ── Ships ────────────────────────────────────────────────────────────
    // Select sprite set based on ship type and zoom level.
    for (let side = 0; side < 2; side++) {
      const ship  = bs.ships[side];
      const color = side === 0 ? '#4af' : '#f84';
      const spSp = spathiSpritesRef.current;
      const uqSp = urquanSpritesRef.current;
      const pkSp = pkunkSpritesRef.current;
      const vxSp = vuxSpritesRef.current;
      let shipSet = null;
      if (bs.shipTypes[side] === 'spathi') {
        shipSet = spSp ? (r >= 2 ? spSp.sml : r === 1 ? spSp.med : spSp.big) : null;
      } else if (bs.shipTypes[side] === 'urquan') {
        shipSet = uqSp ? (r >= 2 ? uqSp.sml : r === 1 ? uqSp.med : uqSp.big) : null;
      } else if (bs.shipTypes[side] === 'pkunk') {
        shipSet = pkSp ? (r >= 2 ? pkSp.sml : r === 1 ? pkSp.med : pkSp.big) : null;
      } else if (bs.shipTypes[side] === 'vux') {
        shipSet = vxSp ? (r >= 2 ? vxSp.sml : r === 1 ? vxSp.med : vxSp.big) : null;
      } else {
        // Try generic sprite cache first, then fall back to cruiser sprites for human
        const generic = genericSpritesRef.current.get(bs.shipTypes[side]);
        if (generic) {
          shipSet = r >= 2 ? generic.sml : r === 1 ? generic.med : generic.big;
        } else {
          shipSet = sp ? (r >= 2 ? sp.sml : r === 1 ? sp.med : sp.big) : null;
        }
      }

      // Warp-in: ship is invisible during countdown (HYPERJUMP_LIFE=15 frames).
      // Render orange→red ion-trail-colored dots approaching from the facing
      // direction, simulating UQM's ship_transition shadow elements.
      if (bs.warpIn[side] > 0) {
        const wi = bs.warpIn[side];
        // Shadow dot approaches ship from the facing direction
        const ang = (ship.facing * 4) & 63; // facing angle
        const distW = Math.round((wi / 15) * DISPLAY_TO_WORLD(120)); // world units
        const shadowX = ship.x + COSINE(ang, distW);
        const shadowY = ship.y + SINE(ang, distW);
        const sdx = w2d(shadowX - camX);
        const sdy = w2d(shadowY - camY);
        // Color cycles: starts bright orange (far), gets redder as it approaches
        const colorStep = Math.min(11, Math.floor((15 - wi) * 12 / 15));
        const ionR = [255, 255, 255, 255, 255, 255, 255, 219, 183, 147, 111, 75][colorStep];
        const ionG = [171, 142, 113, 85, 57, 28, 0, 0, 0, 0, 0, 0][colorStep];
        ctx.fillStyle = `rgb(${ionR},${ionG},0)`;
        ctx.fillRect(sdx - 1, sdy - 1, 3, 3);
        continue; // skip normal ship rendering while warping in
      }

      if (shipSet) {
        drawSprite(ctx, shipSet, ship.facing, ship.x, ship.y, CANVAS_W, CANVAS_H, camX, camY, r);
      } else {
        placeholderDot(ctx, ship.x, ship.y, camX, camY, 8, color, r);
        // Facing indicator
        const angle = (ship.facing * 4) & 63;
        const sdx = w2d(ship.x - camX);
        const sdy = w2d(ship.y - camY);
        ctx.beginPath();
        ctx.moveTo(sdx, sdy);
        ctx.lineTo(
          sdx + Math.cos((angle / 64) * 2 * Math.PI - Math.PI / 2) * 14,
          sdy + Math.sin((angle / 64) * 2 * Math.PI - Math.PI / 2) * 14,
        );
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // ── Explosions ───────────────────────────────────────────────────────
    {
      const exSp = explosionSpritesRef.current;
      for (const ex of bs.explosions) {
        const set = ex.type === 'boom'
          ? (exSp ? (r >= 2 ? exSp.boom.sml : r === 1 ? exSp.boom.med : exSp.boom.big) : null)
          : (exSp ? (r >= 2 ? exSp.blast.sml : r === 1 ? exSp.blast.med : exSp.blast.big) : null);
        if (set) {
          drawSprite(ctx, set, ex.frame, ex.x, ex.y, CANVAS_W, CANVAS_H, camX, camY, r);
        } else {
          // Fallback: colored expanding circle
          const frac = ex.frame / (ex.type === 'boom' ? 8 : 7);
          const radius = (ex.type === 'boom' ? 12 : 6) * frac;
          const sx = w2d(ex.x - camX);
          const sy = w2d(ex.y - camY);
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(1, radius), 0, Math.PI * 2);
          ctx.fillStyle = ex.type === 'boom'
            ? `rgba(255,${Math.round(160 * (1 - frac))},0,${0.8 * (1 - frac)})`
            : `rgba(255,255,${Math.round(200 * (1 - frac))},${0.9 * (1 - frac)})`;
          ctx.fill();
        }
      }
    }

    // ── HUD overlays ─────────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(100,100,120,0.6)';
    ctx.font = '10px monospace';
    ctx.fillText(`frame ${bs.frame}  zoom ${1 << r}×`, 4, 12);

    if (isLocal2P && bs.frame < 360) {
      const alpha = bs.frame < 240 ? 0.7 : 0.7 * (1 - (bs.frame - 240) / 120);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#4af';
      ctx.font = '10px monospace';
      ctx.fillText('P1: Arrows  RCtrl/Enter=fire  RShift/Kp0=special', 4, CANVAS_H - 18);
      ctx.fillStyle = '#f84';
      ctx.fillText('P2: WASD    V/Space=fire       B=special', 4, CANVAS_H - 6);
      ctx.globalAlpha = 1;
    }
  }

  // ─── HUD ─────────────────────────────────────────────────────────────────

  const myFleet  = (yourSide === 0 ? room.host.fleet : room.opponent?.fleet) ?? [];
  const oppFleet = (yourSide === 0 ? room.opponent?.fleet : room.host.fleet) ?? [];

  // Canvas pixel dims are set via the resize effect. The container div is
  // sized to match so the HUD (absolutely positioned inside it) covers the
  // game area correctly without any CSS transform.
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ position: 'relative', width: displaySize.w, height: displaySize.h }}>
        <canvas ref={canvasRef} style={{ display: 'block' }} />
        <HUD
          left={{
            name:      firstShip(myFleet),
            crew:      Math.round(hudData.myCrewPct    * MAX_CREW),
            maxCrew:   MAX_CREW,
            energy:    Math.round(hudData.myEnergyPct  * MAX_ENERGY),
            maxEnergy: MAX_ENERGY,
          }}
          right={{
            name:      firstShip(oppFleet),
            crew:      Math.round(hudData.oppCrewPct   * MAX_CREW),
            maxCrew:   MAX_CREW,
            energy:    Math.round(hudData.oppEnergyPct * MAX_ENERGY),
            maxEnergy: MAX_ENERGY,
          }}
        />
      </div>
    </div>
  );
}

// ─── Helper functions ─────────────────────────────────────────────────────────

function firstShip(fleet: FleetSlot[]): string {
  return fleet.find(Boolean) ?? 'Unknown';
}

function placeholderDot(
  ctx: CanvasRenderingContext2D,
  worldX: number, worldY: number,
  camX: number, camY: number,
  dotR: number, color: string,
  reduction: number = 0,
) {
  const dx = (worldX - camX) >> (2 + reduction);
  const dy = (worldY - camY) >> (2 + reduction);
  ctx.beginPath();
  ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Pick the smallest zoom-out level (0–MAX_REDUCTION) that keeps both ships
 * on screen. Zoom out immediately; zoom in only after separation drops below
 * threshold by HYSTERESIS_W world units to prevent jitter at the boundary.
 */
function calcReduction(ships: [HumanShipState, HumanShipState], current: number): number {
  // Wrap-aware separation
  let dx = Math.abs(ships[1].x - ships[0].x);
  let dy = Math.abs(ships[1].y - ships[0].y);
  if (dx > WORLD_W >> 1) dx = WORLD_W - dx;
  if (dy > WORLD_H >> 1) dy = WORLD_H - dy;
  const sep = Math.max(dx, dy);

  const HYSTERESIS_W = 192; // ~48 display px — prevents rapid zoom toggling

  // Find the minimum reduction where ships fit within the half-view width.
  // When zooming IN (r < current), require the hysteresis margin so we don't
  // oscillate at the threshold.
  for (let candidate = 0; candidate < MAX_REDUCTION; candidate++) {
    const halfView = CANVAS_W << (1 + candidate); // world units of half-view
    const threshold = candidate < current ? halfView - HYSTERESIS_W : halfView;
    if (sep < threshold) return candidate;
  }
  return MAX_REDUCTION;
}

/**
 * Proper equal-mass elastic collision along the collision axis.
 * Applies impulse only when ships are approaching (dot > 0), so ships
 * that are already separating pass through without re-firing.
 * Both ships have SHIP_MASS, so the impulse is split equally.
 */
function resolveShipCollision(a: HumanShipState, b: HumanShipState): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distSq = dx * dx + dy * dy;
  if (distSq === 0) return;

  // Relative velocity projected onto collision axis (unnormalized)
  const rvx = a.velocity.vx - b.velocity.vx;
  const rvy = a.velocity.vy - b.velocity.vy;
  const dot = rvx * dx + rvy * dy;
  if (dot <= 0) return; // already separating — don't resolve

  // Equal-mass elastic: imp = dot / distSq (implicit unit-normal factor)
  // For unequal masses this would need 2*massB/(massA+massB) weighting,
  // but both Earthling Cruisers have SHIP_MASS=6 so the ratio is 1.
  const imp = dot / distSq;
  a.velocity.vx = Math.trunc(a.velocity.vx - imp * dx);
  a.velocity.vy = Math.trunc(a.velocity.vy - imp * dy);
  b.velocity.vx = Math.trunc(b.velocity.vx + imp * dx);
  b.velocity.vy = Math.trunc(b.velocity.vy + imp * dy);
}

function circleOverlap(
  ax: number, ay: number, ar: number,
  bx: number, by: number, br: number,
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const r  = ar + br;
  return dx * dx + dy * dy < r * r;
}

function worldAngle(fromX: number, fromY: number, toX: number, toY: number): number {
  // Use the deterministic integer sine-table lookup — identical on all platforms.
  // tableAngle(dx, dy): dx>0=East, dy>0=South → UQM angle 0=North, 16=East, 32=South.
  return tableAngle(toX - fromX, toY - fromY);
}

/**
 * Simple AI based on UQM human_intelligence behavior:
 * 1. Turn toward enemy
 * 2. Thrust when roughly facing enemy or when far away
 * 3. Fire nuke when well-aligned
 * 4. Fire point defense when enemy nuke is close
 */
function computeAIInput(ai: HumanShipState, target: HumanShipState, nukes: BattleMissile[], aiSide: 0 | 1): number {
  let input = 0;

  // Angle to target (0–63 UQM system)
  const rawAngle = worldAngle(ai.x, ai.y, target.x, target.y);
  // Convert to facing (0–15)
  const targetFacing = Math.round(rawAngle / 4) & 15;
  const facingDiff = ((targetFacing - ai.facing + 16) % 16);

  // Turn: shortest path. facingDiff > 8 means left is shorter.
  if (facingDiff >= 1 && facingDiff <= 8)  input |= INPUT_RIGHT;
  else if (facingDiff > 8)                  input |= INPUT_LEFT;

  // Thrust when within ±3 facings of the target
  if (facingDiff <= 3 || facingDiff >= 13) input |= INPUT_THRUST;

  // Fire nuke when well-aligned (±1 facing)
  if (facingDiff <= 1 || facingDiff >= 15) input |= INPUT_FIRE1;

  // Point defense: if any enemy nuke is within 80 display pixels
  const aiRangeW = DISPLAY_TO_WORLD(80);
  const hasIncomingNuke = nukes.some(n => {
    if (n.owner === aiSide) return false; // own nuke, not a threat
    const dx = n.x - ai.x; const dy = n.y - ai.y;
    return dx * dx + dy * dy < aiRangeW * aiRangeW;
  });
  if (hasIncomingNuke) input |= INPUT_FIRE2;

  return input;
}

function applyGravity(ship: HumanShipState) {
  const dx = PLANET_X - ship.x;
  const dy = PLANET_Y - ship.y;
  const distSq = dx * dx + dy * dy;
  const threshSq = GRAVITY_THRESHOLD_W * GRAVITY_THRESHOLD_W;
  if (distSq === 0 || distSq > threshSq) return;

  // Gravity = 1 world unit toward planet in facing direction
  const angle = worldAngle(ship.x, ship.y, PLANET_X, PLANET_Y);
  // Apply as delta velocity: ~4 velocity units (= DISPLAY_TO_WORLD(1) = 4 world, WORLD_TO_VELOCITY = *32... but that's strong)
  // UQM gravity is 1 world unit/tick = WORLD_TO_VELOCITY(1) = 32 velocity units
  const grav = 32; // velocity units
  ship.velocity.vx += COSINE(angle, grav);
  ship.velocity.vy += SINE(angle, grav);
}

function applyPointDefense(bs: BattleState, side: number) {
  // Faithful port of UQM spawn_point_defense (human.c).
  //
  // Fires at every collidable, non-cloaked object within LASER_RANGE display px:
  //   • enemy missiles (destroyed on hit)
  //   • enemy ship (1 crew damage on hit)
  //
  // Energy and cooldown use a PaidFor flag — deducted only on the FIRST hit.
  // If nothing is in range: no energy spent, no cooldown set (free to spam).
  // One energy payment per activation covers all targets hit that frame.
  const ship = bs.ships[side];
  const enemyShip = bs.ships[side === 0 ? 1 : 0];
  const rangeWSq = DISPLAY_TO_WORLD(LASER_RANGE) ** 2;
  let paidFor = false;

  function payOnce() {
    if (paidFor) return;
    ship.energy -= SPECIAL_ENERGY_COST;
    ship.specialWait = SPECIAL_WAIT;
    paidFor = true;
  }

  // Enemy missiles
  bs.missiles = bs.missiles.filter(m => {
    if (m.owner === side) return true; // never fire at own missiles
    const dx = m.x - ship.x;
    const dy = m.y - ship.y;
    if (dx * dx + dy * dy <= rangeWSq) {
      payOnce();
      bs.lasers.push({ x1: ship.x, y1: ship.y, x2: m.x, y2: m.y });
      return false; // missile destroyed
    }
    return true;
  });

  // Enemy ship (CollidingElement check in UQM — ships always have COLLISION set)
  {
    const dx = enemyShip.x - ship.x;
    const dy = enemyShip.y - ship.y;
    if (dx * dx + dy * dy <= rangeWSq) {
      payOnce();
      bs.lasers.push({ x1: ship.x, y1: ship.y, x2: enemyShip.x, y2: enemyShip.y });
      enemyShip.crew = Math.max(0, enemyShip.crew - 1); // laser mass_points = 1
    }
  }
}

/**
 * VUX forward laser: fires in the ship's facing direction and hits the first
 * target in range. Line-segment collision with enemy ship uses point-to-line
 * distance check. Deals 1 crew damage.
 */
function applyVuxLaser(bs: BattleState, owner: 0 | 1, ox: number, oy: number, facing: number) {
  const enemySide = owner === 0 ? 1 : 0;
  const enemyShip = bs.ships[enemySide];

  const angle = (facing * 4) & 63;
  const ex = COSINE(angle, VUX_LASER_RANGE);
  const ey = SINE(angle, VUX_LASER_RANGE);

  // Check if enemy ship circle intersects the laser line segment
  const dx = enemyShip.x - ox;
  const dy = enemyShip.y - oy;
  const lenSq = ex * ex + ey * ey;

  if (lenSq === 0) return;

  // Project ship onto line segment, clamp t to [0,1]
  const t = Math.max(0, Math.min(1, (dx * ex + dy * ey) / lenSq));
  const closestX = ox + t * ex;
  const closestY = oy + t * ey;
  const distSq = (enemyShip.x - closestX) ** 2 + (enemyShip.y - closestY) ** 2;
  const shipRadW = DISPLAY_TO_WORLD(SHIP_RADIUS);

  if (distSq <= shipRadW * shipRadW) {
    // Hit
    bs.lasers.push({ x1: ox, y1: oy, x2: ox + ex, y2: oy + ey });
    enemyShip.crew = Math.max(0, enemyShip.crew - 1);
  } else {
    // Miss: still show laser flash (cosmetic)
    bs.lasers.push({ x1: ox, y1: oy, x2: ox + ex, y2: oy + ey });
  }
}

function computeChecksum(bs: BattleState): number {
  let crc = bs.frame;
  for (const ship of bs.ships) {
    crc ^= (ship.x & 0xFFFF) ^ ((ship.y & 0xFFFF) << 8);
    crc ^= (ship.velocity.vx & 0xFF) ^ ((ship.velocity.vy & 0xFF) << 8);
    crc ^= ship.crew ^ (ship.energy << 8);
    crc = crc >>> 0;
  }
  for (const f of bs.fighters) {
    crc ^= (f.x & 0xFFFF) ^ ((f.y & 0xFFFF) << 8);
    crc ^= f.facing ^ (f.life << 4);
    crc = crc >>> 0;
  }
  return crc;
}
