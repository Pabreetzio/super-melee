import { drawSprite, placeholderDot, type ExplosionSprites, type PkunkSprites } from '../sprites';
import type { DrawContext, LaserFlash, ShipState } from '../ships/types';
import type { BattleExplosion, CrewPod, IonDot, TractorShadow } from './types';
import { SHIP_REGISTRY } from '../ships/registry';
import type { ShipId } from 'shared/types';
import { COSINE, SINE } from '../sinetab';
import { PRESENTATION_SCALE } from './constants';
import { DISPLAY_TO_WORLD } from '../velocity';
import { wrapWorldCoord } from './helpers';

const ION_COLORS: [number, number, number][] = [
  [255, 171,  0],
  [255, 142,  0],
  [255, 113,  0],
  [255,  85,  0],
  [255,  57,  0],
  [255,  28,  0],
  [255,   0,  0],
  [219,   0,  0],
  [183,   0,  0],
  [147,   0,  0],
  [111,   0,  0],
  [ 75,   0,  0],
];

const GREEN_ION_COLORS: [number, number, number][] = [
  [120, 255, 120],
  [104, 236, 104],
  [ 88, 218,  88],
  [ 72, 200,  72],
  [ 56, 182,  56],
  [ 40, 164,  40],
  [ 24, 146,  24],
  [ 18, 126,  18],
  [ 14, 106,  14],
  [ 10,  86,  10],
  [  8,  68,   8],
  [  6,  52,   6],
];

const CREW_ION_COLORS: [number, number, number][] = [
  [255, 255, 220],
  [244, 236, 202],
  [232, 218, 184],
  [220, 200, 166],
  [208, 182, 148],
  [196, 164, 130],
  [184, 146, 112],
  [168, 128,  96],
  [148, 110,  82],
  [126,  92,  68],
  [104,  74,  54],
  [ 82,  58,  42],
];

export function renderLaserFlashes(
  ctx: CanvasRenderingContext2D,
  lasers: LaserFlash[],
  tw2dx: (x: number) => number,
  tw2dy: (y: number) => number,
  worldW?: number,
  worldH?: number,
  zoomDivisor?: number,
): void {
  if (lasers.length === 0) return;
  ctx.save();
  ctx.lineWidth = PRESENTATION_SCALE;
  for (const lz of lasers) {
    const line = lz.clipToWorld && worldW !== undefined && worldH !== undefined
      ? clipLaserToWorld(lz, worldW, worldH)
      : lz;
    if (!line) continue;
    ctx.beginPath();
    ctx.strokeStyle = lz.color ?? '#fff';
    const x1 = tw2dx(line.x1);
    const y1 = tw2dy(line.y1);
    const x2 = line.clipToWorld && zoomDivisor !== undefined
      ? x1 + Math.trunc((line.x2 - line.x1) / zoomDivisor) * PRESENTATION_SCALE
      : tw2dx(line.x2);
    const y2 = line.clipToWorld && zoomDivisor !== undefined
      ? y1 + Math.trunc((line.y2 - line.y1) / zoomDivisor) * PRESENTATION_SCALE
      : tw2dy(line.y2);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();
}

function clipLaserToWorld(lz: LaserFlash, worldW: number, worldH: number): LaserFlash | null {
  const x1 = wrapWorldCoord(lz.x1, worldW);
  const y1 = wrapWorldCoord(lz.y1, worldH);
  const dx = lz.x2 - lz.x1;
  const dy = lz.y2 - lz.y1;
  if (dx === 0 && dy === 0) return null;

  let tMax = 1;
  if (dx > 0) tMax = Math.min(tMax, (worldW - 1 - x1) / dx);
  else if (dx < 0) tMax = Math.min(tMax, (0 - x1) / dx);

  if (dy > 0) tMax = Math.min(tMax, (worldH - 1 - y1) / dy);
  else if (dy < 0) tMax = Math.min(tMax, (0 - y1) / dy);

  if (tMax <= 0) return null;
  const clippedT = Math.max(0, Math.min(1, tMax));
  return {
    ...lz,
    x1,
    y1,
    x2: Math.round(x1 + dx * clippedT),
    y2: Math.round(y1 + dy * clippedT),
  };
}

const TRACTOR_SHADOW_OFFSETS = [
  DISPLAY_TO_WORLD(8),
  DISPLAY_TO_WORLD(17),
  DISPLAY_TO_WORLD(28),
  DISPLAY_TO_WORLD(42),
  DISPLAY_TO_WORLD(60),
] as const;

const TRACTOR_SHADOW_COLORS = [
  'rgb(0,0,132)',
  'rgb(0,0,115)',
  'rgb(0,0,99)',
  'rgb(0,0,74)',
  'rgb(0,0,58)',
] as const;

let tractorShadowScratch: HTMLCanvasElement | null = null;

function getTractorShadowScratch(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (!tractorShadowScratch) {
    tractorShadowScratch = document.createElement('canvas');
  }
  if (tractorShadowScratch.width !== width || tractorShadowScratch.height !== height) {
    tractorShadowScratch.width = width;
    tractorShadowScratch.height = height;
  }
  return tractorShadowScratch;
}

export function renderTractorShadows(
  ctx: CanvasRenderingContext2D,
  tractorShadows: TractorShadow[],
  ships: [ShipState, ShipState],
  shipTypes: [ShipId, ShipId],
  shipSprites: Map<string, unknown>,
  baseDc: Omit<DrawContext, 'ctx'>,
): void {
  if (tractorShadows.length === 0) return;
  const scratch = getTractorShadowScratch(baseDc.canvasW, baseDc.canvasH);
  const scratchCtx = scratch?.getContext('2d') ?? null;
  if (!scratch || !scratchCtx) return;

  for (const shadow of tractorShadows) {
    const side = shadow.targetSide;
    const ship = ships[side];
    const shipType = shipTypes[side];
    const ctrl = SHIP_REGISTRY[shipType];
    const sprites = shipSprites.get(shipType) ?? null;
    if (!ctrl.getShipCollisionFrame?.(ship, sprites)) continue;

    for (let i = 0; i < TRACTOR_SHADOW_OFFSETS.length; i++) {
      const shadowX = ship.x + COSINE(shadow.angle, TRACTOR_SHADOW_OFFSETS[i]);
      const shadowY = ship.y + SINE(shadow.angle, TRACTOR_SHADOW_OFFSETS[i]);
      scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
      ctrl.drawShip(
        {
          ctx: scratchCtx,
          camX: baseDc.camX,
          camY: baseDc.camY,
          canvasW: baseDc.canvasW,
          canvasH: baseDc.canvasH,
          reduction: baseDc.reduction,
          worldW: baseDc.worldW,
          worldH: baseDc.worldH,
        },
        { ...ship, x: shadowX, y: shadowY },
        sprites,
      );
      scratchCtx.globalCompositeOperation = 'source-in';
      scratchCtx.fillStyle = TRACTOR_SHADOW_COLORS[i];
      scratchCtx.fillRect(0, 0, scratch.width, scratch.height);
      scratchCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(scratch, 0, 0);
    }
  }
}

export function renderIonTrails(
  ctx: CanvasRenderingContext2D,
  ionTrails: [IonDot[], IonDot[]],
  canvasW: number,
  canvasH: number,
  tw2dx: (x: number) => number,
  tw2dy: (y: number) => number,
): void {
  for (let side = 0; side < 2; side++) {
    for (const dot of ionTrails[side]) {
      const palette = dot.palette === 'green'
        ? GREEN_ION_COLORS
        : dot.palette === 'crew'
          ? CREW_ION_COLORS
          : ION_COLORS;
      const [cr, cg, cb] = palette[Math.min(dot.age, 11)];
      const dotDX = tw2dx(dot.x);
      const dotDY = tw2dy(dot.y);
      if (dotDX < -PRESENTATION_SCALE || dotDX > canvasW + PRESENTATION_SCALE || dotDY < -PRESENTATION_SCALE || dotDY > canvasH + PRESENTATION_SCALE) continue;
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.fillRect(dotDX, dotDY, PRESENTATION_SCALE, PRESENTATION_SCALE);
    }
  }
}

export function renderCrewPods(
  ctx: CanvasRenderingContext2D,
  crewPods: CrewPod[],
  canvasW: number,
  canvasH: number,
  tw2dx: (x: number) => number,
  tw2dy: (y: number) => number,
): void {
  for (const pod of crewPods) {
    const sx = tw2dx(pod.x);
    const sy = tw2dy(pod.y);
    const podRadius = PRESENTATION_SCALE + 1;
    if (sx < -podRadius * 2 || sx > canvasW + podRadius * 2 || sy < -podRadius * 2 || sy > canvasH + podRadius * 2) continue;
    ctx.fillStyle = pod.blink ? 'rgb(120,255,120)' : 'rgb(40,132,40)';
    ctx.fillRect(sx - podRadius, sy - podRadius, podRadius * 2 + 1, podRadius * 2 + 1);
  }
}

export function renderPkunkRebirth(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  sprites: unknown,
  timer: number,
  baseDc: Omit<DrawContext, 'ctx'>,
): void {
  const sp = sprites as PkunkSprites | null;
  const set = sp
    ? (baseDc.reduction >= 2 ? sp.sml : baseDc.reduction === 1 ? sp.med : sp.big)
    : null;
  const progress = 1 - ((timer - 1) / 12);
  const distance = Math.round(DISPLAY_TO_WORLD(20) * (1 - progress));
  const alpha = Math.max(0.2, Math.min(0.85, progress));
  const faces = [ship.facing, (ship.facing + 4) & 15, (ship.facing + 8) & 15, (ship.facing + 12) & 15];
  const zoomDivisor = baseDc.zoomDivisor ?? (1 << (2 + baseDc.reduction));

  ctx.save();
  for (const face of faces) {
    const angle = (face * 4) & 63;
    const x = ship.x - COSINE(angle, distance);
    const y = ship.y - SINE(angle, distance);

    for (let trail = 0; trail < 4; trail++) {
      const trailDist = distance + DISPLAY_TO_WORLD(5 * (trail + 1));
      const tx = ship.x - COSINE(angle, trailDist);
      const ty = ship.y - SINE(angle, trailDist);
      const tdx = (((tx - baseDc.camX) % baseDc.worldW) + baseDc.worldW) % baseDc.worldW;
      const tdy = (((ty - baseDc.camY) % baseDc.worldH) + baseDc.worldH) % baseDc.worldH;
      const sx = Math.trunc(((tdx > baseDc.worldW / 2 ? tdx - baseDc.worldW : tdx) / zoomDivisor)) * PRESENTATION_SCALE;
      const sy = Math.trunc(((tdy > baseDc.worldH / 2 ? tdy - baseDc.worldH : tdy) / zoomDivisor)) * PRESENTATION_SCALE;
      ctx.fillStyle = `rgba(${255 - trail * 24},${Math.max(0, 171 - trail * 40)},0,${alpha * (0.7 - trail * 0.12)})`;
      ctx.fillRect(sx, sy, 2 * PRESENTATION_SCALE, 2 * PRESENTATION_SCALE);
    }

    ctx.globalAlpha = alpha;
    if (set) {
      drawSprite(ctx, set, face, x, y, baseDc.canvasW, baseDc.canvasH, baseDc.camX, baseDc.camY, baseDc.reduction);
    } else {
      placeholderDot(ctx, x, y, baseDc.camX, baseDc.camY, 8, '#f80', baseDc.reduction);
    }
  }
  ctx.restore();
}

export function renderExplosions(
  ctx: CanvasRenderingContext2D,
  explosions: BattleExplosion[],
  explosionSprites: ExplosionSprites | null,
  shipSprites: Map<string, unknown>,
  canvasW: number,
  canvasH: number,
  camX: number,
  camY: number,
  reduction: number,
  tw2dx: (x: number) => number,
  tw2dy: (y: number) => number,
): void {
  for (const ex of explosions) {
    if (ex.type === 'splinter') {
      const khSp = shipSprites.get('kohrah') as
        { buzzsaw?: { big: object; med: object; sml: object } } | null;
      const group = khSp?.buzzsaw ?? null;
      const sset = group
        ? (reduction >= 2 ? group.sml : reduction === 1 ? group.med : group.big) as Parameters<typeof drawSprite>[1] | null
        : null;
      if (sset) {
        drawSprite(ctx, sset, ex.frame, ex.x, ex.y, canvasW, canvasH, camX, camY, reduction);
      } else {
        placeholderDot(ctx, ex.x, ex.y, camX, camY, 4, '#f80', reduction);
      }
      continue;
    }

    if (ex.type === 'mycon_plasma') {
      const mySp = shipSprites.get('mycon') as
        { plasmaImpact?: { big: object; med: object; sml: object } } | null;
      const group = mySp?.plasmaImpact ?? null;
      const sset = group
        ? (reduction >= 2 ? group.sml : reduction === 1 ? group.med : group.big) as Parameters<typeof drawSprite>[1] | null
        : null;
      if (sset) {
        drawSprite(ctx, sset, ex.frame, ex.x, ex.y, canvasW, canvasH, camX, camY, reduction);
      } else {
        placeholderDot(ctx, ex.x, ex.y, camX, camY, 5, '#ff9a3c', reduction);
      }
      continue;
    }

    if (ex.type === 'chenjesu_spark') {
      const chSp = shipSprites.get('chenjesu') as
        { spark?: { big: object; med: object; sml: object } } | null;
      const group = chSp?.spark ?? null;
      const sset = group
        ? (reduction >= 2 ? group.sml : reduction === 1 ? group.med : group.big) as Parameters<typeof drawSprite>[1] | null
        : null;
      if (sset) {
        drawSprite(ctx, sset, ex.frame + 2, ex.x, ex.y, canvasW, canvasH, camX, camY, reduction);
      } else {
        placeholderDot(ctx, ex.x, ex.y, camX, camY, 5, '#d0f7ff', reduction);
      }
      continue;
    }

    if (ex.type === 'supox_glob') {
      const supoxSp = shipSprites.get('supox') as
        { glob?: { big: object; med: object; sml: object } } | null;
      const group = supoxSp?.glob ?? null;
      const sset = group
        ? (reduction >= 2 ? group.sml : reduction === 1 ? group.med : group.big) as Parameters<typeof drawSprite>[1] | null
        : null;
      if (sset) {
        drawSprite(ctx, sset, 16 + ex.frame, ex.x, ex.y, canvasW, canvasH, camX, camY, reduction);
      } else {
        placeholderDot(ctx, ex.x, ex.y, camX, camY, 4, '#8cff5a', reduction);
      }
      continue;
    }

    if (ex.type === 'orz_howitzer') {
      const orzSp = shipSprites.get('orz') as
        { howitzer?: { big: object; med: object; sml: object } } | null;
      const group = orzSp?.howitzer ?? null;
      const sset = group
        ? (reduction >= 2 ? group.sml : reduction === 1 ? group.med : group.big) as Parameters<typeof drawSprite>[1] | null
        : null;
      if (sset) {
        drawSprite(ctx, sset, 16 + ex.frame, ex.x, ex.y, canvasW, canvasH, camX, camY, reduction);
      } else {
        placeholderDot(ctx, ex.x, ex.y, camX, camY, 5, '#8cd8ff', reduction);
      }
      continue;
    }

    if (ex.type === 'shofixti_glory') {
      const shofSp = shipSprites.get('shofixti') as
        { destruct?: { big: object; med: object; sml: object } } | null;
      const group = shofSp?.destruct ?? null;
      const sset = group
        ? (reduction >= 2 ? group.sml : reduction === 1 ? group.med : group.big) as Parameters<typeof drawSprite>[1] | null
        : null;
      if (sset) {
        drawSprite(ctx, sset, ex.frame, ex.x, ex.y, canvasW, canvasH, camX, camY, reduction);
      } else {
        placeholderDot(ctx, ex.x, ex.y, camX, camY, 8, '#ff6040', reduction);
      }
      continue;
    }

    if (ex.type === 'melnorme_pump_hit_low' || ex.type === 'melnorme_pump_hit_high') {
      const melnSp = shipSprites.get('melnorme') as
        { pump?: { big: object; med: object; sml: object } } | null;
      const group = melnSp?.pump ?? null;
      const sset = group
        ? (reduction >= 2 ? group.sml : reduction === 1 ? group.med : group.big) as Parameters<typeof drawSprite>[1] | null
        : null;
      const frameOffset = ex.type === 'melnorme_pump_hit_low' ? 20 : 23;
      if (sset) {
        drawSprite(ctx, sset, frameOffset + ex.frame, ex.x, ex.y, canvasW, canvasH, camX, camY, reduction);
      } else {
        placeholderDot(ctx, ex.x, ex.y, camX, camY, 5, ex.type === 'melnorme_pump_hit_low' ? '#9fff9f' : '#9fcfff', reduction);
      }
      continue;
    }

    const set = ex.type === 'boom'
      ? (explosionSprites ? (reduction >= 2 ? explosionSprites.boom.sml : reduction === 1 ? explosionSprites.boom.med : explosionSprites.boom.big) : null)
      : (explosionSprites ? (reduction >= 2 ? explosionSprites.blast.sml : reduction === 1 ? explosionSprites.blast.med : explosionSprites.blast.big) : null);
    if (set) {
      drawSprite(ctx, set, ex.frame, ex.x, ex.y, canvasW, canvasH, camX, camY, reduction);
    } else {
      const frac = ex.frame / (ex.type === 'boom' ? 8 : 7);
      const radius = (ex.type === 'boom' ? 12 : 6) * frac;
      const sx = tw2dx(ex.x);
      const sy = tw2dy(ex.y);
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(PRESENTATION_SCALE, radius * PRESENTATION_SCALE), 0, Math.PI * 2);
      ctx.fillStyle = ex.type === 'boom'
        ? `rgba(255,${Math.round(160 * (1 - frac))},0,${0.8 * (1 - frac)})`
        : `rgba(255,255,${Math.round(200 * (1 - frac))},${0.9 * (1 - frac)})`;
      ctx.fill();
    }
  }
}
