import { playBlast, playEffectSound } from '../audio';
import { SHIP_REGISTRY } from '../ships/registry';
import { getShipDef } from '../ships';
import type { BattleMissile, ShipState } from '../ships/types';
import type { SpriteFrame } from '../sprites';
import { setVelocityVector, VELOCITY_TO_WORLD, DISPLAY_TO_WORLD, WORLD_TO_DISPLAY } from '../velocity';
import { trackFacing } from '../ships/human';
import { COSINE, SINE } from '../sinetab';
import type { BattleExplosion, IonDot } from './types';
import type { BattleState } from './types';
import { circleOverlap, worldAngle, worldDelta } from './helpers';
import { spriteMasksOverlap, spriteMaskIntersectsCircle, sweptSpriteMasksOverlapPadded } from './maskCollision';

function missileRadius(m: BattleMissile): number {
  // Broad-phase circle radius — must be >= the sprite's actual pixel radius so
  // the narrow-phase mask check is always triggered for real overlaps.
  // Plasmoid: sprite grows from 14×13 (frame 0, ~7 px radius) to 49×41 (frame 10,
  // ~25 px radius). Use 28 px to safely cover all frames.
  if (m.weaponType === 'plasmoid') return DISPLAY_TO_WORLD(28);
  // Buzzsaw: collision uses frames 0-1 only (17×17 and 19×19, ~10 px radius max).
  if (m.weaponType === 'buzzsaw') return DISPLAY_TO_WORLD(12);
  if (m.weaponType === 'gas_cloud') return DISPLAY_TO_WORLD(6);
  if (m.weaponType === 'fighter') return DISPLAY_TO_WORLD(8);
  return DISPLAY_TO_WORLD(2);
}

function sweptCircleOverlap(
  a: BattleMissile,
  aRadius: number,
  b: BattleMissile,
  bRadius: number,
  worldW: number,
  worldH: number,
): boolean {
  const { dx: aMoveX, dy: aMoveY } = worldDelta(a.prevX, a.prevY, a.x, a.y, worldW, worldH);
  const { dx: bMoveX, dy: bMoveY } = worldDelta(b.prevX, b.prevY, b.x, b.y, worldW, worldH);
  const maxMovePx = Math.max(
    Math.abs(WORLD_TO_DISPLAY(aMoveX)),
    Math.abs(WORLD_TO_DISPLAY(aMoveY)),
    Math.abs(WORLD_TO_DISPLAY(bMoveX)),
    Math.abs(WORLD_TO_DISPLAY(bMoveY)),
  );
  const steps = Math.max(1, Math.ceil(maxMovePx));

  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const aSampleX = a.prevX + Math.round(aMoveX * t);
    const aSampleY = a.prevY + Math.round(aMoveY * t);
    const bSampleX = b.prevX + Math.round(bMoveX * t);
    const bSampleY = b.prevY + Math.round(bMoveY * t);
    if (circleOverlap(aSampleX, aSampleY, aRadius, bSampleX, bSampleY, bRadius, worldW, worldH)) {
      return true;
    }
  }

  return false;
}

function getMissileCollisionFrame(
  bs: BattleState,
  shipSprites: Map<string, unknown>,
  m: BattleMissile,
): SpriteFrame | null {
  const shipType = bs.shipTypes[m.owner];
  const ctrl = SHIP_REGISTRY[shipType];
  return ctrl.getMissileCollisionFrame?.(m, shipSprites.get(shipType) ?? null) ?? null;
}

function getShipCollisionFrame(
  bs: BattleState,
  shipSprites: Map<string, unknown>,
  side: 0 | 1,
): SpriteFrame | null {
  const shipType = bs.shipTypes[side];
  const ctrl = SHIP_REGISTRY[shipType];
  return ctrl.getShipCollisionFrame?.(bs.ships[side], shipSprites.get(shipType) ?? null) ?? null;
}

function getShipCollisionRadius(bs: BattleState, side: 0 | 1): number {
  return DISPLAY_TO_WORLD(getShipDef(bs.shipTypes[side])?.radius ?? 14);
}

function missileIntersectsShip(
  bs: BattleState,
  shipSprites: Map<string, unknown>,
  m: BattleMissile,
  side: 0 | 1,
  worldW: number,
  worldH: number,
): boolean {
  const ship = bs.ships[side];
  const shipRadius = getShipCollisionRadius(bs, side);
  if (!circleOverlap(m.x, m.y, missileRadius(m), ship.x, ship.y, shipRadius, worldW, worldH)) {
    return false;
  }

  const missileFrame = getMissileCollisionFrame(bs, shipSprites, m);
  const shipFrame = getShipCollisionFrame(bs, shipSprites, side);
  if (missileFrame && shipFrame) {
    return spriteMasksOverlap(missileFrame, m.x, m.y, shipFrame, ship.x, ship.y, worldW, worldH);
  }
  if (missileFrame) {
    return spriteMaskIntersectsCircle(missileFrame, m.x, m.y, ship.x, ship.y, shipRadius, worldW, worldH);
  }

  return true;
}

function playMissileBlast(m: BattleMissile, skipBlast?: boolean): void {
  if (!skipBlast && m.damage > 0) playBlast(Math.max(1, m.damage));
}

function pushHitEffects(
  bs: BattleState,
  m: BattleMissile,
  hitFx: ReturnType<NonNullable<(typeof SHIP_REGISTRY)[keyof typeof SHIP_REGISTRY]['onMissileHit']>>,
): void {
  const explosionType = hitFx.explosionType ?? 'blast';
  if (!hitFx.skipBlast) bs.explosions.push({ type: explosionType, x: m.x, y: m.y, frame: 0 });
  if (hitFx.splinter) {
    bs.explosions.push({ type: 'splinter', x: m.x, y: m.y, frame: 2, vx: hitFx.splinter.vx, vy: hitFx.splinter.vy, ex: 0, ey: 0 });
  }
  if (hitFx.sounds) {
    for (const snd of hitFx.sounds) playEffectSound(snd);
  }
}

export function applyDirectMissileDamage(
  bs: BattleState,
  m: BattleMissile,
  damage: number,
): boolean {
  if (damage <= 0) return false;

  m.hitPoints = Math.max(0, m.hitPoints - damage);
  if (m.hitPoints > 0) return false;

  const ownerCtrl = SHIP_REGISTRY[bs.shipTypes[m.owner]];
  const hitFx = ownerCtrl.onMissileHit?.(m, null) ?? {};
  pushHitEffects(bs, m, hitFx);
  playMissileBlast(m, hitFx.skipBlast);
  return true;
}

function resolveWeaponCollisionPair(a: BattleMissile, b: BattleMissile): { aDestroyed: boolean; bDestroyed: boolean } {
  let aDestroyed = false;
  let bDestroyed = false;
  let aCollided = false;
  let bCollided = false;

  if (a.damage > 0) {
    b.hitPoints = Math.max(0, b.hitPoints - a.damage);
    if (b.hitPoints > 0) aCollided = true;
  }
  if (!bCollided && a.hitPoints <= b.damage) {
    a.hitPoints = 0;
    aDestroyed = true;
    aCollided = true;
  }

  if (b.damage > 0) {
    a.hitPoints = Math.max(0, a.hitPoints - b.damage);
    if (a.hitPoints > 0) bCollided = true;
  }
  if (!aCollided && b.hitPoints <= a.damage) {
    b.hitPoints = 0;
    bDestroyed = true;
    bCollided = true;
  }

  return { aDestroyed: aDestroyed || a.hitPoints <= 0, bDestroyed: bDestroyed || b.hitPoints <= 0 };
}

export function advanceExplosions(
  explosions: BattleExplosion[],
  worldW: number,
  worldH: number,
): BattleExplosion[] {
  return explosions.filter(e => {
    if (e.vx !== undefined || e.vy !== undefined) {
      const vx = e.vx ?? 0;
      const vy = e.vy ?? 0;
      const fracX = Math.abs(vx) & 31;
      const newExX = (e.ex ?? 0) + fracX;
      e.ex = newExX & 31;
      const carryX = newExX >= 32 ? 1 : 0;
      e.x += VELOCITY_TO_WORLD(Math.abs(vx)) * Math.sign(vx) + (vx >= 0 ? carryX : -carryX);

      const fracY = Math.abs(vy) & 31;
      const newExY = (e.ey ?? 0) + fracY;
      e.ey = newExY & 31;
      const carryY = newExY >= 32 ? 1 : 0;
      e.y += VELOCITY_TO_WORLD(Math.abs(vy)) * Math.sign(vy) + (vy >= 0 ? carryY : -carryY);

      e.x = ((e.x % worldW) + worldW) % worldW;
      e.y = ((e.y % worldH) + worldH) % worldH;
    }
    e.frame++;
    return e.type === 'splinter' ? e.frame < 7 : e.type === 'boom' ? e.frame < 9 : e.frame < 8;
  });
}

export function updateIonTrails(
  ionTrails: [IonDot[], IonDot[]],
  ships: [ShipState, ShipState],
  warpIn: [number, number],
): void {
  for (let side = 0; side < 2; side++) {
    const ship = ships[side];
    for (const dot of ionTrails[side]) dot.age++;
    ionTrails[side] = ionTrails[side].filter(d => d.age < 12);
    if (ship.thrusting && warpIn[side] === 0 && ship.crew > 0) {
      const backAng = ((ship.facing * 4 + 32) & 63);
      ionTrails[side].push({
        x: ship.x + COSINE(backAng, 28),
        y: ship.y + SINE(backAng, 28),
        age: 0,
      });
    }
  }
}

export function processMissiles(
  bs: BattleState,
  shipSprites: Map<string, unknown>,
  input0: number,
  input1: number,
  planetX: number,
  planetY: number,
  planetRadiusW: number,
  worldW: number,
  worldH: number,
): void {
  const aliveMissiles: BattleMissile[] = [];

  for (const m of bs.missiles) {
    m.life--;
    if (m.life <= 0) continue;
    m.prevX = m.x;
    m.prevY = m.y;

    const ownerCtrl  = SHIP_REGISTRY[bs.shipTypes[m.owner]];
    const ownShip    = bs.ships[m.owner];
    const enemyShip  = bs.ships[m.owner === 0 ? 1 : 0];
    const ownerInput = m.owner === 0 ? input0 : input1;

    const effect = ownerCtrl.processMissile?.(m, ownShip, enemyShip, ownerInput) ?? {};

    if (effect.damageEnemy) enemyShip.crew = Math.max(0, enemyShip.crew - effect.damageEnemy);
    if (effect.healOwn)     ownShip.crew   = Math.min(ownShip.crew + effect.healOwn, ownerCtrl.maxCrew);
    if (effect.lasers)      bs.lasers.push(...effect.lasers);
    if (effect.sounds) for (const snd of effect.sounds) playEffectSound(snd);

    if (effect.destroy) continue;

    if (!effect.skipDefaultTracking && m.tracks) {
      const targetAngle = worldAngle(m.x, m.y, enemyShip.x, enemyShip.y);
      if (m.trackWait > 0) {
        m.trackWait--;
      } else {
        m.facing = trackFacing(m.facing, targetAngle);
        m.trackWait = m.trackRate;
      }
    }

    if (!effect.skipVelocityUpdate && !m.preserveVelocity) {
      m.speed = Math.min(m.speed + m.accel, m.maxSpeed);
      setVelocityVector(m.velocity, m.speed, m.facing);
    }

    const fracX = Math.abs(m.velocity.vx) & 31;
    m.velocity.ex += fracX;
    const carryX = m.velocity.ex >= 32 ? 1 : 0;
    m.velocity.ex &= 31;
    m.x += VELOCITY_TO_WORLD(Math.abs(m.velocity.vx)) * Math.sign(m.velocity.vx)
          + (m.velocity.vx >= 0 ? carryX : -carryX);

    const fracY = Math.abs(m.velocity.vy) & 31;
    m.velocity.ey += fracY;
    const carryY = m.velocity.ey >= 32 ? 1 : 0;
    m.velocity.ey &= 31;
    m.y += VELOCITY_TO_WORLD(Math.abs(m.velocity.vy)) * Math.sign(m.velocity.vy)
          + (m.velocity.vy >= 0 ? carryY : -carryY);

    m.x = ((m.x % worldW) + worldW) % worldW;
    m.y = ((m.y % worldH) + worldH) % worldH;

    let hit = false;
    const targetSide = m.owner === 0 ? 1 : 0;
    const targetShip = bs.ships[targetSide];

    if (!hit && ownerCtrl.collidesWithPlanet !== false && m.weaponType !== 'fighter') {
      const { dx: pdx, dy: pdy } = worldDelta(planetX, planetY, m.x, m.y);
      if (pdx * pdx + pdy * pdy < (planetRadiusW + 4) ** 2) {
        const missileFrame = getMissileCollisionFrame(bs, shipSprites, m);
        if (missileFrame && !spriteMaskIntersectsCircle(missileFrame, m.x, m.y, planetX, planetY, planetRadiusW, worldW, worldH)) {
          // Bounding spheres overlapped, but masks did not.
        } else {
          const hitFx = ownerCtrl.onMissileHit?.(m, null) ?? {};
          pushHitEffects(bs, m, hitFx);
          playMissileBlast(m, hitFx.skipBlast);
          hit = true;
        }
      }
    }

    if (!hit && m.weaponType === 'fighter') {
      const { dx: fpdx, dy: fpdy } = worldDelta(planetX, planetY, m.x, m.y);
      const fDistSq = fpdx * fpdx + fpdy * fpdy;
      const fCollideR = planetRadiusW + DISPLAY_TO_WORLD(4);
      if (fDistSq < fCollideR * fCollideR && fDistSq > 0) {
        const fDist = Math.sqrt(fDistSq);
        const nx = fpdx / fDist;
        const ny = fpdy / fDist;
        const dot = m.velocity.vx * nx + m.velocity.vy * ny;
        m.velocity.vx -= 2 * dot * nx;
        m.velocity.vy -= 2 * dot * ny;
        m.x = planetX + nx * (fCollideR + 1);
        m.y = planetY + ny * (fCollideR + 1);
      }
    }

    if (!hit &&
        targetShip.crew > 0 &&
        bs.warpIn[targetSide] === 0 &&
        m.weaponType !== 'fighter' &&
        missileIntersectsShip(bs, shipSprites, m, targetSide, worldW, worldH)) {
      targetShip.crew = Math.max(0, targetShip.crew - m.damage);
      const hitFx = ownerCtrl.onMissileHit?.(m, targetShip) ?? {};
      pushHitEffects(bs, m, hitFx);
      if (hitFx.impairTarget) {
        targetShip.turnWait   = Math.min(15, targetShip.turnWait   + hitFx.impairTarget);
        targetShip.thrustWait = Math.min(15, targetShip.thrustWait + hitFx.impairTarget);
      }
      if (hitFx.attachLimpet) {
        targetShip.limpetCount = Math.min(6, (targetShip.limpetCount ?? 0) + hitFx.attachLimpet);
      }
      playMissileBlast(m, hitFx.skipBlast);
      hit = true;
    }

    if (!hit &&
        m.weaponType === 'fighter' &&
        targetShip.crew > 0 &&
        bs.warpIn[targetSide] === 0 &&
        missileIntersectsShip(bs, shipSprites, m, targetSide, worldW, worldH)) {
      const hitFx = ownerCtrl.onMissileHit?.(m, targetShip) ?? {};
      pushHitEffects(bs, m, hitFx);
      playMissileBlast(m, hitFx.skipBlast);
      hit = true;
    }

    if (!hit) aliveMissiles.push(m);
  }

  const alive = Array(aliveMissiles.length).fill(true) as boolean[];
  for (let i = 0; i < aliveMissiles.length; i++) {
    if (!alive[i]) continue;
    const a = aliveMissiles[i];
    for (let j = i + 1; j < aliveMissiles.length; j++) {
      if (!alive[j]) continue;
      const b = aliveMissiles[j];
      if (a.owner === b.owner) continue;
      const aRadius = missileRadius(a);
      const bRadius = missileRadius(b);
      if (!sweptCircleOverlap(a, aRadius, b, bRadius, worldW, worldH)) continue;
      const aFrame = getMissileCollisionFrame(bs, shipSprites, a);
      const bFrame = getMissileCollisionFrame(bs, shipSprites, b);
      if (aFrame && bFrame && !sweptSpriteMasksOverlapPadded(
        aFrame,
        a.prevX,
        a.prevY,
        a.x,
        a.y,
        bFrame,
        b.prevX,
        b.prevY,
        b.x,
        b.y,
        worldW,
        worldH,
        1,
      )) continue;

      const aCtrl = SHIP_REGISTRY[bs.shipTypes[a.owner]];
      const bCtrl = SHIP_REGISTRY[bs.shipTypes[b.owner]];
      const { aDestroyed, bDestroyed } = resolveWeaponCollisionPair(a, b);

      if (aDestroyed || a.hitPoints <= 0) {
        const hitFx = aCtrl.onMissileHit?.(a, null) ?? {};
        pushHitEffects(bs, a, hitFx);
        playMissileBlast(a, hitFx.skipBlast);
        alive[i] = false;
      }
      if (bDestroyed || b.hitPoints <= 0) {
        const hitFx = bCtrl.onMissileHit?.(b, null) ?? {};
        pushHitEffects(bs, b, hitFx);
        playMissileBlast(b, hitFx.skipBlast);
        alive[j] = false;
      }
      if (!alive[i]) break;
    }
  }

  bs.missiles = aliveMissiles.filter((_m, idx) => alive[idx]);
}
