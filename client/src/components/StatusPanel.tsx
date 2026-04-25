// StatusPanel — UQM-faithful side status display rendered to a Canvas.
//
// Layout is based on the original UQM status.c / shipstat.c source at 320×240
// logical resolution, scaled 2× to 128×480 for display at 640×480 screen res.
//
// Logical UQM coordinates (from status.h / units.h with SAFE_Y=0):
//   STATUS_WIDTH       = 64  (→ 128 at 2×)
//   STATUS_HEIGHT      = 480 (/2 per player = 240  → 480 at 2×? No — see below)
//
// UQM ran at 320×240 internally; STATUS_HEIGHT = 240, SHIP_STATUS_HEIGHT = 120.
// We render the 64×120 per-player area at 2× → 128×240 px per player.
// Total canvas: 128×480 (two players stacked).
//
// Key constants (all ×2 from UQM originals unless noted):
//   STATUS_W   = 128      SHIP_INFO_H  = 130  (65×2)
//   GAUGE_Y    = 110      (bottom of gauge = GAUGE_YOFFS×2 = 55×2)
//   CAP_Y      = 138      (CAPTAIN_YOFFS×2 = 69×2)  within player section
//   CAP_W      = 110      CAP_H = 60   (55×30 portrait at 2×)
//   CAP_X      = 8        (CAPTAIN_XOFFS×2 = 4×2)
//   CREW_X     = 8        (CREW_XOFFS×2)
//   ENERGY_X   = 104      (ENERGY_XOFFS×2)
//   UNIT_W     = 4        UNIT_H = 2   (UNIT_WIDTH×2, UNIT_HEIGHT×2)
//   STAT_W     = 14       (STAT_WIDTH×2 = 7×2)

import React, { useEffect, useRef } from 'react';
import type { ShipId } from 'shared/types';
import { SHIP_STATUS_DATA, pickCaptain, type ShipStatusDef } from '../engine/ships/statusData';
import { INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2 } from '../engine/game';
import { loadAtlasImageAsset } from '../engine/atlasAssets';

// ─── Layout constants (2× scale) ───────────────────────────────────────────

const S = 2;                      // scale factor
const STATUS_W    = 64 * S;       // 128 — total panel width
const SECTION_H   = 120 * S;      // 240 — height per player section
const SHIP_INFO_H = 65 * S;       // 130 — ship-icon + gauge area
const GAUGE_Y     = 55 * S;       // 110 — gauge bottom y within section
const CREW_X      = 4 * S;        //   8
const ENERGY_X    = 52 * S;       // 104
const UNIT_W      = 2 * S;        //   4 — one dot width (two cols)
const UNIT_H      = 1 * S;        //   2 — one dot height
const STAT_W      = 7 * S;        //  14 — total gauge column width
const CAP_X       = 4 * S;        //   8 — captain portrait left edge
const CAP_Y_OFF   = 75 * S;       // 150 — portrait top, from section top (pushed down to make room for captain name)
const CAP_W       = 55 * S;       // 110 — portrait width
const CAP_H       = 30 * S;       //  60 — portrait height
const ICON_CY     = 31 * S;       //  62 — ship icon center Y within section
const NAME_Y      = (7 + 3) * S;  //  20 — race name baseline Y within section
const COMPACT_SINGLE_H = 67 * S;  // 134 — matches doubled melee menu preview art
// ─── UQM Font sizes (native UQM pixels × S for canvas) ──────────────────────

const FONT_STARCON_PX = 7 * S;    // 14 — race name (slightly smaller than native 9px×2)
const FONT_TINY_PX    = 12;       // 12px — captain name (sits between the gauge bars)
const FONT_MICRO_PX   = 8;        // 8px — small status labels
const CAPTAIN_DEFEAT_FRAME_MS = 1000 / 24;

// ─── Font loading ────────────────────────────────────────────────────────────

// Fonts are loaded once at module init. The RAF loop falls back to monospace
// until they're ready, then automatically switches on the next frame.
let uqmFontsReady = false;
void Promise.all(
  [
    new FontFace('UQMStarCon', 'url(/fonts/starcon.woff2)'),
    new FontFace('UQMTiny',    'url(/fonts/tiny.woff2)'),
    new FontFace('UQMMicro',   'url(/fonts/micro.woff2)'),
  ].map(face => { document.fonts.add(face); return face.load(); }),
).then(() => { uqmFontsReady = true; });

// ─── Colors (from UQM colors.h MAKE_RGB15 values) ──────────────────────────

const C_BG         = '#525252';  // panel background  (0x0A,0x0A,0x0A ×8 = #52)
const C_DARK       = '#414141';  // 3-D recessed border (0x08,0x08,0x08 ×8 = #41)
const C_LIGHT      = '#838383';  // 3-D raised border   (0x10,0x10,0x10 ×8 = #83)
const C_CREW_ON    = '#00a800';  // active crew dot     (0x00,0x15,0x00)
const C_CREW_OFF   = '#202020';  // empty crew slot
const C_ENERGY_ON  = '#a80000';  // active energy dot   (0x15,0x00,0x00)
const C_ENERGY_OFF = '#201010';  // empty energy slot
const C_SHADOW     = '#787878';  // race name drop shadow — lighter than C_BG (#525252)
const C_LABEL      = '#a0a0a0';  // CREW / BATT label text
const C_BLACK      = '#000000';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SideStatus {
  shipId:    ShipId;
  crew:      number;
  maxCrew:   number;
  energy:    number;
  maxEnergy: number;
  limpetCount?: number;
  orzBoardSlots?: boolean[];
  orzBoardDamageFlash?: number[];
  inputs:    number;   // current input bit flags (INPUT_THRUST | INPUT_LEFT …)
  captainIdx: number;  // which captain name to show (stable per match)
  shofixtiSafetyLevel?: number;
  shofixtiGloryFrames?: number;
  caption?:  string;   // optional override for the center status caption
}

interface CaptainDefeatState {
  key: string | null;
  startedAt: number | null;
  wasAlive: boolean;
}

interface Props {
  /**
   * A ref (not a value) so the rAF loop always reads the latest data written
   * by Battle.tsx's game loop without requiring React re-renders.
   * side 0 = top section (bad guy / enemy), side 1 = bottom (good guy / you).
   */
  sidesRef: React.MutableRefObject<[SideStatus | null, SideStatus | null]>;
  layout?: 'dual' | 'single';
  singleSideIndex?: 0 | 1;
  showCaptain?: boolean;
  showStatLabels?: boolean;
  compactSingle?: boolean;
}

// ─── Image cache ────────────────────────────────────────────────────────────

// Shared module-level image cache so switching ships doesn't reload on every render.
interface RenderableImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

const imgCache = new Map<string, RenderableImage | null>();

/**
 * Per-icon horizontal offset: (ship-body center x) − (image center x) in
 * native image pixels. Positive means the ship body is right of the image
 * midpoint (shadow is to the left). Computed once per URL on first draw and
 * cached so we can shift the icon left to visually centre the ship, not the
 * shadow-inclusive image rectangle.
 */
const iconShipOffsetCache = new Map<string, number>();

function computeIconShipOffset(img: RenderableImage): number {
  const w = img.width;
  const h = img.height;
  const tmp = document.createElement('canvas');
  tmp.width  = w;
  tmp.height = h;
  const tCtx = tmp.getContext('2d');
  if (!tCtx) return 0;
  tCtx.drawImage(img.source, 0, 0, w, h);
  const { data } = tCtx.getImageData(0, 0, w, h);
  let sumX = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a > 10 && (data[i] + data[i+1] + data[i+2]) / 3 > 60) {
      sumX += (i / 4) % w;
      count++;
    }
  }
  return count > 0 ? sumX / count - w / 2 : 0;
}

function loadImg(url: string): Promise<RenderableImage> {
  return new Promise((resolve, reject) => {
    if (imgCache.has(url)) {
      const cached = imgCache.get(url);
      if (cached) resolve(cached); else reject(new Error('not found'));
      return;
    }
    loadAtlasImageAsset(url)
      .then(img => {
        if (!img) {
          imgCache.set(url, null);
          reject(new Error(`Failed: ${url}`));
          return;
        }
        imgCache.set(url, img);
        resolve(img);
      })
      .catch(err => {
        imgCache.set(url, null);
        reject(err);
      });
  });
}

/** Pre-load all images needed to display one ship's status section. */
async function preloadShip(shipId: ShipId): Promise<void> {
  const def = SHIP_STATUS_DATA[shipId];
  if (!def) return;
  const { sprite } = def;
  const base = `/ships/${shipId}`;
  const urls: string[] = [
    `${base}/${sprite}-icons-001.png`,
  ];
  // Captain portrait frames (background + 4 animation groups)
  for (let i = 0; i < def.capCount; i++) {
    urls.push(`${base}/${sprite}-cap-${String(i).padStart(3, '0')}.png`);
  }
  await Promise.allSettled(urls.map(loadImg));
}

async function preloadLimpetOverlay(): Promise<void> {
  const urls: string[] = [];
  for (let i = 0; i < 6; i++) {
    urls.push(`/ships/vux/slime-${String(i).padStart(3, '0')}.png`);
  }
  await Promise.allSettled(urls.map(loadImg));
}

function getImg(url: string): RenderableImage | null {
  return imgCache.get(url) ?? null;
}

async function preloadOrzBoardOverlay(): Promise<void> {
  const urls: string[] = [];
  for (let i = 22; i <= 31; i++) {
    urls.push(`/ships/orz/turret-big-${String(i).padStart(3, '0')}.png`);
  }
  await Promise.allSettled(urls.map(loadImg));
}

// ─── Drawing helpers ────────────────────────────────────────────────────────

function drawSection(
  ctx: CanvasRenderingContext2D,
  sectionY: number,
  side: SideStatus,
  options: { showCaptain: boolean; showStatLabels: boolean; nowMs: number; captainDefeatStartedAt: number | null },
) {
  const def = SHIP_STATUS_DATA[side.shipId];
  const { sprite } = def ?? { sprite: '' };
  const shipBase = `/ships/${side.shipId}`;

  // ── Background fill ───────────────────────────────────────────────────────
  ctx.fillStyle = C_BG;
  ctx.fillRect(0, sectionY, STATUS_W, SECTION_H);

  // ── Outer border (ship-info area) — dark top/left, light right/bottom ─────
  // Top black line
  ctx.fillStyle = C_BLACK;
  ctx.fillRect(0, sectionY, STATUS_W, S);

  // Dark left strips (2px)
  ctx.fillStyle = C_DARK;
  ctx.fillRect(0, sectionY + S, S, SHIP_INFO_H - S);
  ctx.fillRect(S, sectionY + S, S, SHIP_INFO_H - 2 * S);

  // Light right strips (2px)
  ctx.fillStyle = C_LIGHT;
  ctx.fillRect(STATUS_W - S,  sectionY + S, S, SHIP_INFO_H - S);
  ctx.fillRect(STATUS_W - 2*S, sectionY + 2*S, S, SHIP_INFO_H - 2*S);

  // ── Race name ─────────────────────────────────────────────────────────────
  const raceName = (def?.race ?? side.shipId);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (uqmFontsReady) {
    // Auto-scale StarCon to fit within the panel with 4px padding each side.
    const maxW = STATUS_W - 4 * S;
    ctx.font = `${FONT_STARCON_PX}px "UQMStarCon"`;
    const measured = ctx.measureText(raceName).width;
    const sizePx = measured > maxW
      ? Math.floor(FONT_STARCON_PX * maxW / measured)
      : FONT_STARCON_PX;
    ctx.font = `${sizePx}px "UQMStarCon"`;
  } else {
    ctx.font = `bold ${7*S}px monospace`;
  }
  // Shadow one pixel below, in a lighter grey than the panel background
  ctx.fillStyle = C_SHADOW;
  ctx.fillText(raceName, STATUS_W / 2, sectionY + NAME_Y + S);
  // Main text in black
  ctx.fillStyle = C_BLACK;
  ctx.fillText(raceName, STATUS_W / 2, sectionY + NAME_Y);

  // ── Ship icon (icons-001.png, centered at ICON_CY) ────────────────────────
  const iconUrl = `${shipBase}/${sprite}-icons-001.png`;
  const iconImg = getImg(iconUrl);
  if (iconImg) {
    const iw = iconImg.width  * S;
    const ih = iconImg.height * S;
    ctx.imageSmoothingEnabled = false;
    // Compute ship-body centre offset on first use, then cache it.
    // Shifts the icon left so the ship body (not the shadow) is centred.
    if (!iconShipOffsetCache.has(iconUrl)) {
      iconShipOffsetCache.set(iconUrl, computeIconShipOffset(iconImg));
    }
    const bodyOffset = iconShipOffsetCache.get(iconUrl)! * S;
    const iconX = Math.round(STATUS_W / 2 - iw / 2 - bodyOffset);
    const iconY = sectionY + ICON_CY - ih / 2;
    ctx.drawImage(iconImg.source, iconX, iconY, iw, ih);
    drawLimpetOverlay(ctx, side.limpetCount ?? 0, iconX, iconY, iw, ih);
    drawOrzBoardOverlay(ctx, side.orzBoardSlots ?? [], side.orzBoardDamageFlash ?? [], iconX, iconY, iw, ih);
  }

  // ── Crew gauge ────────────────────────────────────────────────────────────
  drawGauge(ctx, sectionY, CREW_X, side.crew, side.maxCrew, C_CREW_ON, C_CREW_OFF);

  // ── Energy gauge ──────────────────────────────────────────────────────────
  drawGauge(ctx, sectionY, ENERGY_X, side.energy, side.maxEnergy, C_ENERGY_ON, C_ENERGY_OFF);

  // ── CREW / BATT labels ────────────────────────────────────────────────────
  if (options.showStatLabels) {
    if (uqmFontsReady) {
      ctx.font = `${FONT_MICRO_PX}px "UQMMicro"`;
    } else {
      ctx.font = `${5*S}px monospace`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = C_LABEL;
    // UQM: CREW label x = CREW_X + (STAT_W/2) centered; BATT = ENERGY_X + (STAT_W/2)
    ctx.fillText('CREW', CREW_X   + STAT_W / 2, sectionY + GAUGE_Y + 2 * S);
    ctx.fillText('BATT', ENERGY_X + STAT_W / 2, sectionY + GAUGE_Y + 2 * S);
  }

  // ── Captain section border ─────────────────────────────────────────────────
  const capSecY = sectionY + SHIP_INFO_H;
  const capSecH = SECTION_H - SHIP_INFO_H;

  // Left dark strips
  ctx.fillStyle = C_DARK;
  ctx.fillRect(0,   capSecY, S,   capSecH - S);
  ctx.fillRect(S,   capSecY, S,   capSecH - 2*S);

  // Right light strips
  ctx.fillStyle = C_LIGHT;
  ctx.fillRect(STATUS_W - S,   capSecY, S, capSecH);
  ctx.fillRect(STATUS_W - 2*S, capSecY, S, capSecH);

  // Bottom light strip
  ctx.fillStyle = C_LIGHT;
  ctx.fillRect(S,   capSecY + capSecH - S,   STATUS_W - 2*S, S);
  ctx.fillRect(0,   capSecY + capSecH,       STATUS_W,       S);

  // ── Captain portrait ──────────────────────────────────────────────────────
  const capTop = sectionY + CAP_Y_OFF;

  if (options.showCaptain) {
    // Portrait border: dark right+bottom, light top+left (around the portrait box)
    ctx.fillStyle = C_DARK;
    ctx.fillRect(CAP_X + CAP_W - S, capTop,          S,   CAP_H);   // right
    ctx.fillRect(CAP_X,             capTop + CAP_H,  CAP_W - S, S); // bottom
    ctx.fillStyle = C_LIGHT;
    ctx.fillRect(CAP_X,     capTop - S,    CAP_W - S, S);            // top
    ctx.fillRect(CAP_X,     capTop,        S,         CAP_H);        // left

    // Portrait background (frame 0)
    if (def && sprite) {
      const bg = getImg(`${shipBase}/${sprite}-cap-000.png`);
      if (bg) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(bg.source, CAP_X, capTop, CAP_W, CAP_H);
      }
    }

    // Captain animation overlays based on current inputs
    if (def && sprite && def.capCount > 0) {
      drawCaptainOverlays(ctx, shipBase, sprite, capTop, side.inputs, def, side.shofixtiSafetyLevel ?? 0, side.shofixtiGloryFrames ?? 0);
    }

    if (options.captainDefeatStartedAt !== null) {
      drawCaptainDefeat(ctx, capTop, options.nowMs - options.captainDefeatStartedAt);
    }
  }

  // ── Captain name — centered horizontally between the two gauge columns,
  //    baseline at the bottom edge of the bars (GAUGE_Y). Most of the text
  //    sits between the bars; a small descender hangs just below.
  const caption = side.caption ?? (def ? pickCaptain(side.shipId, side.captainIdx) : '');
  if (caption) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    // Max width = gap between the right edge of the crew column and the
    // left edge of the energy column, with a little breathing room.
    const capNameMaxW = ENERGY_X - (CREW_X + STAT_W) - 2 * S;  // ~78px
    if (uqmFontsReady) {
      ctx.font = `${FONT_TINY_PX}px "UQMTiny"`;
      const measured = ctx.measureText(caption).width;
      const sizePx = measured > capNameMaxW
        ? Math.floor(FONT_TINY_PX * capNameMaxW / measured)
        : FONT_TINY_PX;
      ctx.font = `${sizePx}px "UQMTiny"`;
    } else {
      ctx.font = `bold ${3*S}px monospace`;
    }
    ctx.fillStyle = C_BLACK;
    // Sit the baseline slightly below GAUGE_Y so the text straddles the
    // bottom line of the bars — most glyphs above, descenders just below.
    ctx.fillText(caption, STATUS_W / 2, sectionY + GAUGE_Y + S);
  }
}

function drawLimpetOverlay(
  ctx: CanvasRenderingContext2D,
  limpetCount: number,
  iconX: number,
  iconY: number,
  iconW: number,
  iconH: number,
) {
  if (limpetCount <= 0) return;

  const slots: Array<[number, number]> = [
    [0.16, 0.20],
    [0.62, 0.18],
    [0.34, 0.42],
    [0.70, 0.48],
    [0.22, 0.66],
    [0.58, 0.72],
  ];
  const count = Math.min(limpetCount, slots.length);

  for (let i = 0; i < count; i++) {
    const frame = getImg(`/ships/vux/slime-${String(i).padStart(3, '0')}.png`);
    if (!frame) continue;
    const [sx, sy] = slots[i];
    const w = frame.width * S;
    const h = frame.height * S;
    const x = Math.round(iconX + iconW * sx - w / 2);
    const y = Math.round(iconY + iconH * sy - h / 2);
    ctx.drawImage(frame.source, x, y, w, h);
  }
}

function drawOrzBoardOverlay(
  ctx: CanvasRenderingContext2D,
  boardSlots: boolean[],
  damageFlash: number[],
  iconX: number,
  iconY: number,
  iconW: number,
  iconH: number,
) {
  if (!boardSlots.some(Boolean)) return;

  const cols = [0.12, 0.36, 0.66, 0.92];
  const rows = [0.26, 0.60];
  for (let i = 0; i < 8; i++) {
    if (!boardSlots[i]) continue;
    const frameId = (damageFlash[i] ?? 0) > 0 ? 31 : 30;
    const frame = getImg(`/ships/orz/turret-big-${String(frameId).padStart(3, '0')}.png`);
    if (!frame) continue;
    const col = i & 3;
    const row = i >> 2;
    const w = frame.width * S;
    const h = frame.height * S;
    const x = Math.round(iconX + iconW * cols[col] - w / 2);
    const y = Math.round(iconY + iconH * rows[row] - h / 2);
    ctx.drawImage(frame.source, x, y, w, h);
  }
}

/**
 * Draw crew or energy dots, stacked upward from GAUGE_Y.
 * Two dot columns per row (UQM STAT_WIDTH = 1+2+1+2+1 with 1px borders).
 */
function drawGauge(
  ctx: CanvasRenderingContext2D,
  sectionY: number,
  gaugeX: number,
  current: number,
  max: number,
  colorOn: string,
  colorOff: string,
) {
  const capped = Math.min(max, 42);                          // UQM MAX_CREW_SIZE = 42
  const rows   = Math.ceil(capped / 2);                     // pairs stacked vertically
  const gaugeH = rows * (UNIT_H + S) + S;                   // height of gauge box
  const boxTop = sectionY + GAUGE_Y - gaugeH;

  // Gauge border (dark, 1px each side of both columns at UQM scale)
  ctx.fillStyle = C_DARK;
  ctx.fillRect(gaugeX - S, boxTop - S, STAT_W + 2*S, S);    // top
  ctx.fillRect(gaugeX - S, boxTop,     S,             gaugeH); // left
  ctx.fillRect(gaugeX + STAT_W, boxTop, S,            gaugeH); // right
  ctx.fillRect(gaugeX - S, boxTop + gaugeH, STAT_W + 2*S, S); // bottom

  // Black interior behind dots
  ctx.fillStyle = C_BLACK;
  ctx.fillRect(gaugeX, boxTop, STAT_W, gaugeH);

  // Draw dots (bottom-up, two per row)
  let remaining = Math.max(0, Math.min(current, capped));
  for (let row = 0; row < rows; row++) {
    const dotY = sectionY + GAUGE_Y - S - (row + 1) * (UNIT_H + S) + S;
    for (let col = 0; col < 2; col++) {
      const dotX = gaugeX + S + col * (UNIT_W + S);
      const filled = remaining > 0;
      if (filled) remaining--;
      ctx.fillStyle = filled ? colorOn : colorOff;
      ctx.fillRect(dotX, dotY, UNIT_W, UNIT_H);
    }
  }
}

/**
 * Overlay captain animation frames based on current input flags.
 * UQM frame layout (0-indexed, relative to background=0):
 *   turn    = frame 1  (base; +1=right, +3=left, +4=left-hold)
 *   thrust  = frame 6  (base; +1 or +2 when active)
 *   weapon  = frame 9  (base; +1 or +2 when active)
 *   special = frame 12 (base; +1 or +2 when active)
 *
 * Each overlay frame is drawn at its natural pixel size × S, positioned using
 * the hotspot offsets from the ship's .ani file:
 *   draw_x = CAP_X − hotspot_x × S
 *   draw_y = capTop − hotspot_y × S
 */
function drawCaptainOverlays(
  ctx: CanvasRenderingContext2D,
  shipBase: string,
  sprite: string,
  capTop: number,
  inputs: number,
  def: ShipStatusDef,
  shofixtiSafetyLevel: number,
  shofixtiGloryFrames: number,
) {
  // Clip to portrait bounds so overlays never escape
  ctx.save();
  ctx.beginPath();
  ctx.rect(CAP_X, capTop, CAP_W, CAP_H);
  ctx.clip();

  function overlay(frameIdx: number) {
    const url = `${shipBase}/${sprite}-cap-${String(frameIdx).padStart(3, '0')}.png`;
    const img = getImg(url);
    if (!img) return;
    const [ox, oy] = def.capOffsets[frameIdx] ?? [0, 0];
    const drawX = CAP_X - ox * S;
    const drawY = capTop - oy * S;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img.source, drawX, drawY, img.width * S, img.height * S);
  }

  // Turn (left takes priority over right in UQM when both held)
  if (inputs & INPUT_LEFT)       overlay(4);   // turn left
  else if (inputs & INPUT_RIGHT) overlay(2);   // turn right

  // Thrust
  if (inputs & INPUT_THRUST)     overlay(7);

  // Weapon (primary fire)
  if (inputs & INPUT_FIRE1)      overlay(10);

  // Special
  if (sprite === 'scout') {
    const shofixtiFrame = shofixtiGloryFrames > 0
      ? (shofixtiGloryFrames >= 2 ? 18 : 19)
      : shofixtiSafetyLevel >= 2
        ? 16
        : shofixtiSafetyLevel === 1
          ? 14
          : 12;
    overlay(shofixtiFrame);
  } else if (inputs & INPUT_FIRE2) {
    overlay(13);
  }

  ctx.restore();
}

function drawCaptainDefeat(
  ctx: CanvasRenderingContext2D,
  capTop: number,
  elapsedMs: number,
) {
  const frame = Math.max(0, Math.floor(elapsedMs / CAPTAIN_DEFEAT_FRAME_MS));
  const flashTab0 = ['#780000', '#f8c8c8', '#f88800', '#f8e000', '#f8f8f8'];
  const flashTab1 = [
    '#f0f890', '#f8f850', '#f8f800', '#f8e000', '#f8c000',
    '#f8a800', '#f88800', '#f87000', '#f85000', '#f83800',
    '#f81800', '#d80000', '#b80000', '#980000', '#780000',
  ];
  const flashTab2 = ['#b80000', '#780000', '#580000'];

  ctx.save();
  ctx.beginPath();
  ctx.rect(CAP_X, capTop, CAP_W, CAP_H);
  ctx.clip();

  const drawFill = (x: number, y: number, w: number, h: number, color: string) => {
    if (w <= 0 || h <= 0) return;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };

  if (frame <= 4) {
    drawFill(CAP_X, capTop, CAP_W, CAP_H, flashTab0[frame]);
  } else {
    let i = frame - 5;
    drawFill(CAP_X, capTop, CAP_W, CAP_H, C_BLACK);
    if (i <= 14) {
      const inset = i * S;
      const w = CAP_W - inset * 2;
      let h = CAP_H - inset * 2;
      if (h === 4) h += S;
      drawFill(CAP_X + inset, capTop + inset, w, h, flashTab1[i]);
    } else if ((i -= 15) <= 4) {
      const midY = capTop + 15 * S;
      const widths = [24, 20, 14, 6, 2];
      const colors = ['#980000', '#380000', '#d80000', '#f80000', '#f84028'];
      const halfWidth = widths[i];
      drawFill(CAP_X + (CAP_W >> 1) - halfWidth, midY, halfWidth, S, colors[i]);
      drawFill(CAP_X + (CAP_W >> 1), midY, halfWidth, S, colors[i]);
    } else {
      i -= 5;
      const color = i > 2 ? C_BLACK : flashTab2[i];
      drawFill(CAP_X + (CAP_W >> 1), capTop + ((CAP_H + S) >> 1), S, S, color);
    }
  }

  ctx.restore();
}

// ─── Divider between player sections ────────────────────────────────────────

function drawDivider(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = C_BLACK;
  ctx.fillRect(0, SECTION_H - S, STATUS_W, S * 2);
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function StatusPanel({
  sidesRef,
  layout = 'dual',
  singleSideIndex = 0,
  showCaptain = true,
  showStatLabels = true,
  compactSingle = false,
}: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  // Track which ship types we've already started loading so we only call
  // preloadShip() once per unique ShipId across frames.
  const loadedRef  = useRef(new Set<ShipId>());
  const limpetsLoadedRef = useRef(false);
  const orzBoardLoadedRef = useRef(false);
  const captainDefeatRef = useRef<[CaptainDefeatState, CaptainDefeatState]>([
    { key: null, startedAt: null, wasAlive: true },
    { key: null, startedAt: null, wasAlive: true },
  ]);

  // Single rAF loop: reads latest data from sidesRef each frame, pre-loads
  // any new ship assets it encounters, then redraws the whole panel.
  useEffect(() => {
    let rafId: number;

    function draw() {
      rafId = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const nowMs = performance.now();
      const [s0, s1] = sidesRef.current;
      const singleSide = singleSideIndex === 0 ? s0 : s1;

      // Kick off asset loading for any ship we haven't seen yet
      for (const side of layout === 'dual' ? [s0, s1] : [singleSide]) {
        if (side && !loadedRef.current.has(side.shipId)) {
          loadedRef.current.add(side.shipId);
          preloadShip(side.shipId).catch(() => {});
        }
        if (side?.limpetCount && !limpetsLoadedRef.current) {
          limpetsLoadedRef.current = true;
          preloadLimpetOverlay().catch(() => {});
        }
        if (side?.orzBoardSlots?.some(Boolean) && !orzBoardLoadedRef.current) {
          orzBoardLoadedRef.current = true;
          preloadOrzBoardOverlay().catch(() => {});
        }
      }

      const totalHeight = layout === 'dual' ? SECTION_H * 2 : compactSingle ? COMPACT_SINGLE_H : SECTION_H;

      // Scale the canvas to an integer multiple of STATUS_W in physical pixels
      // so the CSS stretch is always a clean integer ratio and pixel fonts render
      // without stripe artifacts (avoids the 1.5× nearest-neighbour banding).
      const cssW = canvas.clientWidth;
      if (cssW > 0) {
        const physW = Math.round(cssW * (window.devicePixelRatio || 1));
        const N = Math.max(1, Math.floor(physW / STATUS_W));
        const snapW = STATUS_W * N;
        const snapH = totalHeight * N;
        if (canvas.width !== snapW || canvas.height !== snapH) {
          canvas.width  = snapW;
          canvas.height = snapH;
        }
        ctx.setTransform(N, 0, 0, N, 0, 0);
      }

      ctx.clearRect(0, 0, STATUS_W, totalHeight);

      if (layout === 'single') {
        const defeat = updateCaptainDefeatState(captainDefeatRef.current[singleSideIndex], singleSide, nowMs);
        if (singleSide) drawSection(ctx, 0, singleSide, { showCaptain, showStatLabels, nowMs, captainDefeatStartedAt: defeat });
        else drawEmptySection(ctx, 0);
      } else {
        // top section = side 0 (bad-guy / enemy in UQM's convention)
        const defeat0 = updateCaptainDefeatState(captainDefeatRef.current[0], s0, nowMs);
        const defeat1 = updateCaptainDefeatState(captainDefeatRef.current[1], s1, nowMs);
        if (s0) drawSection(ctx, 0,         s0, { showCaptain, showStatLabels, nowMs, captainDefeatStartedAt: defeat0 });
        else    drawEmptySection(ctx, 0);

        drawDivider(ctx);

        // bottom section = side 1 (good-guy / local player)
        if (s1) drawSection(ctx, SECTION_H, s1, { showCaptain, showStatLabels, nowMs, captainDefeatStartedAt: defeat1 });
        else    drawEmptySection(ctx, SECTION_H);
      }
    }

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={STATUS_W}
      height={layout === 'dual' ? SECTION_H * 2 : compactSingle ? COMPACT_SINGLE_H : SECTION_H}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        imageRendering: 'pixelated',
      }}
    />
  );
}

function updateCaptainDefeatState(
  state: CaptainDefeatState,
  side: SideStatus | null,
  nowMs: number,
): number | null {
  if (!side) {
    state.key = null;
    state.startedAt = null;
    state.wasAlive = true;
    return null;
  }

  const key = `${side.shipId}:${side.captainIdx}`;
  const alive = side.crew > 0;
  if (state.key !== key) {
    state.key = key;
    state.startedAt = alive ? null : nowMs;
    state.wasAlive = alive;
    return state.startedAt;
  }

  if (!alive && state.wasAlive && state.startedAt === null) {
    state.startedAt = nowMs;
  } else if (alive) {
    state.startedAt = null;
  }

  state.wasAlive = alive;
  return state.startedAt;
}

function drawEmptySection(ctx: CanvasRenderingContext2D, sectionY: number) {
  ctx.fillStyle = C_BG;
  ctx.fillRect(0, sectionY, STATUS_W, SECTION_H);
  ctx.fillStyle = C_DARK;
  ctx.fillRect(0, sectionY, S, SECTION_H);
  ctx.fillRect(0, sectionY, STATUS_W, S);
  ctx.fillStyle = C_LIGHT;
  ctx.fillRect(STATUS_W - S, sectionY, S, SECTION_H);
  ctx.fillRect(0, sectionY + SECTION_H - S, STATUS_W, S);
}
