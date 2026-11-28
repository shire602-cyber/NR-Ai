#!/usr/bin/env node
// STEP2: fail when a production build still carries Saudi ZATCA. Scans the client bundle
// (dist/public/**/*.{js,css,html,json}) and the server bundles (dist/*.js). Run after `npm run build`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(root, "dist");
const BANNED = /zatca|fatoora|زاتكا|هيئة الزكاة/i;

if (!fs.existsSync(dist)) {
  console.error("check-no-zatca-bundle: dist/ not found; run `npm run build` first");
  process.exit(2);
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const files = [];
const publicDir = path.join(dist, "public");
if (fs.existsSync(publicDir)) {
  for (const f of walk(publicDir)) {
    if (/\.(js|css|html|json|map)$/.test(f)) files.push(f);
  }
}
for (const entry of fs.readdirSync(dist, { withFileTypes: true })) {
  if (entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name)) {
    files.push(path.join(dist, entry.name));
  }
}

let hits = 0;
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  const m = BANNED.exec(text);
  if (m) {
    hits += 1;
    const at = Math.max(0, m.index - 40);
    const around = text.slice(at, m.index + 60).replace(/\s+/g, " ");
    console.error(`ZATCA text in ${path.relative(root, f)}: ...${around}...`);
  }
}
console.log(`check-no-zatca-bundle: scanned ${files.length} files, ${hits} with ZATCA text`);
process.exit(hits ? 1 : 0);
