// Static per-ship data for the status panel: race name, captain names, and asset file prefixes.
// Asset paths follow the pattern /ships/{shipId}/{prefix}-{kind}-{frame}.png served from
// the publicDir (../assets) by Vite.  Sprite prefix values come from the UQM content package
// directory naming (e.g. "cruiser" for human, "eluder" for spathi).
//
// Captain name tables are extracted verbatim from the UQM ship .txt files (lines 6+).
// Frame layout for captain portraits (15 frames, 0-indexed):
//   0        = background (static portrait)
//   1–5      = turn animation (1=right-base, 2=right, 3=right-release, 4=left, 5=left-hold)
//   6–8      = thrust animation
//   9–11     = weapon (primary fire) animation
//   12–14    = special animation

import type { ShipId } from 'shared/types';

export interface ShipStatusDef {
  /** Sprite prefix used by cap and icons assets, e.g. "cruiser" for human */
  sprite: string;
  /** Full race display name */
  race: string;
  /** Short race name (≤8 chars, used as status-panel header) */
  raceShort: string;
  /** Number of captain portrait animation frames (usually 15; scout has 20) */
  capCount: number;
  /** Captain name table — one is picked per match */
  captains: string[];
  /**
   * Per-frame captain overlay hotspot from the UQM .ani files.
   * Index = frame number (0 = portrait background, always [0,0]).
   * Draw position: (CAP_X − hotspot_x × S, capTop − hotspot_y × S).
   * Sprite is drawn at its natural pixel size × S.
   */
  capOffsets: ReadonlyArray<readonly [number, number]>;
}

export const SHIP_STATUS_DATA: Partial<Record<ShipId, ShipStatusDef>> = {
  androsynth: {
    sprite: 'guardian', race: 'Androsynth', raceShort: 'Andro.',
    capCount: 15,
    captains: ['BOOJI-1','DORN-3','BIM-XT','JOR-15','976-KILL','KORB-7B','XR4-TI',
               'CRC-16','BHS-79','DOS-1.0','ME-262','AK-47','1040-EZ','NECRO-99','HAL-2001'],
    capOffsets: [[0,0],[-12,-11],[-12,-11],[-12,-11],[-12,-11],[-12,-11],[-8,-3],[-8,-3],[-8,-3],[-35,-6],[-35,-6],[-35,-6],[-50,-6],[-50,-6],[-50,-6]],
  },
  arilou: {
    sprite: 'skiff', race: 'Arilou', raceShort: 'Arilou',
    capCount: 15,
    captains: ['Fefaloo','Bezabu','Tiptushi','Marypup','Tinkafo','Patooti','Tifiwilo',
               'Loleelu','Louifoui','Pinywiny','Oowbabe','Dingdup','Wewalia','Yipyapi','Ropilup'],
    capOffsets: [[0,0],[-15,-21],[-15,-21],[-15,-21],[-15,-21],[-15,-21],[-28,-10],[-28,-10],[-28,-10],[-8,-10],[-8,-10],[-8,-10],[-16,-1],[-16,-1],[-16,-1]],
  },
  chenjesu: {
    sprite: 'broodhome', race: 'Chenjesu', raceShort: 'Chenje.',
    capCount: 15,
    captains: ['Kzzakk','Tzrrow','Zzmzmm','Vziziz','Hmmhmm','Bzrak','Krrtzz',
               'Zzzzz','Zxzakz','Brrzap','Tzaprak','Pzkrakz','Fzzzz','Vrroww','Zznaz'],
    capOffsets: [[0,0],[-18,0],[-18,0],[-18,0],[-18,0],[-18,0],[-19,-13],[-15,-3],[-15,-3],[-20,-18],[-20,-13],[-20,-13],[0,-3],[0,-3],[0,-3]],
  },
  chmmr: {
    sprite: 'avatar', race: 'Chmmr', raceShort: 'Chmmr',
    capCount: 15,
    captains: ['Mnzgk','Chzrmn','Bzztrm','Zrnzrk','Tzzqrn','Kzzrn','Vzrzn',
               'Qrntz','Rmnzk','Szmrnz','Zbzzn','Frnkzk','Prmtzz','Tzrtzn','Kztztz'],
    capOffsets: [[0,0],[0,-2],[0,-2],[0,-2],[0,-2],[0,-2],[-27,-2],[-27,-2],[-27,-2],[-12,0],[-12,0],[-12,0],[-37,0],[-37,0],[-37,0]],
  },
  druuge: {
    sprite: 'mauler', race: 'Druuge', raceShort: 'Druuge',
    capCount: 15,
    captains: ['Tuuga','Siinur','Kaapo','Juugl','Paato','Feezo','Maad',
               'Moola','Kooli','Faazur','Zooto','Biitur','Duulard','Piini','Soopi'],
    capOffsets: [[0,0],[-28,-14],[-28,-14],[-28,-14],[-28,-14],[-28,-14],[-41,0],[-41,0],[-41,0],[-32,-6],[-32,-6],[-32,-6],[0,0],[0,0],[0,0]],
  },
  human: {
    sprite: 'cruiser', race: 'Earthling', raceShort: 'Earth.',
    capCount: 15,
    captains: ['Decker','Trent','Adama','Spiff','Graeme','Kirk','Pike',
               'Halleck','Tuf','Pirx','Wu','VanRijn','Ender','Buck','Solo'],
    capOffsets: [[0,0],[-33,-9],[-33,-9],[-33,-9],[-33,-9],[-33,-9],[-44,-7],[-44,-7],[-44,-7],[0,-5],[0,-5],[0,-5],[-19,-2],[-19,-2],[-19,-2]],
  },
  ilwrath: {
    sprite: 'avenger', race: 'Ilwrath', raceShort: 'Ilwrath',
    capCount: 15,
    captains: ['Gorgon','Taragon','Kalgon','Borgo','Dirga','Slygor','Rogash',
               'Argarak','Kayzar','Baylor','Zoggak','Targa','Vogar','Lurgo','Regorjo'],
    capOffsets: [[0,0],[0,-17],[0,-17],[0,-17],[0,-17],[0,-17],[-4,0],[-4,0],[-4,0],[-21,-17],[-21,-17],[-21,-17],[-31,-17],[-31,-17],[-31,-17]],
  },
  kohrah: {
    sprite: 'marauder', race: 'Kohr-Ah', raceShort: 'Kohr-Ah',
    capCount: 15,
    captains: ['Death 11','Death 17','Death 37','Death 23','Death 7','Death 13','Death 19',
               'Death 29','Death 31','Death 41','Death 43','Death 3','Death 5','Death 47','Death 53'],
    capOffsets: [[0,0],[0,-8],[0,-8],[0,-8],[-38,-8],[-38,-8],[-21,-8],[-21,-8],[-21,-8],[-19,-19],[-19,-19],[-19,-19],[0,0],[0,0],[0,0]],
  },
  melnorme: {
    sprite: 'trader', race: 'Melnorme', raceShort: 'Melnorme',
    capCount: 15,
    captains: ['Reddish','Orangy','Aqua','Crimson','Magenta','Cheruse','Beige',
               'Fuchsia','Umber','Cerise','Mauve','Grayish','Yellow','Black','Bluish'],
    capOffsets: [[0,0],[-5,-17],[-5,-17],[-5,-17],[-31,-22],[-31,-22],[-38,-9],[-38,-9],[-38,-9],[0,0],[0,0],[0,0],[-9,-9],[-9,-9],[-9,-9]],
  },
  mmrnmhrm: {
    sprite: 'xform', race: 'Mmrnmhrm', raceShort: 'Mmrn.',
    capCount: 15,
    captains: ['Qir-nha','Jhe-qir','Qua-rhna','Mn-quah','Nrna-mha','Um-hrh','Hm-nhuh',
               'Rrma-hrn','Jra-nr','Ur-mfrs','Qua-qir','Mrm-na','Jhe-mhr','Hmr-hun','Nhuh-na'],
    capOffsets: [[0,0],[-37,-11],[-37,-11],[0,-11],[0,-11],[0,-11],[-19,-15],[-19,-15],[-19,-15],[-14,0],[-14,0],[-14,0],[0,0],[0,0],[0,0]],
  },
  mycon: {
    sprite: 'podship', race: 'Mycon', raceShort: 'Mycon',
    capCount: 15,
    captains: ['Blort','Chupp','Floos','Glish','Glob','Glush','Plork',
               'Shlish','Shlupp','Slingy','Sploozo','Spork','Uffo','Yush','Zaloop'],
    capOffsets: [[0,0],[-30,-20],[-30,-20],[-2,-20],[-2,-20],[-5,-20],[-15,-2],[-15,-2],[-15,-3],[0,0],[0,0],[0,0],[-13,-3],[-7,0],[-7,0]],
  },
  orz: {
    sprite: 'nemesis', race: 'Orz', raceShort: 'Orz',
    capCount: 15,
    captains: ['*Wet*','*Happy*','*Frumple*','*Camper*','*Loner*','*Dancer*','*Singer*',
               '*Heavy*','*NewBoy*','*FatFun*','*Pepper*','*Hungry*','*Deep*','*Smell*','*Juice*'],
    capOffsets: [[0,0],[0,0],[0,0],[0,0],[-42,0],[-42,0],[-15,-6],[-15,-6],[-15,-6],[-20,-14],[-20,-14],[-20,-14],[-17,0],[-17,0],[-17,0]],
  },
  pkunk: {
    sprite: 'fury', race: 'Pkunk', raceShort: 'Pkunk',
    capCount: 15,
    captains: ['Awwky','Tweety','WudStok','Poppy','Brakky','Hooter','Buzzard',
               'Polly','Ernie','Yompin','Fuzzy','Raven','Crow','Jay','Screech'],
    capOffsets: [[0,0],[0,-23],[0,-23],[0,-23],[-22,-25],[-22,-25],[-3,-5],[-3,-5],[-3,-5],[-1,0],[-1,0],[-1,0],[-11,-15],[-11,-15],[-11,-15]],
  },
  shofixti: {
    sprite: 'scout', race: 'Shofixti', raceShort: 'Shofix.',
    capCount: 20,  // scout-cap has 20 frames
    captains: ['Hiyata','Wasabe','Kudzu','Ichiban','Bonsai!','Genjiro','Ginzu',
               'Busu','Gaijin','Daikon','Sushi','Naninani','Chimchim','Tora-3','Tofu'],
    capOffsets: [[0,0],[-2,-10],[-2,-10],[-2,-10],[-2,-10],[-2,-10],[-15,-1],[-15,-1],[-15,-1],[-41,-11],[-41,-11],[-41,-11],[0,-23],[0,-23],[0,-23],[0,-23],[0,-23],[0,-23],[0,-23],[0,-23]],
  },
  slylandro: {
    sprite: 'probe', race: 'Slylandro', raceShort: 'Slylan.',
    capCount: 15,
    captains: ['2418-B','2418-B','2418-B','2418-B','2418-B','2418-B','2418-B',
               '2418-B','2418-B','2418-B','2418-B','2418-B','2418-B','2418-B','2418-B'],
    capOffsets: [[0,0],[-4,0],[-4,0],[-4,0],[-43,0],[-43,0],[-14,-14],[-14,-14],[-14,-14],[-10,-8],[-10,-8],[-10,-8],[-6,-16],[-6,-16],[-6,-16]],
  },
  spathi: {
    sprite: 'eluder', race: 'Spathi', raceShort: 'Spathi',
    capCount: 15,
    captains: ['Thwil','Pwappy','Phwiff','Wiffy','Plibnik','Snurfel','Kwimp',
               'Pkunky','Jinkeze','Thintho','Rupatup','Nargle','Phlendo','Snelopy','Bwinkin'],
    capOffsets: [[0,0],[-31,-12],[-31,-12],[-31,-12],[-31,-12],[-31,-12],[-24,-7],[-24,-7],[-24,-7],[0,-13],[0,-13],[0,-13],[-9,-5],[-9,-5],[-9,-5]],
  },
  supox: {
    sprite: 'blade', race: 'Supox', raceShort: 'Supox',
    capCount: 15,
    captains: ['Trifid','Crinoid','FlyTrap','Thistle','Ivy','Sprout','Twig',
               'Root','Branch','Thorn','Bark','Bud','Nut','Stem','Bramble'],
    capOffsets: [[0,0],[0,-21],[0,-21],[0,-15],[-35,-15],[-35,-15],[0,0],[0,0],[0,0],[-21,-7],[-21,-7],[-21,-7],[-33,0],[-33,0],[-33,0]],
  },
  syreen: {
    sprite: 'penetrator', race: 'Syreen', raceShort: 'Syreen',
    capCount: 15,
    captains: ["Teela","Dejah","Penny","Alia","Be'lit","Ripley","Yarr",
               'Ardala','Sparta','Munro','Danning','Brawne','Maya','Aelita','Alura'],
    capOffsets: [[0,0],[-36,-9],[-36,-9],[-36,-9],[-36,-9],[-36,-9],[-22,0],[-22,0],[-22,0],[-4,-8],[-4,-8],[-4,-8],[-29,0],[-29,0],[-29,0]],
  },
  thraddash: {
    sprite: 'torch', race: 'Thraddash', raceShort: 'Thradd.',
    capCount: 15,
    captains: ['Dthunk','Bardat','Znonk','Mnump','Bronk','Smup','Grulk',
               'Hornk','Knarg','Drulg','Dgako','Znork','Kwamp','Fkank','Pdump'],
    capOffsets: [[0,0],[-36,-4],[-36,-4],[-36,-4],[-36,-4],[-36,-4],[-34,-20],[-34,-20],[-34,-20],[-4,-7],[-4,-7],[-4,-7],[-19,-5],[-19,-5],[-19,-5]],
  },
  umgah: {
    sprite: 'drone', race: 'Umgah', raceShort: 'Umgah',
    capCount: 15,
    captains: ["Julg'ka","Gibj'o","Baguk'i","O'guk'e","Gwap'he","Chez'ef","Znork'i",
               'Bob',"Kwik'ow","Ei'Ei'o","Brewz'k","Pruk'u","O'bargy","Kterbi'a","Chup'he"],
    capOffsets: [[0,0],[-4,-1],[-4,-1],[-4,-1],[-4,-1],[-4,-1],[0,-8],[0,-8],[0,-8],[-29,-9],[-29,-9],[-29,-9],[-28,-1],[-28,-1],[-28,-1]],
  },
  urquan: {
    sprite: 'dreadnought', race: 'Ur-Quan', raceShort: 'Ur-Quan',
    capCount: 15,
    captains: ['Lord 999','Lord 342','Lord 88','Lord 156','Lord 43','Lord 412','Lord 666',
               'Lord 18','Lord 237','Lord 89','Lord 3','Lord 476','Lord 103','Lord 783','Lord 52'],
    capOffsets: [[0,0],[-20,-21],[-20,-21],[-20,-21],[-20,-21],[-20,-21],[0,-15],[0,-15],[0,-15],[-32,-19],[-32,-19],[-32,-19],[-3,0],[-3,0],[-3,0]],
  },
  utwig: {
    sprite: 'jugger', race: 'Utwig', raceShort: 'Utwig',
    capCount: 15,
    captains: ['Endo','Vermi','Manny','Uuter','Nergo','Sami','Duna',
               'Frann','Krisk','Lololo','Snoon','Nestor','Lurg','Thory','Jujuby'],
    capOffsets: [[0,0],[0,-18],[0,-18],[0,-18],[-28,-18],[-28,-18],[-10,0],[-10,0],[-10,0],[-22,-5],[-22,-5],[-22,-5],[-25,-20],[-25,-20],[-25,-20]],
  },
  vux: {
    sprite: 'intruder', race: 'VUX', raceShort: 'VUX',
    capCount: 15,
    captains: ['ZIK','PUZ','ZUK','VIP','ZIT','YUK','DAK','ZRN','PIF','FIZ','FUP','ZUP','NRF','ZOG','ORZ'],
    capOffsets: [[0,0],[-1,-3],[-1,-3],[-1,-3],[-1,-3],[-1,-3],[-39,-9],[-39,-9],[-39,-9],[-25,-14],[-25,-14],[-25,-14],[-15,-2],[-15,-2],[-15,-2]],
  },
  yehat: {
    sprite: 'terminator', race: 'Yehat', raceShort: 'Yehat',
    capCount: 15,
    captains: ['Heep-eep','Feep-eep','Reep-eep','Yeep-eep','Beep-eep','Eeep-eep','Meep-eep',
               'Teep-eep','Jeep-eep','Leep-eep','Peep-eep','Weep-eep','Veep-eep','Geep-eep','Zeep-eep'],
    capOffsets: [[0,0],[-2,-8],[-2,-8],[-2,-8],[-2,-8],[-2,-8],[0,0],[0,0],[0,0],[-43,0],[-43,0],[-43,0],[-24,0],[-24,0],[-24,0]],
  },
  zoqfotpik: {
    sprite: 'stinger', race: 'ZoqFot', raceShort: 'ZoqFot',
    capCount: 15,
    captains: ['NikNak','FipPat','DipPak','FatPot','ZikFat','PukYor','TopNik',
               'PorKoo','TikTak','RinTin','FitFap','TotToe','ZipZak','TikTok','MikMok'],
    capOffsets: [[0,0],[-16,0],[-16,0],[-16,0],[-16,0],[-16,0],[0,-5],[0,-5],[0,-5],[-23,-10],[-23,-10],[-23,-10],[-38,-5],[-38,-5],[-38,-5]],
  },
  // samatra has no captain window in UQM
  samatra: {
    sprite: 'generator', race: 'Sa-Matra', raceShort: 'Sa-Matra',
    capCount: 0,
    captains: [],
    capOffsets: [],
  },
};

const ALL_CAPTAIN_NAMES = Object.values(SHIP_STATUS_DATA)
  .flatMap(def => def?.captains ?? []);

/** Pick a stable captain name for a given ship type based on a seed value */
export function pickCaptain(shipId: ShipId, seed: number): string {
  const def = SHIP_STATUS_DATA[shipId];
  if (!def || def.captains.length === 0) return '';
  return def.captains[seed % def.captains.length];
}

export function pickRandomCaptainName(): string {
  if (ALL_CAPTAIN_NAMES.length === 0) return 'Commander';
  return ALL_CAPTAIN_NAMES[Math.floor(Math.random() * ALL_CAPTAIN_NAMES.length)];
}
