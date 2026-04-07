import { playBattleSound, playBlast, playEffectSound } from '../audio';
import { SHIP_REGISTRY } from '../ships/registry';
import { getShipDef } from '../ships';
import type { BattleMissile, ShipState } from '../ships/types';
import type { SpriteFrame } from '../sprites';
import { setVelocityVector, VELOCITY_TO_WORLD, DISPLAY_TO_WORLD, WORLD_TO_DISPLAY, setVelocityComponents } from '../velocity';
import { trackFacing } from '../ships/human';
import { COSINE, SINE } from '../sinetab';
import type { BattleExplosion, CrewPod, IonDot } from './types';
import type { BattleState } from './types';
import { circleOverlap, worldAngle, worldDelta } from './helpers';
import { spriteMaskIntersectsCircle, sweptSpriteMasksOverlapPadded } from './maskCollision';
import type { MissileHitEffect, SpawnRequest } from '../ships/types';
import { WORLD_H, WORLD_W } from './constants';

function missileRadius(m: BattleMissile): number {
  // Broad-phase circle radius — must be >= the sprite's actual pixel radius so
  // the narrow-phase mask check is always triggered for real overlaps.
  // Plasmoid: sprite grows from 14×13 (frame 0, ~7 px radius) to 49×41 (frame 10,
  // ~25 px radius). Use 28 px to safely cover all frames.
  if (m.weaponType === 'plasmoid') return DISPLAY_TO_WORLD(28);
  if (m.weaponType === 'bubble') return DISPLAY_TO_WORLD(5);
  if (m.weaponType === 'chenjesu_crystal') return DISPLAY_TO_WORLD(9);
  if (m.weaponType === 'chenjesu_shard') return DISPLAY_TO_WORLD(8);
  if (m.weaponType === 'dogi') return DISPLAY_TO_WORLD(9);
  if (m.weaponType === 'chmmr_satellite') return DISPLAY_TO_WORLD(9);
  if (m.weaponType === 'melnorme_pump') return DISPLAY_TO_WORLD(12);
  if (m.weaponType === 'melnorme_confuse') return DISPLAY_TO_WORLD(10);
  if (m.weaponType === 'thraddash_horn') return DISPLAY_TO_WORLD(6);
  if (m.weaponType === 'thraddash_napalm') return DISPLAY_TO_WORLD(11);
  if (m.weaponType === 'umgah_cone') return DISPLAY_TO_WORLD(56);
  if (m.weaponType === 'zoqfotpik_spit') return DISPLAY_TO_WORLD(6);
  if (m.weaponType === 'supox_glob') return DISPLAY_TO_WORLD(10);
  // Buzzsaw: collision uses frames 0-1 only (17×17 and 19×19, ~10 px radius max).
  if (m.weaponType === 'buzzsaw') return DISPLAY_TO_WORLD(12);
  if (m.weaponType === 'gas_cloud') return DISPLAY_TO_WORLD(6);
  if (m.weaponType === 'fighter') return DISPLAY_TO_WORLD(8);
  if (m.weaponType === 'orz_howitzer') return DISPLAY_TO_WORLD(6);
  if (m.weaponType === 'orz_marine') return DISPLAY_TO_WORLD(5);
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
  const ctrl = SHIP_REGISTRY[bs.shipTypes[side]];
  return DISPLAY_TO_WORLD(ctrl.getCollisionRadius?.(bs.ships[side]) ?? getShipDef(bs.shipTypes[side])?.radius ?? 14);
}

function spawnMissileEffect(
  bs: BattleState,
  owner: 0 | 1,
  s: SpawnRequest,
  worldW: number,
  worldH: number,
): void {
  if (s.type !== 'missile') return;

  const v = { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 };
  setVelocityVector(v, s.speed, s.facing);
  let spawnX = s.x;
  let spawnY = s.y;
  if (s.inheritVelocity) {
    const ownerShip = bs.ships[owner];
    v.vx += ownerShip.velocity.vx;
    v.vy += ownerShip.velocity.vy;
    spawnX -= VELOCITY_TO_WORLD(ownerShip.velocity.vx);
    spawnY -= VELOCITY_TO_WORLD(ownerShip.velocity.vy);
  }
  spawnX = ((spawnX % worldW) + worldW) % worldW;
  spawnY = ((spawnY % worldH) + worldH) % worldH;
  bs.missiles.push({
    prevX: spawnX,
    prevY: spawnY,
    x: spawnX,
    y: spawnY,
    facing: s.facing,
    velocity: v,
    life: s.life,
    hitPoints: s.hits ?? s.damage,
    speed: s.speed,
    maxSpeed: s.maxSpeed,
    accel: s.accel,
    damage: s.damage,
    tracks: s.tracks,
    trackWait: s.initialTrackWait ?? s.trackRate,
    trackRate: s.trackRate,
    owner,
    preserveVelocity: s.preserveVelocity,
    limpet: s.limpet,
    weaponType: s.weaponType,
    orzSeed: s.orzSeed,
  });
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
  const missileHitRadius = missileRadius(m);
  const sweptShipProxy = {
    prevX: ship.x,
    prevY: ship.y,
    x: ship.x,
    y: ship.y,
  } as BattleMissile;
  if (!sweptCircleOverlap(m, missileHitRadius, sweptShipProxy, shipRadius, worldW, worldH)) {
    return false;
  }

  const missileFrame = getMissileCollisionFrame(bs, shipSprites, m);
  const shipFrame = getShipCollisionFrame(bs, shipSprites, side);
  if (missileFrame && shipFrame) {
    return sweptSpriteMasksOverlapPadded(
      missileFrame,
      m.prevX,
      m.prevY,
      m.x,
      m.y,
      shipFrame,
      ship.x,
      ship.y,
      ship.x,
      ship.y,
      worldW,
      worldH,
      1,
    );
  }
  if (missileFrame) {
    const { dx: moveX, dy: moveY } = worldDelta(m.prevX, m.prevY, m.x, m.y, worldW, worldH);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(WORLD_TO_DISPLAY(moveX)), Math.abs(WORLD_TO_DISPLAY(moveY)))));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const sampleX = m.prevX + Math.round(moveX * t);
      const sampleY = m.prevY + Math.round(moveY * t);
      if (spriteMaskIntersectsCircle(missileFrame, sampleX, sampleY, ship.x, ship.y, shipRadius, worldW, worldH)) {
        return true;
      }
    }
    return false;
  }

  return true;
}

function playMissileBlast(m: BattleMissile, skipBlast?: boolean): void {
  if (!skipBlast && m.damage > 0) playBlast(Math.max(1, m.damage));
}

function pushHitEffects(
  bs: BattleState,
  m: BattleMissile,
  hitFx: MissileHitEffect,
  worldW: number,
  worldH: number,
): void {
  const explosionType = hitFx.explosionType ?? 'blast';
  const spawnExplosion = !hitFx.skipBlast || explosionType !== 'blast';
  if (spawnExplosion) bs.explosions.push({ type: explosionType, x: m.x, y: m.y, frame: 0 });
  if (hitFx.splinter) {
    bs.explosions.push({ type: 'splinter', x: m.x, y: m.y, frame: 2, vx: hitFx.splinter.vx, vy: hitFx.splinter.vy, ex: 0, ey: 0 });
  }
  if (hitFx.spawnMissiles) {
    for (const spawn of hitFx.spawnMissiles) spawnMissileEffect(bs, m.owner, spawn, worldW, worldH);
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
  pushHitEffects(bs, m, hitFx, WORLD_W, WORLD_H);
  playMissileBlast(m, hitFx.skipBlast);
  if (m.weaponType === 'dogi') {
    const ownShip = bs.ships[m.owner];
    ownShip.chenjesuDogiCount = Math.max(0, (ownShip.chenjesuDogiCount ?? 0) - 1);
  } else if (m.weaponType === 'orz_marine') {
    const ownShip = bs.ships[m.owner];
    ownShip.orzMarineCount = Math.max(0, (ownShip.orzMarineCount ?? 0) - 1);
  }
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
    return e.type === 'splinter' ? e.frame < 7
      : e.type === 'boom' ? e.frame < 9
      : e.type === 'orz_howitzer' ? e.frame < 6
      : e.type === 'supox_glob' ? e.frame < 5
      : e.type === 'shofixti_glory' ? e.frame < 8
      : e.frame < 8;
  });
}

export function updateIonTrails(
  ionTrails: [IonDot[], IonDot[]],
  ships: [ShipState, ShipState],
  warpIn: [number, number],
  shipTypes: [BattleState['shipTypes'][0], BattleState['shipTypes'][1]],
): void {
  for (let side = 0; side < 2; side++) {
    const ship = ships[side];
    for (const dot of ionTrails[side]) dot.age++;
    ionTrails[side] = ionTrails[side].filter(d => d.age < 12);
    if (ship.thrusting
      && warpIn[side] === 0
      && ship.crew > 0
      && !(shipTypes[side] === 'ilwrath' && ship.ilwrathCloaked)
    ) {
      const backAng = ((ship.facing * 4 + 32) & 63);
      ionTrails[side].push({
        x: ship.x + COSINE(backAng, 28),
        y: ship.y + SINE(backAng, 28),
        age: 0,
      });
    }
  }
}

export function updateCrewPods(
  bs: BattleState,
  warpIn: [number, number],
  worldW: number,
  worldH: number,
): void {
  const alivePods: CrewPod[] = [];

  for (const pod of bs.crewPods) {
    pod.life--;
    if (pod.life <= 0) continue;
    if (pod.collectDelay > 0) pod.collectDelay--;

    pod.blink = !pod.blink;
    const targetShip = bs.ships[pod.targetSide];
    const { dx, dy } = worldDelta(pod.x, pod.y, targetShip.x, targetShip.y, worldW, worldH);
    const stepX = dx === 0 ? 0 : dx > 0 ? DISPLAY_TO_WORLD(1) : -DISPLAY_TO_WORLD(1);
    const stepY = dy === 0 ? 0 : dy > 0 ? DISPLAY_TO_WORLD(1) : -DISPLAY_TO_WORLD(1);
    pod.x = ((pod.x + stepX) % worldW + worldW) % worldW;
    pod.y = ((pod.y + stepY) % worldH + worldH) % worldH;

    let collected = false;
    if (pod.collectDelay <= 0) {
      for (const side of [0, 1] as const) {
        const ship = bs.ships[side];
        if (ship.crew <= 0 || warpIn[side] > 0 || SHIP_REGISTRY[bs.shipTypes[side]].isIntangible?.(ship)) continue;
        if (SHIP_REGISTRY[bs.shipTypes[side]].isCrewImmune?.(ship)) continue;
        if (!circleOverlap(pod.x, pod.y, DISPLAY_TO_WORLD(2), ship.x, ship.y, getShipCollisionRadius(bs, side), worldW, worldH)) continue;
        ship.crew = Math.min(ship.crew + 1, SHIP_REGISTRY[bs.shipTypes[side]].maxCrew);
        playBattleSound('getcrew', 0.7);
        collected = true;
        break;
      }
    }

    if (!collected) alivePods.push(pod);
  }

  bs.crewPods = alivePods;
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
    if (m.life <= 0) {
      if (m.weaponType === 'dogi') {
        playEffectSound('chenjesu_dogi_die');
        const ownShip = bs.ships[m.owner];
        ownShip.chenjesuDogiCount = Math.max(0, (ownShip.chenjesuDogiCount ?? 0) - 1);
      } else if (m.weaponType === 'orz_marine') {
        const ownShip = bs.ships[m.owner];
        ownShip.orzMarineCount = Math.max(0, (ownShip.orzMarineCount ?? 0) - 1);
      }
      continue;
    }
    m.prevX = m.x;
    m.prevY = m.y;

    const ownerCtrl  = SHIP_REGISTRY[bs.shipTypes[m.owner]];
    const ownShip    = bs.ships[m.owner];
    const enemyShip  = bs.ships[m.owner === 0 ? 1 : 0];
    const ownerInput = m.owner === 0 ? input0 : input1;

    const effect = ownerCtrl.processMissile?.(m, ownShip, enemyShip, bs.missiles, ownerInput) ?? {};

    if (effect.damageEnemy) {
      const targetCtrl = SHIP_REGISTRY[bs.shipTypes[m.owner === 0 ? 1 : 0]];
      const absorb = targetCtrl.absorbHit?.(enemyShip, { kind: 'laser', damage: effect.damageEnemy });
      if (absorb?.sound) playEffectSound(absorb.sound);
      if (!absorb?.absorbed) {
        enemyShip.crew = Math.max(0, enemyShip.crew - effect.damageEnemy);
      }
    }
    if (effect.healOwn)     ownShip.crew   = Math.min(ownShip.crew + effect.healOwn, ownerCtrl.maxCrew);
    if (effect.lasers)      bs.lasers.push(...effect.lasers);
    if (effect.sounds) for (const snd of effect.sounds) playEffectSound(snd);
    if (effect.ionDots) {
      for (const dot of effect.ionDots) {
        bs.ionTrails[m.owner].push({
          x: dot.x,
          y: dot.y,
          age: dot.age ?? 0,
          palette: dot.palette,
        });
      }
    }
    if (effect.damageMissiles) {
      for (const dmg of effect.damageMissiles) {
        if (applyDirectMissileDamage(bs, dmg.missile, dmg.damage)) {
          dmg.missile.life = 0;
        }
      }
    }

    if (effect.destroy) {
      if (effect.resolveAsHit) {
        const hitFx = ownerCtrl.onMissileHit?.(m, null) ?? {};
        pushHitEffects(bs, m, hitFx, worldW, worldH);
        playMissileBlast(m, hitFx.skipBlast);
      } else if (m.weaponType === 'dogi') {
        playEffectSound('chenjesu_dogi_die');
        ownShip.chenjesuDogiCount = Math.max(0, (ownShip.chenjesuDogiCount ?? 0) - 1);
      } else if (m.weaponType === 'orz_marine') {
        ownShip.orzMarineCount = Math.max(0, (ownShip.orzMarineCount ?? 0) - 1);
      }
      continue;
    }

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

    if (!hit && m.orzMarineMode !== 'boarded' && ownerCtrl.collidesWithPlanet !== false && m.weaponType !== 'fighter') {
      const { dx: pdx, dy: pdy } = worldDelta(planetX, planetY, m.x, m.y);
      if (pdx * pdx + pdy * pdy < (planetRadiusW + 4) ** 2) {
        const missileFrame = getMissileCollisionFrame(bs, shipSprites, m);
        if (missileFrame && !spriteMaskIntersectsCircle(missileFrame, m.x, m.y, planetX, planetY, planetRadiusW, worldW, worldH)) {
          // Bounding spheres overlapped, but masks did not.
        } else {
          const hitFx = ownerCtrl.onMissileHit?.(m, null) ?? {};
          pushHitEffects(bs, m, hitFx, worldW, worldH);
          playMissileBlast(m, hitFx.skipBlast);
          if (hitFx.keepMissileAlive) {
            m.weaponWait = hitFx.missileCooldown ?? m.weaponWait;
          } else {
            if (m.weaponType === 'dogi') {
              ownShip.chenjesuDogiCount = Math.max(0, (ownShip.chenjesuDogiCount ?? 0) - 1);
            }
            hit = true;
          }
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
        m.orzMarineMode !== 'boarded' &&
        targetShip.crew > 0 &&
        bs.warpIn[targetSide] === 0 &&
        !SHIP_REGISTRY[bs.shipTypes[targetSide]].isIntangible?.(targetShip) &&
        m.weaponType !== 'fighter' &&
        missileIntersectsShip(bs, shipSprites, m, targetSide, worldW, worldH)) {
      const targetCtrl = SHIP_REGISTRY[bs.shipTypes[targetSide]];
      const absorb = targetCtrl.absorbHit?.(targetShip, { kind: 'missile', damage: m.damage, hitPoints: m.hitPoints });
      if (absorb?.absorbed) {
        if (absorb.sound) playEffectSound(absorb.sound);
        if (absorb.destroyIncoming !== false) hit = true;
      } else {
      targetShip.crew = Math.max(0, targetShip.crew - m.damage);
      const hitFx = ownerCtrl.onMissileHit?.(m, targetShip) ?? {};
      pushHitEffects(bs, m, hitFx, worldW, worldH);
      if (hitFx.impairTarget) {
        targetShip.turnWait   = Math.min(15, targetShip.turnWait   + hitFx.impairTarget);
        targetShip.thrustWait = Math.min(15, targetShip.thrustWait + hitFx.impairTarget);
      }
      if (hitFx.attachLimpet) {
        targetShip.limpetCount = Math.min(6, (targetShip.limpetCount ?? 0) + hitFx.attachLimpet);
      }
      if (hitFx.drainTargetEnergy) {
        targetShip.energy = Math.max(0, targetShip.energy - Math.min(targetShip.energy, hitFx.drainTargetEnergy));
      }
      if (hitFx.targetVelocityDelta) {
        const nextVx = targetShip.velocity.vx + hitFx.targetVelocityDelta.vx;
        const nextVy = targetShip.velocity.vy + hitFx.targetVelocityDelta.vy;
        setVelocityComponents(targetShip.velocity, nextVx, nextVy);
        if (hitFx.targetVelocityDelta.maxSpeed !== undefined) {
          const speedSq = targetShip.velocity.vx * targetShip.velocity.vx + targetShip.velocity.vy * targetShip.velocity.vy;
          const maxSpeedSq = hitFx.targetVelocityDelta.maxSpeed * hitFx.targetVelocityDelta.maxSpeed;
          if (speedSq > maxSpeedSq) {
            const scale = hitFx.targetVelocityDelta.maxSpeed / Math.sqrt(speedSq);
            setVelocityComponents(targetShip.velocity, targetShip.velocity.vx * scale, targetShip.velocity.vy * scale);
          }
        }
      }
      playMissileBlast(m, hitFx.skipBlast);
      if (hitFx.keepMissileAlive) {
        m.weaponWait = hitFx.missileCooldown ?? m.weaponWait;
      } else {
        hit = true;
      }
      }
    }

    if (!hit &&
        m.orzMarineMode !== 'boarded' &&
        m.weaponType === 'fighter' &&
        targetShip.crew > 0 &&
        bs.warpIn[targetSide] === 0 &&
        !SHIP_REGISTRY[bs.shipTypes[targetSide]].isIntangible?.(targetShip) &&
        missileIntersectsShip(bs, shipSprites, m, targetSide, worldW, worldH)) {
      const targetCtrl = SHIP_REGISTRY[bs.shipTypes[targetSide]];
      const absorb = targetCtrl.absorbHit?.(targetShip, { kind: 'missile', damage: m.damage, hitPoints: m.hitPoints });
      if (absorb?.absorbed) {
        if (absorb.sound) playEffectSound(absorb.sound);
        if (absorb.destroyIncoming !== false) hit = true;
      } else {
      const hitFx = ownerCtrl.onMissileHit?.(m, targetShip) ?? {};
      pushHitEffects(bs, m, hitFx, worldW, worldH);
      if (hitFx.drainTargetEnergy) {
        targetShip.energy = Math.max(0, targetShip.energy - Math.min(targetShip.energy, hitFx.drainTargetEnergy));
      }
      playMissileBlast(m, hitFx.skipBlast);
      if (hitFx.keepMissileAlive) {
        m.weaponWait = hitFx.missileCooldown ?? m.weaponWait;
      } else {
        hit = true;
      }
      }
    }

    if (!hit && m.life > 0 && m.hitPoints > 0) aliveMissiles.push(m);
  }

  const alive = Array(aliveMissiles.length).fill(true) as boolean[];
  for (let i = 0; i < aliveMissiles.length; i++) {
    if (!alive[i]) continue;
      const a = aliveMissiles[i];
      for (let j = i + 1; j < aliveMissiles.length; j++) {
        if (!alive[j]) continue;
        const b = aliveMissiles[j];
        if (a.orzMarineMode === 'boarded' || b.orzMarineMode === 'boarded') continue;
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
        pushHitEffects(bs, a, hitFx, worldW, worldH);
        playMissileBlast(a, hitFx.skipBlast);
        if (a.weaponType === 'dogi') {
          const ownShip = bs.ships[a.owner];
          ownShip.chenjesuDogiCount = Math.max(0, (ownShip.chenjesuDogiCount ?? 0) - 1);
        } else if (a.weaponType === 'orz_marine') {
          const ownShip = bs.ships[a.owner];
          ownShip.orzMarineCount = Math.max(0, (ownShip.orzMarineCount ?? 0) - 1);
        }
        alive[i] = false;
      }
      if (bDestroyed || b.hitPoints <= 0) {
        const hitFx = bCtrl.onMissileHit?.(b, null) ?? {};
        pushHitEffects(bs, b, hitFx, worldW, worldH);
        playMissileBlast(b, hitFx.skipBlast);
        if (b.weaponType === 'dogi') {
          const ownShip = bs.ships[b.owner];
          ownShip.chenjesuDogiCount = Math.max(0, (ownShip.chenjesuDogiCount ?? 0) - 1);
        } else if (b.weaponType === 'orz_marine') {
          const ownShip = bs.ships[b.owner];
          ownShip.orzMarineCount = Math.max(0, (ownShip.orzMarineCount ?? 0) - 1);
        }
        alive[j] = false;
      }
      if (!alive[i]) break;
    }
  }

  bs.missiles = aliveMissiles.filter((m, idx) => alive[idx] && m.life > 0 && m.hitPoints > 0);
}
