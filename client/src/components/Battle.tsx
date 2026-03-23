// Battle screen — canvas game loop with UQM physics and sprite rendering.
// Human (Earthling Cruiser) ship is fully implemented.
// Other ships fall back to a colored placeholder.

import { useEffect, useRef, useState } from 'react';
import type { FullRoomState, FleetSlot } from 'shared/types';
import { client } from '../net/client';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2, BATTLE_FPS } from '../engine/game';
import { COSINE, SINE } from '../engine/sinetab';
import { DISPLAY_TO_WORLD, WORLD_TO_DISPLAY } from '../engine/velocity';
import {
  makeHumanShip, updateHumanShip,
  makeNuke, updateNuke,
  MAX_CREW, MAX_ENERGY, SHIP_RADIUS, LASER_RANGE, MISSILE_DAMAGE,
  type HumanShipState, type NukeState,
} from '../engine/ships/human';
import { loadCruiserSprites, drawSprite, type SpriteSet } from '../engine/sprites';
import HUD from './HUD';

// ─── Constants ────────────────────────────────────────────────────────────────

// Display dimensions
const CANVAS_W = 640;
const CANVAS_H = 480;

// World dimensions (display * 4)
const WORLD_W = DISPLAY_TO_WORLD(CANVAS_W); // 2560
const WORLD_H = DISPLAY_TO_WORLD(CANVAS_H); // 1920

// Planet at world center
const PLANET_X = WORLD_W >> 1;
const PLANET_Y = WORLD_H >> 1;

// Gravity threshold in world units = 255 display pixels * 4
const GRAVITY_THRESHOLD_W = DISPLAY_TO_WORLD(255);

const FRAME_MS = 1000 / BATTLE_FPS;

// Keyboard → input bit maps, keyed by event.code (layout-independent).
// Bindings match the official UQM uqm.key defaults exactly.
//   P1 "Arrows": Up=thrust  Left/Right=turn  RightControl=weapon  RightShift=special
//   P2 "WASD":   W=thrust   A/D=turn         V=weapon             B=special
const KEY_MAP_P1: Record<string, number> = {
  ArrowUp:      INPUT_THRUST,
  ArrowLeft:    INPUT_LEFT,
  ArrowRight:   INPUT_RIGHT,
  ControlRight: INPUT_FIRE1,
  ShiftRight:   INPUT_FIRE2,
};

const KEY_MAP_P2: Record<string, number> = {
  KeyW: INPUT_THRUST,
  KeyA: INPUT_LEFT,
  KeyD: INPUT_RIGHT,
  KeyV: INPUT_FIRE1,
  KeyB: INPUT_FIRE2,
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

interface BattleState {
  ships: [HumanShipState, HumanShipState];
  nukes: BattleNuke[];
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
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const stateRef    = useRef<BattleState | null>(null);
  const keysRef     = useRef(new Set<string>());
  const rafRef      = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const accumRef    = useRef(0);
  const spritesRef  = useRef<{ big: SpriteSet; sml: SpriteSet; nuke: SpriteSet } | null>(null);
  const [hudData, setHudData] = useState({ myCrewPct: 1, oppCrewPct: 1, myEnergyPct: 1, oppEnergyPct: 1 });

  // Initialize battle state
  useEffect(() => {
    // Use seed to place ships on opposite sides of the world
    const s0: HumanShipState = makeHumanShip(PLANET_X - DISPLAY_TO_WORLD(120), PLANET_Y);
    const s1: HumanShipState = makeHumanShip(PLANET_X + DISPLAY_TO_WORLD(120), PLANET_Y);
    s1.facing = 8; // face the other direction

    stateRef.current = {
      ships: [s0, s1],
      nukes: [],
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

    // Ship–ship collision (simplified box check)
    const r = DISPLAY_TO_WORLD(SHIP_RADIUS);
    if (circleOverlap(bs.ships[0].x, bs.ships[0].y, r, bs.ships[1].x, bs.ships[1].y, r)) {
      // Bounce — swap a fraction of velocities (simplified)
      const [vx0, vy0] = [bs.ships[0].velocity.vx, bs.ships[0].velocity.vy];
      bs.ships[0].velocity.vx = bs.ships[1].velocity.vx;
      bs.ships[0].velocity.vy = bs.ships[1].velocity.vy;
      bs.ships[1].velocity.vx = vx0;
      bs.ships[1].velocity.vy = vy0;
      bs.ships[0].crew = Math.max(0, bs.ships[0].crew - 1);
      bs.ships[1].crew = Math.max(0, bs.ships[1].crew - 1);
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

    // Camera: center on midpoint between both ships
    const camX = Math.round((bs.ships[0].x + bs.ships[1].x) / 2) - DISPLAY_TO_WORLD(CANVAS_W / 2);
    const camY = Math.round((bs.ships[0].y + bs.ships[1].y) / 2) - DISPLAY_TO_WORLD(CANVAS_H / 2);

    // Background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Stars (tiled placeholder)
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    for (let i = 0; i < 80; i++) {
      const sx = ((i * 137 + (camX >> 3)) & 0xFFFF) % CANVAS_W;
      const sy = ((i * 251 + (camY >> 3)) & 0xFFFF) % CANVAS_H;
      ctx.fillRect(sx, sy, 1, 1);
    }

    // Planet (display coords — centered in world space)
    const planetDX = WORLD_TO_DISPLAY(PLANET_X - camX);
    const planetDY = WORLD_TO_DISPLAY(PLANET_Y - camY);
    if (planetDX > -60 && planetDX < CANVAS_W + 60) {
      ctx.beginPath();
      ctx.arc(planetDX, planetDY, 40, 0, Math.PI * 2);
      ctx.fillStyle = '#2a1a44';
      ctx.fill();
      ctx.strokeStyle = '#553388';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Nukes
    for (const nuke of bs.nukes) {
      if (sp) {
        drawSprite(ctx, sp.nuke, nuke.facing, nuke.x, nuke.y, CANVAS_W, CANVAS_H, camX, camY);
      } else {
        placeholderDot(ctx, nuke.x, nuke.y, camX, camY, 3, '#ff8');
      }
    }

    // Ships
    for (let side = 0; side < 2; side++) {
      const ship  = bs.ships[side];
      const color = side === 0 ? '#4af' : '#f84';
      if (sp) {
        drawSprite(ctx, sp.big, ship.facing, ship.x, ship.y, CANVAS_W, CANVAS_H, camX, camY);
      } else {
        placeholderDot(ctx, ship.x, ship.y, camX, camY, 8, color);
        // Draw facing indicator
        const angle = (ship.facing * 4) & 63;
        const dx = WORLD_TO_DISPLAY(ship.x - camX);
        const dy = WORLD_TO_DISPLAY(ship.y - camY);
        ctx.beginPath();
        ctx.moveTo(dx, dy);
        ctx.lineTo(
          dx + Math.cos((angle / 64) * 2 * Math.PI - Math.PI / 2) * 14,
          dy + Math.sin((angle / 64) * 2 * Math.PI - Math.PI / 2) * 14,
        );
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Thrust flame placeholder
      if (ship.thrusting) {
        const dx = WORLD_TO_DISPLAY(ship.x - camX);
        const dy = WORLD_TO_DISPLAY(ship.y - camY);
        const ang = ((ship.facing * 4 + 32) & 63) / 64 * 2 * Math.PI - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(dx + Math.cos(ang) * 10, dy + Math.sin(ang) * 10, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#f80';
        ctx.fill();
      }
    }

    // Frame counter
    ctx.fillStyle = 'rgba(100,100,120,0.6)';
    ctx.font = '10px monospace';
    ctx.fillText(`frame ${bs.frame}`, 4, 12);

    // Key reference (local2P only — shows for first 300 frames ~12s then fades)
    if (isLocal2P && bs.frame < 360) {
      const alpha = bs.frame < 240 ? 0.7 : 0.7 * (1 - (bs.frame - 240) / 120);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#4af';
      ctx.font = '10px monospace';
      ctx.fillText('P1: Arrows  RCtrl=fire  RShift=special', 4, CANVAS_H - 18);
      ctx.fillStyle = '#f84';
      ctx.fillText('P2: WASD    V=fire      B=special', 4, CANVAS_H - 6);
      ctx.globalAlpha = 1;
    }
  }

  // ─── HUD ─────────────────────────────────────────────────────────────────

  const myFleet  = (yourSide === 0 ? room.host.fleet : room.opponent?.fleet) ?? [];
  const oppFleet = (yourSide === 0 ? room.opponent?.fleet : room.host.fleet) ?? [];

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} style={{ display: 'block' }} />
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
  r: number, color: string,
) {
  const dx = WORLD_TO_DISPLAY(worldX - camX);
  const dy = WORLD_TO_DISPLAY(worldY - camY);
  ctx.beginPath();
  ctx.arc(dx, dy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
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
  // Point defense laser: destroys nukes within LASER_RANGE display pixels of the firing ship.
  const ship = bs.ships[side];
  const rangeW = DISPLAY_TO_WORLD(LASER_RANGE);
  bs.nukes = bs.nukes.filter(nuke => {
    const dx = nuke.x - ship.x;
    const dy = nuke.y - ship.y;
    return dx * dx + dy * dy > rangeW * rangeW;
  });
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
