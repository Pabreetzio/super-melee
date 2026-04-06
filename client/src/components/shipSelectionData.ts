import type { ShipId } from 'shared/types';
import { SHIP_STATUS_DATA } from '../engine/ships/statusData';

export const SHIP_COSTS: Partial<Record<ShipId, number>> = {
  androsynth: 15, arilou: 16, chenjesu: 28, chmmr: 30, druuge: 17,
  human: 11, ilwrath: 10, melnorme: 18, mmrnmhrm: 19, mycon: 21,
  orz: 23, pkunk: 20, shofixti: 5, slylandro: 17, spathi: 18,
  supox: 16, syreen: 13, thraddash: 10, umgah: 7, urquan: 30,
  utwig: 22, vux: 12, yehat: 23, zoqfotpik: 6,
  kohrah: 30, samatra: 0,
};

// Served from /ships/<folder>/<name>-big-000.png via Vite's publicDir.
export const SHIP_ICON: Partial<Record<ShipId, string>> = {
  androsynth: '/ships/androsynth/guardian-big-000.png',
  arilou:     '/ships/arilou/skiff-big-000.png',
  chenjesu:   '/ships/chenjesu/broodhome-big-000.png',
  chmmr:      '/ships/chmmr/avatar-big-000.png',
  druuge:     '/ships/druuge/mauler-big-000.png',
  human:      '/ships/human/cruiser-big-000.png',
  ilwrath:    '/ships/ilwrath/avenger-big-000.png',
  kohrah:     '/ships/kohrah/marauder-big-000.png',
  melnorme:   '/ships/melnorme/trader-big-000.png',
  mmrnmhrm:   '/ships/mmrnmhrm/xform-big-000.png',
  mycon:      '/ships/mycon/podship-big-000.png',
  orz:        '/ships/orz/nemesis-big-000.png',
  pkunk:      '/ships/pkunk/fury-big-000.png',
  shofixti:   '/ships/shofixti/scout-big-000.png',
  slylandro:  '/ships/slylandro/probe-big-000.png',
  spathi:     '/ships/spathi/eluder-big-000.png',
  supox:      '/ships/supox/blade-big-000.png',
  syreen:     '/ships/syreen/penetrator-big-000.png',
  thraddash:  '/ships/thraddash/torch-big-000.png',
  umgah:      '/ships/umgah/drone-big-000.png',
  urquan:     '/ships/urquan/dreadnought-big-000.png',
  utwig:      '/ships/utwig/jugger-big-000.png',
  vux:        '/ships/vux/intruder-big-000.png',
  yehat:      '/ships/yehat/terminator-big-000.png',
  zoqfotpik:  '/ships/zoqfotpik/stinger-big-000.png',
};

export interface ShipSelectionPreview {
  shipId: ShipId;
  race: string;
  currentCrew: number;
  maxCrew: number;
  currentEnergy: number;
  maxEnergy: number;
  cost: number;
}

const STARTING_OVERRIDES: Partial<Record<ShipId, { crew?: number; energy?: number }>> = {
  utwig:  { energy: 10 },
};

const MAX_STATS: Partial<Record<ShipId, { crew: number; energy: number }>> = {
  androsynth: { crew: 20, energy: 24 },
  arilou:     { crew: 6,  energy: 20 },
  chenjesu:   { crew: 36, energy: 30 },
  chmmr:      { crew: 42, energy: 42 },
  druuge:     { crew: 14, energy: 32 },
  human:      { crew: 18, energy: 18 },
  ilwrath:    { crew: 22, energy: 16 },
  kohrah:     { crew: 42, energy: 42 },
  melnorme:   { crew: 20, energy: 42 },
  mmrnmhrm:   { crew: 20, energy: 10 },
  mycon:      { crew: 20, energy: 40 },
  orz:        { crew: 16, energy: 20 },
  pkunk:      { crew: 8,  energy: 12 },
  shofixti:   { crew: 6,  energy: 4 },
  slylandro:  { crew: 12, energy: 20 },
  spathi:     { crew: 30, energy: 10 },
  supox:      { crew: 12, energy: 16 },
  syreen:     { crew: 42, energy: 16 },
  thraddash:  { crew: 8,  energy: 24 },
  umgah:      { crew: 10, energy: 30 },
  urquan:     { crew: 42, energy: 42 },
  utwig:      { crew: 20, energy: 20 },
  vux:        { crew: 20, energy: 40 },
  yehat:      { crew: 20, energy: 10 },
  zoqfotpik:  { crew: 10, energy: 10 },
  samatra:    { crew: 1,  energy: 42 },
};

export function getShipSelectionPreview(shipId: ShipId | null): ShipSelectionPreview | null {
  if (!shipId) return null;

  const max = MAX_STATS[shipId];
  const status = SHIP_STATUS_DATA[shipId];
  if (!max || !status) return null;

  const starting = STARTING_OVERRIDES[shipId] ?? {};
  return {
    shipId,
    race: status.race,
    currentCrew: starting.crew ?? max.crew,
    maxCrew: max.crew,
    currentEnergy: starting.energy ?? max.energy,
    maxEnergy: max.energy,
    cost: SHIP_COSTS[shipId] ?? 0,
  };
}
