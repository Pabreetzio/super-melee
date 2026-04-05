// Spathi Eluder — ported from uqm-0.8.0/src/uqm/ships/spathi/spathi.c
//
// Primary (FIRES_FORE): forward standard missile (weak, fast, no tracking)
// Special (FIRES_AFT):  B.U.T.T. — backward tracking torpedo (SEEKING_SPECIAL)

import {
  WORLD_TO_VELOCITY, VELOCITY_TO_WORLD, DISPLAY_TO_WORLD,
  setVelocityVector,
  setVelocityComponents, getCurrentVelocityComponents,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2 } from '../game';
import { loadSpathiSprites, drawSprite, placeholderDot, type SpathiSprites, type SpriteFrame } from '../sprites';
import type { ShipState, SpawnRequest, BattleMissile, DrawContext, ShipController } from './types';
import type { AIDifficulty } from 'shared/types';
import { worldAngle, worldDelta } from '../battle/helpers';

// Backward-compat alias
export type { ShipState as HumanShipState };

// ─── Constants (from spathi.c) ────────────────────────────────────────────────

export const SPATHI_MAX_CREW            = 30;
export const SPATHI_MAX_ENERGY          = 10;
export const SPATHI_ENERGY_REGENERATION = 1;
export const SPATHI_ENERGY_WAIT         = 10;  // regen every 11 frames
export const SPATHI_MAX_THRUST          = 48;  // world units
export const SPATHI_THRUST_INCREMENT    = 12;  // world units per thrust
export const SPATHI_THRUST_WAIT         = 1;   // frames between thrust applications
export const SPATHI_TURN_WAIT           = 1;
export const SPATHI_SHIP_MASS           = 5;
export const SPATHI_SHIP_RADIUS         = 14;  // display pixels (approx)

// Primary: forward gun
export const SPATHI_WEAPON_ENERGY_COST = 2;
export const SPATHI_WEAPON_WAIT        = 0;    // fires every frame while held
export const SPATHI_FORWARD_OFFSET     = DISPLAY_TO_WORLD(16); // 64 world units
export const SPATHI_MISSILE_SPEED      = DISPLAY_TO_WORLD(30); // 120 world units
export const SPATHI_MISSILE_LIFE       = 10;
export const SPATHI_MISSILE_HITS       = 1;
export const SPATHI_MISSILE_DAMAGE     = 1;

// Special: B.U.T.T. (backward tracking torpedo)
export const SPATHI_SPECIAL_ENERGY_COST = 3;
export const SPATHI_SPECIAL_WAIT        = 7;
export const SPATHI_REAR_OFFSET         = DISPLAY_TO_WORLD(20); // 80 world units
export const BUTT_SPEED                 = DISPLAY_TO_WORLD(8);  // 32 world units
export const BUTT_LIFE                  = 30;
export const BUTT_HITS                  = 1;
export const BUTT_DAMAGE                = 2;
export const BUTT_TRACK_WAIT            = 1;   // track every 2 frames

// Max speed cap (3× max display speed = WORLD_TO_VELOCITY(DISPLAY_TO_WORLD(18)))
const MAX_SPEED_SQ = WORLD_TO_VELOCITY(SPATHI_MAX_THRUST) ** 2;

// ─── Factory ──────────────────────────────────────────────────────────────────

// Spathi uses the same state shape as the Earthling Cruiser.
export function makeSpathiShip(x: number, y: number): ShipState {
  return {
    x, y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew:   SPATHI_MAX_CREW,
    energy: SPATHI_MAX_ENERGY,
    thrustWait:  0,
    turnWait:    0,
    weaponWait:  0,
    specialWait: 0,
    energyWait:  0,
    thrusting: false,
  };
}

// ─── Per-frame update ─────────────────────────────────────────────────────────

export function updateSpathiShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  // ─── Turning ─────────────────────────────────────────────────────────────
  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing - 1 + 16) % 16;
      ship.turnWait = SPATHI_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) % 16;
      ship.turnWait = SPATHI_TURN_WAIT;
    }
  }

  // ─── Thrust ───────────────────────────────────────────────────────────────
  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = SPATHI_THRUST_WAIT;

    const angle = (ship.facing * 4) & 63;
    const incV  = WORLD_TO_VELOCITY(SPATHI_THRUST_INCREMENT);
    const { dx: curDx, dy: curDy } = getCurrentVelocityComponents(ship.velocity);
    const newDx = curDx + COSINE(angle, incV);
    const newDy = curDy + SINE(angle, incV);
    const desiredSpeedSq = newDx * newDx + newDy * newDy;

    if (desiredSpeedSq <= MAX_SPEED_SQ) {
      setVelocityComponents(ship.velocity, newDx, newDy);
    } else {
      if (ship.velocity.travelAngle === angle) {
        setVelocityVector(ship.velocity, SPATHI_MAX_THRUST, ship.facing);
      } else {
        setVelocityComponents(ship.velocity, newDx, newDy);
        const { vx, vy } = ship.velocity;
        const spd = Math.sqrt(vx * vx + vy * vy);
        if (spd > 0) {
          const scale = WORLD_TO_VELOCITY(SPATHI_MAX_THRUST) / spd;
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

  // ─── Energy regeneration ──────────────────────────────────────────────────
  if (ship.energyWait > 0) {
    ship.energyWait--;
  } else if (ship.energy < SPATHI_MAX_ENERGY) {
    ship.energy = Math.min(SPATHI_MAX_ENERGY, ship.energy + SPATHI_ENERGY_REGENERATION);
    ship.energyWait = SPATHI_ENERGY_WAIT;
  }

  // ─── Primary: forward gun ─────────────────────────────────────────────────
  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if ((input & INPUT_FIRE1) && ship.energy >= SPATHI_WEAPON_ENERGY_COST) {
    ship.energy -= SPATHI_WEAPON_ENERGY_COST;
    ship.weaponWait = SPATHI_WEAPON_WAIT;
    const angle = (ship.facing * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(angle, SPATHI_FORWARD_OFFSET),
      y: ship.y + SINE(angle, SPATHI_FORWARD_OFFSET),
      facing: ship.facing,
      speed:    SPATHI_MISSILE_SPEED,
      maxSpeed: SPATHI_MISSILE_SPEED,
      accel:    0,
      life:     SPATHI_MISSILE_LIFE,
      hits:     SPATHI_MISSILE_HITS,
      damage:   SPATHI_MISSILE_DAMAGE,
      tracks:   false,
      trackRate: 0,
    });
  }

  // ─── Special: B.U.T.T. ───────────────────────────────────────────────────
  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2) && ship.energy >= SPATHI_SPECIAL_ENERGY_COST) {
    ship.energy -= SPATHI_SPECIAL_ENERGY_COST;
    ship.specialWait = SPATHI_SPECIAL_WAIT;
    const rearFacing = (ship.facing + 8) & 15; // 180° behind
    const rearAngle  = (rearFacing * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(rearAngle, SPATHI_REAR_OFFSET),
      y: ship.y + SINE(rearAngle, SPATHI_REAR_OFFSET),
      facing: rearFacing,
      speed:    BUTT_SPEED,
      maxSpeed: BUTT_SPEED,
      accel:    0,
      life:     BUTT_LIFE,
      hits:     BUTT_HITS,
      damage:   BUTT_DAMAGE,
      tracks:   true,
      trackRate: BUTT_TRACK_WAIT,
    });
  }

  return spawns;
}

// ─── Ship controller ─────────────────────────────────────────────────────────

export const spathiController: ShipController = {
  maxCrew:   SPATHI_MAX_CREW,
  maxEnergy: SPATHI_MAX_ENERGY,

  make: makeSpathiShip,
  update: updateSpathiShip,

  loadSprites: () => loadSpathiSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as SpathiSprites | null;
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
    const sp = sprites as SpathiSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as SpathiSprites | null;
    // Tracking missiles (BUTT) use the butt sprite; forward shots use missile sprite
    const group = m.tracks
      ? (sp ? sp.butt    : null)
      : (sp ? sp.missile : null);
    const set = group
      ? (dc.reduction >= 2 ? group.sml : dc.reduction === 1 ? group.med : group.big)
      : null;
    if (set) {
      drawSprite(dc.ctx, set, m.facing, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 3, '#ff8', dc.reduction);
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as SpathiSprites | null;
    const group = m.tracks ? sp?.butt.big : sp?.missile.big;
    return group?.frames[m.facing] ?? null;
  },

  computeAIInput(ship: ShipState, target: ShipState, _missiles: BattleMissile[], _aiSide: 0 | 1, aiLevel: AIDifficulty): number {
    let input = 0;
    const angleToTarget = worldAngle(ship.x, ship.y, target.x, target.y);
    const targetFacing = ((angleToTarget + 2) >> 2) & 15;
    const awayFacing = (targetFacing + 8) & 15;
    const { dx, dy } = worldDelta(ship.x, ship.y, target.x, target.y);
    const distanceSq = dx * dx + dy * dy;
    const tooClose = distanceSq <= DISPLAY_TO_WORLD(96) ** 2;

    const desiredFacing = tooClose ? awayFacing : ((awayFacing + (aiLevel === 'cyborg_awesome' ? 1 : 0)) & 15);
    const diff = (desiredFacing - ship.facing + 16) % 16;
    if (diff >= 1 && diff <= 8) input |= INPUT_RIGHT;
    else if (diff > 8) input |= INPUT_LEFT;
    input |= INPUT_THRUST;

    const buttFacing = (ship.facing + 8) & 15;
    const buttDiff = (targetFacing - buttFacing + 16) % 16;
    const buttWindow = aiLevel === 'cyborg_awesome' ? 2 : 1;
    if (ship.energy >= SPATHI_SPECIAL_ENERGY_COST && (buttDiff <= buttWindow || buttDiff >= 16 - buttWindow)) {
      input |= INPUT_FIRE2;
    }

    const frontDiff = (targetFacing - ship.facing + 16) % 16;
    const missileRange = DISPLAY_TO_WORLD(aiLevel === 'cyborg_awesome' ? 150 : aiLevel === 'cyborg_good' ? 120 : 90);
    if (distanceSq <= missileRange * missileRange && !tooClose && (frontDiff === 0 || (aiLevel !== 'cyborg_weak' && (frontDiff <= 1 || frontDiff >= 15)))) {
      input |= INPUT_FIRE1;
    }

    return input;
  },
};
