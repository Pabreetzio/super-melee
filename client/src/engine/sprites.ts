// Sprite loader — loads PNG frames from the extracted UQM asset directory.
// Frame filenames follow the pattern: <name>-<size>-<NNN>.png
// Hot-spot data (center offset for rendering) is baked in here from the .ani files.

export interface SpriteFrame {
  img:    HTMLImageElement;
  hotX:   number; // pixels from left of image to ship center
  hotY:   number; // pixels from top  of image to ship center
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

// ─── Loader ───────────────────────────────────────────────────────────────────

function loadFrame(url: string, hotX: number, hotY: number): Promise<SpriteFrame> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ img, hotX, hotY });
    img.onerror = () => {
      console.warn(`Sprite not found: ${url} (extract UQM assets per SETUP.md)`);
      reject(new Error(`Failed to load ${url}`));
    };
    img.src = url;
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

// ─── Ship-specific loaders ────────────────────────────────────────────────────

export async function loadCruiserSprites(): Promise<{
  big: SpriteSet;
  sml: SpriteSet;
  nuke: SpriteSet;
}> {
  const [big, sml] = await Promise.all([
    loadSpriteSet('human/cruiser', 'big', 16, CRUISER_BIG_HOTSPOTS),
    loadSpriteSet('human/cruiser', 'sml', 16, CRUISER_SML_HOTSPOTS),
  ]);

  // Saturn (nuke) sprites use a different filename prefix — load them manually.
  const saturnFrames: (SpriteFrame | null)[] = Array(16).fill(null);
  await Promise.all(
    SATURN_BIG_HOTSPOTS.slice(0, 16).map(([hotX, hotY], i) => {
      const url = `/ships/human/saturn-big-${pad3(i)}.png`;
      return loadFrame(url, hotX, hotY)
        .then(f => { saturnFrames[i] = f; })
        .catch(() => {});
    })
  );

  return {
    big,
    sml,
    nuke: { frames: saturnFrames, count: 16 },
  };
}

// ─── Render helper ────────────────────────────────────────────────────────────

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
): void {
  const frame = set.frames[frameIndex & (set.count - 1)];
  if (!frame) return;

  // World → display: divide by 4 at 1x, 8 at 2x, 16 at 4x, 32 at 8x
  const displayX = Math.round((worldX - originWorldX) >> (2 + reduction));
  const displayY = Math.round((worldY - originWorldY) >> (2 + reduction));

  const drawX = displayX - frame.hotX;
  const drawY = displayY - frame.hotY;

  // Only draw if on screen
  if (drawX + frame.img.width < 0 || drawX > canvasW) return;
  if (drawY + frame.img.height < 0 || drawY > canvasH) return;

  ctx.drawImage(frame.img, drawX, drawY);
}
