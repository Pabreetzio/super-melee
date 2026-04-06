import { DISPLAY_TO_WORLD } from '../velocity';

export const BATTLE_CANVAS_W = 640;
export const BATTLE_CANVAS_H = 480;
export const STATUS_PANEL_W = 128;
export const SPACE_CANVAS_W = BATTLE_CANVAS_W - STATUS_PANEL_W;
export const SPACE_CANVAS_H = BATTLE_CANVAS_H;

export const MAX_REDUCTION = 3;

// UQM simulates the melee arena inside the space viewport, not the full screen.
// Our battle canvas is a 2x presentation of that viewport plus the overlaid
// status column, so the arena width tracks the visible 512px battle region.
export const WORLD_W = SPACE_CANVAS_W << (2 + MAX_REDUCTION);
export const WORLD_H = SPACE_CANVAS_H << (2 + MAX_REDUCTION);

export const PLANET_X = WORLD_W >> 1;
export const PLANET_Y = WORLD_H >> 1;
export const PLANET_RADIUS_W = 160;
export const GRAVITY_THRESHOLD_W = DISPLAY_TO_WORLD(255);
