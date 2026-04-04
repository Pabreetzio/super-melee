import type { SpriteFrame } from '../sprites';
import { WORLD_TO_DISPLAY } from '../velocity';
import { worldDelta } from './helpers';

function maskAt(frame: SpriteFrame, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= frame.img.width || y >= frame.img.height) return false;
  return frame.mask[y * frame.img.width + x] !== 0;
}

function spriteMasksOverlapInternal(
  aFrame: SpriteFrame,
  aX: number,
  aY: number,
  bFrame: SpriteFrame,
  bX: number,
  bY: number,
  worldW: number,
  worldH: number,
  paddingPx: number,
): boolean {
  const { dx, dy } = worldDelta(aX, aY, bX, bY, worldW, worldH);
  const bLeft = WORLD_TO_DISPLAY(dx) - bFrame.hotX;
  const bTop = WORLD_TO_DISPLAY(dy) - bFrame.hotY;
  const aLeft = -aFrame.hotX;
  const aTop = -aFrame.hotY;

  const left = Math.max(aLeft, bLeft);
  const top = Math.max(aTop, bTop);
  const right = Math.min(aLeft + aFrame.img.width, bLeft + bFrame.img.width);
  const bottom = Math.min(aTop + aFrame.img.height, bTop + bFrame.img.height);
  if (left >= right || top >= bottom) return false;

  for (let y = top; y < bottom; y++) {
    const ay = y - aTop;
    for (let x = left; x < right; x++) {
      if (!maskAt(aFrame, x - aLeft, ay)) continue;
      if (paddingPx <= 0) {
        if (maskAt(bFrame, x - bLeft, y - bTop)) return true;
        continue;
      }
      for (let oy = -paddingPx; oy <= paddingPx; oy++) {
        for (let ox = -paddingPx; ox <= paddingPx; ox++) {
          if (maskAt(bFrame, x - bLeft + ox, y - bTop + oy)) return true;
        }
      }
    }
  }
  return false;
}

export function spriteMasksOverlap(
  aFrame: SpriteFrame,
  aX: number,
  aY: number,
  bFrame: SpriteFrame,
  bX: number,
  bY: number,
  worldW: number,
  worldH: number,
): boolean {
  return spriteMasksOverlapInternal(aFrame, aX, aY, bFrame, bX, bY, worldW, worldH, 0);
}

export function spriteMasksOverlapPadded(
  aFrame: SpriteFrame,
  aX: number,
  aY: number,
  bFrame: SpriteFrame,
  bX: number,
  bY: number,
  worldW: number,
  worldH: number,
  paddingPx: number,
): boolean {
  return spriteMasksOverlapInternal(aFrame, aX, aY, bFrame, bX, bY, worldW, worldH, paddingPx);
}

export function spriteMaskIntersectsCircle(
  frame: SpriteFrame,
  spriteX: number,
  spriteY: number,
  circleX: number,
  circleY: number,
  radiusWorld: number,
  worldW: number,
  worldH: number,
): boolean {
  const { dx, dy } = worldDelta(spriteX, spriteY, circleX, circleY, worldW, worldH);
  const circleDx = WORLD_TO_DISPLAY(dx);
  const circleDy = WORLD_TO_DISPLAY(dy);
  const radiusPx = Math.max(1, WORLD_TO_DISPLAY(radiusWorld));
  const radiusSq = radiusPx * radiusPx;
  const left = -frame.hotX;
  const top = -frame.hotY;

  for (let y = 0; y < frame.img.height; y++) {
    const worldY = top + y;
    const relY = worldY - circleDy;
    const relYSq = relY * relY;
    if (relYSq > radiusSq) continue;
    for (let x = 0; x < frame.img.width; x++) {
      if (!maskAt(frame, x, y)) continue;
      const relX = (left + x) - circleDx;
      if (relX * relX + relYSq <= radiusSq) return true;
    }
  }
  return false;
}

export function sweptSpriteMasksOverlap(
  aFrame: SpriteFrame,
  aPrevX: number,
  aPrevY: number,
  aX: number,
  aY: number,
  bFrame: SpriteFrame,
  bPrevX: number,
  bPrevY: number,
  bX: number,
  bY: number,
  worldW: number,
  worldH: number,
): boolean {
  return sweptSpriteMasksOverlapPadded(
    aFrame, aPrevX, aPrevY, aX, aY,
    bFrame, bPrevX, bPrevY, bX, bY,
    worldW, worldH, 0,
  );
}

export function sweptSpriteMasksOverlapPadded(
  aFrame: SpriteFrame,
  aPrevX: number,
  aPrevY: number,
  aX: number,
  aY: number,
  bFrame: SpriteFrame,
  bPrevX: number,
  bPrevY: number,
  bX: number,
  bY: number,
  worldW: number,
  worldH: number,
  paddingPx: number,
): boolean {
  const { dx: aMoveX, dy: aMoveY } = worldDelta(aPrevX, aPrevY, aX, aY, worldW, worldH);
  const { dx: bMoveX, dy: bMoveY } = worldDelta(bPrevX, bPrevY, bX, bY, worldW, worldH);
  const maxMovePx = Math.max(
    Math.abs(WORLD_TO_DISPLAY(aMoveX)),
    Math.abs(WORLD_TO_DISPLAY(aMoveY)),
    Math.abs(WORLD_TO_DISPLAY(bMoveX)),
    Math.abs(WORLD_TO_DISPLAY(bMoveY)),
  );
  const steps = Math.max(1, Math.ceil(maxMovePx));

  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const aSampleX = aPrevX + Math.round(aMoveX * t);
    const aSampleY = aPrevY + Math.round(aMoveY * t);
    const bSampleX = bPrevX + Math.round(bMoveX * t);
    const bSampleY = bPrevY + Math.round(bMoveY * t);
    if (spriteMasksOverlapInternal(aFrame, aSampleX, aSampleY, bFrame, bSampleX, bSampleY, worldW, worldH, paddingPx)) {
      return true;
    }
  }

  return false;
}
