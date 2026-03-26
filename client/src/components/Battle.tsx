// Battle screen — canvas game loop with UQM physics and sprite rendering.
// Human (Earthling Cruiser) ship is fully implemented.
// Other ships fall back to a colored placeholder.

import { useEffect, useRef, useState } from 'react';
import type { FullRoomState, FleetSlot } from 'shared/types';
import { client } from '../net/client';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2, BATTLE_FPS } from '../engine/game';
import { COSINE, SINE } from '../engine/sinetab';
import { DISPLAY_TO_WORLD } from '../engine/velocity';
import {
  makeHumanShip, updateHumanShip,
  makeNuke, updateNuke,
  MAX_CREW, MAX_ENERGY, SHIP_RADIUS, LASER_RANGE, MISSILE_DAMAGE,
  SPECIAL_ENERGY_COST, SPECIAL_WAIT,
  type HumanShipState, type NukeState,
} from '../engine/ships/human';
import { loadCruiserSprites, drawSprite, type CruiserSprites } from '../engine/sprites';
import HUD from './HUD';

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

// NukeState extended with owner so we know which ship to target
interface BattleNuke extends NukeState {
  owner: 0 | 1;
}

// One-frame laser line (point-defense flash), world coords
interface LaserFlash {
  x1: number; y1: number;
  x2: number; y2: number;
}

interface BattleState {
  ships: [HumanShipState, HumanShipState];
  nukes: BattleNuke[];
  lasers: LaserFlash[];  // cleared each sim frame; rendered as 1-frame flashes
  frame: number;
  // Input buffers: [myInputs, opponentInputs], indexed by frame number
  inputBuf: [Map<number, number>, Map<number, number>];
}

interface Props {
  room:        FullRoomState;
  yourSide:    0 | 1;
  seed:        number;
  inputDelay:  number;
  isAI?:       boolean;
  isLocal2P?:  boolean;
  onBattleEnd: (winner: 0 | 1 | null) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Battle({ room, yourSide, seed: _seed, inputDelay, isAI = false, isLocal2P = false, onBattleEnd }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const stateRef     = useRef<BattleState | null>(null);
  const keysRef      = useRef(new Set<string>());
  const rafRef       = useRef<number | null>(null);
  const lastTimeRef  = useRef(0);
  const accumRef     = useRef(0);
  const spritesRef   = useRef<CruiserSprites | null>(null);
  const reductionRef = useRef(0); // current zoom level 0–MAX_REDUCTION
  const [hudData, setHudData] = useState({ myCrewPct: 1, oppCrewPct: 1, myEnergyPct: 1, oppEnergyPct: 1 });
  // uiScale: ratio of physical display pixels to logical 640×480 game pixels.
  // Stored in a ref so the render loop always sees the current value without
  // needing to re-bind the tick/render closures on every resize.
  const uiScaleRef  = useRef(1);
  const [displaySize, setDisplaySize] = useState({ w: CANVAS_W, h: CANVAS_H });

  // Initialize battle state
  useEffect(() => {
    // Use seed to place ships on opposite sides of the world
    const s0: HumanShipState = makeHumanShip(PLANET_X - DISPLAY_TO_WORLD(300), PLANET_Y);
    const s1: HumanShipState = makeHumanShip(PLANET_X + DISPLAY_TO_WORLD(300), PLANET_Y);
    s1.facing = 8; // face the other direction

    stateRef.current = {
      ships: [s0, s1],
      nukes: [],
      lasers: [],
      frame: 0,
      inputBuf: [new Map(), new Map()],
    };

    // Load sprites (non-blocking; canvas falls back to placeholder if unavailable)
    loadCruiserSprites().then(sp => { spritesRef.current = sp; }).catch(() => {});

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
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        onBattleEnd(msg.winner);
      } else if (msg.type === 'checksum_mismatch') {
        console.error(`Desync at frame ${msg.frame}`);
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
      const aiInput = computeAIInput(bs.ships[opSide], bs.ships[mySide], bs.nukes, opSide);
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

    // Checksums / battle-over (only in networked mode)
    const isOffline = isAI || isLocal2P;
    if (!isOffline) {
      client.send({ type: 'checksum', frame: bs.frame, crc: computeChecksum(bs) });
    }

    // In offline modes handle battle end locally
    if (isOffline && (bs.ships[0].crew <= 0 || bs.ships[1].crew <= 0)) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const winner: 0 | 1 | null =
        bs.ships[0].crew <= 0 && bs.ships[1].crew <= 0 ? null
        : bs.ships[0].crew <= 0 ? 1
        : 0;
      onBattleEnd(winner);
      return;
    }

    // Update HUD
    setHudData({
      myCrewPct:    bs.ships[mySide].crew    / MAX_CREW,
      oppCrewPct:   bs.ships[opSide].crew    / MAX_CREW,
      myEnergyPct:  bs.ships[mySide].energy  / MAX_ENERGY,
      oppEnergyPct: bs.ships[opSide].energy  / MAX_ENERGY,
    });
  }

  function simulateFrame(bs: BattleState, input0: number, input1: number) {
    bs.lasers = []; // clear previous frame's laser flashes

    // Apply gravity to both ships
    applyGravity(bs.ships[0]);
    applyGravity(bs.ships[1]);

    // Update ships
    const spawns0 = updateHumanShip(bs.ships[0], input0);
    const spawns1 = updateHumanShip(bs.ships[1], input1);

    // Wrap positions
    bs.ships[0].x = ((bs.ships[0].x % WORLD_W) + WORLD_W) % WORLD_W;
    bs.ships[0].y = ((bs.ships[0].y % WORLD_H) + WORLD_H) % WORLD_H;
    bs.ships[1].x = ((bs.ships[1].x % WORLD_W) + WORLD_W) % WORLD_W;
    bs.ships[1].y = ((bs.ships[1].y % WORLD_H) + WORLD_H) % WORLD_H;

    // Spawn nukes — track owner so each nuke targets the opposite ship
    for (const s of spawns0) {
      if (s.type === 'nuke') bs.nukes.push({ ...makeNuke(s.x, s.y, s.facing), owner: 0 });
      if (s.type === 'point_defense') applyPointDefense(bs, 0);
    }
    for (const s of spawns1) {
      if (s.type === 'nuke') bs.nukes.push({ ...makeNuke(s.x, s.y, s.facing), owner: 1 });
      if (s.type === 'point_defense') applyPointDefense(bs, 1);
    }

    // Update nukes — track toward the opposite ship
    const alive: BattleNuke[] = [];
    for (const nuke of bs.nukes) {
      const targetShip = bs.ships[nuke.owner === 0 ? 1 : 0];
      const targetAngle = worldAngle(nuke.x, nuke.y, targetShip.x, targetShip.y);
      const still = updateNuke(nuke, targetAngle);
      if (!still) continue;

      // Wrap nuke position
      nuke.x = ((nuke.x % WORLD_W) + WORLD_W) % WORLD_W;
      nuke.y = ((nuke.y % WORLD_H) + WORLD_H) % WORLD_H;

      // Collision with ships
      let hit = false;
      for (let side = 0; side < 2; side++) {
        const ship = bs.ships[side];
        if (circleOverlap(nuke.x, nuke.y, 4, ship.x, ship.y, DISPLAY_TO_WORLD(SHIP_RADIUS))) {
          ship.crew = Math.max(0, ship.crew - MISSILE_DAMAGE);
          hit = true;
        }
      }
      if (!hit) alive.push(nuke as BattleNuke);
    }
    bs.nukes = alive;

    // Ship–ship collision
    {
      const r = DISPLAY_TO_WORLD(SHIP_RADIUS);
      const dx = bs.ships[1].x - bs.ships[0].x;
      const dy = bs.ships[1].y - bs.ships[0].y;
      const distSq = dx * dx + dy * dy;
      const minDist = r + r;
      if (distSq < minDist * minDist && distSq > 0) {
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

    // Check for battle end — only send ack in networked mode
    // (offline modes detect end in advance() above)
    if (!isAI && !isLocal2P && (bs.ships[0].crew <= 0 || bs.ships[1].crew <= 0)) {
      client.send({ type: 'battle_over_ack' });
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

    // ── Stars: TODO ──────────────────────────────────────────────────────
    // The UQM star tile PNGs have the space background color baked in as
    // opaque pixels — no compositing mode can strip a colored opaque
    // background without per-pixel processing. Skipping for now; see
    // docs/rendering.md for the full analysis. Background stays black.
    // Options for proper implementation:
    //   a) Per-pixel: getImageData, replace near-background pixels → black
    //   b) Procedural: seeded RNG to scatter white dots with parallax

    // ── Planet ───────────────────────────────────────────────────────────
    const planetDX = w2d(PLANET_X - camX);
    const planetDY = w2d(PLANET_Y - camY);
    const planetR  = Math.max(2, PLANET_RADIUS_W >> (2 + r));
    if (planetDX > -planetR * 2 && planetDX < CANVAS_W + planetR * 2) {
      ctx.beginPath();
      ctx.arc(planetDX, planetDY, planetR, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a1a';
      ctx.fill();
      ctx.strokeStyle = '#444';
      ctx.lineWidth = Math.max(1, 2 >> r);
      ctx.stroke();
    }

    // ── Nukes ────────────────────────────────────────────────────────────
    const nukeSet = sp ? (r >= 2 ? sp.nuke.sml : r === 1 ? sp.nuke.med : sp.nuke.big) : null;
    for (const nuke of bs.nukes) {
      if (nukeSet) {
        drawSprite(ctx, nukeSet, nuke.facing, nuke.x, nuke.y, CANVAS_W, CANVAS_H, camX, camY, r);
      } else {
        placeholderDot(ctx, nuke.x, nuke.y, camX, camY, 3, '#ff8', r);
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

    // ── Ships ────────────────────────────────────────────────────────────
    // Select sprite size matching zoom level. UQM uses pre-rendered big/med/sml.
    //   r=0 → big, r=1 → med, r=2–3 → sml
    const shipSet = sp ? (r >= 2 ? sp.sml : r === 1 ? sp.med : sp.big) : null;
    for (let side = 0; side < 2; side++) {
      const ship  = bs.ships[side];
      const color = side === 0 ? '#4af' : '#f84';
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

      // Thrust flame placeholder
      if (ship.thrusting) {
        const sdx = w2d(ship.x - camX);
        const sdy = w2d(ship.y - camY);
        const ang = ((ship.facing * 4 + 32) & 63) / 64 * 2 * Math.PI - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(sdx + Math.cos(ang) * 10, sdy + Math.sin(ang) * 10, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#f80';
        ctx.fill();
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
  const dx = toX - fromX;
  const dy = toY - fromY;
  // UQM angle: 0 = North/up, clockwise. atan2 returns radians where 0=East, counter-clockwise.
  // Convert: UQM_angle = (-atan2(dx, dy) * 64 / (2π)) & 63
  const rad = Math.atan2(dx, -dy); // 0 = North
  return ((Math.round(rad * 64 / (2 * Math.PI)) & 63) + 64) & 63;
}

/**
 * Simple AI based on UQM human_intelligence behavior:
 * 1. Turn toward enemy
 * 2. Thrust when roughly facing enemy or when far away
 * 3. Fire nuke when well-aligned
 * 4. Fire point defense when enemy nuke is close
 */
function computeAIInput(ai: HumanShipState, target: HumanShipState, nukes: BattleNuke[], aiSide: 0 | 1): number {
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
  bs.nukes = bs.nukes.filter(nuke => {
    if (nuke.owner === side) return true; // never fire at own missiles
    const dx = nuke.x - ship.x;
    const dy = nuke.y - ship.y;
    if (dx * dx + dy * dy <= rangeWSq) {
      payOnce();
      bs.lasers.push({ x1: ship.x, y1: ship.y, x2: nuke.x, y2: nuke.y });
      return false; // nuke destroyed
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

function computeChecksum(bs: BattleState): number {
  let crc = bs.frame;
  for (const ship of bs.ships) {
    crc ^= (ship.x & 0xFFFF) ^ ((ship.y & 0xFFFF) << 8);
    crc ^= (ship.velocity.vx & 0xFF) ^ ((ship.velocity.vy & 0xFF) << 8);
    crc ^= ship.crew ^ (ship.energy << 8);
    crc = crc >>> 0;
  }
  return crc;
}
