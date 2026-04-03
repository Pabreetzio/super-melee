import { playBlast, playEffectSound } from '../audio';
import { SHIP_REGISTRY } from '../ships/registry';
import type { BattleMissile, ShipState } from '../ships/types';
import { setVelocityVector, VELOCITY_TO_WORLD, DISPLAY_TO_WORLD } from '../velocity';
import { trackFacing, SHIP_RADIUS } from '../ships/human';
import { COSINE, SINE } from '../sinetab';
import type { BattleExplosion, IonDot } from './types';
import type { BattleState } from './types';
import { circleOverlap, worldAngle } from './helpers';

export function advanceExplosions(
  explosions: BattleExplosion[],
  worldW: number,
  worldH: number,
): BattleExplosion[] {
  return explosions.filter(e => {
    if (e.type === 'splinter') {
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

    if (!effect.skipVelocityUpdate) {
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
      const pdx = m.x - planetX;
      const pdy = m.y - planetY;
      if (pdx * pdx + pdy * pdy < (planetRadiusW + 4) ** 2) {
        const hitFx = ownerCtrl.onMissileHit?.(m, null) ?? {};
        if (!hitFx.skipBlast) bs.explosions.push({ type: 'blast', x: m.x, y: m.y, frame: 0 });
        if (hitFx.splinter)   bs.explosions.push({ type: 'splinter', x: m.x, y: m.y, frame: 2,
          vx: hitFx.splinter.vx, vy: hitFx.splinter.vy, ex: 0, ey: 0 });
        if (hitFx.sounds) for (const snd of hitFx.sounds) playEffectSound(snd);
        playBlast(m.damage);
        hit = true;
      }
    }

    if (!hit && m.weaponType === 'fighter') {
      const fpdx = m.x - planetX;
      const fpdy = m.y - planetY;
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

    if (!hit && m.weaponType !== 'fighter' &&
        bs.warpIn[targetSide] === 0 &&
        circleOverlap(m.x, m.y, 4, targetShip.x, targetShip.y, DISPLAY_TO_WORLD(SHIP_RADIUS))) {
      targetShip.crew = Math.max(0, targetShip.crew - m.damage);
      const hitFx = ownerCtrl.onMissileHit?.(m, targetShip) ?? {};
      if (!hitFx.skipBlast) bs.explosions.push({ type: 'blast', x: m.x, y: m.y, frame: 0 });
      if (hitFx.splinter)   bs.explosions.push({ type: 'splinter', x: m.x, y: m.y, frame: 2,
        vx: hitFx.splinter.vx, vy: hitFx.splinter.vy, ex: 0, ey: 0 });
      if (hitFx.impairTarget) {
        targetShip.turnWait   = Math.min(15, targetShip.turnWait   + hitFx.impairTarget);
        targetShip.thrustWait = Math.min(15, targetShip.thrustWait + hitFx.impairTarget);
      }
      if (hitFx.attachLimpet) {
        targetShip.limpetCount = Math.min(6, (targetShip.limpetCount ?? 0) + hitFx.attachLimpet);
      }
      if (hitFx.sounds) for (const snd of hitFx.sounds) playEffectSound(snd);
      if (!hitFx.skipBlast) playBlast(Math.max(1, m.damage));
      hit = true;
    }

    if (!hit) aliveMissiles.push(m);
  }

  bs.missiles = aliveMissiles;
}
