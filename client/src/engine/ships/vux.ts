// VUX Intruder — ported from uqm-0.8.0/src/uqm/ships/vux/vux.c
//
// Primary (FIRES_FORE, IMMEDIATE_WEAPON): Forward laser
// Special (SEEKING_SPECIAL): Limpets — tracking missiles; on hit apply movement impairment

import {
  VELOCITY_TO_WORLD, DISPLAY_TO_WORLD,
} from '../velocity';
import { COSINE, SINE } from '../sinetab';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2 } from '../game';
import { loadVuxSprites, drawSprite, placeholderDot, type VuxSprites, type SpriteFrame } from '../sprites';
import type { ShipState, SpawnRequest, BattleMissile, DrawContext, ShipController, MissileHitEffect, LaserFlash } from './types';
import type { AIDifficulty } from 'shared/types';
import { worldAngle, worldDelta } from '../battle/helpers';
import { findImmediateLaserHit } from '../battle/immediateLaser';
import { shatterAsteroid } from '../battle/asteroids';
import { SHIP_REGISTRY } from './registry';
import { applyShipInertialThrust } from './thrust';

export type { ShipState as HumanShipState };

// ─── Constants (from vux.c) ───────────────────────────────────────────────────

export const VUX_MAX_CREW            = 20;
export const VUX_MAX_ENERGY          = 40;
export const VUX_ENERGY_REGENERATION = 1;
export const VUX_ENERGY_WAIT         = 8;
export const VUX_MAX_THRUST          = 21;  // not DISPLAY_TO_WORLD — raw value
export const VUX_THRUST_INCREMENT    = 7;
export const VUX_THRUST_WAIT         = 4;
export const VUX_TURN_WAIT           = 6;
export const VUX_SHIP_MASS           = 6;

// Laser (primary)
export const VUX_WEAPON_ENERGY_COST = 1;
export const VUX_WEAPON_WAIT        = 0;
export const VUX_OFFSET             = DISPLAY_TO_WORLD(12);  // 48 world units
export const VUX_LASER_BASE         = 150; // display pixels
export const VUX_LASER_RANGE        = DISPLAY_TO_WORLD(VUX_LASER_BASE + 12); // 648 world units

// Limpets (special)
export const VUX_SPECIAL_ENERGY_COST = 2;
export const VUX_SPECIAL_WAIT        = 7;
export const LIMPET_SPEED            = 25; // world units (raw, not DISPLAY_TO_WORLD)
export const LIMPET_OFFSET           = DISPLAY_TO_WORLD(8); // 32 world units
export const LIMPET_LIFE             = 80;
export const LIMPET_HITS             = 1;
export const LIMPET_DAMAGE           = 0;
const VUX_LASER_COLOR                = '#52ff52';

// ─── Factory ──────────────────────────────────────────────────────────────────

export function makeVuxShip(x: number, y: number): ShipState {
  return {
    x, y,
    velocity: { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 },
    facing: 0,
    crew:   VUX_MAX_CREW,
    energy: VUX_MAX_ENERGY,
    thrustWait:  0,
    turnWait:    0,
    weaponWait:  0,
    specialWait: 0,
    energyWait:  0,
    thrusting: false,
  };
}

// ─── Per-frame update ─────────────────────────────────────────────────────────

export function updateVuxShip(ship: ShipState, input: number): SpawnRequest[] {
  const spawns: SpawnRequest[] = [];

  // ─── Turning ─────────────────────────────────────────────────────────────
  if (ship.turnWait > 0) {
    ship.turnWait--;
  } else {
    if (input & INPUT_LEFT) {
      ship.facing = (ship.facing - 1 + 16) % 16;
      ship.turnWait = VUX_TURN_WAIT;
    } else if (input & INPUT_RIGHT) {
      ship.facing = (ship.facing + 1) % 16;
      ship.turnWait = VUX_TURN_WAIT;
    }
  }

  // ─── Thrust ───────────────────────────────────────────────────────────────
  ship.thrusting = false;
  if (ship.thrustWait > 0) {
    ship.thrustWait--;
  } else if (input & INPUT_THRUST) {
    ship.thrusting = true;
    ship.thrustWait = VUX_THRUST_WAIT;
    applyShipInertialThrust(ship, VUX_MAX_THRUST, VUX_THRUST_INCREMENT);
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
  } else if (ship.energy < VUX_MAX_ENERGY) {
    ship.energy = Math.min(VUX_MAX_ENERGY, ship.energy + VUX_ENERGY_REGENERATION);
    ship.energyWait = VUX_ENERGY_WAIT;
  }

  // ─── Primary: Forward laser ───────────────────────────────────────────────
  // Fires a laser line from ship in facing direction.
  // In Battle.tsx, applyVuxLaser handles collision + LaserFlash creation.
  if (ship.weaponWait > 0) {
    ship.weaponWait--;
  } else if ((input & INPUT_FIRE1) && ship.energy >= VUX_WEAPON_ENERGY_COST) {
    ship.energy -= VUX_WEAPON_ENERGY_COST;
    ship.weaponWait = VUX_WEAPON_WAIT;
    const angle = (ship.facing * 4) & 63;
    spawns.push({
      type: 'vux_laser',
      x: ship.x + COSINE(angle, VUX_OFFSET),
      y: ship.y + SINE(angle, VUX_OFFSET),
      facing: ship.facing,
    });
  }

  // ─── Special: Launch limpet ───────────────────────────────────────────────
  // Spawns from rear, tracks enemy. On hit: 1 crew damage + movement impairment.
  if (ship.specialWait > 0) {
    ship.specialWait--;
  } else if ((input & INPUT_FIRE2) && ship.energy >= VUX_SPECIAL_ENERGY_COST) {
    ship.energy -= VUX_SPECIAL_ENERGY_COST;
    ship.specialWait = VUX_SPECIAL_WAIT;
    const rearFacing = (ship.facing + 8) & 15;
    const rearAngle  = (rearFacing * 4) & 63;
    spawns.push({
      type: 'missile',
      x: ship.x + COSINE(rearAngle, LIMPET_OFFSET),
      y: ship.y + SINE(rearAngle, LIMPET_OFFSET),
      facing: rearFacing,
      speed:    LIMPET_SPEED,
      maxSpeed: LIMPET_SPEED,
      accel:    0,
      life:     LIMPET_LIFE,
      hits:     LIMPET_HITS,
      damage:   LIMPET_DAMAGE,
      tracks:   true,
      trackRate: 1,
      limpet:   true,
    });
  }

  return spawns;
}

// ─── Ship controller ─────────────────────────────────────────────────────────

export const vuxController: ShipController = {
  maxCrew:   VUX_MAX_CREW,
  maxEnergy: VUX_MAX_ENERGY,

  make: makeVuxShip,
  update: updateVuxShip,

  loadSprites: () => loadVuxSprites(),

  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
    const sp = sprites as VuxSprites | null;
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
    const sp = sprites as VuxSprites | null;
    return sp?.big.frames[ship.facing] ?? null;
  },

  drawMissile(dc: DrawContext, m: BattleMissile, sprites: unknown): void {
    const sp = sprites as VuxSprites | null;
    // Only limpets get a custom sprite; vux_laser is handled as a LaserFlash, not a missile
    const group = (sp && m.limpet) ? sp.limpets : null;
    const set = group
      ? (dc.reduction >= 2 ? group.sml : dc.reduction === 1 ? group.med : group.big)
      : null;
    if (set) {
      // Limpets cycle through 4 animation frames
      const frameIdx = m.life > 0 ? (LIMPET_LIFE - m.life) & 3 : 0;
      drawSprite(dc.ctx, set, frameIdx, m.x, m.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
    } else {
      placeholderDot(dc.ctx, m.x, m.y, dc.camX, dc.camY, 3, '#52ff52', dc.reduction);
    }
  },

  getMissileCollisionFrame(m: BattleMissile, sprites: unknown): SpriteFrame | null {
    const sp = sprites as VuxSprites | null;
    if (!m.limpet) return null;
    const frameIdx = m.life > 0 ? (LIMPET_LIFE - m.life) & 3 : 0;
    return sp?.limpets.big.frames[frameIdx] ?? null;
  },

  onMissileHit(m: BattleMissile, target: ShipState | null): MissileHitEffect {
    // Limpet hit: apply movement impairment to the target ship
    if (m.limpet && target) return { skipBlast: true, impairTarget: 1, attachLimpet: 1, sounds: ['vux_limpet_bite'] };
    return {};
  },

  applySpawn(
    s: SpawnRequest,
    _ownShip: ShipState,
    enemyShip: ShipState,
    _ownSide: 0 | 1,
    missiles: BattleMissile[],
    addLaser: (l: LaserFlash) => void,
    _addTractorShadow,
    damageMissile: (m: BattleMissile, damage: number) => boolean,
    _emitSound: (sound: 'primary' | 'secondary') => void,
    enemyType,
    _emitCrewPod,
    addExplosion,
    asteroids,
  ): void {
    if (s.type !== 'vux_laser') return;

    // Faithful port of applyVuxLaser from Battle.tsx.
    // Fires in the ship's facing direction; hits the first target in range.
    const angle = (s.facing * 4) & 63;
    const ex = COSINE(angle, VUX_LASER_RANGE);
    const ey = SINE(angle, VUX_LASER_RANGE);

    const shipRadW = DISPLAY_TO_WORLD(14); // SHIP_RADIUS = 14 display px

    const hit = findImmediateLaserHit({
      startX: s.x,
      startY: s.y,
      endX: s.x + ex,
      endY: s.y + ey,
      owner: _ownSide,
      enemyShip,
      enemyShipRadius: shipRadW,
      missiles,
      asteroids,
    });
    if (hit?.kind === 'ship') {
      const absorb = SHIP_REGISTRY[enemyType].absorbHit?.(enemyShip, { kind: 'laser', damage: 1 });
      if (!absorb?.absorbed) enemyShip.crew = Math.max(0, enemyShip.crew - 1);
      addExplosion?.({ type: 'blast', x: hit.x, y: hit.y, frame: 0 });
    } else if (hit?.kind === 'missile' && hit.missile) {
      damageMissile(hit.missile, 1);
      addExplosion?.({ type: 'blast', x: hit.x, y: hit.y, frame: 0 });
    } else if (hit?.kind === 'asteroid' && hit.asteroid) {
      shatterAsteroid(hit.asteroid);
    } else if (hit?.kind === 'planet') {
      addExplosion?.({ type: 'blast', x: hit.x, y: hit.y, frame: 0 });
    }
    // Always show flash, hit or miss
    addLaser({
      x1: s.x,
      y1: s.y,
      x2: hit ? hit.x : s.x + ex,
      y2: hit ? hit.y : s.y + ey,
      color: VUX_LASER_COLOR,
      clipToWorld: true,
    });
  },

  computeAIInput(ship: ShipState, target: ShipState, _missiles: BattleMissile[], _aiSide: 0 | 1, aiLevel: AIDifficulty): number {
    let input = 0;
    const targetAngle = worldAngle(ship.x, ship.y, target.x, target.y);
    const targetFacing = ((targetAngle + 2) >> 2) & 15;
    const diff = (targetFacing - ship.facing + 16) % 16;
    if (diff >= 1 && diff <= 8) input |= INPUT_RIGHT;
    else if (diff > 8) input |= INPUT_LEFT;

    const { dx, dy } = worldDelta(ship.x, ship.y, target.x, target.y);
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > DISPLAY_TO_WORLD(70) ** 2 || aiLevel !== 'cyborg_weak') input |= INPUT_THRUST;

    const laserWindow = aiLevel === 'cyborg_awesome' ? 1 : 0;
    if (distanceSq <= VUX_LASER_RANGE * VUX_LASER_RANGE && (diff <= laserWindow || diff >= 16 - laserWindow)) {
      input |= INPUT_FIRE1;
    }

    if (ship.energy >= (VUX_MAX_ENERGY >> 1) && ship.specialWait === 0 && distanceSq <= DISPLAY_TO_WORLD(180) ** 2 && (diff >= 1 && diff <= 8)) {
      if (aiLevel !== 'cyborg_weak' || distanceSq <= DISPLAY_TO_WORLD(120) ** 2) {
        input |= INPUT_FIRE2;
      }
    }

    return input;
  },
};
