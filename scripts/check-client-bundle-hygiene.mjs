import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const clientRoot = join(root, 'client', 'src');
const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8');
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
const failures = [];

const limitMatch = viteConfig.match(/chunkSizeWarningLimit:\s*(\d+)/);
if (!limitMatch) {
  failures.push('vite.config.ts must set chunkSizeWarningLimit explicitly.');
} else if (Number(limitMatch[1]) > 500) {
  failures.push(`chunkSizeWarningLimit is ${limitMatch[1]}; keep it at or below 500 KB.`);
}

if (/npm ci[^\n]*\|\|\s*npm install/.test(dockerfile)) {
  failures.push('Dockerfile must fail fast on npm ci; remove npm install fallbacks so lockfile drift breaks the build.');
}

for (const file of walk(clientRoot)) {
  if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
  const source = readFileSync(file, 'utf8');
  if (/from ['"]exceljs['"]|import\(['"]exceljs['"]\)/.test(source)) {
    failures.push(`${relative(root, file)} imports exceljs in browser code. Use server-side XLSX routes instead.`);
  }
  if (/from ['"]pdfjs-dist['"]/.test(source)) {
    failures.push(`${relative(root, file)} statically imports pdfjs-dist. Use the lazy PDF loader so route chunks stay light.`);
  }
}

if (failures.length > 0) {
  console.error('Client bundle hygiene check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Client bundle hygiene check passed.');

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      yield* walk(path);
    } else {
      yield path;
    }
  }
}
