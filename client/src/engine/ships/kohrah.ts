// Kohr-Ah Mauler — ported from uqm-0.8.0/src/uqm/ships/blackurq/blackurq.c
//
// Primary (FIRES_FORE): Buzzsaw — spinning disk projectiles that move while
//   fire is held, then home to enemies when released
// Special (SEEKING_SPECIAL): F.R.I.E.D. — ring of 16 fireballs expanding outward

import {
  WORLD_TO_VELOCITY, VELOCITY_TO_WORLD, DISPLAY_TO_WORLD,
  setVelocityVector, setVelocityComponents, getCurrentVelocityComponents,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2 } from '../game';
import { loadKohrahSprites, drawSprite, placeholderDot, type KohrahSprites, type SpriteFrame } from '../sprites';
import type { ShipState, SpawnRequest, BattleMissile, DrawContext, ShipController, MissileEffect, MissileHitEffect } from './types';
import { worldAngle as battleWorldAngle, worldDelta } from '../battle/helpers';
import type { AIDifficulty } from 'shared/types';

export type { ShipState as HumanShipState };

// ─── Ship constants (from blackurq.c) ──────────────────────────────────────────

export const KOHRAH_MAX_CREW            = 42;
export const KOHRAH_MAX_ENERGY          = 42;
export const KOHRAH_ENERGY_REGENERATION = 1;
export const KOHRAH_ENERGY_WAIT         = 4;
export const KOHRAH_MAX_THRUST          = 30;
export const KOHRAH_THRUST_INCREMENT    = 6;
export const KOHRAH_THRUST_WAIT         = 6;
export const KOHRAH_TURN_WAIT           = 4;
export const KOHRAH_SHIP_MASS           = 10;

// Buzzsaw (primary)
export const BUZZSAW_ENERGY_COST = 6;
export const BUZZSAW_WAIT        = 6;
export const BUZZSAW_SPEED       = 64;  // world units — raw value from UQM, NOT display pixels
export const BUZZSAW_LIFE        = 64;       // frames while button held
export const BUZZSAW_HITS        = 10;       // HP
export const BUZZSAW_DAMAGE      = 4;
export const MAX_BUZZSAWS        = 8;
export const BUZZSAW_OFFSET      = DISPLAY_TO_WORLD(28);   // spawn offset from ship (pixoffs)
export const ACTIVATE_RANGE      = 224;                     // display pixels — UQM checks WORLD_TO_DISPLAY(delta) vs this
export const BUZZSAW_TRACK_WAIT  = 4;                       // frames between homing nudges (TRACK_WAIT)
export const BUZZSAW_TRACK_SPEED = DISPLAY_TO_WORLD(2);     // very slow homing speed (UQM: DISPLAY_TO_WORLD(2) = 8 world units)

// F.R.I.E.D. (special)
export const FRIED_ENERGY_COST   = KOHRAH_MAX_ENERGY / 2; // 10
export const FRIED_WAIT          = 9;
export const GAS_SPEED           = 16;  // world units — raw value from UQM, NOT display pixels
export const GAS_DAMAGE          = 3;
export const GAS_HITS            = 100;
export const NUM_GAS_CLOUDS      = 16;       // ring of 16 fireballs
export const GAS_OFFSET          = DISPLAY_TO_WORLD(2);   // spawn offset

const MAX_SPEED_SQ = WORLD_TO_VELOCITY(KOHRAH_MAX_THRUST) ** 2;

// ─── Factory ──────────────────────────────────────────────────────────────────

export function makeKohrahShip(x: number, y: number): ShipState {
  return {
    x, y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew: KOHRAH_MAX_CREW,
    energy: KOHRAH_MAX_ENERGY,
    thrustWait:  0,
    turnWait:    0,
    weaponWait:  0,
    specialWait: 0,
    energyWait:  0,
    thrusting: false,
  };
}

// ─── Per-frame update ─────────────────────────────────────────────────────────

/**
 * Update Kohr-Ah ship state for one simulation frame.
 * Returns array of spawned weapons (buzzsaws, gas clouds) to add to the world.
 */
export function updateKohrahShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  // ─── Turning ──────────────────────────────────────────────────────────────
  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing - 1 + 16) % 16;
      ship.turnWait = KOHRAH_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) % 16;
      ship.turnWait = KOHRAH_TURN_WAIT;
    }
  }

  // ─── Thrust ───────────────────────────────────────────────────────────────
  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = KOHRAH_THRUST_WAIT;

    const angle = (ship.facing * 4) & 63;
    const incV  = WORLD_TO_VELOCITY(KOHRAH_THRUST_INCREMENT);
    const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
    const newDx = curDx + COSINE(angle, incV);
    const newDy = curDy + SINE(angle, incV);
    const desiredSpeedSq = newDx * newDx + newDy * newDy;

    if (desiredSpeedSq <= MAX_SPEED_SQ) {
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else {
      const currentSpeedSq = ship.velocity.vx ** 2 + ship.velocity.vy ** 2;
      if (desiredSpeedSq < currentSpeedSq) {
        setVelocityComponents(ship.velocity, newDx, newDy);
      } else if (ship.velocity.travelAngle === angle) {
        setVelocityVector(ship.velocity, KOHRAH_MAX_THRUST, ship.facing);
      } else {
        setVelocityComponents(ship.velocity, newDx, newDy);
        const spd = Math.sqrt(ship.velocity.vx ** 2 + ship.velocity.vy ** 2);
        if (spd > 0) {
          const scale = WORLD_TO_VELOCITY(KOHRAH_MAX_THRUST) / spd;
          setVelocityComponents(
            ship.velocity,
            ship.velocity.vx * scale,
            ship.velocity.vy * scale,
          );
        }
      }
    }
  }

  // ─── Position advance ──────────────────────────────────────────────────────
  const fracX = Math.abs(ship.velocity.vx) & 31;
  ship.velocity.ex += fracX;
  const carryX = ship.velocity.ex >= 32 ? 1 : 0;
  ship.velocity.ex &= 31;
  ship.x += VELOCITY_TO_WORLD(Math.abs(ship.velocity.vx)) * Math.sign(ship.velocity.vx) + (ship.velocity.vx >= 0 ? carryX : -carryX);

  const fracY = Math.abs(ship.velocity.vy) & 31;
  ship.velocity.ey += fracY;
  const carryY = ship.velocity.ey >= 32 ? 1 : 0;
  ship.velocity.ey &= 31;
  ship.y += VELOCITY_TO_WORLD(Math.abs(ship.velocity.vy)) * Math.sign(ship.velocity.vy) + (ship.velocity.vy >= 0 ? carryY : -carryY);

  // ─── Energy regeneration ───────────────────────────────────────────────────
  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < KOHRAH_MAX_ENERGY) {
    ship.energy = Math.min(KOHRAH_MAX_ENERGY, ship.energy + KOHRAH_ENERGY_REGENERATION);
    ship.energyWait = KOHRAH_ENERGY_WAIT;
  }

  // ─── Primary weapon: Buzzsaw ──────────────────────────────────────────────
  // One buzzsaw per key-press (edge-triggered). Holding fire keeps the existing
  // buzzsaw alive; releasing lets it stop and home. A new one fires only on the
  // next key-down after a release.
  const fireNow = !!(input & INPUT_FIRE1);
  const fireJustPressed = fireNow && !ship.prevFireHeld;
  ship.prevFireHeld = fireNow;

  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if (fireJustPressed && ship.energy >= BUZZSAW_ENERGY_COST) {
    ship.energy -= BUZZSAW_ENERGY_COST;
    ship.weaponWait = BUZZSAW_WAIT;
    const launchAngle = (ship.facing * 4) & 63;
    const offsetW = BUZZSAW_OFFSET;
    spawns.push({
      type: 'buzzsaw',
      facing: ship.facing,
      x: ship.x + COSINE(launchAngle, offsetW),
      y: ship.y + SINE(launchAngle, offsetW),
      speed: BUZZSAW_SPEED,
      life: BUZZSAW_LIFE,
      damage: BUZZSAW_DAMAGE,
      hits: BUZZSAW_HITS,
      fireHeld: true,
      weaponCap: MAX_BUZZSAWS,
    });
  }

  // ─── Secondary weapon: F.R.I.E.D. (ring of gas clouds) ─────────────────────
  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2) && ship.energy >= FRIED_ENERGY_COST) {
    ship.energy -= FRIED_ENERGY_COST;
    ship.specialWait = FRIED_WAIT;

    // Spawn a ring of 16 gas clouds
    const angleStep = 64 / NUM_GAS_CLOUDS; // 4 angle units per cloud
    for (let i = 0; i < NUM_GAS_CLOUDS; i++) {
      const cloudAngle = (i * angleStep) & 63;
      spawns.push({
        type: 'gas_cloud',
        x: ship.x,
        y: ship.y,
        facing: (cloudAngle * 16) / 64, // convert angle to facing
        speed: GAS_SPEED,
        damage: GAS_DAMAGE,
        hits: GAS_HITS,
        shipVelocity: { vx: ship.velocity.vx, vy: ship.velocity.vy },
      });
    }
  }

  return spawns;
}

// ─── Ship controller ─────────────────────────────────────────────────────────

export const kohrahController: ShipController = {
  maxCrew:   KOHRAH_MAX_CREW,
  maxEnergy: KOHRAH_MAX_ENERGY,

  collidesWithPlanet: true,

  make: makeKohrahShip,
  update: updateKohrahShip,

  loadSprites: () => loadKohrahSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as KohrahSprites | null;
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
    const sp = sprites as KohrahSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as KohrahSprites | null;
    const isBuzzsaw  = m.weaponType === 'buzzsaw';
    const isGasCloud = m.weaponType === 'gas_cloud';
    const group = isBuzzsaw
      ? (sp ? sp.buzzsaw : null)
      : isGasCloud
        ? (sp ? sp.gas : null)
        : null;
    const set = group
      ? (dc.reduction >= 2 ? group.sml : dc.reduction === 1 ? group.med : group.big)
      : null;
    if (set) {
      let frameIdx: number;
      if (isBuzzsaw) {
        // Frames 0–1: spinning; frames 2–7: splinter death. decelWait is the animation tick.
        frameIdx = (m.decelWait ?? 0) & 1;
      } else {
        // Gas cloud: 8 frames, advance based on age (64 - life)
        frameIdx = Math.min(7, (64 - m.life) >> 3);
      }
      drawSprite(dc.ctx, set, frameIdx, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 3, '#ff8', dc.reduction);
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as KohrahSprites | null;
    if (m.weaponType === 'buzzsaw') return sp?.buzzsaw.big.frames[(m.decelWait ?? 0) & 1] ?? null;
    if (m.weaponType === 'gas_cloud') return sp?.gas.big.frames[Math.min(7, (64 - m.life) >> 3)] ?? null;
    return null;
  },

  processMissile(m: BattleMissile, _ownShip: ShipState, enemyShip: ShipState, input: number): MissileEffect {
    if (m.weaponType === 'gas_cloud') {
      // Gas cloud: velocity set once at spawn; never overwrite it.
      return { skipVelocityUpdate: true };
    }

    if (m.weaponType !== 'buzzsaw') return {};

    // ── Buzzsaw lifecycle (ported from blackurq.c) ────────────────────────────
    // UQM phases:
    //   buzzsaw_preprocess  → while fire held: spin_preprocess (life++)
    //   decelerate_preprocess → each frame: halve vx/vy, then spin_preprocess (life++)
    //   buzztrack_preprocess  → nudge if in range, then spin_preprocess (life++)
    // spin_preprocess always counteracts the engine's life-- so buzzsaws never
    // expire naturally. Only FIFO (9th spawn) or a hit destroys them.

    m.decelWait = (m.decelWait ?? 0) + 1; // animation counter (independent of life)

    if (m.fireHeld) {
      if (input & INPUT_FIRE1) {
        // buzzsaw_preprocess + spin_preprocess: replenish life while held
        m.life++;
      } else {
        // Fire just released: halve life, switch to decel phase.
        m.fireHeld = false;
        m.life = Math.max(1, m.life >> 1);
        m.life++;
      }
    } else {
      // decelerate_preprocess or buzztrack_preprocess: always replenish life.
      m.life++;
    }

    // Buzzsaw velocity: decelerate or home — handled here, not by generic code.
    const stopped = m.velocity.vx === 0 && m.velocity.vy === 0;
    if (!m.fireHeld) {
      if (!stopped) {
        // decelerate_preprocess: halve velocity each frame until stopped.
        m.velocity.vx = Math.trunc(m.velocity.vx / 2);
        m.velocity.vy = Math.trunc(m.velocity.vy / 2);
      } else {
        // buzztrack_preprocess: every BUZZSAW_TRACK_WAIT frames, nudge toward enemy
        // if within ACTIVATE_RANGE display pixels.
        if (m.trackWait > 0) {
          m.trackWait--;
        } else {
          m.trackWait = BUZZSAW_TRACK_WAIT;
          const { dx: dxW, dy: dyW } = worldDelta(m.x, m.y, enemyShip.x, enemyShip.y);
          const dxD = Math.abs(dxW) >> 2; // WORLD_TO_DISPLAY
          const dyD = Math.abs(dyW) >> 2;
          if (dxD < ACTIVATE_RANGE && dyD < ACTIVATE_RANGE &&
              dxD * dxD + dyD * dyD < ACTIVATE_RANGE * ACTIVATE_RANGE) {
            const angle  = battleWorldAngle(m.x, m.y, enemyShip.x, enemyShip.y);
            const facing = ((angle + 2) >> 2) & 15;
            setVelocityVector(m.velocity, BUZZSAW_TRACK_SPEED, facing);
          } else {
            m.velocity.vx = 0;
            m.velocity.vy = 0;
          }
        }
      }
    }

    return { skipDefaultTracking: true, skipVelocityUpdate: true };
  },

  onMissileHit(m: BattleMissile, target: ShipState | null): MissileHitEffect {
    if (m.weaponType !== 'buzzsaw') return {};
    if (target === null) {
      // Planet collision: splinter only, no blast
      return {
        skipBlast: true,
        splinter: { vx: m.velocity.vx, vy: m.velocity.vy },
      };
    }
    // Ship collision: blast (default) + splinter
    return { splinter: { vx: m.velocity.vx, vy: m.velocity.vy } };
  },

  computeAIInput(ship: ShipState, target: ShipState, missiles: BattleMissile[], aiSide: 0 | 1, aiLevel: AIDifficulty): number {
    let input = 0;
    const targetAngle = battleWorldAngle(ship.x, ship.y, target.x, target.y);
    const targetFacing = ((targetAngle + 2) >> 2) & 15;
    const diff = (targetFacing - ship.facing + 16) % 16;
    if (diff >= 1 && diff <= 8) input |= INPUT_RIGHT;
    else if (diff > 8) input |= INPUT_LEFT;
    input |= INPUT_THRUST;

    const { dx, dy } = worldDelta(ship.x, ship.y, target.x, target.y);
    const distanceSq = dx * dx + dy * dy;
    const activeSaw = missiles.find(m => m.owner === aiSide && m.weaponType === 'buzzsaw' && m.life > BUZZSAW_LIFE * 3 / 4);

    const fireWindow = aiLevel === 'cyborg_awesome' ? 1 : 0;
    if (distanceSq <= DISPLAY_TO_WORLD(240) ** 2) {
      if (activeSaw) {
        input |= INPUT_FIRE1;
      } else if (diff <= fireWindow || diff >= 16 - fireWindow) {
        input |= INPUT_FIRE1;
      }
    }

    const closeMissileThreat = missiles.some(m => {
      if (m.owner === aiSide || m.weaponType === 'gas_cloud') return false;
      const delta = worldDelta(ship.x, ship.y, m.x, m.y);
      return delta.dx * delta.dx + delta.dy * delta.dy <= DISPLAY_TO_WORLD(80) ** 2;
    });
    if (!closeMissileThreat && ship.specialWait === 0 && ship.energy >= FRIED_ENERGY_COST) {
      if (!(input & INPUT_FIRE1) && distanceSq <= DISPLAY_TO_WORLD(aiLevel === 'cyborg_weak' ? 100 : 140) ** 2 && (input & (INPUT_LEFT | INPUT_RIGHT))) {
        input |= INPUT_FIRE2;
      }
    }

    return input;
  },
};
