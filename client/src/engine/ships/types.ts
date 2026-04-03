// Shared types for the ship controller architecture.
//
// Every ship is represented by a ShipController — a RACE_DESC-style struct
// with function pointers the engine calls each frame.  Battle.tsx dispatches
// through SHIP_REGISTRY and never contains per-ship if-chains.

import type { VelocityDesc } from '../velocity';

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
  canResurrect?: boolean;   // Pkunk passive: true until the one free resurrection fires
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
      damage: number;
      tracks: boolean;
      trackRate: number;
      inheritVelocity?: boolean;
      limpet?: boolean;
    }
  | { type: 'point_defense'; x: number; y: number }
  | {
      type: 'fighter';
      x: number; y: number; facing: number;
      /** Initial flight speed (world units). Filled by the controller. */
      speed: number;
      /** Total lifespan in frames. Filled by the controller. */
      life: number;
    }
  | { type: 'vux_laser'; x: number; y: number; facing: number }
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
    };

// ─── Battle-world objects (live in BattleState) ───────────────────────────────

export interface BattleMissile {
  x: number; y: number;
  facing: number;
  velocity: VelocityDesc;
  life: number;
  speed: number;
  maxSpeed: number;
  accel: number;
  damage: number;
  tracks: boolean;
  trackWait: number;
  trackRate: number;
  owner: 0 | 1;
  limpet?: boolean;
  weaponType?: 'buzzsaw' | 'gas_cloud' | 'fighter';
  fireHeld?: boolean;
  decelWait?: number;
  weaponWait?: number;   // fighters: frames until next laser shot
}

export interface LaserFlash {
  x1: number; y1: number;
  x2: number; y2: number;
  color?: string;
}

// ─── Per-missile effect returned by processMissile() ─────────────────────────

/**
 * Effects a controller wants Battle.tsx to apply after processMissile() runs.
 * All fields are optional; unset fields use Battle.tsx defaults.
 */
export interface MissileEffect {
  /** Force-remove the missile this frame (e.g. fighter docked). */
  destroy?: boolean;
  /** Crew damage to deal to the enemy ship. */
  damageEnemy?: number;
  /** Crew to restore to the owning ship (fighter return). Capped at maxCrew. */
  healOwn?: number;
  /** Laser flashes to add to the world this frame. */
  lasers?: LaserFlash[];
  /** If true, skip the generic tracking logic in Battle.tsx this frame. */
  skipDefaultTracking?: boolean;
  /** If true, skip the generic setVelocityVector call in Battle.tsx this frame. */
  skipVelocityUpdate?: boolean;
  /** Sound keys to play after applying this effect (Battle.tsx dispatches). */
  sounds?: Array<'fighter_laser' | 'fighter_dock'>;
}

// ─── Collision effect returned by onMissileHit() ─────────────────────────────

/**
 * Effects a controller wants Battle.tsx to apply when one of its missiles
 * collides.  target === null means planet collision.
 */
export interface MissileHitEffect {
  /** If true, skip the default blast explosion at the impact site. */
  skipBlast?: boolean;
  /** Spawn a splinter explosion at the impact position with this velocity. */
  splinter?: { vx: number; vy: number };
  /** Add this many frames of impairment to the target ship (limpet). */
  impairTarget?: number;
  /** Permanently attach this many limpets to the target ship. */
  attachLimpet?: number;
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

  /**
   * Draw a missile owned by this ship.
   * Optional — ships without custom projectile sprites can omit this;
   * Battle.tsx will fall back to a placeholder dot.
   */
  drawMissile?(dc: DrawContext, m: BattleMissile, sprites: unknown): void;

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
  ): void;
}
