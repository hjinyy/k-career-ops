#!/usr/bin/env node

/**
 * setup-korea-ee.mjs — install the Korea electrical-engineering customization
 * into the user layer without touching upstream/system career-ops files.
 */

import { copyFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

const root = process.cwd();
const copies = [
  ['templates/cv.korea-ee.template.md', 'cv.md'],
  ['config/profile.korea-ee.example.yml', 'config/profile.yml'],
  ['templates/portals.korea-ee.example.yml', 'portals.yml'],
  ['modes/profile.korea-ee.template.md', 'modes/_profile.md'],
  ['modes/custom.korea-ee.template.md', 'modes/_custom.md'],
];

const force = process.argv.includes('--force');
const installed = [];
const skipped = [];

for (const [src, dest] of copies) {
  const source = path.join(root, src);
  const target = path.join(root, dest);
  if (!existsSync(source)) {
    throw new Error(`Missing template: ${src}`);
  }
  if (existsSync(target) && !force) {
    skipped.push(`${dest} (already exists; use --force to overwrite)`);
    continue;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  installed.push(dest);
}

console.log(JSON.stringify({ ok: true, installed, skipped }, null, 2));
