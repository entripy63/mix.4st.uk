#!/usr/bin/env node
// Rewrites `?v=...` query strings on <script src> / <link href> / etc. in an
// HTML file so the version is a short content-hash of the referenced local
// asset. Idempotent: re-running on unchanged assets produces unchanged output.
//
// Usage:  node tools/cache-bust.js [--write] [file.html ...]
//   Default file: player.html in the project root.
//   Without --write the rewritten HTML is printed to stdout.

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const write = args.includes('--write');
const files = args.filter((a) => !a.startsWith('--'));
if (files.length === 0) files.push('player.html');

// Match  src="X?v=Y"  or  href='X?v=Y'  where X has no '?' and Y has no quote.
// Captures: 1=attr, 2=quote, 3=path, 4=oldVersion
const RE = /\b(src|href)\s*=\s*(["'])([^"'?\s]+)\?v=([^"'\s]*)\2/g;

const hashCache = new Map();
function hashFor(absPath) {
  if (hashCache.has(absPath)) return hashCache.get(absPath);
  let h;
  try {
    const data = readFileSync(absPath);
    h = createHash('sha1').update(data).digest('hex').slice(0, 10);
  } catch {
    h = null; // file missing — leave version alone
  }
  hashCache.set(absPath, h);
  return h;
}

let touched = false;
for (const rel of files) {
  const htmlPath = resolve(PROJECT_ROOT, rel);
  const baseDir = dirname(htmlPath);
  const src = readFileSync(htmlPath, 'utf8');
  let changed = 0;
  let kept = 0;
  const out = src.replace(RE, (full, attr, quote, path, oldV) => {
    // Skip absolute URLs.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || path.startsWith('//')) return full;
    const assetPath = resolve(baseDir, path);
    const hash = hashFor(assetPath);
    if (!hash) {
      kept++;
      return full;
    }
    if (hash === oldV) {
      kept++;
      return full;
    }
    changed++;
    return `${attr}=${quote}${path}?v=${hash}${quote}`;
  });
  if (write) {
    if (out !== src) {
      writeFileSync(htmlPath, out);
      touched = true;
    }
    process.stderr.write(`cache-bust: ${rel}  (${changed} updated, ${kept} unchanged)\n`);
  } else {
    process.stdout.write(out);
  }
}

if (write && !touched) process.stderr.write('cache-bust: no changes\n');
