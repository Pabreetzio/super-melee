// Audio manager — loads and plays UQM battle sound effects.
// All sounds are loaded non-blockingly; missing files are silently ignored.
// Sounds are played via HTMLAudioElement. Multiple simultaneous instances
// are supported by cloning nodes.
import type { EffectSound } from './ships/types';
import type { ShipId } from 'shared/types';

// ─── Audio config ─────────────────────────────────────────────────────────────

export interface AudioConfig {
  sfxVolume:   number; // 0.0 – 1.0
  musicVolume: number; // 0.0 – 1.0
  muted:       boolean;
}

const AUDIO_CONFIG_KEY = 'smAudioConfig';

function defaultConfig(): AudioConfig {
  return { sfxVolume: 0.8, musicVolume: 0.8, muted: false };
}

let _config: AudioConfig = (() => {
  try {
    const raw = localStorage.getItem(AUDIO_CONFIG_KEY);
    if (raw) return { ...defaultConfig(), ...JSON.parse(raw) } as AudioConfig;
  } catch { /* ignore */ }
  return defaultConfig();
})();

export function getAudioConfig(): AudioConfig { return { ..._config }; }

export function setAudioConfig(patch: Partial<AudioConfig>): void {
  _config = { ..._config, ...patch };
  if (_victoryEl) {
    _victoryEl.volume = _config.muted ? 0 : _config.musicVolume;
  }
  try { localStorage.setItem(AUDIO_CONFIG_KEY, JSON.stringify(_config)); } catch { /* ignore */ }
}

// ─── Sound catalog ────────────────────────────────────────────────────────────

// Battle-wide sounds (in /sounds/battle/)
const BATTLE_SOUNDS = {
  shipdies: '/sounds/battle/shipdies.wav',
  boom1:    '/sounds/battle/boom1.wav',
  boom23:   '/sounds/battle/boom23.wav',
  boom45:   '/sounds/battle/boom45.wav',
  boom67:   '/sounds/battle/boom67.wav',
} as const;

const UI_SOUNDS = {
  menuMove:   '/sounds/ui/menusnd01.wav',
  menuSelect: '/sounds/ui/menusnd02.wav',
  menuError:  '/sounds/ui/menusnd03.wav',
} as const;

// Per-ship weapon sounds (in /sounds/ships/<species>/)
const SHIP_SOUNDS: Record<string, Record<string, string | undefined>> = {
  androsynth: { primary: '/sounds/ships/androsynth/primary.wav', secondary: '/sounds/ships/androsynth/secondary.wav' },
  arilou:     { primary: '/sounds/ships/arilou/primary.wav',    secondary: '/sounds/ships/arilou/secondary.wav' },
  chenjesu:   { primary: '/sounds/ships/chenjesu/primary.wav',  secondary: '/sounds/ships/chenjesu/secondary.wav', shrapnel: '/sounds/ships/chenjesu/shrapnel.wav', dogiBark: '/sounds/ships/chenjesu/dogibark.wav', dogiDie: '/sounds/ships/chenjesu/dogidie.wav' },
  chmmr:      { primary: '/sounds/ships/chmmr/primary.wav',     secondary: '/sounds/ships/chmmr/secondary.wav' },
  druuge:     { primary: '/sounds/ships/druuge/primary.wav',    secondary: '/sounds/ships/druuge/secondary.wav' },
  flagship:   { primary: '/sounds/ships/flagship/primary.wav', secondary: '/sounds/ships/flagship/secondary.wav' },
  human:      { primary: '/sounds/ships/human/primary.wav',    secondary: '/sounds/ships/human/secondary.wav' },
  ilwrath:    { primary: '/sounds/ships/ilwrath/primary.wav', secondary: '/sounds/ships/ilwrath/cloak.wav', cloak: '/sounds/ships/ilwrath/cloak.wav', uncloak: '/sounds/ships/ilwrath/uncloak.wav' },
  kohrah:     { primary: '/sounds/ships/kohrah/primary.wav',    secondary: '/sounds/ships/kohrah/secondary.wav' },
  melnorme:   { primary: '/sounds/ships/melnorme/primary.wav',  secondary: '/sounds/ships/melnorme/secondary.wav' },
  mmrnmhrm:   { primaryX: '/sounds/ships/mmrnmhrm/primaryx.wav', secondaryX: '/sounds/ships/mmrnmhrm/secondary.wav', primaryY: '/sounds/ships/mmrnmhrm/primaryy.wav', secondaryY: '/sounds/ships/mmrnmhrm/secondaryy.wav' },
  mycon:      { primary: '/sounds/ships/mycon/primary.wav',     secondary: '/sounds/ships/mycon/secondary.wav' },
  orz:        { primary: '/sounds/ships/orz/primary.wav',       secondary: '/sounds/ships/orz/secondary.wav', zap: '/sounds/ships/orz/zap.wav', argh: '/sounds/ships/orz/argh.wav' },
  pkunk:      { primary: '/sounds/ships/pkunk/primary.wav',     rebirth: '/sounds/ships/pkunk/rebirth.wav', baby: '/sounds/ships/pkunk/insult01.wav', douDou: '/sounds/ships/pkunk/insult02.wav', fool: '/sounds/ships/pkunk/insult03.wav', idiot: '/sounds/ships/pkunk/insult04.wav', jerk: '/sounds/ships/pkunk/insult05.wav', looser: '/sounds/ships/pkunk/insult06.wav', moron: '/sounds/ships/pkunk/insult07.wav', nerd: '/sounds/ships/pkunk/insult08.wav', nitwit: '/sounds/ships/pkunk/insult09.wav', stupid: '/sounds/ships/pkunk/insult10.wav', twig: '/sounds/ships/pkunk/insult11.wav', whimp: '/sounds/ships/pkunk/insult12.wav', worm: '/sounds/ships/pkunk/insult13.wav', dummy: '/sounds/ships/pkunk/insult14.wav' },
  samatra:    { primary: '/sounds/ships/samatra/primary.wav',   secondary: '/sounds/ships/samatra/secondary.wav' },
  shofixti:   { primary: '/sounds/ships/shofixti/primary.wav',  secondary: '/sounds/ships/shofixti/secondary.wav' },
  slylandro:  { primary: '/sounds/ships/slylandro/primary.wav', secondary: '/sounds/ships/slylandro/secondary.wav' },
  spathi:     { primary: '/sounds/ships/spathi/primary.wav',    secondary: '/sounds/ships/spathi/secondary.wav' },
  supox:      { primary: '/sounds/ships/supox/primary.wav' },
  syreen:     { primary: '/sounds/ships/syreen/primary.wav',    secondary: '/sounds/ships/syreen/secondary.wav' },
  thraddash:  { primary: '/sounds/ships/thraddash/primary.wav', secondary: '/sounds/ships/thraddash/secondary.wav' },
  umgah:      { primary: '/sounds/ships/umgah/primary.wav',     secondary: '/sounds/ships/umgah/secondary.wav' },
  urquan:     { primary: '/sounds/ships/urquan/primary.wav',    secondary: '/sounds/ships/urquan/secondary.wav', fighterLaser: '/sounds/ships/urquan/fighter_laser.wav', fighterGet: '/sounds/ships/urquan/fighter_get.wav' },
  utwig:      { primary: '/sounds/ships/utwig/primary.wav',     secondary: '/sounds/ships/utwig/secondary.wav', shieldBatteryGain: '/sounds/ships/utwig/shieldbattgain.wav' },
  vux:        { primary: '/sounds/ships/vux/primary.wav',       secondary: '/sounds/ships/vux/secondary.wav', limpetBite: '/sounds/ships/vux/limpet_bite.wav' },
  yehat:      { primary: '/sounds/ships/yehat/primary.wav',     secondary: '/sounds/ships/yehat/secondary.wav' },
  zoqfotpik:  { primary: '/sounds/ships/zoqfotpik/primary.wav', secondary: '/sounds/ships/zoqfotpik/secondary.wav' }
};

const PKUNK_INSULT_KEYS = [
  'baby', 'douDou', 'fool', 'idiot', 'jerk', 'looser', 'moron',
  'nerd', 'nitwit', 'stupid', 'twig', 'whimp', 'worm', 'dummy',
] as const;

// Victory ditties — OGG files converted from original UQM MOD tracks.
const VICTORY_DITTIES: Partial<Record<ShipId, string>> = {
  androsynth: '/music/ditty-ogg/androsynth.ogg',
  arilou:     '/music/ditty-ogg/arilou.ogg',
  chenjesu:   '/music/ditty-ogg/chenjesu.ogg',
  chmmr:      '/music/ditty-ogg/chmmr.ogg',
  druuge:     '/music/ditty-ogg/druuge.ogg',
  human:      '/music/ditty-ogg/human.ogg',
  ilwrath:    '/music/ditty-ogg/ilwrath.ogg',
  kohrah:     '/music/ditty-ogg/kohrah.ogg',
  melnorme:   '/music/ditty-ogg/melnorme.ogg',
  mmrnmhrm:   '/music/ditty-ogg/mmrnmhrm.ogg',
  mycon:      '/music/ditty-ogg/mycon.ogg',
  orz:        '/music/ditty-ogg/orz.ogg',
  pkunk:      '/music/ditty-ogg/pkunk.ogg',
  shofixti:   '/music/ditty-ogg/shofixti.ogg',
  slylandro:  '/music/ditty-ogg/slylandro.ogg',
  spathi:     '/music/ditty-ogg/spathi.ogg',
  supox:      '/music/ditty-ogg/supox.ogg',
  syreen:     '/music/ditty-ogg/syreen.ogg',
  thraddash:  '/music/ditty-ogg/thraddash.ogg',
  umgah:      '/music/ditty-ogg/umgah.ogg',
  urquan:     '/music/ditty-ogg/urquan.ogg',
  utwig:      '/music/ditty-ogg/utwig.ogg',
  vux:        '/music/ditty-ogg/vux.ogg',
  yehat:      '/music/ditty-ogg/yehat.ogg',
  zoqfotpik:  '/music/ditty-ogg/zoqfotpik.ogg',
};

let pkunkInsultIndex = 0;

// ─── Loader ───────────────────────────────────────────────────────────────────

type SoundKey = keyof typeof BATTLE_SOUNDS;

const cache = new Map<string, HTMLAudioElement>();

function load(url: string): HTMLAudioElement | null {
  if (cache.has(url)) return cache.get(url)!;
  const el = new Audio();
  el.preload = 'auto';
  el.src = url;
  // Store in cache even if loading fails — prevents repeated load attempts
  cache.set(url, el);
  el.load();
  return el;
}

/** Play a preloaded sound URL by cloning the already-loaded template audio
 *  element. This keeps overlap support without constructing a fresh
 *  URL-backed Audio object on every play. */
function playUrl(url: string, volume = 1.0): void {
  if (_config.muted) return;
  const template = cache.get(url) ?? load(url);
  if (!template) return;
  try {
    const el = template.cloneNode(true) as HTMLAudioElement;
    el.preload = 'auto';
    el.volume = Math.max(0, Math.min(1, volume * _config.sfxVolume));
    el.play().catch(() => {}); // ignore autoplay policy rejections
  } catch {
    // Audio not supported or already unmounted — ignore
  }
}

// ─── Victory ditty state ──────────────────────────────────────────────────────

let _victoryEl: HTMLAudioElement | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/** Preload all battle sounds. Call once at battle start. */
export function preloadBattleSounds(shipTypes: string[]): void {
  // Load global battle sounds
  for (const url of Object.values(BATTLE_SOUNDS)) load(url);
  // Load ship-specific sounds for the ships in this battle
  for (const type of shipTypes) {
    const sounds = SHIP_SOUNDS[type];
    if (!sounds) continue;
    for (const url of Object.values(sounds)) {
      if (url) load(url);
    }
    // Preload this ship's victory ditty
    const dittyUrl = VICTORY_DITTIES[type as ShipId];
    if (dittyUrl) load(dittyUrl);
  }
}

export function preloadUISounds(): void {
  for (const url of Object.values(UI_SOUNDS)) load(url);
}

/** Ship destruction boom (big explosion). */
export function playShipDies(): void {
  playUrl(BATTLE_SOUNDS.shipdies, 0.8);
}

/** Missile/projectile impact sound. Frame = size of impact (1=small, 2-3=med, 4-5=large, 6-7=huge). */
export function playBlast(frame: number): void {
  if (frame <= 1)      playUrl(BATTLE_SOUNDS.boom1, 0.6);
  else if (frame <= 3) playUrl(BATTLE_SOUNDS.boom23, 0.6);
  else if (frame <= 5) playUrl(BATTLE_SOUNDS.boom45, 0.6);
  else                 playUrl(BATTLE_SOUNDS.boom67, 0.6);
}

/** Primary weapon fire for the given ship type. */
export function playPrimary(shipType: string): void {
  const url = SHIP_SOUNDS[shipType]?.primary;
  if (url) playUrl(url, 0.7);
}

/** Secondary weapon fire for the given ship type. */
export function playSecondary(shipType: string): void {
  if (shipType === 'pkunk') {
    const key = PKUNK_INSULT_KEYS[pkunkInsultIndex % PKUNK_INSULT_KEYS.length];
    pkunkInsultIndex = (pkunkInsultIndex + 1) % PKUNK_INSULT_KEYS.length;
    const url = SHIP_SOUNDS.pkunk?.[key];
    if (url) playUrl(url, 0.8);
    return;
  }
  const url = SHIP_SOUNDS[shipType]?.secondary;
  if (url) playUrl(url, 0.7);
}

export function playPkunkRebirth(): void {
  const url = SHIP_SOUNDS.pkunk?.rebirth;
  if (url) playUrl(url, 0.8);
}

/** Fighter laser (Ur-Quan). */
export function playFighterLaser(): void {
  const url = SHIP_SOUNDS.urquan?.fighterLaser;
  if (url) playUrl(url, 0.5);
}

/** Fighter launch — "Launch fighters" voice (Ur-Quan secondary.wav). */
export function playFighterLaunch(): void {
  const url = SHIP_SOUNDS.urquan?.secondary;
  if (url) playUrl(url, 0.8);
}

/** Fighter docking — plays when a returning fighter docks with the mothership (fighter_get.wav). */
export function playFighterDock(): void {
  const url = SHIP_SOUNDS.urquan?.fighterGet;
  if (url) playUrl(url, 0.7);
}

export function playVuxLimpetBite(): void {
  const url = SHIP_SOUNDS.vux?.limpetBite;
  if (url) playUrl(url, 0.7);
}

export function playEffectSound(cue: EffectSound): void {
  if (cue === 'fighter_laser') playFighterLaser();
  else if (cue === 'fighter_dock') playFighterDock();
  else if (cue === 'vux_limpet_bite') playVuxLimpetBite();
  else if (cue === 'chenjesu_shrapnel') {
    const url = SHIP_SOUNDS.chenjesu?.shrapnel;
    if (url) playUrl(url, 0.7);
  }
  else if (cue === 'chenjesu_dogi_bark') {
    const url = SHIP_SOUNDS.chenjesu?.dogiBark;
    if (url) playUrl(url, 0.75);
  }
  else if (cue === 'chenjesu_dogi_die') {
    const url = SHIP_SOUNDS.chenjesu?.dogiDie;
    if (url) playUrl(url, 0.75);
  }
}

/** Small blast key by battle sound name. */
export function playBattleSound(key: SoundKey, volume = 0.7): void {
  playUrl(BATTLE_SOUNDS[key], volume);
}

export function playMenuMove(): void {
  playUrl(UI_SOUNDS.menuMove, 0.55);
}

export function playMenuSelect(): void {
  playUrl(UI_SOUNDS.menuSelect, 0.7);
}

export function playMenuError(): void {
  playUrl(UI_SOUNDS.menuError, 0.7);
}

export function isVictoryDittyPlaying(): boolean {
  return _victoryEl !== null && !_victoryEl.paused && !_victoryEl.ended;
}

/** Play the winning ship's victory ditty once. No looping. */
export async function playVictoryDitty(shipType: ShipId): Promise<void> {
  if (_config.muted || _config.musicVolume <= 0) return;

  const url = VICTORY_DITTIES[shipType];
  if (!url) return;

  stopVictoryDitty();

  try {
    const el = new Audio(url);
    el.loop = false;
    el.volume = Math.max(0, Math.min(1, _config.musicVolume));
    el.onended = () => {
      if (_victoryEl === el) _victoryEl = null;
    };
    _victoryEl = el;
    await el.play();
  } catch {
    // Ignore autoplay policy rejections or missing files.
    _victoryEl = null;
  }
}

export function stopVictoryDitty(): void {
  if (_victoryEl) {
    try {
      _victoryEl.pause();
      _victoryEl.currentTime = 0;
    } catch { /* ignore */ }
    _victoryEl = null;
  }
}
