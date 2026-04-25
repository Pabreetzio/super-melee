import type { ShipState } from '../ships/types';
import { MAX_REDUCTION } from './constants';

export const ZOOM_SHIFT = 8;
export const MAX_ZOOM_OUT = 1 << (ZOOM_SHIFT + MAX_REDUCTION - 1);
const MIN_ZOOM_OUT = 1 << ZOOM_SHIFT;

function toroidalSeparation(a: number, b: number, worldSize: number): number {
  let d = Math.abs(b - a);
  if (d > worldSize >> 1) d = worldSize - d;
  return d;
}

export function calcContinuousZoomOut(
  ships: [ShipState, ShipState],
  worldW: number,
  worldH: number,
): number {
  const dx = toroidalSeparation(ships[0].x, ships[1].x, worldW);
  const dy = toroidalSeparation(ships[0].y, ships[1].y, worldH);

  let zoomX = Math.trunc((dx * MAX_ZOOM_OUT) / (worldW >> 2));
  let zoomY = Math.trunc((dy * MAX_ZOOM_OUT) / (worldH >> 2));

  if (zoomX < MIN_ZOOM_OUT) zoomX = MIN_ZOOM_OUT;
  else if (zoomX > MAX_ZOOM_OUT) zoomX = MAX_ZOOM_OUT;

  if (zoomY < MIN_ZOOM_OUT) zoomY = MIN_ZOOM_OUT;
  else if (zoomY > MAX_ZOOM_OUT) zoomY = MAX_ZOOM_OUT;

  return Math.max(zoomX, zoomY);
}

export function zoomOutToWorldUnitsPerLogicalPixel(zoomOut: number): number {
  return zoomOut / (1 << (ZOOM_SHIFT - 2));
}

export function smoothZoomBucket(zoomOut: number): 0 | 1 | 2 {
  if (zoomOut < (2 << ZOOM_SHIFT)) return 0;
  if (zoomOut < (4 << ZOOM_SHIFT)) return 1;
  return 2;
}

export function smoothZoomSpriteScale(zoomOut: number): number {
  const bucket = smoothZoomBucket(zoomOut);
  return (1 << (bucket + ZOOM_SHIFT + 8)) / zoomOut / 256;
}
