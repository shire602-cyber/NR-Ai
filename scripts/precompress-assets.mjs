#!/usr/bin/env node
// Brotli-compress the built client assets once, at the slowest setting (quality 11), next to the
// originals (`name.js` -> `name.js.br`). server/vite.ts serves the `.br` file to browsers that
// accept it, which is about 15% smaller than the quality-4 stream the compression middleware
// produces on the fly. Gzip and unsupported clients keep using the originals.
//
// Usage: node scripts/precompress-assets.mjs   (run after `vite build`; idempotent)

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDirs = ["assets", "firm-assets"].map((d) => join(root, "dist/public", d));
const MIN_BYTES = 1024;

let files = 0;
let before = 0;
let after = 0;
const names = assetsDirs.flatMap((dir) =>
  existsSync(dir) ? readdirSync(dir).map((name) => ({ dir, name })) : []
);
for (const { dir, name } of names) {
  if (!/\.(js|css)$/.test(name)) continue;
  const path = join(dir, name);
  if (statSync(path).size < MIN_BYTES) continue;
  const source = readFileSync(path);
  const packed = brotliCompressSync(source, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
    },
  });
  // Only keep it when it is actually smaller (it always is for text, but never serve a loss).
  if (packed.length >= source.length) continue;
  writeFileSync(`${path}.br`, packed);
  files++;
  before += source.length;
  after += packed.length;
}
console.log(
  `precompress-assets: ${files} files, ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB brotli`
);
