import { DISPLAY_TO_WORLD } from '../velocity';

export const PRESENTATION_SCALE = 2;

export const LOGICAL_BATTLE_CANVAS_W = 320;
export const LOGICAL_BATTLE_CANVAS_H = 240;
export const LOGICAL_STATUS_PANEL_W = 64;
export const LOGICAL_SPACE_CANVAS_W = LOGICAL_BATTLE_CANVAS_W - LOGICAL_STATUS_PANEL_W;
export const LOGICAL_SPACE_CANVAS_H = LOGICAL_BATTLE_CANVAS_H;

export const BATTLE_CANVAS_W = LOGICAL_BATTLE_CANVAS_W * PRESENTATION_SCALE;
export const BATTLE_CANVAS_H = LOGICAL_BATTLE_CANVAS_H * PRESENTATION_SCALE;
export const STATUS_PANEL_W = LOGICAL_STATUS_PANEL_W * PRESENTATION_SCALE;
export const SPACE_CANVAS_W = LOGICAL_SPACE_CANVAS_W * PRESENTATION_SCALE;
export const SPACE_CANVAS_H = LOGICAL_SPACE_CANVAS_H * PRESENTATION_SCALE;

export const MAX_REDUCTION = 3;
export const MAX_VIS_REDUCTION = 2;

// UQM simulates the melee arena inside the space viewport, not the full screen.
// Keep simulation in the original logical 256x240 battle viewport and present
// it at 2x in the browser.
export const WORLD_W = LOGICAL_SPACE_CANVAS_W << (2 + MAX_REDUCTION);
export const WORLD_H = LOGICAL_SPACE_CANVAS_H << (2 + MAX_REDUCTION);

export const PLANET_X = WORLD_W >> 1;
export const PLANET_Y = WORLD_H >> 1;
export const PLANET_RADIUS_W = 160;
export const GRAVITY_THRESHOLD_W = DISPLAY_TO_WORLD(255);
