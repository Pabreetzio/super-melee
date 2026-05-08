#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.error('Usage: npm run compare-desync -- host-report.json opponent-report.json');
  process.exit(1);
}

const [, , leftPath, rightPath] = process.argv;
if (!leftPath || !rightPath) usage();

function readReport(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(text);
}

function byFrame(report) {
  const map = new Map();
  for (const snap of report.snapshots ?? []) map.set(snap.frame, snap);
  return map;
}

function firstDiff(a, b, trail = '') {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b) return { path: trail, left: a, right: b };
  if (a === null || b === null || typeof a !== 'object') {
    return { path: trail, left: a, right: b };
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return { path: trail, left: a, right: b };
    if (a.length !== b.length) return { path: `${trail}.length`, left: a.length, right: b.length };
    for (let i = 0; i < a.length; i++) {
      const diff = firstDiff(a[i], b[i], `${trail}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }

  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
  for (const key of keys) {
    if (!(key in a) || !(key in b)) return { path: trail ? `${trail}.${key}` : key, left: a[key], right: b[key] };
    const diff = firstDiff(a[key], b[key], trail ? `${trail}.${key}` : key);
    if (diff) return diff;
  }
  return null;
}

const left = readReport(leftPath);
const right = readReport(rightPath);
const leftFrames = byFrame(left);
const rightFrames = byFrame(right);
const commonFrames = [...leftFrames.keys()]
  .filter(frame => rightFrames.has(frame))
  .sort((a, b) => a - b);

console.log(`Left:  ${path.basename(leftPath)} side=${left.yourSide} mismatchFrame=${left.mismatch?.frame} snapshots=${left.snapshotCount}`);
console.log(`Right: ${path.basename(rightPath)} side=${right.yourSide} mismatchFrame=${right.mismatch?.frame} snapshots=${right.snapshotCount}`);
console.log(`Common frames: ${commonFrames.length}`);

if (commonFrames.length === 0) {
  console.log('No overlapping captured frames.');
  process.exit(0);
}

for (const frame of commonFrames) {
  const l = leftFrames.get(frame);
  const r = rightFrames.get(frame);
  if (l.checksum === r.checksum && l.i0 === r.i0 && l.i1 === r.i1) continue;
  console.log(`First checksum/input difference at frame ${frame}`);
  console.log(`  left:  checksum=${hex(l.checksum)} i0=${l.i0} i1=${l.i1} rng=${l.rngSeed}`);
  console.log(`  right: checksum=${hex(r.checksum)} i0=${r.i0} i1=${r.i1} rng=${r.rngSeed}`);
  const diff = firstDiff(l, r, 'snapshot');
  if (diff) {
    console.log(`  first field diff: ${diff.path}`);
    console.log(`    left:  ${JSON.stringify(diff.left)}`);
    console.log(`    right: ${JSON.stringify(diff.right)}`);
  }
  printInputTrace(left);
  process.exit(0);
}

for (const frame of commonFrames) {
  const diff = firstDiff(leftFrames.get(frame), rightFrames.get(frame), 'snapshot');
  if (!diff) continue;
  console.log(`First state difference at frame ${frame}`);
  console.log(`  first field diff: ${diff.path}`);
  console.log(`    left:  ${JSON.stringify(diff.left)}`);
  console.log(`    right: ${JSON.stringify(diff.right)}`);
  printInputTrace(left);
  process.exit(0);
}

console.log('No differences found in overlapping frames.');

function hex(value) {
  if (typeof value !== 'number') return String(value);
  return `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
}

function printInputTrace(report) {
  const trace = report.mismatch?.inputTrace ?? [];
  if (!trace.length) return;
  console.log('Server input trace near mismatch:');
  for (const entry of trace.slice(-20)) {
    console.log(`  side=${entry.side} frame=${entry.frame} input=${entry.input} status=${entry.status} expected=${entry.expectedFrame}`);
  }
}
