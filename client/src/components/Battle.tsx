// Battle screen — canvas game loop with UQM physics and sprite rendering.
// Ships dispatch through SHIP_REGISTRY (engine/ships/registry.ts) — no
// per-ship if-chains here.  To add a new ship, implement its controller
// and register it; Battle.tsx needs no changes.

import { useEffect, useRef, useState, useCallback } from 'react';
import type { AIDifficulty, FullRoomState } from 'shared/types';
import { client } from '../net/client';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2, BATTLE_FPS } from '../engine/game';
import {
  getControls, buildKeyMap,
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
import {
  BATTLE_CANVAS_H as CANVAS_H,
  BATTLE_CANVAS_W as CANVAS_W,
  GRAVITY_THRESHOLD_W,
  MAX_REDUCTION,
  PLANET_RADIUS_W,
  PLANET_X,
  PLANET_Y,
  SPACE_CANVAS_W,
  WORLD_H,
  WORLD_W,
} from '../engine/battle/constants';
import { handleShipPlanetCollisions, handleShipShipCollision } from '../engine/battle/collision';
import { spriteMaskContainsWorldPoint } from '../engine/battle/maskCollision';
import {
  advanceShipDestruction,
  beginShipDestruction,
  shouldRenderExplodingShip,
} from '../engine/battle/destruction';
import { advanceExplosions, applyDirectMissileDamage, processMissiles, updateCrewPods, updateIonTrails } from '../engine/battle/projectiles';
import { renderCrewPods, renderExplosions, renderIonTrails, renderLaserFlashes, renderPkunkRebirth, renderTractorShadows } from '../engine/battle/renderEffects';
import { pickSpawnPoint, pickVuxSpawnPoint } from '../engine/battle/spawn';
import { captureSnap, logDesyncEvent, type FrameSnap } from '../engine/battle/desync';
import { computeAIInput } from '../engine/battle/ai';
import PauseOverlay from './PauseOverlay';
import { SHIP_REGISTRY } from '../engine/ships/registry';
import { loadExplosionSprites, placeholderDot, type ExplosionSprites, type SpriteFrame } from '../engine/sprites';
import { RNG } from '../engine/rng';
import type { ShipId } from 'shared/types';
import StatusPanel, { type SideStatus } from './StatusPanel';
import { preloadBattleSounds, playShipDies, playPrimary, playSecondary, playSpawnSound, playFighterLaunch, playPkunkRebirth, playVictoryDitty, stopVictoryDitty, isVictoryDittyPlaying } from '../engine/audio';
import { loadAtlasImageAsset, preloadBattleAssets } from '../engine/atlasAssets';
import { getShipDef } from '../engine/ships/index';

// ─── Constants ────────────────────────────────────────────────────────────────

const HYPERJUMP_LIFE = 15;
const TRANSITION_SPEED_W = DISPLAY_TO_WORLD(40);
const POST_BATTLE_PAUSE_FRAMES = 144; // safety cap (~12.5s); real end is gated on ditty completion

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

interface Props {
  room:        FullRoomState;
  yourSide:    0 | 1;
  seed:        number;
  planetType:  string;
  inputDelay:  number;
  isAI?:       boolean;
  aiDifficulty?: AIDifficulty;
  isLocal2P?:  boolean;
  winnerState?: WinnerShipState | null;
  // Active fleet slot for each side (offline modes). null = use first non-null fallback.
  activeSlot0?: number | null;
  activeSlot1?: number | null;
  onBattleEnd: (winner: 0 | 1 | null, winnerState?: WinnerShipState) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Battle({ room, yourSide, seed: _seed, planetType, inputDelay, isAI = false, aiDifficulty = 'cyborg_weak', isLocal2P = false, winnerState = null, activeSlot0 = null, activeSlot1 = null, onBattleEnd }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const stateRef     = useRef<BattleState | null>(null);
  const keysRef      = useRef(new Set<string>());
  const rafRef       = useRef<number | null>(null);
  const lastTimeRef  = useRef(0);
  const accumRef     = useRef(0);
  const [isPaused, setIsPaused]        = useState(false);
  const pausedRef    = useRef(false); // mirror of isPaused readable in tick closure
  const assetsReadyRef = useRef(false);

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
  const visualRngRef = useRef<RNG | null>(null);

  // ─── Desync diagnostics ──────────────────────────────────────────────────
  // Ring buffer: last 64 frames of full game state + inputs used.
  // Populated every frame; read when checksum_mismatch arrives from server.
  // Number of consecutive checksum mismatches seen — used to decide when to give up.
  const checksumMismatchCountRef = useRef(0);
  const snapHistoryRef = useRef<FrameSnap[]>([]);

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
      const camX = midX - (SPACE_CANVAS_W << (1 + r));
      const camY = midY - (CANVAS_H << (1 + r));
      // tw2dx/tw2dy must exactly mirror the renderer's logic (including wdw fix)
      const wdw = WORLD_W >> (2 + r);
      const wdh = WORLD_H >> (2 + r);
      const tw2dx = (wx: number) => {
        let x = wx - camX; x = ((x % WORLD_W) + WORLD_W) % WORLD_W; if (x > WORLD_W >> 1) x -= WORLD_W;
        let d = x >> (2 + r);
        if (d < 0 && d + wdw <= SPACE_CANVAS_W) d += wdw; else if (d > SPACE_CANVAS_W && d - wdw >= 0) d -= wdw;
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
    void stopVictoryDitty();
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
    visualRngRef.current = new RNG((_seed || 1) ^ 0x5f3759df);
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

    const spawn0 = pickSpawnPoint(rng, [], PLANET_X, PLANET_Y, WORLD_W, WORLD_H);
    const s0 = makeShip(type0, spawn0.x, spawn0.y);
    s0.facing = rng.rand(16);

    const spawn1 = type1 === 'vux'
      ? pickVuxSpawnPoint(rng, s0, [s0], PLANET_X, PLANET_Y, WORLD_W, WORLD_H)
      : pickSpawnPoint(rng, [s0], PLANET_X, PLANET_Y, WORLD_W, WORLD_H);
    const s1 = makeShip(type1, spawn1.x, spawn1.y);
    s1.facing = type1 === 'vux'
      ? worldAngle(s1.x, s1.y, s0.x, s0.y) >> 2
      : rng.rand(16);

    if (type0 === 'vux') {
      const vuxSpawn0 = pickVuxSpawnPoint(rng, s1, [s1], PLANET_X, PLANET_Y, WORLD_W, WORLD_H);
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
      if (ws.chmmrSatellitesSpawned !== undefined) {
        wShip.chmmrSatellitesSpawned = ws.chmmrSatellitesSpawned;
      }
      // Winner skips warp-in (they're already in the arena)
      if (ws.side === 0) warpIn0 = 0; else warpIn1 = 0;

      const loserSide = ws.side === 0 ? 1 : 0;
      const loserType = loserSide === 0 ? type0 : type1;
      const respawn = loserType === 'vux'
        ? pickVuxSpawnPoint(rng, wShip, [wShip], PLANET_X, PLANET_Y, WORLD_W, WORLD_H)
        : pickSpawnPoint(rng, [wShip], PLANET_X, PLANET_Y, WORLD_W, WORLD_H);
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
      tractorShadows: [],
      explosions: [],
      shipDestructions: [null, null],
      ionTrails: [[], []],
      crewPods: [],
      warpIn: [warpIn0, warpIn1],
      rebirth: [0, 0],
      shipAlive: [true, true],
      frame: 0,
      inputBuf,
      pendingEnd: null,
    };

    // Seed the status panel so its data is ready once assets finish preloading.
    statusRef.current = [
      { shipId: type0, crew: s0.crew, maxCrew: SHIP_REGISTRY[type0].maxCrew, energy: s0.energy, maxEnergy: SHIP_REGISTRY[type0].maxEnergy, limpetCount: 0, orzBoardSlots: s0.orzBoardSlots ?? [], orzBoardDamageFlash: s0.orzBoardDamageFlash ?? [], inputs: 0, captainIdx: captainIdxRef.current[0] },
      { shipId: type1, crew: s1.crew, maxCrew: SHIP_REGISTRY[type1].maxCrew, energy: s1.energy, maxEnergy: SHIP_REGISTRY[type1].maxEnergy, limpetCount: 0, orzBoardSlots: s1.orzBoardSlots ?? [], orzBoardDamageFlash: s1.orzBoardDamageFlash ?? [], inputs: 0, captainIdx: captainIdxRef.current[1] },
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
            bs.pendingEnd = {
              winner: msg.winner,
              countdown: msg.winner === null ? 1 : POST_BATTLE_PAUSE_FRAMES,
              dittyStarted: false,
            };
          } else {
            bs.pendingEnd.winner = msg.winner; // server's winner is authoritative
          }
        } else {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          onBattleEnd(msg.winner);
        }
      } else if (msg.type === 'checksum_mismatch') {
        checksumMismatchCountRef.current++;
        logDesyncEvent(snapHistoryRef.current, msg.frame, stateRef.current?.frame ?? -1, yourSide, checksumMismatchCountRef.current);
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
      void stopVictoryDitty();
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
      const aiCtrl = SHIP_REGISTRY[bs.shipTypes[opSide]];
      const aiInput = aiCtrl.computeAIInput?.(bs.ships[opSide], bs.ships[mySide], bs.missiles, opSide, aiDifficulty)
        ?? computeAIInput(bs.ships[opSide], bs.ships[mySide], bs.missiles, opSide, aiDifficulty);
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
            bs.shipDestructions[side] = null;
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
      bs.pendingEnd = {
        winner,
        countdown: winner === null ? 1 : POST_BATTLE_PAUSE_FRAMES,
        dittyStarted: false,
      };
      if (!isAI && !isLocal2P) {
        client.send({ type: 'battle_over_ack', winner });
      }
    }
    if (bs.pendingEnd) {
      const deadSides: (0 | 1)[] = [];
      if (s0dead) deadSides.push(0);
      if (s1dead) deadSides.push(1);
      const explosionsFinished = deadSides.every(side => bs.shipDestructions[side] === null);

      if (explosionsFinished && !bs.pendingEnd.dittyStarted) {
        bs.pendingEnd.dittyStarted = true;
        if (bs.pendingEnd.winner !== null && bs.ships[bs.pendingEnd.winner].crew > 0) {
          void playVictoryDitty(bs.shipTypes[bs.pendingEnd.winner]);
        } else {
          bs.pendingEnd.countdown = Math.min(bs.pendingEnd.countdown, 1);
        }
      }

      if (explosionsFinished && bs.pendingEnd.dittyStarted) {
        bs.pendingEnd.countdown--;
      }

      // Wait for both the minimum frame countdown AND the ditty to finish.
      // If audio never starts (autoplay blocked, file missing), the countdown
      // alone will end the battle via POST_BATTLE_PAUSE_FRAMES.
      if (explosionsFinished && bs.pendingEnd.dittyStarted && bs.pendingEnd.countdown <= 0 && !isVictoryDittyPlaying()) {
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
          if (bs.shipTypes[w] === 'chmmr') {
            ws.chmmrSatellitesSpawned = bs.ships[w].chmmrSatellitesSpawned ?? true;
          }
          // Carry over live winner-owned companion missiles that persist across rounds.
          const persistedWinnerMissiles = bs.missiles.filter(
            m => m.owner === w && (m.weaponType === 'fighter' || m.weaponType === 'chmmr_satellite'),
          );
          if (persistedWinnerMissiles.length > 0) {
            ws.persistedMissiles = persistedWinnerMissiles.map(m => ({ ...m }));
          }
        }
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        void stopVictoryDitty();
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
        orzBoardSlots: bs.ships[0].orzBoardSlots ?? [],
        orzBoardDamageFlash: bs.ships[0].orzBoardDamageFlash ?? [],
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
        orzBoardSlots: bs.ships[1].orzBoardSlots ?? [],
        orzBoardDamageFlash: bs.ships[1].orzBoardDamageFlash ?? [],
        inputs:     i1,
        captainIdx: captainIdxRef.current[1],
      },
    ];
  }

  function simulateFrame(bs: BattleState, input0: number, input1: number) {
    bs.lasers = []; // clear previous frame's laser flashes
    bs.tractorShadows = [];

    for (const ship of bs.ships) {
      if (!ship.orzBoardDamageFlash) continue;
      for (let i = 0; i < ship.orzBoardDamageFlash.length; i++) {
        if ((ship.orzBoardDamageFlash[i] ?? 0) > 0) ship.orzBoardDamageFlash[i]!--;
      }
    }

    if ((bs.ships[0].melnormeConfusionFrames ?? 0) > 0) {
      bs.ships[0].melnormeConfusionFrames!--;
      input0 = (input0 & ~(INPUT_LEFT | INPUT_RIGHT | INPUT_FIRE2)) | (bs.ships[0].melnormeConfusionInput ?? 0);
    }
    if ((bs.ships[1].melnormeConfusionFrames ?? 0) > 0) {
      bs.ships[1].melnormeConfusionFrames!--;
      input1 = (input1 & ~(INPUT_LEFT | INPUT_RIGHT | INPUT_FIRE2)) | (bs.ships[1].melnormeConfusionInput ?? 0);
    }

    // Apply gravity to ships still actively flying around the arena.
    if (bs.shipDestructions[0] === null && bs.ships[0].crew > 0 && !SHIP_REGISTRY[bs.shipTypes[0]].isIntangible?.(bs.ships[0])) {
      applyGravity(bs.ships[0], PLANET_X, PLANET_Y, GRAVITY_THRESHOLD_W);
    }
    if (bs.shipDestructions[1] === null && bs.ships[1].crew > 0 && !SHIP_REGISTRY[bs.shipTypes[1]].isIntangible?.(bs.ships[1])) {
      applyGravity(bs.ships[1], PLANET_X, PLANET_Y, GRAVITY_THRESHOLD_W);
    }

    // Decrement warp-in countdown (ship is invisible and nonsolid during this)
    if (bs.warpIn[0] > 0) bs.warpIn[0]--;
    if (bs.warpIn[1] > 0) bs.warpIn[1]--;
    if (bs.rebirth[0] > 0) bs.rebirth[0]--;
    if (bs.rebirth[1] > 0) bs.rebirth[1]--;

    // Update ships — dispatch through registry.
    // Ships still warping in cannot act (no weapons, no steering).
    const updateShip = (ship: ShipState, input: number, type: ShipId, inactive: boolean): SpawnRequest[] => {
      if (inactive || ship.crew <= 0) return [];
      return SHIP_REGISTRY[type].update(ship, input);
    };
    const preShip0 = { facing: bs.ships[0].facing, vx: bs.ships[0].velocity.vx, vy: bs.ships[0].velocity.vy };
    const preShip1 = { facing: bs.ships[1].facing, vx: bs.ships[1].velocity.vx, vy: bs.ships[1].velocity.vy };
    const inactive0 = bs.warpIn[0] > 0 || bs.rebirth[0] > 0 || bs.shipDestructions[0] !== null;
    const inactive1 = bs.warpIn[1] > 0 || bs.rebirth[1] > 0 || bs.shipDestructions[1] !== null;
    const spawns0 = updateShip(bs.ships[0], input0, bs.shipTypes[0], inactive0);
    const spawns1 = updateShip(bs.ships[1], input1, bs.shipTypes[1], inactive1);
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
          orzSeed: s.orzSeed,
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
          orbitDir: s.orbitDir,
        });
      }
    };
    const addLaser = (l: LaserFlash) => bs.lasers.push(l);
    const addTractorShadow = (shadow: BattleState['tractorShadows'][number]) => bs.tractorShadows.push(shadow);
    const damageMissile = (m: BattleMissile, damage: number): boolean => {
      if (!applyDirectMissileDamage(bs, m, damage)) return false;
      const idx = bs.missiles.indexOf(m);
      if (idx !== -1) bs.missiles.splice(idx, 1);
      return true;
    };
    let launchSoundPlayed0 = false;
    let gasSoundPlayed0 = false;
    let missileSoundPlayed0 = false;
    for (const s of spawns0) {
      spawnRequest(s, 0);
      // Immediate weapon effects owned by each ship's controller
      SHIP_REGISTRY[bs.shipTypes[0]].applySpawn?.(
        s,
        bs.ships[0],
        bs.ships[1],
        0,
        bs.missiles,
        addLaser,
        addTractorShadow,
        damageMissile,
        sound => sound === 'primary' ? playPrimary(bs.shipTypes[0]) : playSecondary(bs.shipTypes[0]),
        bs.shipTypes[1],
        pod => bs.crewPods.push(pod),
      );
      // Sound dispatch (keyed on spawn type, independent of ship identity)
      if (s.type === 'sound') {
        playSpawnSound(bs.shipTypes[0], s.sound);
      }
      else
      if (s.type === 'missile') {
        if (bs.shipTypes[0] !== 'pkunk' && bs.shipTypes[0] !== 'mmrnmhrm' && bs.shipTypes[0] !== 'utwig' && s.weaponType !== 'chmmr_satellite') {
          if (s.weaponType === 'orz_marine') continue;
          if (s.weaponType === 'thraddash_napalm') continue;
          if (bs.shipTypes[0] === 'yehat' && missileSoundPlayed0) continue;
          s.limpet ? playSecondary(bs.shipTypes[0]) : playPrimary(bs.shipTypes[0]);
          missileSoundPlayed0 = true;
        }
      }
      else if (s.type === 'buzzsaw')   playPrimary(bs.shipTypes[0]);
      else if (s.type === 'gas_cloud' && !gasSoundPlayed0) { playSecondary(bs.shipTypes[0]); gasSoundPlayed0 = true; }
      else if (s.type === 'vux_laser') playPrimary(bs.shipTypes[0]);
      else if (s.type === 'chmmr_laser') playPrimary(bs.shipTypes[0]);
      else if (s.type === 'chmmr_tractor') playSecondary(bs.shipTypes[0]);
      else if (s.type === 'fighter' && !launchSoundPlayed0) { playFighterLaunch(); launchSoundPlayed0 = true; }
    }
    let launchSoundPlayed1 = false;
    let gasSoundPlayed1 = false;
    let missileSoundPlayed1 = false;
    for (const s of spawns1) {
      spawnRequest(s, 1);
      SHIP_REGISTRY[bs.shipTypes[1]].applySpawn?.(
        s,
        bs.ships[1],
        bs.ships[0],
        1,
        bs.missiles,
        addLaser,
        addTractorShadow,
        damageMissile,
        sound => sound === 'primary' ? playPrimary(bs.shipTypes[1]) : playSecondary(bs.shipTypes[1]),
        bs.shipTypes[0],
        pod => bs.crewPods.push(pod),
      );
      if (s.type === 'sound') {
        playSpawnSound(bs.shipTypes[1], s.sound);
      }
      else
      if (s.type === 'missile') {
        if (bs.shipTypes[1] !== 'pkunk' && bs.shipTypes[1] !== 'mmrnmhrm' && bs.shipTypes[1] !== 'utwig' && s.weaponType !== 'chmmr_satellite') {
          if (s.weaponType === 'orz_marine') continue;
          if (s.weaponType === 'thraddash_napalm') continue;
          if (bs.shipTypes[1] === 'yehat' && missileSoundPlayed1) continue;
          s.limpet ? playSecondary(bs.shipTypes[1]) : playPrimary(bs.shipTypes[1]);
          missileSoundPlayed1 = true;
        }
      }
      else if (s.type === 'buzzsaw')   playPrimary(bs.shipTypes[1]);
      else if (s.type === 'gas_cloud' && !gasSoundPlayed1) { playSecondary(bs.shipTypes[1]); gasSoundPlayed1 = true; }
      else if (s.type === 'vux_laser') playPrimary(bs.shipTypes[1]);
      else if (s.type === 'chmmr_laser') playPrimary(bs.shipTypes[1]);
      else if (s.type === 'chmmr_tractor') playSecondary(bs.shipTypes[1]);
      else if (s.type === 'fighter' && !launchSoundPlayed1) { playFighterLaunch(); launchSoundPlayed1 = true; }
    }

    processMissiles(bs, shipSpritesRef.current, input0, input1, PLANET_X, PLANET_Y, PLANET_RADIUS_W, WORLD_W, WORLD_H);
    updateCrewPods(bs, bs.warpIn, WORLD_W, WORLD_H);

    // Advance cosmetic explosions (advance 1 frame per sim tick, remove when done)
    bs.explosions = advanceExplosions(bs.explosions, WORLD_W, WORLD_H);

    // Ship–ship collision (skip if either ship is still warping in)
    handleShipShipCollision(
      bs.ships,
      [
        bs.warpIn[0] + (bs.rebirth[0] > 0 ? 1 : 0) + (bs.shipDestructions[0] !== null || bs.ships[0].crew <= 0 ? 1 : 0),
        bs.warpIn[1] + (bs.rebirth[1] > 0 ? 1 : 0) + (bs.shipDestructions[1] !== null || bs.ships[1].crew <= 0 ? 1 : 0),
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
      [
        bs.rebirth[0] > 0 || bs.shipDestructions[0] !== null || bs.ships[0].crew <= 0,
        bs.rebirth[1] > 0 || bs.shipDestructions[1] !== null || bs.ships[1].crew <= 0,
      ],
    );

    for (let side = 0 as 0 | 1; side < 2; side++) {
      SHIP_REGISTRY[bs.shipTypes[side]].postUpdateShip?.(bs.ships[side]);
    }

    // Start the UQM-style destruction sequence when a ship transitions alive→dead.
    for (let side = 0; side < 2; side++) {
      const alive = bs.ships[side].crew > 0;
      if (bs.shipAlive[side] && !alive) {
        bs.shipDestructions[side] = beginShipDestruction(bs.ships[side].x, bs.ships[side].y);
        bs.ships[side].velocity.vx = 0;
        bs.ships[side].velocity.vy = 0;
        bs.ships[side].velocity.ex = 0;
        bs.ships[side].velocity.ey = 0;
        bs.ships[side].thrusting = false;
        playShipDies();
      }
      bs.shipAlive[side] = alive;
    }

    const visualRand = visualRngRef.current;
    if (visualRand) {
      bs.shipDestructions[0] = advanceShipDestruction(bs.shipDestructions[0], bs.explosions, (n) => visualRand.rand(n), WORLD_W, WORLD_H);
      bs.shipDestructions[1] = advanceShipDestruction(bs.shipDestructions[1], bs.explosions, (n) => visualRand.rand(n), WORLD_W, WORLD_H);
    }

    // Update ion trail dots (cosmetic thruster exhaust; not checksummed).
    // Colors cycle from orange → red → dark red per UQM cycle_ion_trail.
    updateIonTrails(bs.ionTrails, bs.ships, bs.warpIn, bs.shipTypes);
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
    reductionRef.current = calcReduction(bs.ships, reductionRef.current, SPACE_CANVAS_W, MAX_REDUCTION, WORLD_W, WORLD_H);
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
      if (d < 0 && d + wdw <= SPACE_CANVAS_W) d += wdw;
      else if (d > SPACE_CANVAS_W && d - wdw >= 0) d -= wdw;
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
    const camX = midX - (SPACE_CANVAS_W << (1 + r));
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
      const cloakedShips: Array<{ ship: ShipState; frame: SpriteFrame | null; radiusSq: number }> = [];
      for (let side = 0 as 0 | 1; side < 2; side++) {
        const ship = bs.ships[side];
        if (bs.shipTypes[side] !== 'ilwrath' || !ship.ilwrathCloaked) continue;
        const ctrl = SHIP_REGISTRY[bs.shipTypes[side]];
        const frame = ctrl.getShipCollisionFrame?.(ship, shipSpritesRef.current.get(bs.shipTypes[side]) ?? null) ?? null;
        if (frame) {
          cloakedShips.push({ ship, frame, radiusSq: 0 });
          continue;
        }
        const radius = DISPLAY_TO_WORLD(ctrl.getCollisionRadius?.(ship) ?? getShipDef(bs.shipTypes[side])?.radius ?? 14);
        cloakedShips.push({ ship, frame: null, radiusSq: radius * radius });
      }
      for (let i = 0; i < total; i++) {
        if (cloakedShips.some(({ ship, frame, radiusSq }) => {
          const delta = worldDelta(stars[i].x, stars[i].y, ship.x, ship.y, WORLD_W, WORLD_H);
          if (frame) {
            return spriteMaskContainsWorldPoint(frame, ship.x, ship.y, stars[i].x, stars[i].y, WORLD_W, WORLD_H);
          }
          return delta.dx * delta.dx + delta.dy * delta.dy <= radiusSq;
        })) continue;
        let sx = (stars[i].x - camX) >> (2 + r);
        let sy = (stars[i].y - camY) >> (2 + r);
        // Wrap single step — world is always >= the visible battle viewport at any zoom
        if (sx < 0) sx += worldDW; else if (sx >= SPACE_CANVAS_W) sx -= worldDW;
        if (sy < 0) sy += worldDH; else if (sy >= CANVAS_H) sy -= worldDH;
        if (sx < 0 || sx >= SPACE_CANVAS_W || sy < 0 || sy >= CANVAS_H) continue;
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
      if (pDX > -planetR * 4 && pDX < SPACE_CANVAS_W + planetR * 4) {
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
      const dc: DrawContext = { ctx, camX, camY, canvasW: SPACE_CANVAS_W, canvasH: CANVAS_H, reduction: r, worldW: WORLD_W, worldH: WORLD_H };
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
    renderTractorShadows(
      ctx,
      bs.tractorShadows,
      bs.ships,
      bs.shipTypes,
      shipSpritesRef.current,
      { camX, camY, canvasW: SPACE_CANVAS_W, canvasH: CANVAS_H, reduction: r, worldW: WORLD_W, worldH: WORLD_H },
    );

    // ── Ion trails (thruster exhaust dots) ──────────────────────────────
    // UQM-style: small 1×1 dots cycling orange → red → dark red → gone.
    // Colors from UQM tactrans.c cycle_ion_trail colorTab (RGB15 values).
    renderIonTrails(ctx, bs.ionTrails, SPACE_CANVAS_W, CANVAS_H, tw2dx, tw2dy);
    renderCrewPods(ctx, bs.crewPods, SPACE_CANVAS_W, CANVAS_H, tw2dx, tw2dy);

    // ── Ships ────────────────────────────────────────────────────────────
    {
      const dc: DrawContext = { ctx, camX, camY, canvasW: SPACE_CANVAS_W, canvasH: CANVAS_H, reduction: r, worldW: WORLD_W, worldH: WORLD_H };
      for (let side = 0; side < 2; side++) {
        const ship = bs.ships[side];
        const destruction = bs.shipDestructions[side];

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
            { camX, camY, canvasW: SPACE_CANVAS_W, canvasH: CANVAS_H, reduction: r, worldW: WORLD_W, worldH: WORLD_H },
          );
          continue;
        }

        if ((ship.crew <= 0 && destruction === null) || !shouldRenderExplodingShip(destruction)) {
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
      SPACE_CANVAS_W,
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

  const handleResume = useCallback(() => {
    pausedRef.current = false;
    setIsPaused(false);
    lastTimeRef.current = performance.now();
    accumRef.current = 0;
  }, []);

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
          <PauseOverlay
            isLocal2P={isLocal2P}
            onResume={handleResume}
            onQuit={() => onBattleEnd(null)}
            onBindingsChanged={(controls: ControlsConfig) => {
              keyMapP1Ref.current  = buildKeyMap(controls.p1.bindings, INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2);
              keyMapP2Ref.current  = buildKeyMap(controls.p2.bindings, INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2);
              gamepadP1Ref.current = controls.p1.bindings.gamepadIndex;
              gamepadP2Ref.current = controls.p2.bindings.gamepadIndex;
              gameKeysRef.current  = new Set([...Object.keys(keyMapP1Ref.current), ...Object.keys(keyMapP2Ref.current)]);
            }}
          />
        )}
      </div>
    </div>
  );
}
