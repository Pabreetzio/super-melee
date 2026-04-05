import type { ShipId } from 'shared/types';
import { preloadBattleSounds } from './audio';
import { preloadImage } from '../lib/preloadedImage';

export interface AtlasRuntimeFrame {
  img: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
  mask: Uint8Array;
}

export interface AtlasImageAsset {
  source: CanvasImageSource;
  width: number;
  height: number;
}

interface AtlasIndex {
  atlases: Record<string, { id: string; imageUrl: string; manifestUrl: string }>;
  ships: Partial<Record<ShipId, string>>;
  planets: Record<string, string>;
  urls: Record<string, string>;
  battleCommon: string | null;
}

interface AtlasManifest {
  id: string;
  imageUrl: string;
  frames: Record<string, {
    key: string;
    sourceUrl: string;
    x: number;
    y: number;
    w: number;
    h: number;
    hotX?: number;
    hotY?: number;
    maskSource?: string;
  }>;
}

interface LoadedAtlas {
  image: HTMLImageElement;
  frames: Map<string, AtlasRuntimeFrame>;
}

const indexPromise: Promise<AtlasIndex> = fetch('/atlases/index.json').then(r => {
  if (!r.ok) throw new Error(`Failed atlas index: ${r.status}`);
  return r.json() as Promise<AtlasIndex>;
});

const atlasPromises = new Map<string, Promise<LoadedAtlas>>();
const subImagePromises = new Map<string, Promise<AtlasImageAsset | null>>();

async function decodeImage(url: string): Promise<HTMLImageElement> {
  await preloadImage(url);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      try { await img.decode(); } catch { /* ignore */ }
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

async function loadAtlas(atlasId: string): Promise<LoadedAtlas> {
  if (!atlasPromises.has(atlasId)) {
    atlasPromises.set(atlasId, (async () => {
      const index = await indexPromise;
      const meta = index.atlases[atlasId];
      if (!meta) throw new Error(`Missing atlas ${atlasId}`);

      const [manifest, image] = await Promise.all([
        fetch(meta.manifestUrl).then(r => {
          if (!r.ok) throw new Error(`Failed atlas manifest ${meta.manifestUrl}`);
          return r.json() as Promise<AtlasManifest>;
        }),
        decodeImage(meta.imageUrl),
      ]);

      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const frames = new Map<string, AtlasRuntimeFrame>();
      if (!ctx) return { image, frames };

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

      for (const [url, frame] of Object.entries(manifest.frames)) {
        const mask = new Uint8Array(frame.w * frame.h);
        for (let row = 0; row < frame.h; row++) {
          for (let col = 0; col < frame.w; col++) {
            const srcIndex = ((frame.y + row) * canvas.width + (frame.x + col)) * 4 + 3;
            mask[row * frame.w + col] = data[srcIndex] > 0 ? 1 : 0;
          }
        }
        frames.set(url, {
          img: image,
          x: frame.x,
          y: frame.y,
          width: frame.w,
          height: frame.h,
          mask,
        });
      }

      return { image, frames };
    })());
  }
  return atlasPromises.get(atlasId)!;
}

export async function getAtlasFrameForUrl(url: string): Promise<AtlasRuntimeFrame | null> {
  const index = await indexPromise;
  const atlasId = index.urls[url];
  if (!atlasId) return null;
  const atlas = await loadAtlas(atlasId);
  return atlas.frames.get(url) ?? null;
}

export async function loadAtlasImageAsset(url: string): Promise<AtlasImageAsset | null> {
  if (!subImagePromises.has(url)) {
    subImagePromises.set(url, (async () => {
      const frame = await getAtlasFrameForUrl(url);
      if (!frame) return null;
      const canvas = document.createElement('canvas');
      canvas.width = frame.width;
      canvas.height = frame.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        frame.img,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        0,
        0,
        frame.width,
        frame.height,
      );
      return { source: canvas, width: frame.width, height: frame.height };
    })());
  }
  return subImagePromises.get(url)!;
}

export async function preloadBattleAssets(input: {
  fleets: Array<Array<ShipId | null>>;
  activeShips: ShipId[];
  planetType: string;
}): Promise<void> {
  const index = await indexPromise;
  const shipIds = new Set<ShipId>(input.activeShips);
  for (const fleet of input.fleets) {
    for (const shipId of fleet) {
      if (shipId) shipIds.add(shipId);
    }
  }

  const atlasIds = new Set<string>();
  if (index.battleCommon) atlasIds.add(index.battleCommon);
  const planetAtlas = index.planets[input.planetType];
  if (planetAtlas) atlasIds.add(planetAtlas);
  for (const shipId of shipIds) {
    const atlasId = index.ships[shipId];
    if (atlasId) atlasIds.add(atlasId);
  }

  await Promise.all([...atlasIds].map(loadAtlas));
  preloadBattleSounds([...shipIds]);
}
