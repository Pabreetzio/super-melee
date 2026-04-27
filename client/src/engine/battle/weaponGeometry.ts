import type { BattleMissile } from '../ships/types';
import { DISPLAY_TO_WORLD } from '../velocity';

export function missileCollisionRadius(m: BattleMissile): number {
  // Broad-phase circle radius; keep this at least as large as the drawn/collision
  // mask so instant beams can hit the same weapon bodies as projectile logic.
  if (m.weaponType === 'plasmoid') return DISPLAY_TO_WORLD(28);
  if (m.weaponType === 'bubble') return DISPLAY_TO_WORLD(5);
  if (m.weaponType === 'chenjesu_crystal') return DISPLAY_TO_WORLD(9);
  if (m.weaponType === 'chenjesu_shard') return DISPLAY_TO_WORLD(8);
  if (m.weaponType === 'dogi') return DISPLAY_TO_WORLD(9);
  if (m.weaponType === 'chmmr_satellite') return DISPLAY_TO_WORLD(9);
  if (m.weaponType === 'melnorme_pump') return DISPLAY_TO_WORLD(12);
  if (m.weaponType === 'melnorme_charging') return DISPLAY_TO_WORLD(12);
  if (m.weaponType === 'melnorme_confuse') return DISPLAY_TO_WORLD(10);
  if (m.weaponType === 'thraddash_horn') return DISPLAY_TO_WORLD(6);
  if (m.weaponType === 'thraddash_napalm') return DISPLAY_TO_WORLD(11);
  if (m.weaponType === 'umgah_cone') return DISPLAY_TO_WORLD(56);
  if (m.weaponType === 'zoqfotpik_spit') return DISPLAY_TO_WORLD(6);
  if (m.weaponType === 'supox_glob') return DISPLAY_TO_WORLD(10);
  if (m.weaponType === 'buzzsaw') return DISPLAY_TO_WORLD(12);
  if (m.weaponType === 'gas_cloud') return DISPLAY_TO_WORLD(6);
  if (m.weaponType === 'fighter') return DISPLAY_TO_WORLD(8);
  if (m.weaponType === 'orz_howitzer') return DISPLAY_TO_WORLD(6);
  if (m.weaponType === 'orz_marine') return DISPLAY_TO_WORLD(5);
  return DISPLAY_TO_WORLD(2);
}
