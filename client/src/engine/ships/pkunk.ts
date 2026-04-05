// Pkunk Fury — ported from uqm-0.8.0/src/uqm/ships/pkunk/pkunk.c
//
// Primary (FIRES_FORE | FIRES_LEFT | FIRES_RIGHT): Triple bug-gun burst
// Special: Taunt (regains 2 energy and plays the next insult clip)
// Passive: Resurrection — 50% chance to respawn with full stats on death

import {
  WORLD_TO_VELOCITY, VELOCITY_TO_WORLD, DISPLAY_TO_WORLD,
  setVelocityVector,
  setVelocityComponents, getCurrentVelocityComponents,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2 } from '../game';
import { loadPkunkSprites, drawSprite, placeholderDot, type PkunkSprites, type SpriteFrame } from '../sprites';
import type { ShipState, SpawnRequest, BattleMissile, DrawContext, ShipController } from './types';
import type { AIDifficulty } from 'shared/types';
import { worldAngle, worldDelta } from '../battle/helpers';

// ─── Constants (from pkunk.c) ─────────────────────────────────────────────────

export const PKUNK_MAX_CREW            = 8;
export const PKUNK_MAX_ENERGY          = 12;
export const PKUNK_ENERGY_REGENERATION = 0;  // NO regen
export const PKUNK_MAX_THRUST          = 64;
export const PKUNK_THRUST_INCREMENT    = 16;
export const PKUNK_THRUST_WAIT         = 0;  // instant thrust
export const PKUNK_TURN_WAIT           = 0;  // instant turn
export const PKUNK_SHIP_MASS           = 1;

// Triple bug-gun (primary)
export const PKUNK_WEAPON_ENERGY_COST = 1;
export const PKUNK_WEAPON_WAIT        = 0;   // fires every frame while held
export const PKUNK_OFFSET             = DISPLAY_TO_WORLD(15); // 60 world units
export const PKUNK_MISSILE_SPEED      = DISPLAY_TO_WORLD(24); // 96 world units
export const PKUNK_MISSILE_LIFE       = 5;
export const PKUNK_MISSILE_HITS       = 1;
export const PKUNK_MISSILE_DAMAGE     = 1;

// Taunt
export const PKUNK_SPECIAL_ENERGY_GAIN = 2;
export const PKUNK_SPECIAL_WAIT        = 16;

export const PKUNK_REBIRTH_LIFE        = 12;

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(PKUNK_MAX_THRUST) ** 2;

// canResurrect lives on ShipState (optional field) — no extension type needed.
export type PkunkShipState = ShipState; // backward-compat alias

export function makePkunkShip(x: number, y: number, rng: () => number): ShipState {
  return {
    x, y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew:   PKUNK_MAX_CREW,
    energy: PKUNK_MAX_ENERGY,
    thrustWait:  0,
    turnWait:    0,
    weaponWait:  0,
    specialWait: 0,
    energyWait:  0,
    thrusting: false,
    canResurrect: rng() < 0.5, // 50% chance, rolled at spawn
  };
}

// ─── Per-frame update ─────────────────────────────────────────────────────────

export function updatePkunkShip(
  ship: ShipState,
  input: number,
): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  // ─── Turning (TURN_WAIT = 0, instant) ────────────────────────────────────
  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing - 1 + 16) % 16;
      ship.turnWait = PKUNK_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) % 16;
      ship.turnWait = PKUNK_TURN_WAIT;
    }
  }

  // ─── Thrust (THRUST_WAIT = 0, instant) ───────────────────────────────────
  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = PKUNK_THRUST_WAIT;

    const angle = (ship.facing * 4) & 63;
    const incV  = WORLD_TO_VELOCITY(PKUNK_THRUST_INCREMENT);
    const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
    const newDx = curDx + COSINE(angle, incV);
    const newDy = curDy + SINE(angle, incV);
    const desiredSpeedSq = newDx * newDx + newDy * newDy;

    if (desiredSpeedSq <= MAX_SPEED_SQ) {
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else {
      if (ship.velocity.travelAngle === angle) {
        setVelocityVector(ship.velocity, PKUNK_MAX_THRUST, ship.facing);
      } else {
        setVelocityComponents(ship.velocity, newDx, newDy);
        const { vx, vy } = ship.velocity;
        const spd = Math.sqrt(vx * vx + vy * vy);
        if (spd > 0) {
          const scale = WORLD_TO_VELOCITY(PKUNK_MAX_THRUST) / spd;
          setVelocityComponents(ship.velocity, vx * scale, vy * scale);
        }
      }
    }
  }

  // ─── Position advance ─────────────────────────────────────────────────────
  {
    const fracX = Math.abs(ship.velocity.vx) & 31;
    ship.velocity.ex += fracX;
    const carryX = ship.velocity.ex >= 32 ? 1 : 0;
    ship.velocity.ex &= 31;
    ship.x += VELOCITY_TO_WORLD(Math.abs(ship.velocity.vx)) * Math.sign(ship.velocity.vx)
              + (ship.velocity.vx >= 0 ? carryX : -carryX);

    const fracY = Math.abs(ship.velocity.vy) & 31;
    ship.velocity.ey += fracY;
    const carryY = ship.velocity.ey >= 32 ? 1 : 0;
    ship.velocity.ey &= 31;
    ship.y += VELOCITY_TO_WORLD(Math.abs(ship.velocity.vy)) * Math.sign(ship.velocity.vy)
              + (ship.velocity.vy >= 0 ? carryY : -carryY);
  }

  // No energy regeneration for Pkunk (ENERGY_REGENERATION = 0)

  // ─── Primary: Triple bug-gun ──────────────────────────────────────────────
  // Fires 3 missiles: forward, +90° (right), -90° (left)
  // Each missile inherits ship velocity (inheritVelocity: true)
  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if ((input & INPUT_FIRE1) && ship.energy >= PKUNK_WEAPON_ENERGY_COST) {
    ship.energy -= PKUNK_WEAPON_ENERGY_COST;
    ship.weaponWait = PKUNK_WEAPON_WAIT;
    spawns.push({ type: 'sound', sound: 'primary' });

    // Three facings: forward (0), right (+4), left (+12)
    const facingOffsets = [0, 4, 12] as const;
    for (const offset of facingOffsets) {
      const face = (ship.facing + offset) & 15;
      const angle = (face * 4) & 63;
      spawns.push({
        type: 'missile',
        x: ship.x + COSINE(angle, PKUNK_OFFSET),
        y: ship.y + SINE(angle, PKUNK_OFFSET),
        facing: face,
        speed:    PKUNK_MISSILE_SPEED,
        maxSpeed: PKUNK_MISSILE_SPEED,
        accel:    0,
        life:     PKUNK_MISSILE_LIFE,
        hits:     PKUNK_MISSILE_HITS,
        damage:   PKUNK_MISSILE_DAMAGE,
        tracks:   false,
        trackRate: 0,
        inheritVelocity: true,
        preserveVelocity: true,
      });
    }
  }

  // ─── Special: Taunt ───────────────────────────────────────────────────────
  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2) && ship.energy < PKUNK_MAX_ENERGY) {
    ship.energy = Math.min(PKUNK_MAX_ENERGY, ship.energy + PKUNK_SPECIAL_ENERGY_GAIN);
    ship.specialWait = PKUNK_SPECIAL_WAIT;
    spawns.push({ type: 'sound', sound: 'secondary' });
  }

  return spawns;
}

// ─── Ship controller ─────────────────────────────────────────────────────────

export const pkunkController: ShipController = {
  maxCrew:   PKUNK_MAX_CREW,
  maxEnergy: PKUNK_MAX_ENERGY,

  make(x: number, y: number, rng?: () => number): ShipState {
    return makePkunkShip(x, y, rng ?? (() => Math.random()));
  },

  update: updatePkunkShip,

  loadSprites: () => loadPkunkSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as PkunkSprites | null;
    const set = sp
      ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
    } else {
      placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, '#4af', dc.reduction);
    }
  },

  getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
    const sp = sprites as PkunkSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as PkunkSprites | null;
    const group = sp ? sp.bug : null;
    const set = group
      ? (dc.reduction >= 2 ? group.sml : dc.reduction === 1 ? group.med : group.big)
      : null;
    if (set) {
      // Bug sprite has only 1 frame — frame 0 for all facings
      drawSprite(dc.ctx, set, 0, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 3, '#ff8', dc.reduction);
    }
  },

  getMissileCollisionFrame(_m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as PkunkSprites | null;
    return sp?.bug.big.frames[0] ?? null;
  },

  onDeath(ship: ShipState, rand: (n: number) => number): boolean {
    if (!ship.canResurrect) return false;
    // Each new Pkunk life gets its own fresh 50% reincarnation roll.
    ship.canResurrect = rand(2) === 0;
    ship.crew    = PKUNK_MAX_CREW;
    ship.energy  = PKUNK_MAX_ENERGY;
    ship.x       = rand(20480); // WORLD_W
    ship.y       = rand(15360); // WORLD_H
    ship.velocity = { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 };
    ship.facing  = rand(16);
    ship.thrustWait = 0;
    ship.turnWait = 0;
    ship.weaponWait = 0;
    ship.specialWait = 0;
    ship.energyWait = 0;
    ship.thrusting = false;
    ship.limpetCount = 0;
    return true;
  },

  computeAIInput(ship: ShipState, target: ShipState, _missiles: BattleMissile[], _aiSide: 0 | 1, aiLevel: AIDifficulty): number {
    let input = INPUT_THRUST;
    const targetAngle = worldAngle(ship.x, ship.y, target.x, target.y);
    const targetFacing = ((targetAngle + 2) >> 2) & 15;
    const diff = (targetFacing - ship.facing + 16) % 16;
    if (diff >= 1 && diff <= 8) input |= INPUT_RIGHT;
    else if (diff > 8) input |= INPUT_LEFT;

    const { dx, dy } = worldDelta(ship.x, ship.y, target.x, target.y);
    const distanceSq = dx * dx + dy * dy;
    const fireWindow = aiLevel === 'cyborg_weak' ? 1 : 2;
    if (distanceSq <= DISPLAY_TO_WORLD(140) ** 2 && (diff <= fireWindow || diff >= 16 - fireWindow)) {
      input |= INPUT_FIRE1;
    }

    if (ship.energy < PKUNK_MAX_ENERGY && ship.specialWait === 0) {
      const tauntChance = aiLevel === 'cyborg_awesome' ? 0.1 : aiLevel === 'cyborg_good' ? 0.2 : 0.35;
      const shouldTaunt = ship.energy <= (aiLevel === 'cyborg_weak' ? 8 : 10) && ((ship.x + ship.y + ship.energy + ship.crew) % 10) / 10 < tauntChance;
      if (shouldTaunt || ship.energy <= 3) input |= INPUT_FIRE2;
    }

    return input;
  },
};
