// Sprite loader — loads battle frames through generated atlases.
// Frame filenames still follow the extracted UQM naming, but runtime resolves
// them from build-generated atlas images instead of downloading each PNG.

import { getAtlasFrameForUrl } from './atlasAssets';

export interface SpriteFrame {
  img:    CanvasImageSource;
  width:  number;
  height: number;
  hotX:   number; // pixels from left of image to ship center
  hotY:   number; // pixels from top  of image to ship center
  sourceX?: number;
  sourceY?: number;
  sourceW?: number;
  sourceH?: number;
  mask:   Uint8Array; // 1 byte per pixel, non-zero = collidable
}

export interface SpriteSet {
  frames: (SpriteFrame | null)[]; // null = not yet loaded
  count:  number;
}

// ─── Hot-spot tables (from .ani files) ───────────────────────────────────────
// Format: [hotX, hotY] per frame index

// cruiser-big (16 rotation frames)
const CRUISER_BIG_HOTSPOTS: [number, number][] = [
  [7,19],[12,19],[16,15],[21,12],[20,6],[20,13],[16,15],[13,17],
  [7,17],[13,17],[17,15],[20,13],[23,6],[19,11],[17,16],[13,19],
];

// cruiser-med (16 rotation frames) — from cruiser-med.ani
const CRUISER_MED_HOTSPOTS: [number, number][] = [
  [2,9],[6,8],[9,7],[12,5],[10,2],[12,7],[9,9],[7,10],
  [3,9],[6,10],[7,9],[9,7],[10,3],[8,5],[7,7],[6,8],
];

// cruiser-sml (16 rotation frames)
const CRUISER_SML_HOTSPOTS: [number, number][] = [
  [1,4],[3,4],[4,4],[5,2],[6,1],[5,3],[4,4],[3,5],
  [1,5],[2,5],[4,4],[4,3],[5,1],[4,2],[4,4],[2,4],
];

// saturn-big (25 frames — first 16 are rotation, rest are unused here)
const SATURN_BIG_HOTSPOTS: [number, number][] = [
  [1,11],[5,10],[8,9],[11,6],[12,1],[11,6],[8,9],[5,10],
  [1,11],[5,10],[8,9],[11,6],[12,1],[11,6],[8,9],[5,10],
  [8,7],[9,8],[10,9],[11,10],[13,11],[14,12],[15,13],[17,14],[18,15],
];

// saturn-med (from saturn-med.ani, cols 4+5 = hotX, hotY)
const SATURN_MED_HOTSPOTS: [number, number][] = [
  [1,6],[3,6],[5,5],[6,4],[7,1],[6,3],[5,5],[3,6],
  [1,6],[3,6],[5,5],[6,3],[7,1],[6,3],[5,5],[3,6],
  [4,4],[4,4],[5,5],[5,5],[6,5],[7,6],[8,6],[8,7],[9,7],
];

// saturn-sml (from saturn-sml.ani, cols 4+5 = hotX, hotY)
const SATURN_SML_HOTSPOTS: [number, number][] = [
  [0,3],[1,3],[2,2],[3,1],[3,0],[3,1],[2,2],[1,3],
  [0,3],[1,3],[2,2],[3,1],[3,0],[3,1],[2,2],[1,3],
  [2,2],[2,2],[2,2],[2,2],[3,2],[3,3],[4,3],[4,3],[4,3],
];

// ─── Loader ───────────────────────────────────────────────────────────────────

function loadFrame(url: string, hotX: number, hotY: number): Promise<SpriteFrame> {
  return getAtlasFrameForUrl(url).then(frame => {
    if (!frame) {
      console.warn(`Sprite not found in atlas: ${url} (run the atlas generator)`);
      throw new Error(`Failed to load ${url}`);
    }
    return {
      img: frame.img,
      width: frame.width,
      height: frame.height,
      hotX,
      hotY,
      sourceX: frame.x,
      sourceY: frame.y,
      sourceW: frame.width,
      sourceH: frame.height,
      mask: frame.mask,
    };
  });
}

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

// path = 'species/shipname', e.g. 'human/cruiser' or 'spathi/eluder'
export async function loadSpriteSet(
  path: string,
  size: 'big' | 'med' | 'sml',
  count: number,
  hotspots: [number, number][],
): Promise<SpriteSet> {
  const frames: (SpriteFrame | null)[] = Array(count).fill(null);

  await Promise.all(
    Array.from({ length: count }, (_, i) => {
      const [hotX, hotY] = hotspots[i] ?? [0, 0];
      const url = `/ships/${path}-${size}-${pad3(i)}.png`;
      return loadFrame(url, hotX, hotY)
        .then(f => { frames[i] = f; })
        .catch(() => { /* frame stays null; placeholder rendered */ });
    })
  );

  return { frames, count };
}

// ─── Spathi hotspot tables ────────────────────────────────────────────────────

// eluder-big.ani — 16 rotation frames
const ELUDER_BIG_HOTSPOTS: [number, number][] = [
  [14,11],[17,14],[17,14],[14,13],[12,12],[13,14],[14,14],[14,13],
  [12,11],[16,11],[17,13],[16,13],[13,11],[16,15],[16,16],[16,15],
];
const ELUDER_MED_HOTSPOTS: [number, number][] = [
  [7,5],[9,7],[9,7],[7,7],[6,6],[7,7],[8,7],[8,6],
  [7,6],[9,5],[9,6],[9,6],[8,6],[9,8],[9,8],[7,8],
];
const ELUDER_SML_HOTSPOTS: [number, number][] = [
  [3,2],[3,3],[4,3],[3,3],[2,3],[3,3],[3,3],[3,3],
  [3,2],[4,3],[4,3],[3,3],[3,3],[3,3],[4,4],[3,3],
];

// butt-big.ani — 16 rotation frames (B.U.T.T. missile)
const BUTT_BIG_HOTSPOTS: [number, number][] = [
  [1,4],[2,4],[3,3],[4,2],[4,1],[4,2],[3,3],[2,4],
  [1,4],[2,4],[3,3],[4,2],[4,1],[4,2],[3,3],[2,4],
];
const BUTT_MED_HOTSPOTS: [number, number][] = [
  [1,2],[2,2],[2,2],[2,2],[2,1],[2,2],[2,2],[2,2],
  [1,2],[2,2],[2,2],[2,2],[2,1],[2,2],[2,2],[2,2],
];
const BUTT_SML_HOTSPOTS: [number, number][] = [
  [1,1],[1,1],[1,1],[1,1],[1,0],[1,1],[1,1],[1,1],
  [0,1],[1,1],[1,1],[1,1],[1,0],[1,1],[1,1],[1,1],
];

// missile-big.ani — 16 rotation frames (forward gun)
const SPATHI_MISSILE_BIG_HOTSPOTS: [number, number][] = [
  [1,1],[1,0],[2,0],[2,0],[2,1],[2,1],[2,2],[1,2],
  [1,2],[0,2],[0,2],[0,1],[1,1],[0,0],[0,0],[0,0],
];
const SPATHI_MISSILE_MED_HOTSPOTS: [number, number][] = [
  [0,0],[1,0],[1,0],[1,0],[0,0],[1,0],[1,0],[1,0],
  [1,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],
];
const SPATHI_MISSILE_SML_HOTSPOTS: [number, number][] = Array(16).fill([0, 0]);
const SHOFIXTI_MISSILE_BIG_HOTSPOTS: [number, number][] = [
  [1,1],[1,0],[2,0],[2,0],[2,1],[2,1],[2,2],[1,2],
  [1,2],[0,2],[0,2],[0,1],[1,1],[0,0],[0,0],[0,0],
];
const SHOFIXTI_MISSILE_MED_HOTSPOTS: [number, number][] = [
  [0,0],[1,0],[1,0],[1,0],[0,0],[1,1],[1,1],[1,1],
  [0,1],[0,1],[0,1],[0,1],[0,0],[0,0],[0,0],[0,0],
];
const SHOFIXTI_MISSILE_SML_HOTSPOTS: [number, number][] = Array(16).fill([0, 0]);
const YEHAT_MISSILE_BIG_HOTSPOTS: [number, number][] = [
  [1,1],[1,0],[2,0],[2,0],[2,1],[2,1],[2,2],[1,2],
  [1,2],[0,2],[0,2],[0,1],[1,1],[0,0],[0,0],[0,0],
];
const YEHAT_MISSILE_MED_HOTSPOTS: [number, number][] = [
  [0,0],[1,0],[1,0],[1,0],[0,0],[1,1],[1,1],[1,1],
  [0,1],[0,1],[0,1],[0,1],[0,0],[0,0],[0,0],[0,0],
];
const YEHAT_MISSILE_SML_HOTSPOTS: [number, number][] = Array(16).fill([0, 0]);
const YEHAT_SHIELD_BIG_HOTSPOTS: [number, number][] = [
  [11,11],[10,13],[8,13],[8,12],[6,10],[8,8],[8,7],[9,6],
  [11,6],[13,6],[14,6],[12,8],[11,10],[13,12],[15,13],[13,12],
];
const YEHAT_SHIELD_MED_HOTSPOTS: [number, number][] = [
  [7,6],[5,7],[4,8],[4,8],[3,6],[4,5],[4,4],[5,4],
  [7,4],[8,4],[9,4],[8,5],[6,6],[8,7],[9,8],[8,7],
];
const YEHAT_SHIELD_SML_HOTSPOTS: [number, number][] = [
  [4,3],[4,4],[4,4],[3,4],[3,4],[4,3],[4,3],[4,3],
  [4,3],[4,3],[4,3],[4,4],[4,4],[4,4],[4,4],[4,4],
];

// ─── Ship-specific loaders ────────────────────────────────────────────────────

export interface CruiserSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  nuke: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

export async function loadCruiserSprites(): Promise<CruiserSprites> {
  const [big, med, sml] = await Promise.all([
    loadSpriteSet('human/cruiser', 'big', 16, CRUISER_BIG_HOTSPOTS),
    loadSpriteSet('human/cruiser', 'med', 16, CRUISER_MED_HOTSPOTS),
    loadSpriteSet('human/cruiser', 'sml', 16, CRUISER_SML_HOTSPOTS),
  ]);

  // Saturn (nuke) — load all three sizes using the same generic loader
  const [nukeBig, nukeMed, nukeSml] = await Promise.all([
    loadSpriteSet('human/saturn', 'big', 16, SATURN_BIG_HOTSPOTS),
    loadSpriteSet('human/saturn', 'med', 16, SATURN_MED_HOTSPOTS),
    loadSpriteSet('human/saturn', 'sml', 16, SATURN_SML_HOTSPOTS),
  ]);

  return {
    big,
    med,
    sml,
    nuke: { big: nukeBig, med: nukeMed, sml: nukeSml },
  };
}

export interface SpathiSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  butt:    { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
  missile: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

export async function loadSpathiSprites(): Promise<SpathiSprites> {
  const [big, med, sml] = await Promise.all([
    loadSpriteSet('spathi/eluder', 'big', 16, ELUDER_BIG_HOTSPOTS),
    loadSpriteSet('spathi/eluder', 'med', 16, ELUDER_MED_HOTSPOTS),
    loadSpriteSet('spathi/eluder', 'sml', 16, ELUDER_SML_HOTSPOTS),
  ]);
  const [buttBig, buttMed, buttSml] = await Promise.all([
    loadSpriteSet('spathi/butt', 'big', 16, BUTT_BIG_HOTSPOTS),
    loadSpriteSet('spathi/butt', 'med', 16, BUTT_MED_HOTSPOTS),
    loadSpriteSet('spathi/butt', 'sml', 16, BUTT_SML_HOTSPOTS),
  ]);
  const [missileBig, missileMed, missileSml] = await Promise.all([
    loadSpriteSet('spathi/missile', 'big', 16, SPATHI_MISSILE_BIG_HOTSPOTS),
    loadSpriteSet('spathi/missile', 'med', 16, SPATHI_MISSILE_MED_HOTSPOTS),
    loadSpriteSet('spathi/missile', 'sml', 16, SPATHI_MISSILE_SML_HOTSPOTS),
  ]);
  return {
    big, med, sml,
    butt:    { big: buttBig,    med: buttMed,    sml: buttSml },
    missile: { big: missileBig, med: missileMed, sml: missileSml },
  };
}

export interface ShofixtiSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  missile: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

export async function loadShofixtiSprites(): Promise<ShofixtiSprites> {
  const [big, med, sml] = await Promise.all([
    loadSpriteSet('shofixti/scout', 'big', 16, SCOUT_BIG_HOTSPOTS),
    loadSpriteSet('shofixti/scout', 'med', 16, SCOUT_MED_HOTSPOTS),
    loadSpriteSet('shofixti/scout', 'sml', 16, SCOUT_SML_HOTSPOTS),
  ]);
  const [missileBig, missileMed, missileSml] = await Promise.all([
    loadSpriteSet('shofixti/missile', 'big', 16, SHOFIXTI_MISSILE_BIG_HOTSPOTS),
    loadSpriteSet('shofixti/missile', 'med', 16, SHOFIXTI_MISSILE_MED_HOTSPOTS),
    loadSpriteSet('shofixti/missile', 'sml', 16, SHOFIXTI_MISSILE_SML_HOTSPOTS),
  ]);
  return {
    big, med, sml,
    missile: { big: missileBig, med: missileMed, sml: missileSml },
  };
}

export interface ThraddashSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  horn: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
  napalm: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

export async function loadThraddashSprites(): Promise<ThraddashSprites> {
  const body = await loadGenericShipSprites('thraddash');
  if (!body) throw new Error('Missing thraddash body sprites');
  const [hornBig, hornMed, hornSml, napalmBig, napalmMed, napalmSml] = await Promise.all([
    loadSpriteSet('thraddash/horn', 'big', 16, HORN_BIG_HOTSPOTS),
    loadSpriteSet('thraddash/horn', 'med', 16, HORN_MED_HOTSPOTS),
    loadSpriteSet('thraddash/horn', 'sml', 16, HORN_SML_HOTSPOTS),
    loadSpriteSet('thraddash/napalm', 'big', 8, NAPALM_BIG_HOTSPOTS),
    loadSpriteSet('thraddash/napalm', 'med', 8, NAPALM_MED_HOTSPOTS),
    loadSpriteSet('thraddash/napalm', 'sml', 8, NAPALM_SML_HOTSPOTS),
  ]);
  return {
    ...body,
    horn: { big: hornBig, med: hornMed, sml: hornSml },
    napalm: { big: napalmBig, med: napalmMed, sml: napalmSml },
  };
}

const GLOB_BIG_HOTSPOTS: [number, number][] = [
  [1,1],[3,1],[6,1],[8,1],[8,1],[8,3],[6,6],[3,8],
  [1,8],[1,8],[1,6],[2,3],[2,1],[2,1],[1,1],[1,1],
  [2,2],[5,6],[10,9],[12,11],[13,13],
];
const GLOB_MED_HOTSPOTS: [number, number][] = [
  [0,0],[2,0],[3,0],[4,0],[4,0],[4,2],[3,3],[2,4],
  [0,4],[0,4],[0,3],[0,2],[0,0],[0,0],[0,0],[0,0],
  [1,1],[2,3],[3,4],[4,5],[5,6],
];
const GLOB_SML_HOTSPOTS: [number, number][] = [
  [0,0],[1,0],[1,0],[1,0],[1,0],[1,1],[1,1],[1,1],
  [0,1],[0,1],[0,1],[0,1],[0,0],[0,0],[0,0],[0,0],
  [0,0],[1,1],[2,2],[3,3],[3,3],
];

export interface SupoxSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  glob: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

export async function loadSupoxSprites(): Promise<SupoxSprites> {
  const body = await loadGenericShipSprites('supox');
  if (!body) throw new Error('Missing supox body sprites');
  const [globBig, globMed, globSml] = await Promise.all([
    loadSpriteSet('supox/glob', 'big', 21, GLOB_BIG_HOTSPOTS),
    loadSpriteSet('supox/glob', 'med', 21, GLOB_MED_HOTSPOTS),
    loadSpriteSet('supox/glob', 'sml', 21, GLOB_SML_HOTSPOTS),
  ]);
  return {
    ...body,
    glob: { big: globBig, med: globMed, sml: globSml },
  };
}

export interface ZoqfotpikSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  spit: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
  proboscis: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

export async function loadZoqfotpikSprites(): Promise<ZoqfotpikSprites> {
  const body = await loadGenericShipSprites('zoqfotpik');
  if (!body) throw new Error('Missing zoqfotpik body sprites');
  const [spitBig, spitMed, spitSml, proboscisBig, proboscisMed, proboscisSml] = await Promise.all([
    loadSpriteSet('zoqfotpik/spit', 'big', 13, SPIT_BIG_HOTSPOTS),
    loadSpriteSet('zoqfotpik/spit', 'med', 13, SPIT_MED_HOTSPOTS),
    loadSpriteSet('zoqfotpik/spit', 'sml', 13, SPIT_SML_HOTSPOTS),
    loadSpriteSet('zoqfotpik/proboscis', 'big', 16, PROBOSCIS_BIG_HOTSPOTS),
    loadSpriteSet('zoqfotpik/proboscis', 'med', 16, PROBOSCIS_MED_HOTSPOTS),
    loadSpriteSet('zoqfotpik/proboscis', 'sml', 16, PROBOSCIS_SML_HOTSPOTS),
  ]);
  return {
    ...body,
    spit: { big: spitBig, med: spitMed, sml: spitSml },
    proboscis: { big: proboscisBig, med: proboscisMed, sml: proboscisSml },
  };
}

// ─── VUX Intruder hotspot tables ─────────────────────────────────────────────

// intruder-big.ani — 16 rotation frames
const INTRUDER_BIG_HOTSPOTS: [number, number][] = [
  [7,11],[8,11],[10,8],[11,5],[7,6],[10,8],[11,8],[8,7],
  [7,6],[7,7],[10,8],[12,7],[13,6],[11,5],[8,9],[6,11],
];
const INTRUDER_MED_HOTSPOTS: [number, number][] = [
  [3,5],[4,5],[5,4],[4,2],[3,3],[4,4],[5,4],[4,3],
  [3,3],[2,3],[4,4],[5,4],[6,3],[5,2],[4,4],[2,4],
];
const INTRUDER_SML_HOTSPOTS: [number, number][] = [
  [2,3],[2,3],[2,2],[2,2],[2,2],[2,2],[2,2],[2,2],
  [2,2],[2,2],[3,2],[3,2],[3,2],[3,2],[3,3],[2,3],
];

// limpets — 4 animation frames (no rotation, animated sprite)
const LIMPETS_BIG_HOTSPOT:  [number, number][] = [[1,1],[1,1],[1,1],[0,0]];
const LIMPETS_MED_HOTSPOT:  [number, number][] = [[0,0],[0,0],[0,0],[0,0]];
const LIMPETS_SML_HOTSPOT:  [number, number][] = [[0,0],[0,0],[0,0],[0,0]];

// Androsynth bubble / blazer
const BUBBLE_BIG_HOTSPOTS: [number, number][] = [[3,3],[4,4],[4,4]];
const BUBBLE_MED_HOTSPOTS: [number, number][] = [[1,1],[2,2],[2,2]];
const BUBBLE_SML_HOTSPOTS: [number, number][] = [[1,1],[1,1],[1,1]];
const BLAZER_BIG_HOTSPOTS: [number, number][] = [
  [5,5],[7,5],[10,5],[10,5],[12,5],[15,7],[13,12],[9,14],
  [5,16],[5,15],[5,12],[5,8],[5,5],[5,5],[5,5],[5,5],
];
const BLAZER_MED_HOTSPOTS: [number, number][] = [
  [2,2],[4,2],[6,2],[7,2],[7,2],[7,4],[6,4],[4,5],
  [2,7],[2,6],[2,6],[2,4],[3,2],[2,2],[2,2],[2,2],
];
const BLAZER_SML_HOTSPOTS: [number, number][] = [
  [1,2],[2,1],[3,1],[5,1],[4,1],[5,1],[3,3],[2,4],
  [1,4],[1,4],[1,3],[1,1],[2,1],[1,1],[1,1],[1,1],
];
const CHENJESU_SPARK_BIG_HOTSPOTS: [number, number][] = [
  [4,4],[2,2],[10,9],[11,11],[14,13],[16,15],[18,17],[18,17],[18,17],[18,17],[18,17],
];
const CHENJESU_SPARK_MED_HOTSPOTS: [number, number][] = [
  [3,3],[1,1],[4,5],[5,5],[6,7],[7,7],[9,9],[8,9],[9,9],[8,9],[9,9],
];
const CHENJESU_SPARK_SML_HOTSPOTS: [number, number][] = [
  [2,2],[0,0],[1,2],[2,3],[3,3],[4,4],[5,5],[5,5],[5,4],[5,4],[5,4],
];
const DOGGY_BIG_HOTSPOTS: [number, number][] = [[9,8],[9,8],[9,8],[9,8],[9,8],[9,8],[9,8]];
const DOGGY_MED_HOTSPOTS: [number, number][] = [[4,4],[4,4],[4,4],[4,4],[4,4],[4,4],[4,4]];
const DOGGY_SML_HOTSPOTS: [number, number][] = [[2,2],[2,2],[2,2],[2,2],[2,2],[2,2],[2,2]];
const MUZZLE_BIG_HOTSPOTS: [number, number][] = [
  [0,22],[-11,20],[-16,17],[-21,10],[-22,0],[-22,-10],[-17,-16],[-11,-20],
  [0,-22],[11,-20],[17,-16],[22,-10],[23,0],[22,10],[17,16],[11,20],
  [2,21],[-6,19],[-11,16],[-14,9],[-17,2],[-15,-5],[-12,-11],[-6,-13],
  [2,-17],[10,-13],[16,-11],[21,-5],[22,2],[21,9],[16,15],[10,19],
  [3,4],[3,4],[5,5],[5,5],[6,5],[6,4],[6,4],[5,3],[5,0],
];
const MUZZLE_MED_HOTSPOTS: [number, number][] = [
  [0,-11],[5,-12],[9,-9],[10,-5],[12,0],[10,5],[9,10],[6,12],
  [0,12],[-6,13],[-9,10],[-10,5],[-12,0],[-10,-6],[-9,-9],[-6,-12],
  [1,10],[-4,10],[-5,8],[-8,4],[-9,1],[-8,-3],[-5,-6],[-4,-8],
  [1,-9],[5,-8],[8,-6],[10,-3],[11,1],[10,4],[8,8],[5,10],
  [3,4],[3,4],[5,5],[5,5],[6,5],[6,4],[6,4],[5,3],[5,0],
];
const MUZZLE_SML_HOTSPOTS: [number, number][] = [
  [0,-7],[3,-6],[5,-5],[6,-3],[7,0],[6,3],[5,5],[3,6],
  [0,7],[-3,6],[-5,-5],[-6,3],[-7,0],[-6,-3],[-5,-5],[-3,-6],
  [0,6],[-2,5],[-3,4],[-4,2],[-5,0],[-4,-2],[-3,-3],[-2,-4],
  [0,-5],[2,-4],[4,-3],[5,-2],[6,0],[5,2],[4,4],[2,5],
  [2,2],[2,2],[3,2],[3,3],[3,2],[4,2],[3,2],[3,1],[3,0],
];
const SATELLITE_BIG_HOTSPOTS: [number, number][] = [[9,7],[8,7],[5,7],[3,7],[3,7],[3,7],[5,7],[8,7]];
const SATELLITE_MED_HOTSPOTS: [number, number][] = [[4,3],[4,3],[3,3],[2,3],[1,3],[2,3],[3,3],[4,3]];
const SATELLITE_SML_HOTSPOTS: [number, number][] = [[2,2],[2,2],[2,2],[1,2],[1,2],[2,2],[2,2],[2,2]];
const CANNON_BIG_HOTSPOTS: [number, number][] = [
  [1,5],[2,5],[2,4],[3,2],[3,1],[3,2],[2,2],[2,3],
  [1,3],[2,3],[4,2],[5,2],[5,1],[5,2],[4,4],[2,5],
];
const CANNON_MED_HOTSPOTS: [number, number][] = [
  [1,3],[0,2],[1,1],[1,1],[1,1],[1,0],[1,1],[0,1],
  [1,1],[1,1],[2,1],[2,0],[3,1],[2,1],[2,2],[1,2],
];
const CANNON_SML_HOTSPOTS: [number, number][] = [
  [0,1],[0,1],[0,1],[1,1],[1,0],[1,1],[0,0],[0,1],
  [0,1],[0,1],[1,1],[1,1],[1,0],[1,0],[1,1],[0,1],
];
const FIRE_BIG_HOTSPOTS: [number, number][] = [[4,3],[4,4],[5,5],[5,5],[6,6],[7,6],[9,8],[10,9]];
const FIRE_MED_HOTSPOTS: [number, number][] = [[2,2],[2,2],[2,2],[2,2],[3,2],[3,3],[4,4],[5,4]];
const FIRE_SML_HOTSPOTS: [number, number][] = [[1,1],[1,1],[1,1],[1,1],[1,1],[2,1],[2,2],[2,2]];
const HORN_BIG_HOTSPOTS: [number, number][] = [
  [2,5],[2,5],[3,4],[5,1],[5,2],[5,3],[3,3],[2,5],
  [2,5],[2,5],[4,3],[5,3],[5,2],[5,2],[4,3],[2,5],
];
const HORN_MED_HOTSPOTS: [number, number][] = [
  [1,2],[1,2],[1,2],[1,1],[1,1],[1,1],[1,1],[1,1],
  [1,1],[1,1],[2,1],[3,1],[3,1],[3,1],[2,2],[1,2],
];
const HORN_SML_HOTSPOTS: [number, number][] = Array.from({ length: 16 }, () => [1, 1]);
const NAPALM_BIG_HOTSPOTS: [number, number][] = [[4,3],[4,4],[5,5],[5,5],[6,6],[7,6],[9,8],[10,9]];
const NAPALM_MED_HOTSPOTS: [number, number][] = [[2,2],[2,2],[2,2],[2,2],[3,2],[3,3],[4,4],[5,4]];
const NAPALM_SML_HOTSPOTS: [number, number][] = [[1,1],[1,1],[1,1],[1,1],[1,1],[2,1],[2,2],[2,2]];
const SPIT_BIG_HOTSPOTS: [number, number][] = Array.from({ length: 13 }, () => [0, 0]);
const SPIT_MED_HOTSPOTS: [number, number][] = Array.from({ length: 13 }, () => [0, 0]);
const SPIT_SML_HOTSPOTS: [number, number][] = Array.from({ length: 13 }, () => [0, 0]);
const PROBOSCIS_BIG_HOTSPOTS: [number, number][] = [
  [1,13],[-2,11],[-3,9],[-4,3],[-5,1],[-4,-2],[-2,-2],[-2,-4],
  [1,-4],[2,-4],[10,-3],[11,-2],[15,1],[10,3],[9,9],[3,11],
];
const PROBOSCIS_MED_HOTSPOTS: [number, number][] = [
  [0,7],[-1,7],[-2,6],[-3,2],[-3,0],[-3,-1],[-2,-2],[-1,-3],
  [0,-3],[2,-3],[6,-2],[7,-1],[8,0],[7,2],[6,6],[3,7],
];
const PROBOSCIS_SML_HOTSPOTS: [number, number][] = [
  [0,4],[-1,3],[-1,3],[-1,2],[-2,0],[-1,-1],[-1,-1],[-1,-1],
  [0,-2],[2,-1],[3,-1],[3,-1],[5,0],[3,2],[3,3],[2,3],
];
const PUMPUP_BIG_HOTSPOTS: [number, number][] = [
  [5,5],[4,4],[3,3],[3,3],[4,4],[6,6],[5,5],[4,4],[4,4],[5,5],
  [8,8],[7,7],[5,5],[5,5],[7,7],[12,12],[10,10],[8,8],[7,7],[10,10],
  [1,1],[2,2],[4,4],[6,6],[8,8],[10,10],
];
const PUMPUP_MED_HOTSPOTS: [number, number][] = [
  [2,2],[2,2],[1,1],[1,1],[2,2],[3,3],[3,3],[2,2],[2,2],[3,3],
  [5,5],[4,4],[3,3],[3,3],[4,4],[6,6],[5,5],[4,4],[4,4],[5,5],
  [1,1],[1,1],[2,2],[3,3],[4,4],[5,5],
];
const PUMPUP_SML_HOTSPOTS: [number, number][] = [
  [0,0],[0,0],[0,0],[0,0],[0,0],[1,1],[1,1],[1,1],[1,1],[1,1],
  [2,2],[2,2],[1,1],[1,1],[2,2],[3,3],[3,3],[2,2],[2,2],[3,3],
  [0,0],[1,1],[1,1],[1,1],[2,2],[2,2],
];
const CONFUSE_BIG_HOTSPOTS: [number, number][] = [
  [5,5],[6,6],[7,7],[7,7],[7,7],[7,7],[7,7],[7,7],
  [16,14],[11,16],[11,16],[13,16],[13,16],[16,15],[16,14],[16,14],
];
const CONFUSE_MED_HOTSPOTS: [number, number][] = [
  [3,3],[4,4],[4,4],[4,4],[4,4],[4,4],[4,4],[4,4],
  [8,6],[5,7],[5,7],[6,7],[6,7],[8,7],[8,6],[8,6],
];
const CONFUSE_SML_HOTSPOTS: [number, number][] = [
  [1,1],[2,2],[2,2],[2,2],[2,2],[2,2],[2,2],[2,2],
  [4,4],[4,4],[4,3],[3,4],[2,4],[2,4],[2,4],[4,4],
];

// ─── Pkunk Fury hotspot tables ────────────────────────────────────────────────

// fury-big.ani — 16 rotation frames
const FURY_BIG_HOTSPOTS: [number, number][] = [
  [13,11],[13,11],[13,13],[10,12],[8,13],[10,14],[12,13],[14,10],
  [13,8],[12,10],[12,12],[11,14],[12,13],[11,12],[13,12],[13,11],
];
const FURY_MED_HOTSPOTS: [number, number][] = [
  [6,5],[7,5],[7,6],[5,6],[4,7],[5,7],[7,7],[7,5],
  [6,4],[5,5],[4,7],[4,8],[5,7],[5,6],[5,6],[5,5],
];
const FURY_SML_HOTSPOTS: [number, number][] = [
  [3,3],[3,2],[2,3],[2,2],[2,3],[2,3],[2,2],[3,2],
  [3,2],[2,2],[3,2],[2,3],[3,3],[2,2],[3,3],[2,2],
];

// bug-big/med/sml — single frame (no rotation on missiles)
const BUG_BIG_HOTSPOT:  [number, number][] = [[3,3]];
const BUG_MED_HOTSPOT:  [number, number][] = [[1,1]];
const BUG_SML_HOTSPOT:  [number, number][] = [[0,0]];

// ─── Mycon Podship projectile hotspots ───────────────────────────────────────

// plasma-*.ani — first 11 frames are the in-flight plasmoid growth/decay states.
const PLASMA_BIG_HOTSPOTS: [number, number][] = [
  [7,6],[8,8],[11,9],[13,11],[15,14],[19,16],[23,19],[27,23],[27,23],[27,23],[25,22],
];
const PLASMA_MED_HOTSPOTS: [number, number][] = [
  [2,3],[4,4],[4,4],[6,5],[7,7],[9,8],[11,9],[13,11],[13,11],[14,12],[12,11],
];
const PLASMA_SML_HOTSPOTS: [number, number][] = [
  [1,1],[2,2],[2,2],[3,2],[4,3],[4,4],[5,4],[6,5],[7,5],[6,5],[5,5],
];
const PLASMA_IMPACT_BIG_HOTSPOTS: [number, number][] = [
  [1,-1],[4,7],[4,7],[9,9],[9,8],[10,8],[10,8],[10,9],
];
const PLASMA_IMPACT_MED_HOTSPOTS: [number, number][] = [
  [0,-1],[2,3],[2,3],[4,4],[4,4],[5,4],[5,4],[5,5],
];
const PLASMA_IMPACT_SML_HOTSPOTS: [number, number][] = [
  [0,-1],[1,2],[1,2],[2,2],[2,2],[2,2],[2,2],[2,2],
];

// ─── Ur-Quan Dreadnought hotspot tables ──────────────────────────────────────

// dreadnought-big.ani — 16 rotation frames
const DREADNOUGHT_BIG_HOTSPOTS: [number, number][] = [
  [14,21],[13,20],[15,16],[14,15],[12,14],[14,13],[15,14],[13,11],
  [14,11],[17,11],[18,14],[20,13],[22,14],[20,16],[18,16],[17,20],
];
// dreadnought-med.ani — 16 rotation frames
const DREADNOUGHT_MED_HOTSPOTS: [number, number][] = [
  [7,8],[8,8],[9,8],[9,8],[9,7],[9,8],[8,7],[8,8],
  [7,8],[8,8],[8,7],[9,8],[9,7],[9,8],[8,7],[8,8],
];
// dreadnought-sml.ani — 16 rotation frames
const DREADNOUGHT_SML_HOTSPOTS: [number, number][] = [
  [3,4],[4,4],[4,3],[4,3],[4,3],[3,3],[4,4],[4,4],
  [3,4],[4,4],[4,4],[4,4],[4,3],[4,4],[4,4],[4,4],
];

// fusion-big.ani — first 16 frames are rotation of the in-flight missile
const FUSION_BIG_HOTSPOTS: [number, number][] = [
  [2,8],[4,7],[6,6],[8,4],[9,2],[8,4],[6,6],[4,7],
  [2,8],[4,7],[6,6],[8,4],[9,2],[8,4],[6,6],[4,7],
];
const FUSION_MED_HOTSPOTS: [number, number][] = [
  [1,4],[2,3],[3,3],[3,2],[4,1],[3,2],[3,3],[2,3],
  [1,4],[2,3],[3,3],[3,2],[4,1],[3,2],[3,3],[2,3],
];
const FUSION_SML_HOTSPOTS: [number, number][] = [
  [1,1],[1,0],[2,0],[2,0],[2,1],[2,1],[2,2],[1,2],
  [1,2],[0,2],[0,2],[0,1],[1,1],[0,0],[0,0],[0,0],
];

// fighter-big.ani — 16 rotation frames
const FIGHTER_BIG_HOTSPOTS: [number, number][] = [
  [1,1],[1,1],[2,1],[2,1],[2,1],[2,1],[2,2],[2,2],
  [1,1],[1,1],[1,2],[1,2],[2,1],[2,1],[1,1],[1,1],
];
const FIGHTER_MED_HOTSPOTS: [number, number][] = [
  [0,0],[0,0],[1,0],[1,0],[1,0],[1,0],[1,1],[1,1],
  [0,1],[0,1],[0,1],[0,1],[0,0],[0,0],[0,0],[0,0],
];
const FIGHTER_SML_HOTSPOTS: [number, number][] = [
  [0,1],[0,1],[1,1],[1,0],[1,0],[1,0],[1,1],[1,1],
  [0,1],[1,1],[1,1],[1,1],[1,0],[1,0],[1,1],[1,1],
];

// ─── Kohr-Ah Mauler weapon hotspot tables ─────────────────────────────────────

// buzzsaw-big.ani — 8 animation frames (spinning disk)
const BUZZSAW_BIG_HOTSPOTS: [number, number][] = [
  [8,8],[9,9],[7,7],[10,10],[11,11],[13,13],[14,15],[15,16],
];
const BUZZSAW_MED_HOTSPOTS: [number, number][] = [
  [4,4],[4,4],[7,7],[3,3],[5,5],[6,7],[7,7],[6,8],
];
const BUZZSAW_SML_HOTSPOTS: [number, number][] = [
  [3,3],[2,2],[2,2],[4,4],[4,4],[5,5],[5,5],[4,4],
];

// gas-big.ani — 8 animation frames (gas cloud)
const GAS_BIG_HOTSPOTS: [number, number][] = [
  [4,3],[4,4],[5,5],[5,5],[6,6],[7,6],[9,8],[10,9],
];
const GAS_MED_HOTSPOTS: [number, number][] = [
  [2,2],[2,2],[2,2],[2,2],[3,2],[3,3],[4,4],[5,4],
];
const GAS_SML_HOTSPOTS: [number, number][] = [
  [1,1],[1,1],[1,1],[1,1],[1,1],[2,1],[2,2],[2,2],
];

// ─── Render helpers ───────────────────────────────────────────────────────────

/** Draw a filled circle at a world position — used when sprites aren't loaded. */
export function placeholderDot(
  ctx: CanvasRenderingContext2D,
  worldX: number, worldY: number,
  camX: number, camY: number,
  dotR: number, color: string,
  reduction: number = 0,
  worldW = 20480, worldH = 15360,
): void {
  let rx = worldX - camX;
  let ry = worldY - camY;
  rx = ((rx % worldW) + worldW) % worldW; if (rx > worldW >> 1) rx -= worldW;
  ry = ((ry % worldH) + worldH) % worldH; if (ry > worldH >> 1) ry -= worldH;
  let dx = rx >> (2 + reduction);
  let dy = ry >> (2 + reduction);
  const wdw = worldW >> (2 + reduction);
  const wdh = worldH >> (2 + reduction);
  if (dx < 0 && dx + wdw <= 640) dx += wdw;
  else if (dx > 640 && dx - wdw >= 0) dx -= wdw;
  if (dy < 0 && dy + wdh <= 480) dy += wdh;
  else if (dy > 480 && dy - wdh >= 0) dy -= wdh;
  ctx.beginPath();
  ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Draw a sprite frame at world position (worldX, worldY).
 * Converts world coords to display coords (divide by 4) and adjusts for hotspot.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  set: SpriteSet,
  frameIndex: number,
  worldX: number,
  worldY: number,
  canvasW: number,
  canvasH: number,
  originWorldX: number,  // world X of canvas top-left (camera)
  originWorldY: number,
  reduction: number = 0, // zoom level: 0=1x, 1=2x, 2=4x, 3=8x
  worldW = 20480, worldH = 15360,
): void {
  const normalizedIndex = ((frameIndex % set.count) + set.count) % set.count;
  const frame = set.frames[normalizedIndex];
  if (!frame) return;

  // World → display: divide by 4 at 1x, 8 at 2x, 16 at 4x, 32 at 8x
  // Normalize offset toroidally so objects near a world edge stay visible.
  let rx = worldX - originWorldX;
  let ry = worldY - originWorldY;
  rx = ((rx % worldW) + worldW) % worldW; if (rx > worldW >> 1) rx -= worldW;
  ry = ((ry % worldH) + worldH) % worldH; if (ry > worldH >> 1) ry -= worldH;
  let displayX = Math.round(rx >> (2 + reduction));
  let displayY = Math.round(ry >> (2 + reduction));
  // At maximum zoom the whole world fits on screen. The short-path normalization
  // above can place an object off-screen when the long path is actually on-screen.
  // Correct by trying the other side whenever the current result is off-canvas.
  const wdw = worldW >> (2 + reduction);
  const wdh = worldH >> (2 + reduction);
  if (displayX < 0 && displayX + wdw <= canvasW) displayX += wdw;
  else if (displayX > canvasW && displayX - wdw >= 0) displayX -= wdw;
  if (displayY < 0 && displayY + wdh <= canvasH) displayY += wdh;
  else if (displayY > canvasH && displayY - wdh >= 0) displayY -= wdh;

  // Draw sprite at native size using its own hotspot.
  // Callers are responsible for passing the correct size sprite set for the
  // current zoom level (big → r=0/1, sml → r=2/3). UQM uses pre-rendered
  // sprites per zoom level rather than scaling a single sprite down.
  const drawX = displayX - frame.hotX;
  const drawY = displayY - frame.hotY;

  // Only draw if on screen
  if (drawX + frame.width < 0 || drawX > canvasW) return;
  if (drawY + frame.height < 0 || drawY > canvasH) return;

  if (frame.sourceX !== undefined && frame.sourceY !== undefined && frame.sourceW !== undefined && frame.sourceH !== undefined) {
    ctx.drawImage(frame.img, frame.sourceX, frame.sourceY, frame.sourceW, frame.sourceH, drawX, drawY, frame.width, frame.height);
  } else {
    ctx.drawImage(frame.img, drawX, drawY);
  }
}

// ─── Ur-Quan sprites ──────────────────────────────────────────────────────────

export interface UrquanSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  fusion:  { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
  fighter: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

export async function loadUrquanSprites(): Promise<UrquanSprites> {
  const [big, med, sml] = await Promise.all([
    loadSpriteSet('urquan/dreadnought', 'big', 16, DREADNOUGHT_BIG_HOTSPOTS),
    loadSpriteSet('urquan/dreadnought', 'med', 16, DREADNOUGHT_MED_HOTSPOTS),
    loadSpriteSet('urquan/dreadnought', 'sml', 16, DREADNOUGHT_SML_HOTSPOTS),
  ]);
  const [fusionBig, fusionMed, fusionSml] = await Promise.all([
    loadSpriteSet('urquan/fusion', 'big', 16, FUSION_BIG_HOTSPOTS),
    loadSpriteSet('urquan/fusion', 'med', 16, FUSION_MED_HOTSPOTS),
    loadSpriteSet('urquan/fusion', 'sml', 16, FUSION_SML_HOTSPOTS),
  ]);
  const [fighterBig, fighterMed, fighterSml] = await Promise.all([
    loadSpriteSet('urquan/fighter', 'big', 16, FIGHTER_BIG_HOTSPOTS),
    loadSpriteSet('urquan/fighter', 'med', 16, FIGHTER_MED_HOTSPOTS),
    loadSpriteSet('urquan/fighter', 'sml', 16, FIGHTER_SML_HOTSPOTS),
  ]);
  return {
    big, med, sml,
    fusion:  { big: fusionBig,  med: fusionMed,  sml: fusionSml },
    fighter: { big: fighterBig, med: fighterMed, sml: fighterSml },
  };
}

// ─── Pkunk Fury sprites ───────────────────────────────────────────────────────

export interface PkunkSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  bug: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

export async function loadPkunkSprites(): Promise<PkunkSprites> {
  const [big, med, sml] = await Promise.all([
    loadSpriteSet('pkunk/fury', 'big', 16, FURY_BIG_HOTSPOTS),
    loadSpriteSet('pkunk/fury', 'med', 16, FURY_MED_HOTSPOTS),
    loadSpriteSet('pkunk/fury', 'sml', 16, FURY_SML_HOTSPOTS),
  ]);
  // Bug missile: 1 frame only (no rotation)
  const [bugBig, bugMed, bugSml] = await Promise.all([
    loadSpriteSet('pkunk/bug', 'big', 1, BUG_BIG_HOTSPOT),
    loadSpriteSet('pkunk/bug', 'med', 1, BUG_MED_HOTSPOT),
    loadSpriteSet('pkunk/bug', 'sml', 1, BUG_SML_HOTSPOT),
  ]);
  return {
    big, med, sml,
    bug: { big: bugBig, med: bugMed, sml: bugSml },
  };
}

// ─── Mycon Podship sprites ────────────────────────────────────────────────────

export interface MyconSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  plasma: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
  plasmaImpact: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

async function loadSpriteSetRange(
  path: string,
  size: 'big' | 'med' | 'sml',
  start: number,
  count: number,
  hotspots: [number, number][],
): Promise<SpriteSet> {
  const frames: (SpriteFrame | null)[] = Array(count).fill(null);

  await Promise.all(
    Array.from({ length: count }, (_, i) => {
      const [hotX, hotY] = hotspots[i] ?? [0, 0];
      const url = `/ships/${path}-${size}-${pad3(start + i)}.png`;
      return loadFrame(url, hotX, hotY)
        .then(f => { frames[i] = f; })
        .catch(() => {});
    })
  );

  return { frames, count };
}

export async function loadMyconSprites(): Promise<MyconSprites> {
  const [big, med, sml] = await Promise.all([
    loadSpriteSet('mycon/podship', 'big', 16, PODSHIP_BIG_HOTSPOTS),
    loadSpriteSet('mycon/podship', 'med', 16, PODSHIP_MED_HOTSPOTS),
    loadSpriteSet('mycon/podship', 'sml', 16, PODSHIP_SML_HOTSPOTS),
  ]);
  const [plasmaBig, plasmaMed, plasmaSml] = await Promise.all([
    loadSpriteSet('mycon/plasma', 'big', 11, PLASMA_BIG_HOTSPOTS),
    loadSpriteSet('mycon/plasma', 'med', 11, PLASMA_MED_HOTSPOTS),
    loadSpriteSet('mycon/plasma', 'sml', 11, PLASMA_SML_HOTSPOTS),
  ]);
  const [plasmaImpactBig, plasmaImpactMed, plasmaImpactSml] = await Promise.all([
    loadSpriteSetRange('mycon/plasma', 'big', 11, 8, PLASMA_IMPACT_BIG_HOTSPOTS),
    loadSpriteSetRange('mycon/plasma', 'med', 11, 8, PLASMA_IMPACT_MED_HOTSPOTS),
    loadSpriteSetRange('mycon/plasma', 'sml', 11, 8, PLASMA_IMPACT_SML_HOTSPOTS),
  ]);
  return {
    big, med, sml,
    plasma: { big: plasmaBig, med: plasmaMed, sml: plasmaSml },
    plasmaImpact: { big: plasmaImpactBig, med: plasmaImpactMed, sml: plasmaImpactSml },
  };
}

// ─── VUX Intruder sprites ─────────────────────────────────────────────────────

export interface VuxSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  limpets: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

export async function loadVuxSprites(): Promise<VuxSprites> {
  const [big, med, sml] = await Promise.all([
    loadSpriteSet('vux/intruder', 'big', 16, INTRUDER_BIG_HOTSPOTS),
    loadSpriteSet('vux/intruder', 'med', 16, INTRUDER_MED_HOTSPOTS),
    loadSpriteSet('vux/intruder', 'sml', 16, INTRUDER_SML_HOTSPOTS),
  ]);
  // Limpets: 4 animation frames (animated, not rotation-based)
  const [limBig, limMed, limSml] = await Promise.all([
    loadSpriteSet('vux/limpets', 'big', 4, LIMPETS_BIG_HOTSPOT),
    loadSpriteSet('vux/limpets', 'med', 4, LIMPETS_MED_HOTSPOT),
    loadSpriteSet('vux/limpets', 'sml', 4, LIMPETS_SML_HOTSPOT),
  ]);
  return {
    big, med, sml,
    limpets: { big: limBig, med: limMed, sml: limSml },
  };
}

// ─── Androsynth Guardian sprites ─────────────────────────────────────────────

export interface AndrosynthSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  bubble: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
  blazer: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

export async function loadAndrosynthSprites(): Promise<AndrosynthSprites> {
  const [big, med, sml] = await Promise.all([
    loadSpriteSet('androsynth/guardian', 'big', 16, GUARDIAN_BIG_HOTSPOTS),
    loadSpriteSet('androsynth/guardian', 'med', 16, GUARDIAN_MED_HOTSPOTS),
    loadSpriteSet('androsynth/guardian', 'sml', 16, GUARDIAN_SML_HOTSPOTS),
  ]);
  const [bubbleBig, bubbleMed, bubbleSml] = await Promise.all([
    loadSpriteSet('androsynth/bubble', 'big', 3, BUBBLE_BIG_HOTSPOTS),
    loadSpriteSet('androsynth/bubble', 'med', 3, BUBBLE_MED_HOTSPOTS),
    loadSpriteSet('androsynth/bubble', 'sml', 3, BUBBLE_SML_HOTSPOTS),
  ]);
  const [blazerBig, blazerMed, blazerSml] = await Promise.all([
    loadSpriteSet('androsynth/blazer', 'big', 16, BLAZER_BIG_HOTSPOTS),
    loadSpriteSet('androsynth/blazer', 'med', 16, BLAZER_MED_HOTSPOTS),
    loadSpriteSet('androsynth/blazer', 'sml', 16, BLAZER_SML_HOTSPOTS),
  ]);
  return {
    big, med, sml,
    bubble: { big: bubbleBig, med: bubbleMed, sml: bubbleSml },
    blazer: { big: blazerBig, med: blazerMed, sml: blazerSml },
  };
}

export interface ChenjesuSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  spark: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
  doggy: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

export async function loadChenjesuSprites(): Promise<ChenjesuSprites> {
  const [big, med, sml] = await Promise.all([
    loadSpriteSet('chenjesu/broodhome', 'big', 16, BROODHOME_BIG_HOTSPOTS),
    loadSpriteSet('chenjesu/broodhome', 'med', 16, BROODHOME_MED_HOTSPOTS),
    loadSpriteSet('chenjesu/broodhome', 'sml', 16, BROODHOME_SML_HOTSPOTS),
  ]);
  const [sparkBig, sparkMed, sparkSml] = await Promise.all([
    loadSpriteSet('chenjesu/spark', 'big', 11, CHENJESU_SPARK_BIG_HOTSPOTS),
    loadSpriteSet('chenjesu/spark', 'med', 11, CHENJESU_SPARK_MED_HOTSPOTS),
    loadSpriteSet('chenjesu/spark', 'sml', 11, CHENJESU_SPARK_SML_HOTSPOTS),
  ]);
  const [doggyBig, doggyMed, doggySml] = await Promise.all([
    loadSpriteSet('chenjesu/doggy', 'big', 7, DOGGY_BIG_HOTSPOTS),
    loadSpriteSet('chenjesu/doggy', 'med', 7, DOGGY_MED_HOTSPOTS),
    loadSpriteSet('chenjesu/doggy', 'sml', 7, DOGGY_SML_HOTSPOTS),
  ]);
  return {
    big,
    med,
    sml,
    spark: { big: sparkBig, med: sparkMed, sml: sparkSml },
    doggy: { big: doggyBig, med: doggyMed, sml: doggySml },
  };
}

export interface ChmmrSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  muzzle: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
  satellite: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

export async function loadChmmrSprites(): Promise<ChmmrSprites> {
  const [big, med, sml] = await Promise.all([
    loadSpriteSet('chmmr/avatar', 'big', 16, AVATAR_BIG_HOTSPOTS),
    loadSpriteSet('chmmr/avatar', 'med', 16, AVATAR_MED_HOTSPOTS),
    loadSpriteSet('chmmr/avatar', 'sml', 16, AVATAR_SML_HOTSPOTS),
  ]);
  const [muzzleBig, muzzleMed, muzzleSml] = await Promise.all([
    loadSpriteSet('chmmr/muzzle', 'big', 41, MUZZLE_BIG_HOTSPOTS),
    loadSpriteSet('chmmr/muzzle', 'med', 41, MUZZLE_MED_HOTSPOTS),
    loadSpriteSet('chmmr/muzzle', 'sml', 41, MUZZLE_SML_HOTSPOTS),
  ]);
  const [satBig, satMed, satSml] = await Promise.all([
    loadSpriteSet('chmmr/satellite', 'big', 8, SATELLITE_BIG_HOTSPOTS),
    loadSpriteSet('chmmr/satellite', 'med', 8, SATELLITE_MED_HOTSPOTS),
    loadSpriteSet('chmmr/satellite', 'sml', 8, SATELLITE_SML_HOTSPOTS),
  ]);
  return {
    big,
    med,
    sml,
    muzzle: { big: muzzleBig, med: muzzleMed, sml: muzzleSml },
    satellite: { big: satBig, med: satMed, sml: satSml },
  };
}

export interface DruugeSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  cannon: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

export async function loadDruugeSprites(): Promise<DruugeSprites> {
  const [big, med, sml] = await Promise.all([
    loadSpriteSet('druuge/mauler', 'big', 16, MAULER_BIG_HOTSPOTS),
    loadSpriteSet('druuge/mauler', 'med', 16, MAULER_MED_HOTSPOTS),
    loadSpriteSet('druuge/mauler', 'sml', 16, MAULER_SML_HOTSPOTS),
  ]);
  const [cannonBig, cannonMed, cannonSml] = await Promise.all([
    loadSpriteSet('druuge/cannon', 'big', 16, CANNON_BIG_HOTSPOTS),
    loadSpriteSet('druuge/cannon', 'med', 16, CANNON_MED_HOTSPOTS),
    loadSpriteSet('druuge/cannon', 'sml', 16, CANNON_SML_HOTSPOTS),
  ]);
  return {
    big,
    med,
    sml,
    cannon: { big: cannonBig, med: cannonMed, sml: cannonSml },
  };
}

export interface IlwrathSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  fire: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

export async function loadIlwrathSprites(): Promise<IlwrathSprites> {
  const [big, med, sml] = await Promise.all([
    loadSpriteSet('ilwrath/avenger', 'big', 16, AVENGER_BIG_HOTSPOTS),
    loadSpriteSet('ilwrath/avenger', 'med', 16, AVENGER_MED_HOTSPOTS),
    loadSpriteSet('ilwrath/avenger', 'sml', 16, AVENGER_SML_HOTSPOTS),
  ]);
  const [fireBig, fireMed, fireSml] = await Promise.all([
    loadSpriteSet('ilwrath/fire', 'big', 8, FIRE_BIG_HOTSPOTS),
    loadSpriteSet('ilwrath/fire', 'med', 8, FIRE_MED_HOTSPOTS),
    loadSpriteSet('ilwrath/fire', 'sml', 8, FIRE_SML_HOTSPOTS),
  ]);
  return {
    big,
    med,
    sml,
    fire: { big: fireBig, med: fireMed, sml: fireSml },
  };
}

export interface YehatSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  missile: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
  shield: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

export async function loadYehatSprites(): Promise<YehatSprites> {
  const [big, med, sml] = await Promise.all([
    loadSpriteSet('yehat/terminator', 'big', 16, TERMINATOR_BIG_HOTSPOTS),
    loadSpriteSet('yehat/terminator', 'med', 16, TERMINATOR_MED_HOTSPOTS),
    loadSpriteSet('yehat/terminator', 'sml', 16, TERMINATOR_SML_HOTSPOTS),
  ]);
  const [missileBig, missileMed, missileSml] = await Promise.all([
    loadSpriteSet('yehat/missile', 'big', 16, YEHAT_MISSILE_BIG_HOTSPOTS),
    loadSpriteSet('yehat/missile', 'med', 16, YEHAT_MISSILE_MED_HOTSPOTS),
    loadSpriteSet('yehat/missile', 'sml', 16, YEHAT_MISSILE_SML_HOTSPOTS),
  ]);
  const [shieldBig, shieldMed, shieldSml] = await Promise.all([
    loadSpriteSet('yehat/shield', 'big', 16, YEHAT_SHIELD_BIG_HOTSPOTS),
    loadSpriteSet('yehat/shield', 'med', 16, YEHAT_SHIELD_MED_HOTSPOTS),
    loadSpriteSet('yehat/shield', 'sml', 16, YEHAT_SHIELD_SML_HOTSPOTS),
  ]);
  return {
    big, med, sml,
    missile: { big: missileBig, med: missileMed, sml: missileSml },
    shield: { big: shieldBig, med: shieldMed, sml: shieldSml },
  };
}

export interface MelnormeSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  pump: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
  confuse: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

export async function loadMelnormeSprites(): Promise<MelnormeSprites> {
  const [big, med, sml] = await Promise.all([
    loadSpriteSet('melnorme/trader', 'big', 16, TRADER_BIG_HOTSPOTS),
    loadSpriteSet('melnorme/trader', 'med', 16, TRADER_MED_HOTSPOTS),
    loadSpriteSet('melnorme/trader', 'sml', 16, TRADER_SML_HOTSPOTS),
  ]);
  const [pumpBig, pumpMed, pumpSml] = await Promise.all([
    loadSpriteSet('melnorme/pumpup', 'big', 26, PUMPUP_BIG_HOTSPOTS),
    loadSpriteSet('melnorme/pumpup', 'med', 26, PUMPUP_MED_HOTSPOTS),
    loadSpriteSet('melnorme/pumpup', 'sml', 26, PUMPUP_SML_HOTSPOTS),
  ]);
  const [confuseBig, confuseMed, confuseSml] = await Promise.all([
    loadSpriteSet('melnorme/confuse', 'big', 16, CONFUSE_BIG_HOTSPOTS),
    loadSpriteSet('melnorme/confuse', 'med', 16, CONFUSE_MED_HOTSPOTS),
    loadSpriteSet('melnorme/confuse', 'sml', 16, CONFUSE_SML_HOTSPOTS),
  ]);
  return {
    big,
    med,
    sml,
    pump: { big: pumpBig, med: pumpMed, sml: pumpSml },
    confuse: { big: confuseBig, med: confuseMed, sml: confuseSml },
  };
}

// ─── Kohr-Ah Mauler sprites ───────────────────────────────────────────────────

export interface KohrahSprites {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
  buzzsaw: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
  gas:     { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

export async function loadKohrahSprites(): Promise<KohrahSprites> {
  const [big, med, sml] = await Promise.all([
    loadSpriteSet('kohrah/marauder', 'big', 16, MARAUDER_BIG_HOTSPOTS),
    loadSpriteSet('kohrah/marauder', 'med', 16, MARAUDER_MED_HOTSPOTS),
    loadSpriteSet('kohrah/marauder', 'sml', 16, MARAUDER_SML_HOTSPOTS),
  ]);
  // Buzzsaw: 8 animation frames (spinning disk)
  const [sawBig, sawMed, sawSml] = await Promise.all([
    loadSpriteSet('kohrah/buzzsaw', 'big', 8, BUZZSAW_BIG_HOTSPOTS),
    loadSpriteSet('kohrah/buzzsaw', 'med', 8, BUZZSAW_MED_HOTSPOTS),
    loadSpriteSet('kohrah/buzzsaw', 'sml', 8, BUZZSAW_SML_HOTSPOTS),
  ]);
  // Gas clouds: 8 animation frames
  const [gasBig, gasMed, gasSml] = await Promise.all([
    loadSpriteSet('kohrah/gas', 'big', 8, GAS_BIG_HOTSPOTS),
    loadSpriteSet('kohrah/gas', 'med', 8, GAS_MED_HOTSPOTS),
    loadSpriteSet('kohrah/gas', 'sml', 8, GAS_SML_HOTSPOTS),
  ]);
  return {
    big, med, sml,
    buzzsaw: { big: sawBig, med: sawMed, sml: sawSml },
    gas:     { big: gasBig, med: gasMed, sml: gasSml },
  };
}

// ─── Hotspot tables for remaining 20 ships ────────────────────────────────────

const GUARDIAN_BIG_HOTSPOTS: [number,number][] = [[8,14],[7,11],[7,8],[7,8],[7,7],[7,8],[6,7],[7,6],[8,6],[12,6],[14,6],[16,7],[16,7],[12,11],[10,13],[9,15]];
const GUARDIAN_MED_HOTSPOTS: [number,number][] = [[4,5],[5,4],[5,3],[5,3],[5,4],[4,4],[4,4],[4,5],[4,5],[5,4],[5,3],[5,3],[5,4],[4,4],[4,4],[4,5]];
const GUARDIAN_SML_HOTSPOTS: [number,number][] = [[2,3],[3,3],[3,2],[3,2],[3,2],[3,2],[2,3],[2,3],[2,3],[2,3],[3,2],[3,2],[3,2],[2,3],[2,3],[2,3]];

const SKIFF_BIG_HOTSPOTS: [number,number][] = [[9,7],[9,7],[9,7],[9,7],[11,7],[9,7],[9,7],[9,7],[9,8],[9,7],[9,7],[9,7],[9,7],[9,7],[9,7],[9,7]];
const SKIFF_MED_HOTSPOTS: [number,number][] = [[4,3],[4,3],[4,3],[4,3],[5,3],[4,3],[4,3],[4,3],[4,3],[4,3],[4,3],[4,3],[4,3],[4,3],[4,3],[4,3]];
const SKIFF_SML_HOTSPOTS: [number,number][] = [[2,2],[2,2],[2,2],[2,2],[2,2],[2,2],[2,2],[2,2],[2,2],[2,2],[2,2],[2,2],[2,2],[2,2],[2,2],[2,2]];

const BROODHOME_BIG_HOTSPOTS: [number,number][] = [[16,13],[17,15],[16,17],[20,16],[21,15],[20,15],[16,15],[17,18],[16,19],[18,18],[20,15],[18,15],[16,15],[18,16],[20,17],[18,15]];
const BROODHOME_MED_HOTSPOTS: [number,number][] = [[9,8],[8,8],[8,8],[10,7],[11,8],[10,8],[8,8],[8,9],[9,10],[9,9],[8,8],[10,8],[10,8],[10,7],[8,8],[9,8]];
const BROODHOME_SML_HOTSPOTS: [number,number][] = [[4,4],[4,4],[4,4],[3,3],[5,4],[3,4],[4,4],[4,3],[4,4],[4,3],[4,4],[4,4],[4,4],[4,3],[4,4],[4,4]];

const AVATAR_BIG_HOTSPOTS: [number,number][] = [[18,20],[21,19],[18,18],[19,15],[18,18],[18,20],[18,18],[21,19],[18,17],[15,19],[18,18],[21,20],[21,18],[20,14],[18,17],[15,19]];
const AVATAR_MED_HOTSPOTS: [number,number][] = [[9,9],[10,9],[10,9],[9,7],[8,9],[9,10],[10,9],[10,9],[9,8],[7,9],[8,9],[9,10],[10,9],[9,7],[8,9],[7,9]];
const AVATAR_SML_HOTSPOTS: [number,number][] = [[4,5],[5,5],[4,4],[4,3],[4,4],[4,5],[4,4],[5,4],[4,4],[3,4],[4,4],[5,5],[5,4],[5,3],[4,4],[3,5]];

const MAULER_BIG_HOTSPOTS: [number,number][] = [[5,22],[8,20],[9,18],[10,13],[10,5],[10,8],[9,9],[8,10],[8,10],[12,10],[18,9],[22,8],[25,8],[22,13],[18,18],[12,20]];
const MAULER_MED_HOTSPOTS: [number,number][] = [[3,11],[4,10],[5,8],[5,6],[5,2],[5,4],[5,4],[4,5],[4,5],[6,5],[9,4],[11,4],[13,4],[11,6],[9,8],[6,10]];
const MAULER_SML_HOTSPOTS: [number,number][] = [[1,5],[2,4],[2,4],[2,2],[2,1],[2,1],[2,2],[2,2],[2,2],[2,2],[4,2],[5,1],[6,1],[5,2],[4,4],[3,4]];

const AVENGER_BIG_HOTSPOTS: [number,number][] = [[18,22],[14,20],[11,16],[11,17],[8,17],[11,12],[11,11],[14,9],[18,8],[19,9],[17,11],[20,12],[24,17],[20,17],[17,16],[19,20]];
const AVENGER_MED_HOTSPOTS: [number,number][] = [[8,11],[6,9],[6,8],[4,7],[3,7],[4,6],[6,6],[6,4],[8,3],[9,4],[8,6],[11,6],[12,7],[11,7],[8,8],[9,9]];
const AVENGER_SML_HOTSPOTS: [number,number][] = [[5,6],[4,6],[3,5],[3,5],[2,5],[3,4],[3,3],[4,2],[5,2],[6,2],[6,3],[6,4],[7,5],[6,5],[6,5],[6,6]];

const MARAUDER_BIG_HOTSPOTS: [number,number][] = [[11,20],[14,20],[17,18],[18,15],[18,10],[19,15],[17,16],[14,17],[10,17],[15,16],[19,17],[21,14],[21,11],[20,15],[19,20],[15,21]];
const MARAUDER_MED_HOTSPOTS: [number,number][] = [[5,10],[7,10],[9,9],[9,7],[9,6],[10,9],[9,10],[7,10],[5,10],[6,11],[7,11],[9,8],[9,6],[9,7],[9,9],[8,9]];
const MARAUDER_SML_HOTSPOTS: [number,number][] = [[2,5],[4,5],[4,4],[4,3],[4,2],[4,3],[4,4],[4,4],[2,4],[3,4],[4,4],[5,3],[5,2],[5,3],[4,4],[3,5]];

const TRADER_BIG_HOTSPOTS: [number,number][] = [[14,17],[15,16],[14,18],[14,18],[14,16],[14,16],[14,15],[15,15],[15,14],[16,15],[16,15],[15,16],[16,16],[16,17],[16,17],[17,17]];
const TRADER_MED_HOTSPOTS: [number,number][] = [[7,9],[7,10],[7,9],[6,9],[6,8],[6,7],[7,7],[7,6],[7,7],[7,6],[7,7],[8,7],[8,7],[8,9],[7,9],[7,10]];
const TRADER_SML_HOTSPOTS: [number,number][] = [[3,4],[3,4],[3,4],[3,3],[3,3],[3,3],[3,3],[3,3],[3,3],[3,3],[4,3],[4,3],[4,3],[4,3],[4,4],[3,4]];

const XFORM_BIG_HOTSPOTS: [number,number][] = [[12,13],[13,11],[11,10],[9,10],[4,11],[9,12],[11,11],[13,9],[12,4],[11,9],[10,11],[11,12],[14,11],[12,10],[10,10],[11,12]];
const XFORM_MED_HOTSPOTS: [number,number][] = [[6,4],[6,5],[5,5],[5,6],[5,5],[5,6],[5,5],[6,5],[6,4],[6,5],[5,5],[5,6],[5,5],[5,6],[5,5],[6,5]];
const XFORM_SML_HOTSPOTS: [number,number][] = [[3,2],[3,2],[3,3],[2,3],[2,3],[2,3],[3,3],[3,2],[3,2],[3,2],[3,3],[2,3],[2,3],[2,3],[3,3],[3,2]];

const PODSHIP_BIG_HOTSPOTS: [number,number][] = [[12,13],[12,13],[12,11],[12,11],[12,11],[12,11],[12,11],[12,11],[12,11],[12,11],[12,11],[14,11],[14,11],[14,11],[12,11],[12,13]];
const PODSHIP_MED_HOTSPOTS: [number,number][] = [[6,6],[6,6],[6,5],[6,5],[6,5],[6,5],[6,5],[6,5],[6,5],[6,5],[6,5],[7,5],[7,5],[7,5],[6,5],[6,6]];
const PODSHIP_SML_HOTSPOTS: [number,number][] = [[3,4],[3,4],[3,4],[3,3],[3,3],[3,3],[3,3],[3,3],[3,3],[3,3],[4,3],[4,3],[4,3],[4,3],[4,4],[3,4]];

const NEMESIS_BIG_HOTSPOTS: [number,number][] = [[14,11],[17,11],[17,10],[16,10],[11,14],[17,16],[19,18],[17,15],[14,11],[9,16],[10,19],[11,16],[11,14],[11,10],[10,10],[9,11]];
const NEMESIS_MED_HOTSPOTS: [number,number][] = [[7,5],[8,5],[8,5],[7,4],[5,7],[6,8],[8,7],[8,6],[7,5],[4,6],[5,8],[5,8],[5,7],[5,4],[5,5],[4,5]];
const NEMESIS_SML_HOTSPOTS: [number,number][] = [[3,3],[4,3],[4,2],[3,2],[2,3],[3,4],[4,4],[4,3],[3,2],[2,3],[2,4],[3,4],[3,3],[3,2],[2,2],[2,3]];

const SCOUT_BIG_HOTSPOTS: [number,number][] = [[4,9],[3,9],[4,6],[5,3],[6,4],[5,4],[4,4],[4,4],[4,5],[3,4],[6,4],[7,4],[9,4],[7,3],[6,6],[3,7]];
const SCOUT_MED_HOTSPOTS: [number,number][] = [[2,4],[2,4],[3,3],[4,2],[5,2],[4,2],[3,3],[2,4],[2,4],[2,4],[3,3],[4,2],[5,2],[4,2],[3,3],[2,4]];
const SCOUT_SML_HOTSPOTS: [number,number][] = [[1,3],[1,2],[2,2],[2,1],[2,1],[2,1],[2,2],[1,2],[1,3],[1,2],[2,2],[2,1],[2,1],[2,1],[2,2],[1,2]];

const PROBE_BIG_HOTSPOTS: [number,number][] = [[13,22],[14,22],[17,21],[19,20],[21,18],[23,16],[24,14],[25,12],[25,11],[25,12],[24,14],[23,16],[21,18],[19,20],[17,21],[14,22]];
const PROBE_MED_HOTSPOTS: [number,number][] = [[6,10],[6,10],[8,9],[9,9],[10,8],[11,7],[11,6],[12,5],[12,5],[12,5],[11,6],[11,7],[10,8],[9,9],[8,9],[7,10]];
const PROBE_SML_HOTSPOTS: [number,number][] = [[3,5],[2,5],[3,4],[4,4],[4,4],[5,3],[5,3],[5,3],[5,3],[5,3],[5,3],[5,3],[4,4],[4,4],[3,4],[3,5]];

const BLADE_BIG_HOTSPOTS: [number,number][] = [[6,13],[9,12],[12,10],[15,9],[16,6],[15,9],[12,12],[9,13],[6,15],[8,14],[10,12],[13,9],[13,6],[13,9],[10,10],[8,12]];
const BLADE_MED_HOTSPOTS: [number,number][] = [[3,7],[4,6],[6,5],[7,4],[7,3],[6,4],[6,6],[4,7],[3,7],[4,7],[5,6],[6,4],[7,3],[6,4],[5,5],[4,6]];
const BLADE_SML_HOTSPOTS: [number,number][] = [[1,4],[3,3],[3,3],[3,2],[3,1],[3,3],[3,3],[3,3],[1,3],[2,3],[3,3],[3,3],[4,1],[3,3],[3,4],[2,4]];

const PENETRATOR_BIG_HOTSPOTS: [number,number][] = [[8,18],[13,17],[16,13],[15,9],[13,8],[15,12],[16,14],[14,13],[8,11],[9,12],[13,14],[18,12],[23,8],[19,10],[14,14],[9,18]];
const PENETRATOR_MED_HOTSPOTS: [number,number][] = [[4,9],[6,8],[8,7],[8,5],[7,4],[8,6],[8,7],[6,7],[4,6],[4,7],[7,7],[9,6],[9,4],[9,5],[7,7],[4,8]];
const PENETRATOR_SML_HOTSPOTS: [number,number][] = [[2,5],[4,4],[4,4],[5,3],[4,2],[5,4],[4,4],[4,4],[2,4],[3,4],[4,4],[5,4],[7,2],[5,2],[4,4],[2,4]];

const TORCH_BIG_HOTSPOTS: [number,number][] = [[11,10],[13,11],[13,11],[13,10],[11,11],[13,12],[13,13],[13,13],[10,11],[10,13],[11,13],[11,12],[10,10],[11,10],[11,11],[10,11]];
const TORCH_MED_HOTSPOTS: [number,number][] = [[6,5],[7,5],[7,5],[7,5],[6,5],[7,6],[7,7],[6,7],[5,6],[4,7],[5,7],[5,7],[5,6],[5,5],[5,5],[5,5]];
const TORCH_SML_HOTSPOTS: [number,number][] = [[2,2],[3,3],[3,3],[4,3],[3,2],[4,3],[3,3],[3,3],[3,3],[3,3],[3,3],[3,3],[2,3],[3,3],[3,3],[2,3]];

const DRONE_BIG_HOTSPOTS: [number,number][] = [[6,7],[6,7],[7,7],[8,7],[8,6],[8,7],[7,7],[6,7],[6,7],[6,7],[7,8],[8,6],[8,6],[8,6],[7,7],[6,7]];
const DRONE_MED_HOTSPOTS: [number,number][] = [[3,3],[3,3],[3,3],[4,3],[4,3],[4,3],[3,3],[3,3],[3,3],[3,3],[4,3],[4,3],[4,3],[4,3],[3,3],[3,3]];
const DRONE_SML_HOTSPOTS: [number,number][] = [[1,2],[2,2],[2,2],[2,2],[2,1],[2,2],[2,2],[2,2],[1,2],[2,2],[2,2],[2,2],[2,1],[2,2],[2,2],[2,2]];

const JUGGER_BIG_HOTSPOTS: [number,number][] = [[16,17],[16,16],[13,14],[14,14],[13,15],[14,15],[13,12],[16,14],[16,13],[14,14],[15,13],[17,15],[17,15],[17,14],[14,14],[14,17]];
const JUGGER_MED_HOTSPOTS: [number,number][] = [[8,8],[7,8],[6,7],[6,7],[6,8],[6,7],[6,5],[7,6],[8,5],[7,5],[7,5],[8,6],[9,7],[8,6],[7,7],[8,8]];
const JUGGER_SML_HOTSPOTS: [number,number][] = [[4,4],[4,3],[3,3],[3,3],[3,4],[3,4],[3,3],[4,3],[4,3],[4,3],[3,3],[4,4],[4,4],[4,3],[3,3],[4,3]];

const TERMINATOR_BIG_HOTSPOTS: [number,number][] = [[9,9],[8,11],[6,11],[6,10],[4,8],[6,6],[6,5],[7,4],[9,4],[11,4],[12,4],[10,6],[9,8],[11,10],[13,11],[11,10]];
const TERMINATOR_MED_HOTSPOTS: [number,number][] = [[5,4],[3,5],[2,6],[2,6],[1,4],[2,3],[2,2],[3,2],[5,2],[6,2],[7,2],[6,3],[4,4],[6,5],[7,6],[6,5]];
const TERMINATOR_SML_HOTSPOTS: [number,number][] = [[2,1],[2,2],[2,2],[1,2],[1,2],[2,1],[2,1],[2,1],[2,1],[2,1],[2,1],[2,2],[2,2],[2,2],[2,2],[2,2]];

const STINGER_BIG_HOTSPOTS: [number,number][] = [[11,9],[12,10],[13,10],[13,10],[13,11],[12,11],[14,14],[12,12],[11,14],[11,12],[11,13],[11,11],[9,11],[10,10],[10,10],[10,9]];
const STINGER_MED_HOTSPOTS: [number,number][] = [[5,5],[6,6],[6,6],[6,6],[6,5],[6,5],[6,6],[6,6],[5,6],[6,6],[6,6],[6,5],[5,5],[6,6],[6,6],[6,6]];
const STINGER_SML_HOTSPOTS: [number,number][] = [[3,2],[4,3],[4,3],[4,3],[4,3],[4,4],[4,4],[4,4],[3,4],[3,4],[3,4],[3,4],[2,3],[3,3],[3,3],[3,3]];

// ─── Generic ship sprite loader ───────────────────────────────────────────────
// Maps ShipId → (species dir, ship prefix, hotspot tables)

export interface ShipSpriteSet {
  big: SpriteSet;
  med: SpriteSet;
  sml: SpriteSet;
}

const SHIP_HOTSPOT_MAP: Record<string, {
  species: string;
  prefix:  string;
  big: [number,number][];
  med: [number,number][];
  sml: [number,number][];
}> = {
  androsynth: { species: 'androsynth', prefix: 'guardian',   big: GUARDIAN_BIG_HOTSPOTS,   med: GUARDIAN_MED_HOTSPOTS,   sml: GUARDIAN_SML_HOTSPOTS },
  arilou:     { species: 'arilou',     prefix: 'skiff',      big: SKIFF_BIG_HOTSPOTS,      med: SKIFF_MED_HOTSPOTS,      sml: SKIFF_SML_HOTSPOTS },
  chenjesu:   { species: 'chenjesu',   prefix: 'broodhome',  big: BROODHOME_BIG_HOTSPOTS,  med: BROODHOME_MED_HOTSPOTS,  sml: BROODHOME_SML_HOTSPOTS },
  chmmr:      { species: 'chmmr',      prefix: 'avatar',     big: AVATAR_BIG_HOTSPOTS,     med: AVATAR_MED_HOTSPOTS,     sml: AVATAR_SML_HOTSPOTS },
  druuge:     { species: 'druuge',     prefix: 'mauler',     big: MAULER_BIG_HOTSPOTS,     med: MAULER_MED_HOTSPOTS,     sml: MAULER_SML_HOTSPOTS },
  ilwrath:    { species: 'ilwrath',    prefix: 'avenger',    big: AVENGER_BIG_HOTSPOTS,    med: AVENGER_MED_HOTSPOTS,    sml: AVENGER_SML_HOTSPOTS },
  kohrah:     { species: 'kohrah',     prefix: 'marauder',   big: MARAUDER_BIG_HOTSPOTS,   med: MARAUDER_MED_HOTSPOTS,   sml: MARAUDER_SML_HOTSPOTS },
  melnorme:   { species: 'melnorme',   prefix: 'trader',     big: TRADER_BIG_HOTSPOTS,     med: TRADER_MED_HOTSPOTS,     sml: TRADER_SML_HOTSPOTS },
  mmrnmhrm:   { species: 'mmrnmhrm',   prefix: 'xform',      big: XFORM_BIG_HOTSPOTS,      med: XFORM_MED_HOTSPOTS,      sml: XFORM_SML_HOTSPOTS },
  mycon:      { species: 'mycon',      prefix: 'podship',    big: PODSHIP_BIG_HOTSPOTS,    med: PODSHIP_MED_HOTSPOTS,    sml: PODSHIP_SML_HOTSPOTS },
  orz:        { species: 'orz',        prefix: 'nemesis',    big: NEMESIS_BIG_HOTSPOTS,    med: NEMESIS_MED_HOTSPOTS,    sml: NEMESIS_SML_HOTSPOTS },
  shofixti:   { species: 'shofixti',   prefix: 'scout',      big: SCOUT_BIG_HOTSPOTS,      med: SCOUT_MED_HOTSPOTS,      sml: SCOUT_SML_HOTSPOTS },
  slylandro:  { species: 'slylandro',  prefix: 'probe',      big: PROBE_BIG_HOTSPOTS,      med: PROBE_MED_HOTSPOTS,      sml: PROBE_SML_HOTSPOTS },
  supox:      { species: 'supox',      prefix: 'blade',      big: BLADE_BIG_HOTSPOTS,      med: BLADE_MED_HOTSPOTS,      sml: BLADE_SML_HOTSPOTS },
  syreen:     { species: 'syreen',     prefix: 'penetrator', big: PENETRATOR_BIG_HOTSPOTS, med: PENETRATOR_MED_HOTSPOTS, sml: PENETRATOR_SML_HOTSPOTS },
  thraddash:  { species: 'thraddash',  prefix: 'torch',      big: TORCH_BIG_HOTSPOTS,      med: TORCH_MED_HOTSPOTS,      sml: TORCH_SML_HOTSPOTS },
  umgah:      { species: 'umgah',      prefix: 'drone',      big: DRONE_BIG_HOTSPOTS,      med: DRONE_MED_HOTSPOTS,      sml: DRONE_SML_HOTSPOTS },
  utwig:      { species: 'utwig',      prefix: 'jugger',     big: JUGGER_BIG_HOTSPOTS,     med: JUGGER_MED_HOTSPOTS,     sml: JUGGER_SML_HOTSPOTS },
  yehat:      { species: 'yehat',      prefix: 'terminator', big: TERMINATOR_BIG_HOTSPOTS, med: TERMINATOR_MED_HOTSPOTS, sml: TERMINATOR_SML_HOTSPOTS },
  zoqfotpik:  { species: 'zoqfotpik',  prefix: 'stinger',    big: STINGER_BIG_HOTSPOTS,    med: STINGER_MED_HOTSPOTS,    sml: STINGER_SML_HOTSPOTS },
};

/**
 * Load ship sprites for any ShipId that has data in SHIP_HOTSPOT_MAP.
 * Returns null if the ship type is not in the map (handled by weapon-specific loaders).
 */
export async function loadGenericShipSprites(shipId: string): Promise<ShipSpriteSet | null> {
  const entry = SHIP_HOTSPOT_MAP[shipId];
  if (!entry) return null;
  const path = `${entry.species}/${entry.prefix}`;
  const [big, med, sml] = await Promise.all([
    loadSpriteSet(path, 'big', 16, entry.big),
    loadSpriteSet(path, 'med', 16, entry.med),
    loadSpriteSet(path, 'sml', 16, entry.sml),
  ]);
  return { big, med, sml };
}

// ─── Battle explosion sprites ─────────────────────────────────────────────────
// boom  = ship destruction (9 frames; frames with scale=-1 are invisible)
// blast = projectile impact   (8 frames; all visible)

export interface ExplosionSprites {
  boom:  { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
  blast: { big: SpriteSet; med: SpriteSet; sml: SpriteSet };
}

// Frames where UQM scale=-1 (invisible) per size variant
const BOOM_INVISIBLE: Record<'big'|'med'|'sml', Set<number>> = {
  big: new Set([0, 8]),
  med: new Set([0, 1, 7, 8]),
  sml: new Set([0, 1, 6, 7, 8]),
};

// Per-frame hotspots from boom-*.ani and blast-*.ani
const BOOM_BIG_HOTSPOTS:   [number,number][] = [[0,0],[1,1],[3,3],[3,3],[3,3],[3,3],[2,2],[1,1],[0,0]];
const BOOM_MED_HOTSPOTS:   [number,number][] = [[0,0],[0,0],[1,1],[1,1],[1,1],[1,1],[1,1],[0,0],[0,0]];
const BOOM_SML_HOTSPOTS:   [number,number][] = [[0,0],[0,0],[1,1],[1,1],[1,1],[1,1],[0,0],[0,0],[0,0]];
const BLAST_BIG_HOTSPOTS:  [number,number][] = [[5,5],[3,5],[1,5],[3,3],[5,1],[6,3],[5,5],[6,5]];
const BLAST_MED_HOTSPOTS:  [number,number][] = [[3,3],[2,2],[0,3],[2,2],[3,0],[3,2],[3,3],[3,3]];
const BLAST_SML_HOTSPOTS:  [number,number][] = [[1,1],[1,1],[1,1],[1,1],[1,1],[1,1],[1,1],[1,1]];

async function loadBattleSpriteSet(
  name: string,
  size: 'big' | 'med' | 'sml',
  count: number,
  hotspots: [number, number][],
  invisible?: Set<number>,
): Promise<SpriteSet> {
  const frames: (SpriteFrame | null)[] = Array(count).fill(null);
  await Promise.all(
    Array.from({ length: count }, (_, i) => {
      if (invisible?.has(i)) return Promise.resolve();
      const [hotX, hotY] = hotspots[i] ?? [0, 0];
      const url = `/battle/${name}-${size}-${pad3(i)}.png`;
      return loadFrame(url, hotX, hotY)
        .then(f => { frames[i] = f; })
        .catch(() => {});
    })
  );
  return { frames, count };
}

export async function loadExplosionSprites(): Promise<ExplosionSprites> {
  const [boomBig, boomMed, boomSml, blastBig, blastMed, blastSml] = await Promise.all([
    loadBattleSpriteSet('boom',  'big', 9, BOOM_BIG_HOTSPOTS,  BOOM_INVISIBLE.big),
    loadBattleSpriteSet('boom',  'med', 9, BOOM_MED_HOTSPOTS,  BOOM_INVISIBLE.med),
    loadBattleSpriteSet('boom',  'sml', 9, BOOM_SML_HOTSPOTS,  BOOM_INVISIBLE.sml),
    loadBattleSpriteSet('blast', 'big', 8, BLAST_BIG_HOTSPOTS),
    loadBattleSpriteSet('blast', 'med', 8, BLAST_MED_HOTSPOTS),
    loadBattleSpriteSet('blast', 'sml', 8, BLAST_SML_HOTSPOTS),
  ]);
  return {
    boom:  { big: boomBig,  med: boomMed,  sml: boomSml },
    blast: { big: blastBig, med: blastMed, sml: blastSml },
  };
}
