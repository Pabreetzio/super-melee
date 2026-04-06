// Generic AI fallback used when a ship controller does not implement computeAIInput.
// Matches UQM's human_intelligence behavior (Earthling Cruiser AI).

import type { AIDifficulty } from 'shared/types';
import type { ShipState, BattleMissile } from '../ships/types';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2 } from '../game';
import { DISPLAY_TO_WORLD } from '../velocity';
import { worldAngle } from './helpers';

/**
 * 1. Turn toward enemy
 * 2. Thrust when roughly facing enemy
 * 3. Fire when well-aligned
 * 4. Fire special (point defense) when enemy missile is close
 */
export function computeAIInput(
  ai: ShipState,
  target: ShipState,
  nukes: BattleMissile[],
  aiSide: 0 | 1,
  aiDifficulty: AIDifficulty,
): number {
  let input = 0;

  const rawAngle    = worldAngle(ai.x, ai.y, target.x, target.y);
  const targetFacing = Math.round(rawAngle / 4) & 15;
  const facingDiff   = ((targetFacing - ai.facing + 16) % 16);

  if (facingDiff >= 1 && facingDiff <= 8) input |= INPUT_RIGHT;
  else if (facingDiff > 8)                input |= INPUT_LEFT;

  const thrustWindow = aiDifficulty === 'cyborg_awesome' ? 4 : aiDifficulty === 'cyborg_good' ? 3 : 2;
  if (facingDiff <= thrustWindow || facingDiff >= 16 - thrustWindow) input |= INPUT_THRUST;

  const fireWindow = aiDifficulty === 'cyborg_awesome' ? 1 : aiDifficulty === 'cyborg_good' ? 1 : 0;
  if (facingDiff <= fireWindow || facingDiff >= 16 - fireWindow) input |= INPUT_FIRE1;

  const aiRangeW = DISPLAY_TO_WORLD(aiDifficulty === 'cyborg_awesome' ? 96 : aiDifficulty === 'cyborg_good' ? 84 : 72);
  const hasIncomingNuke = nukes.some(n => {
    if (n.owner === aiSide) return false;
    const dx = n.x - ai.x; const dy = n.y - ai.y;
    return dx * dx + dy * dy < aiRangeW * aiRangeW;
  });
  if (hasIncomingNuke) input |= INPUT_FIRE2;

  return input;
}
