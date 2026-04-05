import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS_DIR = path.join(ROOT, 'assets');
const ATLAS_DIR = path.join(ASSETS_DIR, 'atlases');
const MAX_ATLAS_WIDTH = 2048;
const PADDING = 2;

function toPosix(p) {
  return p.split(path.sep).join('/');
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function removeDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

async function readPngFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map(entry => path.join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function collectShipGroups() {
  const shipsRoot = path.join(ASSETS_DIR, 'ships');
  const entries = await fs.readdir(shipsRoot, { withFileTypes: true });
  const groups = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const shipId = entry.name;
    const dir = path.join(shipsRoot, shipId);
    const files = await readPngFiles(dir);
    if (files.length === 0) continue;
    groups.push({
      atlasId: `ships/${shipId}`,
      kind: 'ship',
      shipId,
      files,
    });
  }
  return groups;
}

async function collectBattleGroup() {
  const dir = path.join(ASSETS_DIR, 'battle');
  const files = await readPngFiles(dir);
  if (files.length === 0) return null;
  return {
    atlasId: 'battle/common',
    kind: 'battle',
    files,
  };
}

async function collectPlanetGroups() {
  const planetsRoot = path.join(ASSETS_DIR, 'planets');
  const files = await readPngFiles(planetsRoot);
  const byType = new Map();
  for (const file of files) {
    const name = path.basename(file);
    const match = /^([^-]+)-(big|med|sml)-\d+\.png$/i.exec(name);
    if (!match) continue;
    const type = match[1];
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(file);
  }
  return [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, groupFiles]) => ({
      atlasId: `planets/${type}`,
      kind: 'planet',
      planetType: type,
      files: groupFiles.sort((a, b) => a.localeCompare(b)),
    }));
}

async function layoutFiles(files) {
  const items = [];
  for (const file of files) {
    const meta = await sharp(file).metadata();
    if (!meta.width || !meta.height) continue;
    items.push({ file, width: meta.width, height: meta.height });
  }

  let x = PADDING;
  let y = PADDING;
  let rowHeight = 0;
  let atlasWidth = 0;
  const placed = [];

  for (const item of items) {
    if (x + item.width + PADDING > MAX_ATLAS_WIDTH && rowHeight > 0) {
      x = PADDING;
      y += rowHeight + PADDING;
      rowHeight = 0;
    }
    placed.push({ ...item, x, y });
    x += item.width + PADDING;
    rowHeight = Math.max(rowHeight, item.height);
    atlasWidth = Math.max(atlasWidth, x);
  }

  const atlasHeight = y + rowHeight + PADDING;
  return {
    width: Math.max(1, atlasWidth),
    height: Math.max(1, atlasHeight),
    items: placed,
  };
}

async function writeAtlas(group) {
  const outBase = path.join(ATLAS_DIR, group.atlasId);
  await ensureDir(path.dirname(outBase));

  const layout = await layoutFiles(group.files);
  const composites = layout.items.map(item => ({
    input: item.file,
    left: item.x,
    top: item.y,
  }));

  await sharp({
    create: {
      width: layout.width,
      height: layout.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png().toFile(`${outBase}.png`);

  const frames = {};
  for (const item of layout.items) {
    const rel = path.relative(ASSETS_DIR, item.file);
    const publicUrl = `/${toPosix(rel)}`;
    frames[publicUrl] = {
      key: publicUrl,
      sourceUrl: publicUrl,
      x: item.x,
      y: item.y,
      w: item.width,
      h: item.height,
      hotX: 0,
      hotY: 0,
      maskSource: publicUrl,
    };
  }

  await fs.writeFile(
    `${outBase}.json`,
    JSON.stringify(
      {
        id: group.atlasId,
        imageUrl: `/atlases/${toPosix(group.atlasId)}.png`,
        frames,
      },
      null,
      2,
    ),
    'utf8',
  );

  return {
    id: group.atlasId,
    imageUrl: `/atlases/${toPosix(group.atlasId)}.png`,
    manifestUrl: `/atlases/${toPosix(group.atlasId)}.json`,
  };
}

async function main() {
  await removeDir(ATLAS_DIR);
  await ensureDir(ATLAS_DIR);

  const shipGroups = await collectShipGroups();
  const battleGroup = await collectBattleGroup();
  const planetGroups = await collectPlanetGroups();
  const allGroups = [...shipGroups, ...(battleGroup ? [battleGroup] : []), ...planetGroups];

  const atlases = {};
  const ships = {};
  const planets = {};
  const urls = {};

  for (const group of allGroups) {
    const atlasMeta = await writeAtlas(group);
    atlases[group.atlasId] = atlasMeta;
    if (group.kind === 'ship') ships[group.shipId] = group.atlasId;
    if (group.kind === 'planet') planets[group.planetType] = group.atlasId;
    for (const file of group.files) {
      const rel = path.relative(ASSETS_DIR, file);
      const publicUrl = `/${toPosix(rel)}`;
      urls[publicUrl] = group.atlasId;
    }
  }

  const index = {
    atlases,
    ships,
    planets,
    urls,
    battleCommon: battleGroup ? battleGroup.atlasId : null,
  };

  await fs.writeFile(
    path.join(ATLAS_DIR, 'index.json'),
    JSON.stringify(index, null, 2),
    'utf8',
  );
}

main().catch(err => {
  console.error('Failed to generate atlases:', err);
  process.exitCode = 1;
});
