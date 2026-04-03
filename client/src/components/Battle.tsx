// Battle screen — canvas game loop with UQM physics and sprite rendering.
// Ships dispatch through SHIP_REGISTRY (engine/ships/registry.ts) — no
// per-ship if-chains here.  To add a new ship, implement its controller
// and register it; Battle.tsx needs no changes.

import { useEffect, useRef, useState, useCallback } from 'react';
import type { FullRoomState } from 'shared/types';
import { client } from '../net/client';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2, BATTLE_FPS } from '../engine/game';
import {
  getControls, setControls, buildKeyMap, codeDisplay,
  type BindingField, BINDING_FIELDS, FIELD_LABELS,
  type ControlsConfig,
} from '../lib/controls';
import { COSINE, SINE, tableAngle } from '../engine/sinetab';
import { DISPLAY_TO_WORLD, setVelocityVector, setVelocityComponents, VELOCITY_TO_WORLD, type VelocityDesc } from '../engine/velocity';
import type { ShipState, SpawnRequest, BattleMissile, LaserFlash, DrawContext } from '../engine/ships/types';
import { SHIP_REGISTRY } from '../engine/ships/registry';
// Per-ship constants still needed for world-physics helpers that live here
import { SHIP_RADIUS, trackFacing } from '../engine/ships/human';
import { loadExplosionSprites, drawSprite, placeholderDot, type ExplosionSprites } from '../engine/sprites';
import { RNG } from '../engine/rng';
import type { ShipId } from 'shared/types';
import StatusPanel, { type SideStatus } from './StatusPanel';
import { preloadBattleSounds, playShipDies, playBlast, playPrimary, playSecondary, playFighterLaser, playFighterLaunch, playFighterDock, playVuxLimpetBite, getAudioConfig, setAudioConfig, type AudioConfig } from '../engine/audio';

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

// Planet sprite hotspots from {type}-{big|med|sml}.ani
// Format: <file> 0 -1 <hotX> <hotY>  (hotspot = sprite center)
// All regular planet types share these values; shattered is 1px off (negligible).
const PLANET_HOT: Record<'big' | 'med' | 'sml', [number, number]> = {
  big: [37, 33],
  med: [19, 17],
  sml: [9, 8],
};


// Key maps are built inside the component at mount time from the live controls
// singleton so they reflect any rebinds made in a previous battle this session.
// (Module-level constants would be stale after an in-session setControls() call.)

// ─── Types ────────────────────────────────────────────────────────────────────

// BattleMissile and LaserFlash are defined in engine/ships/types.ts and
// imported above — no local redefinition needed.

// Cosmetic explosion animation (not included in checksum; purely visual)
interface BattleExplosion {
  type: 'boom' | 'blast' | 'splinter';
  x: number;
  y: number;
  frame: number; // current frame index; advances each sim tick
  // splinter only: velocity from the buzzsaw at impact (continues moving)
  vx?: number;
  vy?: number;
  ex?: number; // Bresenham sub-pixel accumulator
  ey?: number;
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
  // Fighters belonging to the winner that should survive into the next fight.
  // Only set when the winner has live fighters (Ur-Quan Dreadnought).
  persistedMissiles?: BattleMissile[];
}

interface BattleState {
  ships:     [ShipState, ShipState];
  shipTypes: [ShipId, ShipId];
  missiles:  BattleMissile[];
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
  planetType:  string;
  inputDelay:  number;
  isAI?:       boolean;
  isLocal2P?:  boolean;
  winnerState?: WinnerShipState | null;
  // Active fleet slot for each side (offline modes). null = use first non-null fallback.
  activeSlot0?: number | null;
  activeSlot1?: number | null;
  onBattleEnd: (winner: 0 | 1 | null, winnerState?: WinnerShipState) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Battle({ room, yourSide, seed: _seed, planetType, inputDelay, isAI = false, isLocal2P = false, winnerState = null, activeSlot0 = null, activeSlot1 = null, onBattleEnd }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const stateRef     = useRef<BattleState | null>(null);
  const keysRef      = useRef(new Set<string>());
  const rafRef       = useRef<number | null>(null);
  const lastTimeRef  = useRef(0);
  const accumRef     = useRef(0);
  const [isPaused, setIsPaused]        = useState(false);
  const pausedRef    = useRef(false); // mirror of isPaused readable in tick closure
  const [pauseAudio, setPauseAudio]    = useState<AudioConfig>(getAudioConfig);
  const [pauseTab, setPauseTab]        = useState<'audio' | 'controls'>('audio');
  const [pauseControls, setPauseControls] = useState<ControlsConfig>(getControls);
  const [pauseRebinding, setPauseRebinding] =
    useState<{ player: 1 | 2; field: BindingField } | null>(null);

  // Live key-map refs — initialized from getControls() at mount (not from the
  // module-level constants, which are fixed at page load and go stale if the
  // player rebinds during a previous battle in the same session).
  // Updated when the player rebinds in the pause menu so changes take effect
  // immediately on resume without a page reload.
  const _initControls = getControls(); // reads live _cfg singleton
  const keyMapP1Ref   = useRef(buildKeyMap(_initControls.p1.bindings, INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2));
  const keyMapP2Ref   = useRef(buildKeyMap(_initControls.p2.bindings, INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2));
  const gamepadP1Ref  = useRef(_initControls.p1.bindings.gamepadIndex);
  const gamepadP2Ref  = useRef(_initControls.p2.bindings.gamepadIndex);
  const gameKeysRef   = useRef(new Set([...Object.keys(keyMapP1Ref.current), ...Object.keys(keyMapP2Ref.current)]));
  // Per-ship sprites keyed by ShipId.  Each controller's loadSprites() returns
  // its own opaque sprite bundle; drawShip/drawMissile cast internally.
  const shipSpritesRef      = useRef<Map<string, unknown>>(new Map());
  const explosionSpritesRef = useRef<ExplosionSprites | null>(null);
  const reductionRef = useRef(0); // current zoom level 0–MAX_REDUCTION
  // Stars: flat array [big×30, med×60, sml×90] of {x,y} world-unit positions
  const starsRef = useRef<{ x: number; y: number }[]>([]);
  const rngRef   = useRef<RNG | null>(null);

  // ─── Desync diagnostics ──────────────────────────────────────────────────
  // Ring buffer: last 64 frames of full game state + inputs used.
  // Populated every frame; read when checksum_mismatch arrives from server.
  // Number of consecutive checksum mismatches seen — used to decide when to give up.
  const checksumMismatchCountRef = useRef(0);
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
      warpIn: [...bs.warpIn] as [number, number],
    };
  }

  // Planet sprite images (type determined by parent, stable across ship fights); null until loaded
  const planetImgRef = useRef<{ big: HTMLImageElement; med: HTMLImageElement; sml: HTMLImageElement } | null>(null);
  // Live status panel data — updated each sim frame via ref to avoid React re-render cost.
  // StatusPanel reads directly from this ref in its own rAF loop.
  const statusRef = useRef<[SideStatus | null, SideStatus | null]>([null, null]);
  // uiScale: ratio of physical display pixels to logical 640×480 game pixels.
  // Stored in a ref so the render loop always sees the current value without
  // needing to re-bind the tick/render closures on every resize.
  const uiScaleRef  = useRef(1);
  const [displaySize, setDisplaySize] = useState({ w: CANVAS_W, h: CANVAS_H });

  // Debug helper — call window.__battleDebug() from the browser console
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__battleDebug = () => {
      const bs = stateRef.current;
      if (!bs) { console.log('No battle state'); return; }
      const r = reductionRef.current;
      let ax = bs.ships[0].x, bx = bs.ships[1].x;
      let ay = bs.ships[0].y, by = bs.ships[1].y;
      if (Math.abs(bx - ax) > WORLD_W >> 1) bx -= Math.sign(bx - ax) * WORLD_W;
      if (Math.abs(by - ay) > WORLD_H >> 1) by -= Math.sign(by - ay) * WORLD_H;
      const midX = ((((ax + bx) >> 1) % WORLD_W) + WORLD_W) % WORLD_W;
      const midY = ((((ay + by) >> 1) % WORLD_H) + WORLD_H) % WORLD_H;
      const camX = midX - (CANVAS_W << (1 + r));
      const camY = midY - (CANVAS_H << (1 + r));
      // tw2dx/tw2dy must exactly mirror the renderer's logic (including wdw fix)
      const wdw = WORLD_W >> (2 + r);
      const wdh = WORLD_H >> (2 + r);
      const tw2dx = (wx: number) => {
        let x = wx - camX; x = ((x % WORLD_W) + WORLD_W) % WORLD_W; if (x > WORLD_W >> 1) x -= WORLD_W;
        let d = x >> (2 + r);
        if (d < 0 && d + wdw <= CANVAS_W) d += wdw; else if (d > CANVAS_W && d - wdw >= 0) d -= wdw;
        return d;
      };
      const tw2dy = (wy: number) => {
        let y = wy - camY; y = ((y % WORLD_H) + WORLD_H) % WORLD_H; if (y > WORLD_H >> 1) y -= WORLD_H;
        let d = y >> (2 + r);
        if (d < 0 && d + wdh <= CANVAS_H) d += wdh; else if (d > CANVAS_H && d - wdh >= 0) d -= wdh;
        return d;
      };
      console.log(`=== BATTLE DEBUG  frame=${bs.frame}  zoom=r${r} (${1 << r}×)  wdw=${wdw} wdh=${wdh} ===`);
      console.log(`camera: midX=${midX} midY=${midY}  camX=${camX} camY=${camY}`);
      for (let i = 0; i < 2; i++) {
        const s = bs.ships[i];
        const rawX = s.x - camX, rawY = s.y - camY;
        const dx = tw2dx(s.x), dy = tw2dy(s.y);
        console.log(`ship${i} (${bs.shipTypes[i]}): world=(${s.x},${s.y})  rawOffset=(${rawX},${rawY})  display=(${dx},${dy})  onScreen=${dx>=0&&dx<=640&&dy>=0&&dy<=480}  vx=${s.velocity.vx} vy=${s.velocity.vy}  crew=${s.crew}  warpIn=${bs.warpIn[i]}`);
      }
      const wdx = Math.min(Math.abs(bs.ships[1].x - bs.ships[0].x), WORLD_W - Math.abs(bs.ships[1].x - bs.ships[0].x));
      const wdy = Math.min(Math.abs(bs.ships[1].y - bs.ships[0].y), WORLD_H - Math.abs(bs.ships[1].y - bs.ships[0].y));
      console.log(`separation (toroidal): dx=${wdx} dy=${wdy}`);
      console.log(`missiles=${bs.missiles.length}  explosions=${bs.explosions.length}  ionTrail0=${bs.ionTrails[0].length}  ionTrail1=${bs.ionTrails[1].length}`);
    };
    return () => { delete (window as unknown as Record<string, unknown>).__battleDebug; };
  }, []);

  // Initialize battle state
  useEffect(() => {
    // Determine each player's active ship type from their fleet.
    // fleet0 = host (ship 0), fleet1 = opponent (ship 1) — always absolute,
    // never relative to yourSide. Both clients must compute the same types
    // for the lockstep simulation to remain in sync.
    const fleet0 = room.host.fleet;
    const fleet1 = room.opponent?.fleet ?? [];
    const type0 = ((activeSlot0 != null ? fleet0[activeSlot0] : null) ?? fleet0.find(Boolean) ?? 'human') as ShipId;
    const type1 = ((activeSlot1 != null ? fleet1[activeSlot1] : null) ?? fleet1.find(Boolean) ?? 'human') as ShipId;

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

    const makeShip = (type: ShipId, x: number, y: number) =>
      SHIP_REGISTRY[type].make(x, y, () => rng.rand(1000) / 1000);

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

    // Restore fighters carried over from the previous fight (Urquan winner scenario).
    const initMissiles: BattleMissile[] = winnerState?.persistedMissiles
      ? winnerState.persistedMissiles.map(m => ({ ...m }))
      : [];

    stateRef.current = {
      ships: [s0, s1],
      shipTypes: [type0, type1],
      missiles: initMissiles,
      lasers: [],
      explosions: [],
      ionTrails: [[], []],
      warpIn: [warpIn0, warpIn1],
      shipAlive: [true, true],
      frame: 0,
      inputBuf,
      pendingEnd: null,
    };

    // Seed the status panel so it can preload assets before the first sim tick.
    statusRef.current = [
      { shipId: type0, crew: s0.crew, maxCrew: SHIP_REGISTRY[type0].maxCrew, energy: s0.energy, maxEnergy: SHIP_REGISTRY[type0].maxEnergy, limpetCount: 0, inputs: 0, captainIdx: type0.charCodeAt(0) },
      { shipId: type1, crew: s1.crew, maxCrew: SHIP_REGISTRY[type1].maxCrew, energy: s1.energy, maxEnergy: SHIP_REGISTRY[type1].maxEnergy, limpetCount: 0, inputs: 0, captainIdx: type1.charCodeAt(0) },
    ];

    // Preload sounds (non-blocking; silently ignored if files are missing)
    preloadBattleSounds([type0, type1]);

    // Load sprites via each ship's own controller (non-blocking; falls back to
    // placeholder if files are missing).  Only load what the active ships need.
    const loadedTypes = new Set<string>();
    for (const t of [type0, type1]) {
      if (!loadedTypes.has(t)) {
        loadedTypes.add(t);
        SHIP_REGISTRY[t].loadSprites()
          .then(sp => { shipSpritesRef.current.set(t, sp); })
          .catch(() => {});
      }
    }
    loadExplosionSprites().then(sp => { explosionSpritesRef.current = sp; }).catch(() => {});

    // Load planet sprites (non-blocking)
    // onload must be assigned before src to handle cached images correctly.
    {
      const pt = planetType;
      const big = new Image();
      const med = new Image();
      const sml = new Image();
      let n = 0;
      const done = () => { if (++n === 3) planetImgRef.current = { big, med, sml }; };
      big.onload = med.onload = sml.onload = done;
      big.src = `/planets/${pt}-big-000.png`;
      med.src = `/planets/${pt}-med-000.png`;
      sml.src = `/planets/${pt}-sml-000.png`;
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
        checksumMismatchCountRef.current++;
        const mismatchN = checksumMismatchCountRef.current;
        console.group(
          `%c[DESYNC #${mismatchN}] Checksum mismatch — diverged at frame ${mf}, currently at frame ${cur}`,
          'color:orange;font-weight:bold;font-size:14px'
        );
        console.log('yourSide:', yourSide, '— game continues (states may drift)');
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
          console.log('warpIn:', snap.warpIn, ' inputs(i0,i1):', snap.i0, snap.i1);
        } else {
          console.warn('Mismatch frame not in ring buffer — RTT too high?');
          console.log('Oldest buffered frame:', allSnaps[0]?.frame);
        }
        console.groupEnd();
        // Don't crash — continue playing. The lockstep still guarantees both
        // clients run identical inputs each frame, so crew/energy should still
        // agree in most cases even if positions have drifted slightly.
        // The battle ends normally when a ship dies; both clients report the
        // winner via battle_over_ack at that point.
      }
    });

    // Keyboard — track by event.code so bindings are layout-independent
    // and we can distinguish Left/RightCtrl, Left/RightShift, etc.
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        const next = !pausedRef.current;
        pausedRef.current = next;
        setIsPaused(next);
        if (!next) {
          // Reset accumulator when resuming so we don't try to catch up a huge dt
          lastTimeRef.current = performance.now();
          accumRef.current = 0;
        }
        return;
      }
      if (gameKeysRef.current.has(e.code)) e.preventDefault();
      if (!pausedRef.current) keysRef.current.add(e.code);
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

  function computeInput(keyMap: Record<string, number>, gamepadIndex = -1): number {
    let bits = 0;
    // Keyboard
    for (const code of keysRef.current) bits |= keyMap[code] ?? 0;
    // Gamepad (polled each frame via Gamepad API)
    if (gamepadIndex >= 0) {
      const gp = navigator.getGamepads()[gamepadIndex];
      if (gp) {
        if (gp.axes[1] < -0.4) bits |= INPUT_THRUST;        // stick up
        if (gp.axes[0] < -0.4) bits |= INPUT_LEFT;          // stick left
        if (gp.axes[0] >  0.4) bits |= INPUT_RIGHT;         // stick right
        // D-pad via standard hat axes (axes[6]/axes[7]) or buttons[12-15]
        if ((gp.axes[7] ?? 0) < -0.5 || gp.buttons[12]?.pressed) bits |= INPUT_THRUST;
        if ((gp.axes[6] ?? 0) < -0.5 || gp.buttons[14]?.pressed) bits |= INPUT_LEFT;
        if ((gp.axes[6] ?? 0) >  0.5 || gp.buttons[15]?.pressed) bits |= INPUT_RIGHT;
        if (gp.buttons[0]?.pressed) bits |= INPUT_FIRE1;    // A / ✕
        if (gp.buttons[1]?.pressed) bits |= INPUT_FIRE2;    // B / ○
      }
    }
    return bits;
  }

  function tick(now: number) {
    rafRef.current = requestAnimationFrame(tick);
    const dt = now - lastTimeRef.current;
    lastTimeRef.current = now;

    if (!pausedRef.current) {
      accumRef.current += dt;
      while (accumRef.current >= FRAME_MS) {
        accumRef.current -= FRAME_MS;
        advance();
      }
    }

    render();
  }

  function advance() {
    const bs = stateRef.current;
    if (!bs) return;

    const mySide = yourSide;
    const opSide: 0 | 1 = yourSide === 0 ? 1 : 0;
    // Online: always use P1 bindings regardless of which side you're on
    const myInput = computeInput(keyMapP1Ref.current, gamepadP1Ref.current);

    let i0: number;
    let i1: number;

    if (isLocal2P) {
      // Both players on same device — P1 bindings for side 0, P2 for side 1
      i0 = computeInput(keyMapP1Ref.current, gamepadP1Ref.current);
      i1 = computeInput(keyMapP2Ref.current, gamepadP2Ref.current);
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

    // Give each ship's controller a chance to cancel/handle death (e.g. Pkunk resurrection).
    for (let side = 0; side < 2; side++) {
      const ship = bs.ships[side];
      if (ship.crew <= 0) {
        const ctrl = SHIP_REGISTRY[bs.shipTypes[side]];
        if (ctrl.onDeath) {
          const rng = rngRef.current!;
          ctrl.onDeath(ship, (n) => rng.rand(n));
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
        client.send({ type: 'battle_over_ack', winner });
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
          // Carry over live fighters belonging to the winner (Ur-Quan Dreadnought).
          // Fighters die with their mothership, so only persist when the winner has them.
          const winnerFighters = bs.missiles.filter(
            m => m.weaponType === 'fighter' && m.owner === w,
          );
          if (winnerFighters.length > 0) {
            ws.persistedMissiles = winnerFighters.map(m => ({ ...m }));
          }
        }
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        onBattleEnd(w, ws);
        return;
      }
    }

    // Update status panel (top = side 0 / bad-guy, bottom = side 1 / good-guy)
    statusRef.current = [
      {
        shipId:     bs.shipTypes[0],
        crew:       bs.ships[0].crew,
        maxCrew:    SHIP_REGISTRY[bs.shipTypes[0]].maxCrew,
        energy:     bs.ships[0].energy,
        maxEnergy:  SHIP_REGISTRY[bs.shipTypes[0]].maxEnergy,
        limpetCount: bs.ships[0].limpetCount ?? 0,
        inputs:     i0,
        captainIdx: bs.shipTypes[0].charCodeAt(0),
      },
      {
        shipId:     bs.shipTypes[1],
        crew:       bs.ships[1].crew,
        maxCrew:    SHIP_REGISTRY[bs.shipTypes[1]].maxCrew,
        energy:     bs.ships[1].energy,
        maxEnergy:  SHIP_REGISTRY[bs.shipTypes[1]].maxEnergy,
        limpetCount: bs.ships[1].limpetCount ?? 0,
        inputs:     i1,
        captainIdx: bs.shipTypes[1].charCodeAt(0),
      },
    ];
  }

  function simulateFrame(bs: BattleState, input0: number, input1: number) {
    bs.lasers = []; // clear previous frame's laser flashes

    // Apply gravity to both ships
    applyGravity(bs.ships[0]);
    applyGravity(bs.ships[1]);

    // Decrement warp-in countdown (ship is invisible and nonsolid during this)
    if (bs.warpIn[0] > 0) bs.warpIn[0]--;
    if (bs.warpIn[1] > 0) bs.warpIn[1]--;

    // Update ships — dispatch through registry.
    // Ships still warping in cannot act (no weapons, no steering).
    const updateShip = (ship: ShipState, input: number, type: ShipId, warping: boolean): SpawnRequest[] => {
      if (warping) return [];
      return SHIP_REGISTRY[type].update(ship, input);
    };
    const preShip0 = { facing: bs.ships[0].facing, vx: bs.ships[0].velocity.vx, vy: bs.ships[0].velocity.vy };
    const preShip1 = { facing: bs.ships[1].facing, vx: bs.ships[1].velocity.vx, vy: bs.ships[1].velocity.vy };
    const spawns0 = updateShip(bs.ships[0], input0, bs.shipTypes[0], bs.warpIn[0] > 0);
    const spawns1 = updateShip(bs.ships[1], input1, bs.shipTypes[1], bs.warpIn[1] > 0);
    applyAttachedLimpetPenalty(bs.ships[0], preShip0);
    applyAttachedLimpetPenalty(bs.ships[1], preShip1);

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
          limpet: s.limpet,
        });
      } else if (s.type === 'buzzsaw') {
        // FIFO cap: controller specifies the limit via weaponCap.
        if (s.weaponCap !== undefined) {
          const ownerSaws = bs.missiles.filter(m => m.weaponType === 'buzzsaw' && m.owner === owner);
          if (ownerSaws.length >= s.weaponCap) {
            const oldest = ownerSaws[0];
            const idx = bs.missiles.indexOf(oldest);
            if (idx !== -1) bs.missiles.splice(idx, 1);
          }
        }
        const v: VelocityDesc = { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 };
        setVelocityVector(v, s.speed, s.facing);
        bs.missiles.push({
          x: s.x, y: s.y, facing: s.facing, velocity: v,
          life: s.life, speed: s.speed, maxSpeed: s.speed,
          accel: 0, damage: s.damage,
          tracks: false,   // buzzsaws NEVER home — they freeze in place on release
          trackWait: 0, trackRate: 0,
          owner,
          weaponType: 'buzzsaw',
          fireHeld: s.fireHeld,
          decelWait: 0,
        });
      } else if (s.type === 'gas_cloud') {
        const v: VelocityDesc = { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 };
        setVelocityVector(v, s.speed, s.facing);
        // Add ship velocity to gas cloud (DeltaVelocityComponents from UQM)
        v.vx += s.shipVelocity.vx;
        v.vy += s.shipVelocity.vy;
        bs.missiles.push({
          x: s.x, y: s.y, facing: s.facing, velocity: v,
          life: 64, speed: s.speed, maxSpeed: s.speed,
          accel: 0, damage: s.damage,
          tracks: false, trackWait: 0, trackRate: 0,
          owner,
          weaponType: 'gas_cloud',
        });
      } else if (s.type === 'fighter') {
        // Fighters live in bs.missiles; all AI runs in urquanController.processMissile.
        const v: VelocityDesc = { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 };
        setVelocityVector(v, s.speed, s.facing);
        bs.missiles.push({
          x: s.x, y: s.y, facing: s.facing, velocity: v,
          life: s.life, speed: s.speed, maxSpeed: s.speed,
          accel: 0, damage: 0,
          tracks: false, trackWait: 0, trackRate: 0,
          owner,
          weaponType: 'fighter',
          weaponWait: 0,
        });
      }
    };
    const addLaser = (l: LaserFlash) => bs.lasers.push(l);
    let launchSoundPlayed0 = false;
    let gasSoundPlayed0 = false;
    for (const s of spawns0) {
      spawnRequest(s, 0);
      // Immediate weapon effects owned by each ship's controller
      SHIP_REGISTRY[bs.shipTypes[0]].applySpawn?.(s, bs.ships[0], bs.ships[1], 0, bs.missiles, addLaser);
      // Sound dispatch (keyed on spawn type, independent of ship identity)
      if (s.type === 'point_defense')  playSecondary(bs.shipTypes[0]);
      else if (s.type === 'missile')   s.limpet ? playSecondary(bs.shipTypes[0]) : playPrimary(bs.shipTypes[0]);
      else if (s.type === 'buzzsaw')   playPrimary(bs.shipTypes[0]);
      else if (s.type === 'gas_cloud' && !gasSoundPlayed0) { playSecondary(bs.shipTypes[0]); gasSoundPlayed0 = true; }
      else if (s.type === 'vux_laser') playPrimary(bs.shipTypes[0]);
      else if (s.type === 'fighter' && !launchSoundPlayed0) { playFighterLaunch(); launchSoundPlayed0 = true; }
    }
    let launchSoundPlayed1 = false;
    let gasSoundPlayed1 = false;
    for (const s of spawns1) {
      spawnRequest(s, 1);
      SHIP_REGISTRY[bs.shipTypes[1]].applySpawn?.(s, bs.ships[1], bs.ships[0], 1, bs.missiles, addLaser);
      if (s.type === 'point_defense')  playSecondary(bs.shipTypes[1]);
      else if (s.type === 'missile')   s.limpet ? playSecondary(bs.shipTypes[1]) : playPrimary(bs.shipTypes[1]);
      else if (s.type === 'buzzsaw')   playPrimary(bs.shipTypes[1]);
      else if (s.type === 'gas_cloud' && !gasSoundPlayed1) { playSecondary(bs.shipTypes[1]); gasSoundPlayed1 = true; }
      else if (s.type === 'vux_laser') playPrimary(bs.shipTypes[1]);
      else if (s.type === 'fighter' && !launchSoundPlayed1) { playFighterLaunch(); launchSoundPlayed1 = true; }
    }

    // Update missiles
    const aliveMissiles: BattleMissile[] = [];
    for (const m of bs.missiles) {
      m.life--;
      if (m.life <= 0) continue;

      const ownerCtrl  = SHIP_REGISTRY[bs.shipTypes[m.owner]];
      const ownShip    = bs.ships[m.owner];
      const enemyShip  = bs.ships[m.owner === 0 ? 1 : 0];
      const ownerInput = m.owner === 0 ? input0 : input1;

      // Per-missile lifecycle hook: controllers handle all weapon-specific behaviour
      // (buzzsaw spin, gas cloud velocity, fighter AI, etc.)
      const effect = ownerCtrl.processMissile?.(m, ownShip, enemyShip, ownerInput) ?? {};

      // Apply effects from the controller (sounds and heals run even on destroy)
      if (effect.damageEnemy) enemyShip.crew = Math.max(0, enemyShip.crew - effect.damageEnemy);
      if (effect.healOwn)     ownShip.crew   = Math.min(ownShip.crew + effect.healOwn, ownerCtrl.maxCrew);
      if (effect.lasers)      bs.lasers.push(...effect.lasers);
      if (effect.sounds)      for (const snd of effect.sounds) {
        if (snd === 'fighter_laser') playFighterLaser();
        else if (snd === 'fighter_dock') playFighterDock();
      }

      if (effect.destroy) continue; // e.g. fighter docked with mothership

      // Generic tracking (skip if controller already handled it)
      if (!effect.skipDefaultTracking && m.tracks) {
        const targetAngle = worldAngle(m.x, m.y, enemyShip.x, enemyShip.y);
        if (m.trackWait > 0) {
          m.trackWait--;
        } else {
          m.facing = trackFacing(m.facing, targetAngle);
          m.trackWait = m.trackRate;
        }
      }

      // Generic velocity update (skip if controller manages velocity directly)
      if (!effect.skipVelocityUpdate) {
        m.speed = Math.min(m.speed + m.accel, m.maxSpeed);
        setVelocityVector(m.velocity, m.speed, m.facing);
      }

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

      // Planet collision — all weapons hit the planet unless controller explicitly opts out.
      // Fighters have their own bounce logic below and are excluded here.
      if (!hit && ownerCtrl.collidesWithPlanet !== false && m.weaponType !== 'fighter') {
        const pdx = m.x - PLANET_X;
        const pdy = m.y - PLANET_Y;
        if (pdx * pdx + pdy * pdy < (PLANET_RADIUS_W + 4) ** 2) {
          const hitFx = ownerCtrl.onMissileHit?.(m, null) ?? {};
          if (!hitFx.skipBlast) bs.explosions.push({ type: 'blast', x: m.x, y: m.y, frame: 0 });
          if (hitFx.splinter)   bs.explosions.push({ type: 'splinter', x: m.x, y: m.y, frame: 2,
            vx: hitFx.splinter.vx, vy: hitFx.splinter.vy, ex: 0, ey: 0 });
          playBlast(m.damage);
          hit = true;
        }
      }

      // Fighter-planet bounce: push fighter outside planet radius (from urquan.c fighter_collision).
      // Fighters don't explode on planet contact — they bounce off and resume navigation.
      if (!hit && m.weaponType === 'fighter') {
        const fpdx = m.x - PLANET_X;
        const fpdy = m.y - PLANET_Y;
        const fDistSq = fpdx * fpdx + fpdy * fpdy;
        const fCollideR = PLANET_RADIUS_W + DISPLAY_TO_WORLD(4);
        if (fDistSq < fCollideR * fCollideR && fDistSq > 0) {
          // Reflect velocity around the outward planet normal, then push outside.
          const fDist = Math.sqrt(fDistSq);
          const nx = fpdx / fDist;
          const ny = fpdy / fDist;
          const dot = m.velocity.vx * nx + m.velocity.vy * ny;
          m.velocity.vx -= 2 * dot * nx;
          m.velocity.vy -= 2 * dot * ny;
          m.x = PLANET_X + nx * (fCollideR + 1);
          m.y = PLANET_Y + ny * (fCollideR + 1);
        }
      }

      // Fighters don't have a damage value and collide with neither planet nor enemy ship
      // in the traditional sense (they dock, not explode). Skip ship collision for them.
      if (!hit && m.weaponType !== 'fighter' &&
          bs.warpIn[targetSide] === 0 &&
          circleOverlap(m.x, m.y, 4, targetShip.x, targetShip.y, DISPLAY_TO_WORLD(SHIP_RADIUS))) {
        targetShip.crew = Math.max(0, targetShip.crew - m.damage);
        const hitFx = ownerCtrl.onMissileHit?.(m, targetShip) ?? {};
        if (!hitFx.skipBlast) bs.explosions.push({ type: 'blast', x: m.x, y: m.y, frame: 0 });
        if (hitFx.splinter)   bs.explosions.push({ type: 'splinter', x: m.x, y: m.y, frame: 2,
          vx: hitFx.splinter.vx, vy: hitFx.splinter.vy, ex: 0, ey: 0 });
        if (hitFx.impairTarget) {
          targetShip.turnWait   = Math.min(15, targetShip.turnWait   + hitFx.impairTarget);
          targetShip.thrustWait = Math.min(15, targetShip.thrustWait + hitFx.impairTarget);
        }
        if (hitFx.attachLimpet) {
          targetShip.limpetCount = Math.min(6, (targetShip.limpetCount ?? 0) + hitFx.attachLimpet);
          playVuxLimpetBite();
        }
        if (!hitFx.skipBlast) playBlast(Math.max(1, m.damage));
        hit = true;
      }
      if (!hit) aliveMissiles.push(m);
    }
    bs.missiles = aliveMissiles;

    // Advance cosmetic explosions (advance 1 frame per sim tick, remove when done)
    bs.explosions = bs.explosions.filter(e => {
      if (e.type === 'splinter') {
        // splinter_preprocess: keep moving at buzzsaw velocity, no deceleration
        const vx = e.vx ?? 0, vy = e.vy ?? 0;
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
        e.x = ((e.x % WORLD_W) + WORLD_W) % WORLD_W;
        e.y = ((e.y % WORLD_H) + WORLD_H) % WORLD_H;
      }
      e.frame++;
      // splinter: frames 2–6 = 5 frames (UQM life_span=5 after collision)
      return e.type === 'splinter' ? e.frame < 7 : e.type === 'boom' ? e.frame < 9 : e.frame < 8;
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
        // Push ships apart so they don't re-trigger next frame.
        // Use integer arithmetic (tableAngle + COSINE/SINE) to avoid any
        // floating-point precision differences between JS engines.
        const distInt = Math.round(Math.sqrt(distSq));
        const overlap = minDist - distInt;
        if (overlap > 0) {
          const push = Math.ceil(overlap / 2);
          const sepAngle = tableAngle(dx, dy); // direction ship0 → ship1
          const ox = COSINE(sepAngle, push);
          const oy = SINE(sepAngle, push);
          bs.ships[0].x -= ox;
          bs.ships[0].y -= oy;
          bs.ships[1].x += ox;
          bs.ships[1].y += oy;
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

        // Push ship outside collision radius — integer arithmetic only.
        // `angle` already points away from planet; COSINE/SINE give the
        // separation vector without any floating-point division.
        const distInt = Math.round(Math.sqrt(distSq));
        const pushAmt = minDist - distInt;
        if (pushAmt > 0) {
          ship.x += COSINE(angle, pushAmt);
          ship.y += SINE(angle, pushAmt);
        }

        // Damage: 25% current HP, min 1 (mirrors UQM ship.c hit_points >> 2)
        const damage = Math.max(1, ship.crew >> 2);
        ship.crew = Math.max(0, ship.crew - damage);

        // Sound: TARGET_DAMAGED_FOR_1_PT + (damage >> 1), capped at TARGET_DAMAGED_FOR_6_PLUS_PT
        // Maps to boom1 / boom23 / boom45 / boom67 via playBlast frame thresholds.
        // UQM indices: 2=1pt, 3=2-3pt, 4=4-5pt, 5=6+pt → frame 1 / 3 / 5 / 7
        const soundFrame = damage <= 1 ? 1 : damage <= 3 ? 3 : damage <= 5 ? 5 : 7;
        playBlast(soundFrame);
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

    // tw2dx / tw2dy: like w2d but wrap-aware — use these whenever converting a
    // world coordinate that might be near a world edge (ships, trails, lasers).
    // Short-path normalization puts the object on the nearest side; if that lands
    // off-screen but the far side is on-screen (happens at max zoom r=3 where the
    // entire world fits the canvas), use the far side instead.
    const wdw = WORLD_W >> (2 + r); // world width in display pixels at this zoom
    const wdh = WORLD_H >> (2 + r);
    const tw2dx = (worldX: number) => {
      let x = worldX - camX;
      x = ((x % WORLD_W) + WORLD_W) % WORLD_W;
      if (x > WORLD_W >> 1) x -= WORLD_W;
      let d = x >> (2 + r);
      if (d < 0 && d + wdw <= CANVAS_W) d += wdw;
      else if (d > CANVAS_W && d - wdw >= 0) d -= wdw;
      return d;
    };
    const tw2dy = (worldY: number) => {
      let y = worldY - camY;
      y = ((y % WORLD_H) + WORLD_H) % WORLD_H;
      if (y > WORLD_H >> 1) y -= WORLD_H;
      let d = y >> (2 + r);
      if (d < 0 && d + wdh <= CANVAS_H) d += wdh;
      else if (d > CANVAS_H && d - wdh >= 0) d -= wdh;
      return d;
    };

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
    // Random planet sprite: big at r=0, med at r=1, sml at r≥2.
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
      const dc: DrawContext = { ctx, camX, camY, canvasW: CANVAS_W, canvasH: CANVAS_H, reduction: r, worldW: WORLD_W, worldH: WORLD_H };
      // Each missile is drawn by the owner ship's controller.
      // The controller receives the opaque sprite bundle it loaded earlier.
      for (const m of bs.missiles) {
        const ownerCtrl    = SHIP_REGISTRY[bs.shipTypes[m.owner]];
        const ownerSprites = shipSpritesRef.current.get(bs.shipTypes[m.owner]) ?? null;
        if (ownerCtrl.drawMissile) {
          ownerCtrl.drawMissile(dc, m, ownerSprites);
        } else {
          placeholderDot(ctx, m.x, m.y, camX, camY, 3, '#ff8', r);
        }
      }
    }

    // ── Point-defense laser flashes (1 frame, white lines) ───────────────
    if (bs.lasers.length > 0) {
      ctx.save();
      ctx.lineWidth = 1;
      for (const lz of bs.lasers) {
        ctx.beginPath();
        ctx.strokeStyle = lz.color ?? '#fff';
        ctx.moveTo(tw2dx(lz.x1), tw2dy(lz.y1));
        ctx.lineTo(tw2dx(lz.x2), tw2dy(lz.y2));
        ctx.stroke();
      }
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
          const dotDX = tw2dx(dot.x);
          const dotDY = tw2dy(dot.y);
          if (dotDX < -1 || dotDX > CANVAS_W + 1 || dotDY < -1 || dotDY > CANVAS_H + 1) continue;
          ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
          ctx.fillRect(dotDX, dotDY, 1, 1);
        }
      }
    }

    // ── Ships ────────────────────────────────────────────────────────────
    {
      const dc: DrawContext = { ctx, camX, camY, canvasW: CANVAS_W, canvasH: CANVAS_H, reduction: r, worldW: WORLD_W, worldH: WORLD_H };
      for (let side = 0; side < 2; side++) {
        const ship = bs.ships[side];

        // Warp-in: ship is invisible during countdown (HYPERJUMP_LIFE=15 frames).
        // Render orange→red shadow dot approaching from the facing direction.
        if (bs.warpIn[side] > 0) {
          const wi  = bs.warpIn[side];
          const ang = (ship.facing * 4) & 63;
          const distW = Math.round((wi / 15) * DISPLAY_TO_WORLD(120));
          const sdx = tw2dx(ship.x + COSINE(ang, distW));
          const sdy = tw2dy(ship.y + SINE(ang, distW));
          const colorStep = Math.min(11, Math.floor((15 - wi) * 12 / 15));
          const ionR = [255, 255, 255, 255, 255, 255, 255, 219, 183, 147, 111, 75][colorStep];
          const ionG = [171, 142, 113, 85,  57,  28,   0,   0,   0,   0,   0,  0][colorStep];
          ctx.fillStyle = `rgb(${ionR},${ionG},0)`;
          ctx.fillRect(sdx - 1, sdy - 1, 3, 3);
          continue;
        }

        const ctrl    = SHIP_REGISTRY[bs.shipTypes[side]];
        const sprites = shipSpritesRef.current.get(bs.shipTypes[side]) ?? null;
        ctrl.drawShip(dc, ship, sprites);
      }
    }

    // ── Explosions ───────────────────────────────────────────────────────
    {
      const exSp = explosionSpritesRef.current;
      for (const ex of bs.explosions) {
        if (ex.type === 'splinter') {
          // Buzzsaw impact: render using buzzsaw sprite frames 2–6.
          // Splinters always come from Kohr-Ah, so pull from their sprite bundle.
          const khSp = shipSpritesRef.current.get('kohrah') as
            { buzzsaw?: { big: object; med: object; sml: object } } | null;
          const group = khSp?.buzzsaw ?? null;
          const sset = group
            ? (r >= 2 ? group.sml : r === 1 ? group.med : group.big) as Parameters<typeof drawSprite>[1] | null
            : null;
          if (sset) {
            drawSprite(ctx, sset, ex.frame, ex.x, ex.y, CANVAS_W, CANVAS_H, camX, camY, r);
          } else {
            placeholderDot(ctx, ex.x, ex.y, camX, camY, 4, '#f80', r);
          }
          continue;
        }
        const set = ex.type === 'boom'
          ? (exSp ? (r >= 2 ? exSp.boom.sml : r === 1 ? exSp.boom.med : exSp.boom.big) : null)
          : (exSp ? (r >= 2 ? exSp.blast.sml : r === 1 ? exSp.blast.med : exSp.blast.big) : null);
        if (set) {
          drawSprite(ctx, set, ex.frame, ex.x, ex.y, CANVAS_W, CANVAS_H, camX, camY, r);
        } else {
          // Fallback: colored expanding circle
          const frac = ex.frame / (ex.type === 'boom' ? 8 : 7);
          const radius = (ex.type === 'boom' ? 12 : 6) * frac;
          const sx = tw2dx(ex.x);
          const sy = tw2dy(ex.y);
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

  // Canvas pixel dims are set via the resize effect. The container div is
  // sized to match so the HUD (absolutely positioned inside it) covers the
  // game area correctly without any CSS transform.
  //
  // Status panel: 128×480 logical pixels (2× UQM's 64×240 per-player layout),
  // displayed at 20% of the container width (128/640 = 1/5) × full height.
  // It overlaps the rightmost 20% of the battle canvas, matching how UQM
  // carved its 64px status column from the right of a 640px screen.
  const panelW = Math.round(displaySize.w * 128 / 640);

  // Key capture for in-pause rebinding — runs in the capture phase so ESC
  // cancels the rebind instead of toggling the pause overlay.
  useEffect(() => {
    if (!isPaused || !pauseRebinding) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') {
        const pKey = pauseRebinding.player === 1 ? 'p1' : 'p2';
        const next: ControlsConfig = {
          ...pauseControls,
          [pKey]: {
            preset: 'custom',
            bindings: { ...pauseControls[pKey].bindings, [pauseRebinding.field]: e.code },
          },
        };
        setPauseControls(next);
        setControls(next);
        // Rebuild live refs so new bindings work immediately on resume
        keyMapP1Ref.current  = buildKeyMap(next.p1.bindings, INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2);
        keyMapP2Ref.current  = buildKeyMap(next.p2.bindings, INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2);
        gamepadP1Ref.current = next.p1.bindings.gamepadIndex;
        gamepadP2Ref.current = next.p2.bindings.gamepadIndex;
        gameKeysRef.current  = new Set([
          ...Object.keys(keyMapP1Ref.current),
          ...Object.keys(keyMapP2Ref.current),
        ]);
      }
      setPauseRebinding(null);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isPaused, pauseRebinding, pauseControls]);

  const handleResume = useCallback(() => {
    pausedRef.current = false;
    setIsPaused(false);
    lastTimeRef.current = performance.now();
    accumRef.current = 0;
  }, []);

  function patchPauseAudio(patch: Partial<AudioConfig>) {
    const next = { ...pauseAudio, ...patch };
    setPauseAudio(next);
    setAudioConfig(next);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ position: 'relative', width: displaySize.w, height: displaySize.h }}>
        <canvas ref={canvasRef} style={{ display: 'block' }} />
        {/* UQM-style status panel — right edge overlay, same as original game layout */}
        <div style={{
          position: 'absolute', top: 0, right: 0,
          width: panelW, height: displaySize.h,
          pointerEvents: 'none',
        }}>
          <StatusPanel sidesRef={statusRef} />
        </div>

        {/* Pause overlay */}
        {isPaused && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.72)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font)',
          }}>
            <div style={{
              background: 'rgba(2,3,20,0.97)',
              border: '1px solid #2a2a50',
              padding: '24px 28px',
              display: 'flex', flexDirection: 'column', gap: 16,
              minWidth: 320, maxWidth: 480,
              maxHeight: '90vh', overflowY: 'auto',
            }}>
              {/* Title */}
              <div style={{
                fontSize: 22, fontWeight: 'bold', letterSpacing: '0.3em',
                color: '#ff44ff', textShadow: '0 0 12px #ff00ff50',
                textTransform: 'uppercase', textAlign: 'center',
              }}>
                PAUSED
              </div>

              {/* Tab bar */}
              <div style={{ display: 'flex', gap: 2 }}>
                {(['audio', 'controls'] as const).map(t => (
                  <button key={t} onClick={() => { setPauseTab(t); setPauseRebinding(null); }} style={{
                    flex: 1, fontSize: 10, padding: '5px',
                    background: pauseTab === t ? '#111130' : '#07070f',
                    color: pauseTab === t ? '#ff88ff' : '#445',
                    border: `1px solid ${pauseTab === t ? '#ff88ff44' : '#181830'}`,
                    fontFamily: 'var(--font)', letterSpacing: '0.12em',
                    cursor: 'pointer', textTransform: 'uppercase',
                  }}>{t}</button>
                ))}
              </div>

              {/* Audio tab */}
              {pauseTab === 'audio' && <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#778', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Mute All</span>
                  <button
                    onClick={() => patchPauseAudio({ muted: !pauseAudio.muted })}
                    style={{
                      fontSize: 10, padding: '4px 14px',
                      background: pauseAudio.muted ? '#220a22' : '#07070f',
                      color: pauseAudio.muted ? '#ff88ff' : '#556',
                      border: `1px solid ${pauseAudio.muted ? '#ff44ff55' : '#1e1e40'}`,
                      fontFamily: 'var(--font)', letterSpacing: '0.1em',
                      cursor: 'pointer', textTransform: 'uppercase',
                    }}
                  >
                    {pauseAudio.muted ? 'MUTED' : 'MUTE'}
                  </button>
                </div>
                <PauseVolumeSlider label="Sound Effects" value={pauseAudio.sfxVolume} disabled={pauseAudio.muted} onChange={v => patchPauseAudio({ sfxVolume: v })} />
                <PauseVolumeSlider label="Music" value={pauseAudio.musicVolume} disabled={pauseAudio.muted} note="(no music yet)" onChange={v => patchPauseAudio({ musicVolume: v })} />
              </>}

              {/* Controls tab */}
              {pauseTab === 'controls' && (
                <PauseControlsPanel
                  controls={pauseControls}
                  rebinding={pauseRebinding}
                  isLocal2P={isLocal2P}
                  onRebind={target => setPauseRebinding(target)}
                />
              )}

              {/* Divider */}
              <div style={{ borderTop: '1px solid #1a1a30' }} />

              {/* Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  onClick={handleResume}
                  style={{
                    fontSize: 12, padding: '9px',
                    background: '#0d0d2a', color: '#ff88ff',
                    border: '1px solid #ff44ff44',
                    fontFamily: 'var(--font)', letterSpacing: '0.18em',
                    cursor: 'pointer', textTransform: 'uppercase',
                  }}
                >
                  RESUME  (Esc)
                </button>
                <button
                  onClick={() => onBattleEnd(null)}
                  style={{
                    fontSize: 12, padding: '9px',
                    background: '#07070f', color: '#556',
                    border: '1px solid #1e1e40',
                    fontFamily: 'var(--font)', letterSpacing: '0.18em',
                    cursor: 'pointer', textTransform: 'uppercase',
                  }}
                >
                  QUIT BATTLE
                </button>
              </div>

              <div style={{ color: '#2a2a44', fontSize: 10, letterSpacing: '0.08em', textAlign: 'center' }}>
                {pauseRebinding ? 'Press any key to bind · Esc to cancel' : 'ESC to resume · changes saved automatically'}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pause menu sub-components ───────────────────────────────────────────────

function PauseControlsPanel({ controls, rebinding, isLocal2P, onRebind }: {
  controls: ControlsConfig;
  rebinding: { player: 1 | 2; field: BindingField } | null;
  isLocal2P: boolean;
  onRebind: (target: { player: 1 | 2; field: BindingField }) => void;
}) {
  const players: Array<1 | 2> = isLocal2P ? [1, 2] : [1];
  const accents: Record<1 | 2, string> = { 1: '#ff88ff', 2: '#88ccff' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {players.map(player => {
        const cfg     = player === 1 ? controls.p1 : controls.p2;
        const isJoy   = cfg.bindings.gamepadIndex >= 0;
        const accent  = accents[player];
        return (
          <div key={player}>
            {isLocal2P && (
              <div style={{
                color: accent, fontSize: 10, letterSpacing: '0.15em',
                textTransform: 'uppercase', marginBottom: 6,
                borderBottom: '1px solid #181830', paddingBottom: 4,
              }}>
                Player {player}
              </div>
            )}
            {isJoy ? (
              <div style={{ color: '#556', fontSize: 11, lineHeight: 1.7 }}>
                <div>Gamepad {cfg.bindings.gamepadIndex + 1} — axis / buttons</div>
                <div style={{ color: '#334', fontSize: 10, marginTop: 4 }}>Switch preset in Settings to use keyboard.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  color: '#334', fontSize: 10, letterSpacing: '0.1em',
                  marginBottom: 3, paddingBottom: 3, borderBottom: '1px solid #111125',
                }}>
                  <span>ACTION</span>
                  <span>KEY (CLICK TO REBIND)</span>
                </div>
                {BINDING_FIELDS.map(field => {
                  const keyCode  = cfg.bindings[field as keyof typeof cfg.bindings] as string;
                  const isAlt    = field === 'weaponAlt' || field === 'specialAlt';
                  const isActive = rebinding?.player === player && rebinding?.field === field;
                  if (isAlt && !keyCode && !isActive) return null;
                  return (
                    <div
                      key={field}
                      onClick={() => onRebind({ player, field })}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '4px 5px',
                        background: isActive ? '#08082a' : 'transparent',
                        border: `1px solid ${isActive ? '#334499' : 'transparent'}`,
                        cursor: 'pointer', borderRadius: 2,
                      }}
                    >
                      <span style={{
                        color: isAlt ? '#445' : '#778', fontSize: isAlt ? 10 : 11,
                        letterSpacing: '0.05em', paddingLeft: isAlt ? 10 : 0,
                      }}>
                        {FIELD_LABELS[field]}
                      </span>
                      <span style={{
                        color: isActive ? '#aabbff' : keyCode ? accent : '#2a2a44',
                        fontSize: 10,
                        background: isActive ? '#111140' : '#040410',
                        padding: '2px 8px',
                        border: `1px solid ${isActive ? '#4455bb' : '#121220'}`,
                        minWidth: 72, textAlign: 'center', letterSpacing: '0.04em',
                      }}>
                        {isActive ? 'Press a key…' : codeDisplay(keyCode) || '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {!isLocal2P && (
        <div style={{ color: '#2a2a44', fontSize: 10, letterSpacing: '0.07em' }}>
          Online play uses Player 1 controls.
        </div>
      )}
    </div>
  );
}

function PauseVolumeSlider({ label, value, disabled, note, onChange }: {
  label: string;
  value: number;
  disabled?: boolean;
  note?: string;
  onChange: (v: number) => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, opacity: disabled ? 0.4 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ color: '#778', fontSize: 11, letterSpacing: '0.09em', textTransform: 'uppercase' }}>
          {label}
          {note && <span style={{ color: '#334', fontSize: 10, marginLeft: 8 }}>{note}</span>}
        </span>
        <span style={{ color: '#ff88ff', fontSize: 11, minWidth: 32, textAlign: 'right' }}>{pct}%</span>
      </div>
      <input
        type="range" min={0} max={100} step={1}
        value={pct}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value) / 100)}
        style={{ width: '100%', accentColor: '#ff44ff', cursor: disabled ? 'not-allowed' : 'pointer' }}
      />
    </div>
  );
}

// ─── Helper functions ─────────────────────────────────────────────────────────

// placeholderDot is imported from engine/sprites

/**
 * Pick the smallest zoom-out level (0–MAX_REDUCTION) that keeps both ships
 * on screen. Zoom out immediately; zoom in only after separation drops below
 * threshold by HYSTERESIS_W world units to prevent jitter at the boundary.
 */
function calcReduction(ships: [ShipState, ShipState], current: number): number {
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
function resolveShipCollision(a: ShipState, b: ShipState): void {
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
  // Use setVelocityComponents so travelAngle stays correct — stale travelAngle
  // causes wrong thrust-clamping decisions on the next frame.
  setVelocityComponents(a.velocity, a.velocity.vx - imp * dx, a.velocity.vy - imp * dy);
  setVelocityComponents(b.velocity, b.velocity.vx + imp * dx, b.velocity.vy + imp * dy);
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

function applyAttachedLimpetPenalty(
  ship: ShipState,
  previous: { facing: number; vx: number; vy: number },
): void {
  const limpets = ship.limpetCount ?? 0;
  if (limpets <= 0) return;

  if (ship.facing !== previous.facing) {
    ship.turnWait = Math.min(30, ship.turnWait + limpets);
  }

  if (ship.thrusting) {
    ship.thrustWait = Math.min(30, ship.thrustWait + limpets);

    const thrustScale = Math.max(0.35, 1 - limpets * 0.12);
    const dvx = ship.velocity.vx - previous.vx;
    const dvy = ship.velocity.vy - previous.vy;
    setVelocityComponents(
      ship.velocity,
      previous.vx + dvx * thrustScale,
      previous.vy + dvy * thrustScale,
    );
  }
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
function computeAIInput(ai: ShipState, target: ShipState, nukes: BattleMissile[], aiSide: 0 | 1): number {
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

function applyGravity(ship: ShipState) {
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


// FNV-1a style mixing — detects all single-field divergences regardless of bit
// position, including vx/vy values that differ by multiples of 256.
function hashStep(h: number, v: number): number {
  return Math.imul(h ^ (v | 0), 0x9e3779b9) >>> 0;
}

function computeChecksum(bs: BattleState): number {
  let h = hashStep(0x811c9dc5, bs.frame);
  for (const ship of bs.ships) {
    h = hashStep(h, ship.x);
    h = hashStep(h, ship.y);
    h = hashStep(h, ship.velocity.vx);
    h = hashStep(h, ship.velocity.vy);
    h = hashStep(h, ship.velocity.travelAngle);
    h = hashStep(h, ship.crew);
    h = hashStep(h, ship.energy);
    h = hashStep(h, ship.facing);
  }
  h = hashStep(h, bs.missiles.length);
  for (const m of bs.missiles) {
    h = hashStep(h, m.x);
    h = hashStep(h, m.y);
    h = hashStep(h, m.facing);
    h = hashStep(h, m.life);
    h = hashStep(h, m.speed);
    h = hashStep(h, m.owner);
  }
  h = hashStep(h, bs.warpIn[0]);
  h = hashStep(h, bs.warpIn[1]);
  return h;
}
