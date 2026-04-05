// Ship registry — maps every ShipId to its ShipController.
//
// Implemented ships have full physics/sprites in their own file (RACE_DESC pattern).
// Unimplemented ships fall back to a default controller that uses Earthling
// Cruiser movement and generic sprite loading until they are fleshed out.

import type { ShipId } from 'shared/types';
import type { ShipController, ShipState, DrawContext } from './types';
import type { SpriteFrame } from '../sprites';
import { getAllShips } from './index';
import { loadGenericShipSprites, drawSprite, placeholderDot } from '../sprites';
import { makeHumanShip, updateHumanShip } from './human';

import { humanController  } from './human';
import { spathiController } from './spathi';
import { urquanController } from './urquan';
import { pkunkController  } from './pkunk';
import { vuxController    } from './vux';
import { kohrahController } from './kohrah';
import { myconController  } from './mycon';
import { arilouController } from './arilou';

// ─── Fallback controller for unimplemented ships ──────────────────────────────

function makeDefaultController(id: ShipId): ShipController {
  const def = getAllShips().find(s => s.id === id);

  return {
    maxCrew:   def?.crew   ?? 18,
    maxEnergy: def?.energy ?? 18,

    make(x: number, y: number): ShipState {
      const s = makeHumanShip(x, y);
      s.crew   = def?.crew   ?? s.crew;
      s.energy = def?.energy ?? s.energy;
      return s;
    },

    update: updateHumanShip,

    loadSprites: () => loadGenericShipSprites(id).then(sp => sp ?? null),

    drawShip(dc: DrawContext, ship: ShipState, sprites: unknown): void {
      // loadGenericShipSprites returns ShipSpriteSet | null
      const sp = sprites as { big: object; med: object; sml: object } | null;
      const set = sp
        ? (dc.reduction >= 2 ? sp.sml : dc.reduction === 1 ? sp.med : sp.big) as Parameters<typeof drawSprite>[1] | null
        : null;
      if (set) {
        drawSprite(dc.ctx, set, ship.facing, ship.x, ship.y, dc.canvasW, dc.canvasH, dc.camX, dc.camY, dc.reduction);
      } else {
        placeholderDot(dc.ctx, ship.x, ship.y, dc.camX, dc.camY, 8, '#4af', dc.reduction);
      }
    },

    getShipCollisionFrame(ship: ShipState, sprites: unknown): SpriteFrame | null {
      const sp = sprites as { big?: { frames: (SpriteFrame | null)[] } } | null;
      return sp?.big?.frames[ship.facing] ?? null;
    },

    // No custom missile sprite — Battle.tsx will call the owner controller's
    // drawMissile and fall through to placeholderDot.
  };
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const EXPLICIT: Partial<Record<ShipId, ShipController>> = {
  human:   humanController,
  spathi:  spathiController,
  urquan:  urquanController,
  pkunk:   pkunkController,
  vux:     vuxController,
  kohrah:  kohrahController,
  mycon:   myconController,
  arilou:  arilouController,
};

export const IMPLEMENTED_SHIP_IDS = new Set<ShipId>(Object.keys(EXPLICIT) as ShipId[]);

// Build the full registry, filling every ShipId with either the explicit
// controller or a generated default.  Computed once at module load.
const _registry: Partial<Record<ShipId, ShipController>> = {};
for (const ship of getAllShips()) {
  _registry[ship.id] = EXPLICIT[ship.id] ?? makeDefaultController(ship.id);
}

export const SHIP_REGISTRY = _registry as Record<ShipId, ShipController>;

export function getController(id: ShipId): ShipController {
  return SHIP_REGISTRY[id] ?? humanController;
}

export function isShipImplemented(id: ShipId): boolean {
  return IMPLEMENTED_SHIP_IDS.has(id);
}
