// Shared types for the ship controller architecture.
//
// Every ship is represented by a ShipController — a RACE_DESC-style struct
// with function pointers the engine calls each frame.  Battle.tsx dispatches
// through SHIP_REGISTRY and never contains per-ship if-chains.

import type { VelocityDesc } from '../velocity';
import type { SpriteFrame } from '../sprites';
import type { AIDifficulty } from 'shared/types';

// ─── Common ship state (all ships use this) ───────────────────────────────────

export interface ShipState {
  x: number;
  y: number;
  velocity: VelocityDesc;
  facing: number;   // 0–15 (64-unit circle ÷ 4)
  crew: number;
  energy: number;
  // Countdown timers (0 = ready)
  thrustWait:  number;
  turnWait:    number;
  weaponWait:  number;
  specialWait: number;
  energyWait:  number;
  // Status flags
  thrusting:     boolean;
  limpetCount?:  number;
  prevFireHeld?: boolean;   // edge-trigger for weapons like Kohr-Ah buzzsaw
  canResurrect?: boolean;   // Pkunk passive: 50% chance to reincarnate on this life
  arilouTeleportFrames?: number;
  arilouTeleportSeed?: number;
  androsynthBlazer?: boolean;
  androsynthSeed?: number;
  chenjesuDogiCount?: number;
  chmmrLaserCycle?: number;
  chmmrSatellitesSpawned?: boolean;
  ilwrathCloaked?: boolean;
  ilwrathUncloakShot?: boolean;
  shofixtiGloryFrames?: number;
  shofixtiSafetyLevel?: number;
  shofixtiPrevSpecialHeld?: boolean;
  yehatShieldFrames?: number;
  melnormeCharging?: boolean;
  melnormePumpLevel?: number;
  melnormePumpTimer?: number;
  melnormeConfusionFrames?: number;
  melnormeConfusionInput?: number;
  melnormeSeed?: number;
  thraddashPrevSpecialHeld?: boolean;
  zoqTongueFrames?: number;
  zoqSpitCycle?: number;
}

// ─── Spawn requests (produced by update(); consumed by simulateFrame()) ───────

export type SpawnRequest =
  | {
      type: 'missile';
      x: number; y: number; facing: number;
      speed: number;
      maxSpeed: number;
      accel: number;
      life: number;
      hits?: number;
      damage: number;
      tracks: boolean;
      trackRate: number;
      inheritVelocity?: boolean;
      preserveVelocity?: boolean;
      limpet?: boolean;
      weaponType?: 'plasmoid' | 'bubble' | 'chenjesu_crystal' | 'chenjesu_shard' | 'dogi' | 'chmmr_satellite' | 'melnorme_pump' | 'melnorme_confuse' | 'thraddash_horn' | 'thraddash_napalm' | 'zoqfotpik_spit';
      initialTrackWait?: number;
    }
  | { type: 'sound'; sound: 'primary' | 'secondary' | 'cloak' | 'uncloak' }
  | { type: 'point_defense'; x: number; y: number }
  | { type: 'chmmr_laser'; x: number; y: number; facing: number }
  | { type: 'chmmr_tractor'; x: number; y: number; facing: number }
  | {
      type: 'fighter';
      x: number; y: number; facing: number;
      /** Initial flight speed (world units). Filled by the controller. */
      speed: number;
      /** Total lifespan in frames. Filled by the controller. */
      life: number;
      /** Attack-lane side copied from UQM's LEFT/RIGHT fighter state. */
      orbitDir: -1 | 1;
    }
  | { type: 'vux_laser'; x: number; y: number; facing: number }
  | { type: 'arilou_laser'; x: number; y: number; facing: number }
  | {
      type: 'buzzsaw';
      x: number; y: number; facing: number;
      speed: number;
      life: number;
      damage: number;
      hits: number;
      fireHeld: boolean;
      /**
       * FIFO cap: if this owner already has this many buzzsaws alive, the
       * oldest is removed before the new one is added.  Set by the controller.
       */
      weaponCap?: number;
    }
  | {
      type: 'gas_cloud';
      x: number; y: number; facing: number;
      speed: number;
      damage: number;
      hits: number;
      shipVelocity: { vx: number; vy: number };
    }
  | { type: 'zoqfotpik_tongue' }
  | { type: 'shofixti_glory'; x: number; y: number };

// ─── Battle-world objects (live in BattleState) ───────────────────────────────

export interface BattleMissile {
  prevX: number; prevY: number;
  x: number; y: number;
  facing: number;
  velocity: VelocityDesc;
  life: number;
  hitPoints: number;
  speed: number;
  maxSpeed: number;
  accel: number;
  damage: number;
  tracks: boolean;
  trackWait: number;
  trackRate: number;
  owner: 0 | 1;
  preserveVelocity?: boolean;
  limpet?: boolean;
  weaponType?: 'buzzsaw' | 'gas_cloud' | 'fighter' | 'plasmoid' | 'bubble' | 'chenjesu_crystal' | 'chenjesu_shard' | 'dogi' | 'chmmr_satellite' | 'melnorme_pump' | 'melnorme_confuse' | 'thraddash_horn' | 'thraddash_napalm' | 'zoqfotpik_spit';
  fireHeld?: boolean;
  decelWait?: number;
  weaponWait?: number;   // fighters: frames until next laser shot
  orbitDir?: -1 | 1;     // fighters: preferred attack lane around enemy
  satelliteAngle?: number;
  zoqSpitAngle?: number;
}

export interface LaserFlash {
  x1: number; y1: number;
  x2: number; y2: number;
  color?: string;
}

export type EffectSound =
  | 'fighter_laser'
  | 'fighter_dock'
  | 'vux_limpet_bite'
  | 'chenjesu_shrapnel'
  | 'chenjesu_dogi_bark'
  | 'chenjesu_dogi_die';

// ─── Per-missile effect returned by processMissile() ─────────────────────────

/**
 * Effects a controller wants Battle.tsx to apply after processMissile() runs.
 * All fields are optional; unset fields use Battle.tsx defaults.
 */
export interface MissileEffect {
  /** Force-remove the missile this frame (e.g. fighter docked). */
  destroy?: boolean;
  /** Resolve the forced destroy through onMissileHit() and impact effects. */
  resolveAsHit?: boolean;
  /** Crew damage to deal to the enemy ship. */
  damageEnemy?: number;
  /** Crew to restore to the owning ship (fighter return). Capped at maxCrew. */
  healOwn?: number;
  /** Laser flashes to add to the world this frame. */
  lasers?: LaserFlash[];
  /** Apply damage to specific missiles after this missile updates. */
  damageMissiles?: Array<{ missile: BattleMissile; damage: number }>;
  /** If true, skip the generic tracking logic in Battle.tsx this frame. */
  skipDefaultTracking?: boolean;
  /** If true, skip the generic setVelocityVector call in Battle.tsx this frame. */
  skipVelocityUpdate?: boolean;
  /** Sound keys to play after applying this effect (Battle.tsx dispatches). */
  sounds?: EffectSound[];
}

// ─── Collision effect returned by onMissileHit() ─────────────────────────────

/**
 * Effects a controller wants Battle.tsx to apply when one of its missiles
 * collides.  target === null means a non-ship collision (planet or projectile).
 */
export interface MissileHitEffect {
  /** If true, skip the default blast explosion at the impact site. */
  skipBlast?: boolean;
  /** Override the cosmetic explosion animation used at the impact site. */
  explosionType?: 'mycon_plasma' | 'chenjesu_spark';
  /** Spawn a splinter explosion at the impact position with this velocity. */
  splinter?: { vx: number; vy: number };
  /** Add this many frames of impairment to the target ship (limpet). */
  impairTarget?: number;
  /** Permanently attach this many limpets to the target ship. */
  attachLimpet?: number;
  /** Drain up to this much energy from the target ship. */
  drainTargetEnergy?: number;
  /** Apply an immediate velocity delta to the target ship, then clamp if needed. */
  targetVelocityDelta?: { vx: number; vy: number; maxSpeed?: number };
  /** Keep the missile alive after this hit instead of removing it. */
  keepMissileAlive?: boolean;
  /** Set the missile's weaponWait after the hit (used as custom cooldown/stun). */
  missileCooldown?: number;
  /** Spawn follow-up projectiles when the hit resolves. */
  spawnMissiles?: SpawnRequest[];
  /** Sound keys to play when the hit effect resolves. */
  sounds?: EffectSound[];
}

// ─── Rendering context passed to controller draw functions ────────────────────

export interface DrawContext {
  ctx:      CanvasRenderingContext2D;
  camX:     number;
  camY:     number;
  canvasW:  number;
  canvasH:  number;
  reduction: number;   // zoom level: 0=1×, 1=2×, 2=4×, 3=8×
  worldW:   number;    // toroidal world width in world units
  worldH:   number;    // toroidal world height in world units
}

// ─── Ship controller (analogous to UQM's RACE_DESC) ──────────────────────────

export interface ShipController {
  // Stats used by the HUD
  maxCrew:   number;
  maxEnergy: number;

  /** Create initial ship state at world position (x, y). */
  make(x: number, y: number, rng?: () => number): ShipState;

  /**
   * Advance ship one simulation frame.
   * input: bitmask of INPUT_* constants.
   * Returns spawn requests to add to the world.
   */
  update(ship: ShipState, input: number): SpawnRequest[];

  /** Load all sprites needed by this ship.  Called once at battle start. */
  loadSprites(): Promise<unknown>;

  /** Draw the ship body at its current position. */
  drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void;
  /** Return the sprite frame used for ship collision tests, ideally the same one being drawn. */
  getShipCollisionFrame?(ship: ShipState, sprites: unknown): SpriteFrame | null;
  getCollisionRadius?(ship: ShipState): number;
  getCollisionMass?(ship: ShipState): number;

  /**
   * Draw a missile owned by this ship.
   * Optional — ships without custom projectile sprites can omit this;
   * Battle.tsx will fall back to a placeholder dot.
   */
  drawMissile?(dc: DrawContext, m: BattleMissile, sprites: unknown): void;
  /** Return the sprite frame used for projectile collision tests. */
  getMissileCollisionFrame?(m: BattleMissile, sprites: unknown): SpriteFrame | null;

  /**
   * Called when crew reaches 0.  Return true to cancel death (resurrection).
   * The controller is responsible for resetting ship state inside this call.
   * rand(n) returns a random integer in [0, n).
   */
  onDeath?(ship: ShipState, rand: (n: number) => number): boolean;

  /**
   * If true, this ship's missiles can collide with the planet.
   * Battle.tsx checks this flag before running the planet-collision test.
   */
  collidesWithPlanet?: boolean;

  /**
   * Per-frame lifecycle hook for each missile owned by this ship.
   * Called once per missile per frame, before the generic velocity/position
   * update.  Return a MissileEffect to request side-effects from Battle.tsx.
   *
   * input: raw input bitmask for the owning player this frame (needed by
   *   buzzsaw to track whether fire is held).
   */
  processMissile?(
    m: BattleMissile,
    ownShip: ShipState,
    enemyShip: ShipState,
    missiles: BattleMissile[],
    input: number,
  ): MissileEffect;

  /**
   * Called when one of this ship's missiles collides with a target.
   * target === null means the missile hit the planet.
   * Return a MissileHitEffect to customise the explosion / apply side-effects.
   */
  onMissileHit?(m: BattleMissile, target: ShipState | null): MissileHitEffect;

  /**
   * Immediate-effect hook for non-missile spawns (point_defense, vux_laser).
   * Called by Battle.tsx after spawnRequest() for every spawn this ship emits.
   * The controller mutates ownShip/enemyShip/missiles directly and calls
   * addLaser() to add laser flashes.
   */
  applySpawn?(
    s: SpawnRequest,
    ownShip: ShipState,
    enemyShip: ShipState,
    ownSide: 0 | 1,
    missiles: BattleMissile[],
    addLaser: (l: LaserFlash) => void,
    damageMissile: (m: BattleMissile, damage: number) => boolean,
    emitSound: (sound: 'primary' | 'secondary') => void,
  ): void;

  /** True while the ship should ignore gravity/collisions/hits (e.g. teleporting). */
  isIntangible?(ship: ShipState): boolean;
  onShipCollision?(ship: ShipState, other: ShipState): { damageOther?: number } | void;

  /** Optional ship-specific AI override for offline cyborg battles. */
  computeAIInput?(
    ship: ShipState,
    target: ShipState,
    missiles: BattleMissile[],
    aiSide: 0 | 1,
    aiLevel: AIDifficulty,
  ): number;
}
