import { drawSprite, placeholderDot, type ExplosionSprites } from '../sprites';
import type { LaserFlash } from '../ships/types';
import type { BattleExplosion, IonDot } from './types';

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
      const [cr, cg, cb] = ION_COLORS[Math.min(dot.age, 11)];
      const dotDX = tw2dx(dot.x);
      const dotDY = tw2dy(dot.y);
      if (dotDX < -1 || dotDX > canvasW + 1 || dotDY < -1 || dotDY > canvasH + 1) continue;
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.fillRect(dotDX, dotDY, 1, 1);
    }
  }
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
