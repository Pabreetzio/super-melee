import { drawSprite, placeholderDot, type ExplosionSprites, type PkunkSprites } from '../sprites';
import type { DrawContext, LaserFlash, ShipState } from '../ships/types';
import type { BattleExplosion, IonDot } from './types';
import { COSINE, SINE } from '../sinetab';
import { DISPLAY_TO_WORLD } from '../velocity';

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

export function renderLaserFlashes(
  ctx: CanvasRenderingContext2D,
  lasers: LaserFlash[],
  tw2dx: (x: number) => number,
  tw2dy: (y: number) => number,
): void {
  if (lasers.length === 0) return;
  ctx.save();
  ctx.lineWidth = 1;
  for (const lz of lasers) {
    ctx.beginPath();
    ctx.strokeStyle = lz.color ?? '#fff';
    ctx.moveTo(tw2dx(lz.x1), tw2dy(lz.y1));
    ctx.lineTo(tw2dx(lz.x2), tw2dy(lz.y2));
    ctx.stroke();
  }
  ctx.restore();
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
      const palette = dot.palette === 'green' ? GREEN_ION_COLORS : ION_COLORS;
      const [cr, cg, cb] = palette[Math.min(dot.age, 11)];
      const dotDX = tw2dx(dot.x);
      const dotDY = tw2dy(dot.y);
      if (dotDX < -1 || dotDX > canvasW + 1 || dotDY < -1 || dotDY > canvasH + 1) continue;
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.fillRect(dotDX, dotDY, 1, 1);
    }
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
      const sx = Math.floor((tdx > baseDc.worldW / 2 ? tdx - baseDc.worldW : tdx) / (1 << (2 + baseDc.reduction)));
      const sy = Math.floor((tdy > baseDc.worldH / 2 ? tdy - baseDc.worldH : tdy) / (1 << (2 + baseDc.reduction)));
      ctx.fillStyle = `rgba(${255 - trail * 24},${Math.max(0, 171 - trail * 40)},0,${alpha * (0.7 - trail * 0.12)})`;
      ctx.fillRect(sx, sy, 2, 2);
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
      ctx.arc(sx, sy, Math.max(1, radius), 0, Math.PI * 2);
      ctx.fillStyle = ex.type === 'boom'
        ? `rgba(255,${Math.round(160 * (1 - frac))},0,${0.8 * (1 - frac)})`
        : `rgba(255,255,${Math.round(200 * (1 - frac))},${0.9 * (1 - frac)})`;
      ctx.fill();
    }
  }
}
