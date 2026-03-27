// Audio manager — loads and plays UQM battle sound effects.
// All sounds are loaded non-blockingly; missing files are silently ignored.
// Sounds are played via HTMLAudioElement (Web Audio API's simpler cousin).
// Multiple simultaneous instances are supported by cloning nodes.

// ─── Sound catalog ────────────────────────────────────────────────────────────

// Battle-wide sounds (in /sounds/battle/)
const BATTLE_SOUNDS = {
  shipdies: '/sounds/battle/shipdies.wav',
  boom1:    '/sounds/battle/boom1.wav',
  boom23:   '/sounds/battle/boom23.wav',
  boom45:   '/sounds/battle/boom45.wav',
  boom67:   '/sounds/battle/boom67.wav',
} as const;

// Per-ship weapon sounds (in /sounds/ships/<species>/)
const SHIP_SOUNDS: Partial<Record<string, { primary?: string; secondary?: string; extra?: string }>> = {
  human:  { primary: '/sounds/ships/human/primary.wav',  secondary: '/sounds/ships/human/secondary.wav' },
  spathi: { primary: '/sounds/ships/spathi/primary.wav', secondary: '/sounds/ships/spathi/secondary.wav' },
  urquan: { primary: '/sounds/ships/urquan/primary.wav', secondary: '/sounds/ships/urquan/secondary.wav', extra: '/sounds/ships/urquan/fighter_laser.wav' },
  pkunk:  { primary: '/sounds/ships/pkunk/primary.wav' },
  vux:    { primary: '/sounds/ships/vux/primary.wav' },
};

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

/** Play a cached sound. Clones the element so the same sound can overlap itself. */
function playUrl(url: string, volume = 1.0): void {
  const src = cache.get(url);
  if (!src) return;
  try {
    const clone = src.cloneNode() as HTMLAudioElement;
    clone.volume = Math.max(0, Math.min(1, volume));
    clone.play().catch(() => {}); // ignore autoplay policy rejections
  } catch {
    // Audio not supported or already unmounted — ignore
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Preload all battle sounds. Call once at battle start. */
export function preloadBattleSounds(shipTypes: string[]): void {
  // Load global battle sounds
  for (const url of Object.values(BATTLE_SOUNDS)) load(url);
  // Load ship-specific sounds for the ships in this battle
  for (const type of shipTypes) {
    const sounds = SHIP_SOUNDS[type];
    if (!sounds) continue;
    if (sounds.primary)   load(sounds.primary);
    if (sounds.secondary) load(sounds.secondary);
    if (sounds.extra)     load(sounds.extra);
  }
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
  const url = SHIP_SOUNDS[shipType]?.secondary;
  if (url) playUrl(url, 0.7);
}

/** Fighter laser (Ur-Quan). */
export function playFighterLaser(): void {
  const url = SHIP_SOUNDS.urquan?.extra;
  if (url) playUrl(url, 0.5);
}

/** Small blast key by battle sound name. */
export function playBattleSound(key: SoundKey, volume = 0.7): void {
  playUrl(BATTLE_SOUNDS[key], volume);
}
