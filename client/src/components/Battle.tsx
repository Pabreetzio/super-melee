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
import { COSINE, SINE } from '../engine/sinetab';
import { DISPLAY_TO_WORLD, VELOCITY_TO_WORLD, setVelocityVector, type VelocityDesc } from '../engine/velocity';
import type { ShipState, SpawnRequest, BattleMissile, LaserFlash, DrawContext } from '../engine/ships/types';
import type { BattleState, WinnerShipState } from '../engine/battle/types';
import {
  applyAttachedLimpetPenalty,
  applyGravity,
  calcReduction,
  computeChecksum,
  worldDelta,
  worldAngle,
  wrapWorldCoord,
} from '../engine/battle/helpers';
import { handleShipPlanetCollisions, handleShipShipCollision } from '../engine/battle/collision';
import { advanceExplosions, processMissiles, updateIonTrails } from '../engine/battle/projectiles';
import { renderExplosions, renderIonTrails, renderLaserFlashes } from '../engine/battle/renderEffects';
import { SHIP_REGISTRY } from '../engine/ships/registry';
import { loadExplosionSprites, drawSprite, placeholderDot, type ExplosionSprites, type PkunkSprites } from '../engine/sprites';
import { RNG } from '../engine/rng';
import type { ShipId } from 'shared/types';
import StatusPanel, { type SideStatus } from './StatusPanel';
import { preloadBattleSounds, playShipDies, playPrimary, playSecondary, playFighterLaunch, playPkunkRebirth, getAudioConfig, setAudioConfig, type AudioConfig } from '../engine/audio';
import { loadAtlasImageAsset, preloadBattleAssets } from '../engine/atlasAssets';

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
const HYPERJUMP_LIFE = 15;
const TRANSITION_SPEED_W = DISPLAY_TO_WORLD(40);
const POST_BATTLE_PAUSE_FRAMES = 72;
const SPAWN_CONFLICT_RADIUS_W = DISPLAY_TO_WORLD(24);
const VUX_AGGRESSIVE_ENTRY_DIST_W = DISPLAY_TO_WORLD((150 + 12 + 46) << 1);

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

function randomSpawnCoord(rng: RNG, worldSize: number): number {
  return (rng.rand(worldSize >> 2) << 2) % worldSize;
}

function inGravityWell(x: number, y: number): boolean {
  const { dx, dy } = worldDelta(x, y, PLANET_X, PLANET_Y, WORLD_W, WORLD_H);
  return dx * dx + dy * dy <= GRAVITY_THRESHOLD_W * GRAVITY_THRESHOLD_W;
}

function conflictsWithShips(
  x: number,
  y: number,
  ships: ReadonlyArray<ShipState>,
): boolean {
  for (const ship of ships) {
    const { dx, dy } = worldDelta(x, y, ship.x, ship.y, WORLD_W, WORLD_H);
    if (dx * dx + dy * dy < SPAWN_CONFLICT_RADIUS_W * SPAWN_CONFLICT_RADIUS_W) {
      return true;
    }
  }
  return false;
}

function pickSpawnPoint(
  rng: RNG,
  existingShips: ReadonlyArray<ShipState>,
): { x: number; y: number } {
  for (let attempt = 0; attempt < 256; attempt++) {
    const x = randomSpawnCoord(rng, WORLD_W);
    const y = randomSpawnCoord(rng, WORLD_H);
    if (!inGravityWell(x, y) && !conflictsWithShips(x, y, existingShips)) {
      return { x, y };
    }
  }

  // Fallback: preserve progress even if our approximation gets unlucky.
  return {
    x: wrapWorldCoord(PLANET_X - DISPLAY_TO_WORLD(300), WORLD_W),
    y: wrapWorldCoord(PLANET_Y, WORLD_H),
  };
}

function pickVuxSpawnPoint(
  rng: RNG,
  targetShip: ShipState,
  existingShips: ReadonlyArray<ShipState>,
): { x: number; y: number } {
  for (let attempt = 0; attempt < 256; attempt++) {
    const x = wrapWorldCoord(
      targetShip.x - (VUX_AGGRESSIVE_ENTRY_DIST_W >> 1) + rng.rand(VUX_AGGRESSIVE_ENTRY_DIST_W),
      WORLD_W,
    );
    const y = wrapWorldCoord(
      targetShip.y - (VUX_AGGRESSIVE_ENTRY_DIST_W >> 1) + rng.rand(VUX_AGGRESSIVE_ENTRY_DIST_W),
      WORLD_H,
    );
    if (!inGravityWell(x, y) && !conflictsWithShips(x, y, existingShips)) {
      return { x, y };
    }
  }

  return pickSpawnPoint(rng, existingShips);
}


// Key maps are built inside the component at mount time from the live controls
// singleton so they reflect any rebinds made in a previous battle this session.
// (Module-level constants would be stale after an in-session setControls() call.)

// ─── Types ────────────────────────────────────────────────────────────────────

// BattleMissile and LaserFlash are defined in engine/ships/types.ts and
// imported above — no local redefinition needed.

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
  const assetsReadyRef = useRef(false);
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
    rebirth:  [number, number];
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
      rebirth: [...bs.rebirth] as [number, number],
    };
  }

  // Planet sprite images (type determined by parent, stable across ship fights); null until loaded
  const planetImgRef = useRef<{ big: { source: CanvasImageSource; width: number; height: number }; med: { source: CanvasImageSource; width: number; height: number }; sml: { source: CanvasImageSource; width: number; height: number } } | null>(null);
  // Live status panel data — updated each sim frame via ref to avoid React re-render cost.
  // StatusPanel reads directly from this ref in its own rAF loop.
  const statusRef = useRef<[SideStatus | null, SideStatus | null]>([null, null]);
  // Random captain index per side, picked once per match so the name is stable
  // within a fight but varies across matches.
  const captainIdxRef = useRef<[number, number]>([
    Math.floor(Math.random() * 1000),
    Math.floor(Math.random() * 1000),
  ]);
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
    assetsReadyRef.current = false;
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

    const spawn0 = pickSpawnPoint(rng, []);
    const s0 = makeShip(type0, spawn0.x, spawn0.y);
    s0.facing = rng.rand(16);

    const spawn1 = type1 === 'vux'
      ? pickVuxSpawnPoint(rng, s0, [s0])
      : pickSpawnPoint(rng, [s0]);
    const s1 = makeShip(type1, spawn1.x, spawn1.y);
    s1.facing = type1 === 'vux'
      ? worldAngle(s1.x, s1.y, s0.x, s0.y) >> 2
      : rng.rand(16);

    if (type0 === 'vux') {
      const vuxSpawn0 = pickVuxSpawnPoint(rng, s1, [s1]);
      s0.x = vuxSpawn0.x;
      s0.y = vuxSpawn0.y;
      s0.facing = worldAngle(s0.x, s0.y, s1.x, s1.y) >> 2;
    }

    // Apply winner state if this is a continuation battle (offline modes).
    // Winner keeps exact crew/energy/position/velocity from previous fight.
    // The loser re-enters using the same spawn search as a fresh battle.
    let warpIn0 = HYPERJUMP_LIFE;
    let warpIn1 = HYPERJUMP_LIFE;
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

      const loserSide = ws.side === 0 ? 1 : 0;
      const loserType = loserSide === 0 ? type0 : type1;
      const respawn = loserType === 'vux'
        ? pickVuxSpawnPoint(rng, wShip, [wShip])
        : pickSpawnPoint(rng, [wShip]);
      const loserShip = loserSide === 0 ? s0 : s1;
      loserShip.x = respawn.x;
      loserShip.y = respawn.y;
      loserShip.facing = loserType === 'vux'
        ? worldAngle(loserShip.x, loserShip.y, wShip.x, wShip.y) >> 2
        : rng.rand(16);
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
      ? winnerState.persistedMissiles.map(m => ({
          ...m,
          prevX: m.prevX ?? m.x,
          prevY: m.prevY ?? m.y,
        }))
      : [];

    stateRef.current = {
      ships: [s0, s1],
      shipTypes: [type0, type1],
      missiles: initMissiles,
      lasers: [],
      explosions: [],
      ionTrails: [[], []],
      warpIn: [warpIn0, warpIn1],
      rebirth: [0, 0],
      shipAlive: [true, true],
      frame: 0,
      inputBuf,
      pendingEnd: null,
    };

    // Seed the status panel so its data is ready once assets finish preloading.
    statusRef.current = [
      { shipId: type0, crew: s0.crew, maxCrew: SHIP_REGISTRY[type0].maxCrew, energy: s0.energy, maxEnergy: SHIP_REGISTRY[type0].maxEnergy, limpetCount: 0, inputs: 0, captainIdx: captainIdxRef.current[0] },
      { shipId: type1, crew: s1.crew, maxCrew: SHIP_REGISTRY[type1].maxCrew, energy: s1.energy, maxEnergy: SHIP_REGISTRY[type1].maxEnergy, limpetCount: 0, inputs: 0, captainIdx: captainIdxRef.current[1] },
    ];

    void (async () => {
      await preloadBattleAssets({
        fleets: [fleet0, fleet1],
        activeShips: [type0, type1],
        planetType,
      });
      preloadBattleSounds([type0, type1]);

      const loadedTypes = new Set<string>();
      for (const t of [type0, type1]) {
        if (!loadedTypes.has(t)) {
          loadedTypes.add(t);
          try {
            const sp = await SHIP_REGISTRY[t].loadSprites();
            shipSpritesRef.current.set(t, sp);
          } catch {
            // Placeholder fallback still applies if an atlas entry is missing.
          }
        }
      }

      try {
        explosionSpritesRef.current = await loadExplosionSprites();
      } catch {
        explosionSpritesRef.current = null;
      }

      const [big, med, sml] = await Promise.all([
        loadAtlasImageAsset(`/planets/${planetType}-big-000.png`),
        loadAtlasImageAsset(`/planets/${planetType}-med-000.png`),
        loadAtlasImageAsset(`/planets/${planetType}-sml-000.png`),
      ]);
      if (big && med && sml) {
        planetImgRef.current = { big, med, sml };
      }

      assetsReadyRef.current = true;
      lastTimeRef.current = performance.now();
      accumRef.current = 0;
    })();

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
      if (!pausedRef.current && assetsReadyRef.current) keysRef.current.add(e.code);
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
    if (!bs || !assetsReadyRef.current) return;

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
          const resurrected = ctrl.onDeath(ship, (n) => rng.rand(n));
          if (resurrected) {
            bs.rebirth[side] = bs.shipTypes[side] === 'pkunk' ? 12 : 0;
            bs.shipAlive[side] = true;
            if (bs.shipTypes[side] === 'pkunk') playPkunkRebirth();
          }
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
      bs.pendingEnd = { winner, countdown: POST_BATTLE_PAUSE_FRAMES };
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
        captainIdx: captainIdxRef.current[0],
      },
      {
        shipId:     bs.shipTypes[1],
        crew:       bs.ships[1].crew,
        maxCrew:    SHIP_REGISTRY[bs.shipTypes[1]].maxCrew,
        energy:     bs.ships[1].energy,
        maxEnergy:  SHIP_REGISTRY[bs.shipTypes[1]].maxEnergy,
        limpetCount: bs.ships[1].limpetCount ?? 0,
        inputs:     i1,
        captainIdx: captainIdxRef.current[1],
      },
    ];
  }

  function simulateFrame(bs: BattleState, input0: number, input1: number) {
    bs.lasers = []; // clear previous frame's laser flashes

    // UQM keeps physics running during the inter-round pause, but ships do not
    // accept steering/weapon input while waiting for the next entrant.
    if (bs.pendingEnd) {
      input0 = 0;
      input1 = 0;
    }

    // Apply gravity to both ships
    applyGravity(bs.ships[0], PLANET_X, PLANET_Y, GRAVITY_THRESHOLD_W);
    applyGravity(bs.ships[1], PLANET_X, PLANET_Y, GRAVITY_THRESHOLD_W);

    // Decrement warp-in countdown (ship is invisible and nonsolid during this)
    if (bs.warpIn[0] > 0) bs.warpIn[0]--;
    if (bs.warpIn[1] > 0) bs.warpIn[1]--;
    if (bs.rebirth[0] > 0) bs.rebirth[0]--;
    if (bs.rebirth[1] > 0) bs.rebirth[1]--;

    // Update ships — dispatch through registry.
    // Ships still warping in cannot act (no weapons, no steering).
    const updateShip = (ship: ShipState, input: number, type: ShipId, warping: boolean): SpawnRequest[] => {
      if (warping) return [];
      return SHIP_REGISTRY[type].update(ship, input);
    };
    const preShip0 = { facing: bs.ships[0].facing, vx: bs.ships[0].velocity.vx, vy: bs.ships[0].velocity.vy };
    const preShip1 = { facing: bs.ships[1].facing, vx: bs.ships[1].velocity.vx, vy: bs.ships[1].velocity.vy };
    const spawns0 = updateShip(bs.ships[0], input0, bs.shipTypes[0], bs.warpIn[0] > 0 || bs.rebirth[0] > 0);
    const spawns1 = updateShip(bs.ships[1], input1, bs.shipTypes[1], bs.warpIn[1] > 0 || bs.rebirth[1] > 0);
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
        let spawnX = s.x;
        let spawnY = s.y;
        if (s.inheritVelocity) {
          const ownerShip = bs.ships[owner];
          v.vx += ownerShip.velocity.vx;
          v.vy += ownerShip.velocity.vy;
          // UQM nudges the missile's initial world position back by one frame
          // of inherited ship movement so the burst stays centered on the ship.
          spawnX -= VELOCITY_TO_WORLD(ownerShip.velocity.vx);
          spawnY -= VELOCITY_TO_WORLD(ownerShip.velocity.vy);
        }
        spawnX = ((spawnX % WORLD_W) + WORLD_W) % WORLD_W;
        spawnY = ((spawnY % WORLD_H) + WORLD_H) % WORLD_H;
        bs.missiles.push({
          prevX: spawnX, prevY: spawnY,
          x: spawnX, y: spawnY, facing: s.facing, velocity: v,
          life: s.life, hitPoints: s.hits ?? s.damage, speed: s.speed, maxSpeed: s.maxSpeed,
          accel: s.accel, damage: s.damage,
          tracks: s.tracks, trackWait: s.initialTrackWait ?? s.trackRate, trackRate: s.trackRate,
          owner,
          preserveVelocity: s.preserveVelocity,
          limpet: s.limpet,
          weaponType: s.weaponType,
        });
      } else if (s.type === 'sound') {
        // Pure side-effect request; handled by the sound dispatch below.
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
          prevX: s.x, prevY: s.y,
          x: s.x, y: s.y, facing: s.facing, velocity: v,
          life: s.life, hitPoints: s.hits, speed: s.speed, maxSpeed: s.speed,
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
          prevX: s.x, prevY: s.y,
          x: s.x, y: s.y, facing: s.facing, velocity: v,
          life: 64, hitPoints: s.hits, speed: s.speed, maxSpeed: s.speed,
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
          prevX: s.x, prevY: s.y,
          x: s.x, y: s.y, facing: s.facing, velocity: v,
          life: s.life, hitPoints: 1, speed: s.speed, maxSpeed: s.speed,
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
      if (s.type === 'sound')          s.sound === 'primary' ? playPrimary(bs.shipTypes[0]) : playSecondary(bs.shipTypes[0]);
      else
      if (s.type === 'point_defense')  playSecondary(bs.shipTypes[0]);
      else if (s.type === 'missile') {
        if (bs.shipTypes[0] !== 'pkunk') s.limpet ? playSecondary(bs.shipTypes[0]) : playPrimary(bs.shipTypes[0]);
      }
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
      if (s.type === 'sound')          s.sound === 'primary' ? playPrimary(bs.shipTypes[1]) : playSecondary(bs.shipTypes[1]);
      else
      if (s.type === 'point_defense')  playSecondary(bs.shipTypes[1]);
      else if (s.type === 'missile') {
        if (bs.shipTypes[1] !== 'pkunk') s.limpet ? playSecondary(bs.shipTypes[1]) : playPrimary(bs.shipTypes[1]);
      }
      else if (s.type === 'buzzsaw')   playPrimary(bs.shipTypes[1]);
      else if (s.type === 'gas_cloud' && !gasSoundPlayed1) { playSecondary(bs.shipTypes[1]); gasSoundPlayed1 = true; }
      else if (s.type === 'vux_laser') playPrimary(bs.shipTypes[1]);
      else if (s.type === 'fighter' && !launchSoundPlayed1) { playFighterLaunch(); launchSoundPlayed1 = true; }
    }

    processMissiles(bs, shipSpritesRef.current, input0, input1, PLANET_X, PLANET_Y, PLANET_RADIUS_W, WORLD_W, WORLD_H);

    // Advance cosmetic explosions (advance 1 frame per sim tick, remove when done)
    bs.explosions = advanceExplosions(bs.explosions, WORLD_W, WORLD_H);

    // Ship–ship collision (skip if either ship is still warping in)
    handleShipShipCollision(
      bs.ships,
      [
        bs.warpIn[0] + (bs.rebirth[0] > 0 ? 1 : 0),
        bs.warpIn[1] + (bs.rebirth[1] > 0 ? 1 : 0),
      ],
      bs.shipTypes,
      shipSpritesRef.current,
    );

    // Ship–planet collision (UQM misc.c / ship.c behavior):
    //   damage = ship.crew >> 2  (25% current HP, min 1)
    //   planet has DEFY_PHYSICS — ship bounces, planet doesn't move
    handleShipPlanetCollisions(
      bs.ships,
      bs.shipTypes,
      shipSpritesRef.current,
      PLANET_X,
      PLANET_Y,
      PLANET_RADIUS_W,
      [bs.rebirth[0] > 0, bs.rebirth[1] > 0],
    );

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
    updateIonTrails(bs.ionTrails, bs.ships, bs.warpIn);
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
    reductionRef.current = calcReduction(bs.ships, reductionRef.current, CANVAS_W, MAX_REDUCTION, WORLD_W, WORLD_H);
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

    if (!assetsReadyRef.current) {
      ctx.fillStyle = '#889';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Preparing battle assets...', CANVAS_W / 2, CANVAS_H / 2 - 6);
      ctx.fillStyle = '#556';
      ctx.font = '10px monospace';
      ctx.fillText('Ships will become controllable when loading is complete.', CANVAS_W / 2, CANVAS_H / 2 + 14);
      return;
    }

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
          ctx.drawImage(img.source, pDX - hx, pDY - hy, img.width, img.height);
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
    renderLaserFlashes(ctx, bs.lasers, tw2dx, tw2dy);

    // ── Ion trails (thruster exhaust dots) ──────────────────────────────
    // UQM-style: small 1×1 dots cycling orange → red → dark red → gone.
    // Colors from UQM tactrans.c cycle_ion_trail colorTab (RGB15 values).
    renderIonTrails(ctx, bs.ionTrails, CANVAS_W, CANVAS_H, tw2dx, tw2dy);

    // ── Ships ────────────────────────────────────────────────────────────
    {
      const dc: DrawContext = { ctx, camX, camY, canvasW: CANVAS_W, canvasH: CANVAS_H, reduction: r, worldW: WORLD_W, worldH: WORLD_H };
      for (let side = 0; side < 2; side++) {
        const ship = bs.ships[side];

        // Warp-in: tint the actual ship sprite into the UQM-style orange/red
        // silhouette and slide it in from the facing direction.
        if (bs.warpIn[side] > 0) {
          const wi = bs.warpIn[side];
          const ang = (ship.facing * 4) & 63;
          const ctrl = SHIP_REGISTRY[bs.shipTypes[side]];
          const sprites = shipSpritesRef.current.get(bs.shipTypes[side]) ?? null;
          const progress = (HYPERJUMP_LIFE - wi + 1) / HYPERJUMP_LIFE;
          const tintOpacity = 0.28 + progress * 0.45;

          for (let trail = 0; trail < 3; trail++) {
            const distW = TRANSITION_SPEED_W * Math.max(0, wi + trail - 1);
            const warpX = wrapWorldCoord(ship.x - COSINE(ang, distW), WORLD_W);
            const warpY = wrapWorldCoord(ship.y - SINE(ang, distW), WORLD_H);

            ctx.save();
            ctx.globalAlpha = tintOpacity * (1 - trail * 0.24);
            ctx.filter = 'sepia(1) saturate(7) hue-rotate(-28deg) brightness(0.92)';
            ctrl.drawShip(dc, { ...ship, x: warpX, y: warpY }, sprites);
            ctx.restore();
          }
          continue;
        }

        if (bs.rebirth[side] > 0 && bs.shipTypes[side] === 'pkunk') {
          renderPkunkRebirth(
            ctx,
            ship,
            shipSpritesRef.current.get(bs.shipTypes[side]) ?? null,
            bs.rebirth[side],
            { camX, camY, canvasW: CANVAS_W, canvasH: CANVAS_H, reduction: r, worldW: WORLD_W, worldH: WORLD_H },
          );
          continue;
        }

        const ctrl    = SHIP_REGISTRY[bs.shipTypes[side]];
        const sprites = shipSpritesRef.current.get(bs.shipTypes[side]) ?? null;
        ctrl.drawShip(dc, ship, sprites);
      }
    }

    // ── Explosions ───────────────────────────────────────────────────────
    renderExplosions(
      ctx,
      bs.explosions,
      explosionSpritesRef.current,
      shipSpritesRef.current,
      CANVAS_W,
      CANVAS_H,
      camX,
      camY,
      r,
      tw2dx,
      tw2dy,
    );

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

function renderPkunkRebirth(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  sprites: unknown,
  timer: number,
  baseDc: Omit<DrawContext, 'ctx'>,
): void {
  const sp = sprites as PkunkSprites | null;
  const set = sp
    ? (baseDc.reduction >= 2 ? sp.sml : baseDc.reduction === 1 ? sp.med : sp.big)
    : null;
  const progress = 1 - ((timer - 1) / 12);
  const distance = Math.round(DISPLAY_TO_WORLD(20) * (1 - progress));
  const alpha = Math.max(0.2, Math.min(0.85, progress));
  const faces = [ship.facing, (ship.facing + 4) & 15, (ship.facing + 8) & 15, (ship.facing + 12) & 15];

  ctx.save();
  for (const face of faces) {
    const angle = (face * 4) & 63;
    const x = ship.x - COSINE(angle, distance);
    const y = ship.y - SINE(angle, distance);

    for (let trail = 0; trail < 4; trail++) {
      const trailDist = distance + DISPLAY_TO_WORLD(5 * (trail + 1));
      const tx = ship.x - COSINE(angle, trailDist);
      const ty = ship.y - SINE(angle, trailDist);
      const tdx = (((tx - baseDc.camX) % baseDc.worldW) + baseDc.worldW) % baseDc.worldW;
      const tdy = (((ty - baseDc.camY) % baseDc.worldH) + baseDc.worldH) % baseDc.worldH;
      const sx = Math.floor((tdx > baseDc.worldW / 2 ? tdx - baseDc.worldW : tdx) / (1 << (2 + baseDc.reduction)));
      const sy = Math.floor((tdy > baseDc.worldH / 2 ? tdy - baseDc.worldH : tdy) / (1 << (2 + baseDc.reduction)));
      ctx.fillStyle = `rgba(${255 - trail * 24},${Math.max(0, 171 - trail * 40)},0,${alpha * (0.7 - trail * 0.12)})`;
      ctx.fillRect(sx, sy, 2, 2);
    }

    ctx.globalAlpha = alpha;
    if (set) {
      drawSprite(ctx, set, face, x, y, baseDc.canvasW, baseDc.canvasH, baseDc.camX, baseDc.camY, baseDc.reduction);
    } else {
      placeholderDot(ctx, x, y, baseDc.camX, baseDc.camY, 8, '#f80', baseDc.reduction);
    }
  }
  ctx.restore();
}

/**
 * Pick the smallest zoom-out level (0–MAX_REDUCTION) that keeps both ships
 * on screen. Zoom out immediately; zoom in only after separation drops below
 * threshold by HYSTERESIS_W world units to prevent jitter at the boundary.
 */
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
