import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const strict = process.argv.includes('--strict') || process.env.AUDIT_STRICT === 'true';

function walk(relDir, predicate = () => true) {
  const absDir = path.join(root, relDir);
  if (!fs.existsSync(absDir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const relPath = path.join(relDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(relPath, predicate));
    } else if (predicate(relPath)) {
      results.push(relPath.replaceAll(path.sep, '/'));
    }
  }
  return results.sort();
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function unique(items) {
  return [...new Set(items)].sort();
}

function normalizeApiPath(value) {
  return value
    .replace(/\/\$\{[^}]+\}/g, '/:param')
    .replace(/\$\{[^}]+\}/g, '')
    .replace(/\/:[A-Za-z0-9_]+\?/g, '/:optional')
    .replace(/\?.*$/, '')
    .replace(/:[A-Za-z0-9_]+/g, ':param')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/';
}

function toRegex(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^${escaped.replaceAll('/:optional', '(?:/[^/]+)?').replaceAll(':param', '[^/]+')}$`,
  );
}

const serverRouteFiles = [
  ...walk('server/routes', (file) => file.endsWith('.routes.ts')),
  ...['server/index.ts'].filter((file) => fs.existsSync(path.join(root, file))),
];
const serverPatterns = [];

for (const file of serverRouteFiles) {
  const source = read(file);
  const directRoutes = [...source.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g)];
  for (const match of directRoutes) {
    serverPatterns.push({
      method: match[1].toUpperCase(),
      path: normalizeApiPath(match[2]),
      file,
    });
  }

  const routerRoutes = [...source.matchAll(/\brouter\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g)];
  const mounts = [...source.matchAll(/\bapp\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*router(?:\s+as\s+any)?/g)].map(
    (match) => match[1],
  );
  for (const mount of mounts) {
    for (const match of routerRoutes) {
      serverPatterns.push({
        method: match[1].toUpperCase(),
        path: normalizeApiPath(`${mount}${match[2] === '/' ? '' : match[2]}`),
        file,
      });
    }
  }
}

const clientFiles = walk('client/src', (file) => /\.(ts|tsx)$/.test(file));
const apiReferences = [];
for (const file of clientFiles) {
  const lines = read(file).split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.includes('invalidateQueries')) continue;

    const queryKeyMatch = line.match(/queryKey:\s*\[([^\]]+)\]/);
    if (queryKeyMatch) {
      const lookahead = lines.slice(index, index + 8).join('\n');
      if (/\bqueryFn\s*:/.test(lookahead)) continue;

      const queryKeyContent = queryKeyMatch[1].split('{')[0];
      const tokens = [...queryKeyContent.matchAll(/(['"`])([^'"`]+)\1|([A-Za-z_$][\w$?.]*)/g)]
        .map((match) => match[2] ?? match[3])
        .filter(Boolean);
      const apiIndex = tokens.findIndex((token) => token.startsWith('/api') || token.startsWith('/nra'));
      if (apiIndex >= 0) {
        const parts = [];
        for (const token of tokens.slice(apiIndex)) {
          if (token.startsWith('/api') || token.startsWith('/nra')) {
            parts.push(token);
          } else if (/^[A-Za-z_$]/.test(token)) {
            parts.push(':param');
          } else if (token.startsWith('/')) {
            parts.push(token.replace(/^\//, ''));
          } else {
            parts.push(token);
          }
        }
        const ref = parts.join('/').replace(/\/+/g, '/');
        apiReferences.push({ file, ref: normalizeApiPath(ref), raw: ref });
      }
      continue;
    }

    const matches = [...line.matchAll(/[`'"]((?:\/api|\/nra)\/[^`'"\s),>]*)/g)];
    for (const match of matches) {
      apiReferences.push({ file, ref: normalizeApiPath(match[1]), raw: match[1] });
    }
  }
}

const patterns = serverPatterns.map((route) => ({ ...route, regex: toRegex(route.path) }));
const unresolved = [];
for (const ref of unique(apiReferences.map((item) => `${item.file}|${item.ref}|${item.raw}`))) {
  const [file, refPath, raw] = ref.split('|');
  const refRegex = toRegex(refPath);
  const matched = patterns.some(
    (pattern) => pattern.regex.test(refPath) || refRegex.test(pattern.path),
  );
  if (!matched) unresolved.push({ file, ref: raw });
}

console.log(`Frontend API coverage checked ${apiReferences.length} references against ${serverPatterns.length} server patterns.`);
if (unresolved.length) {
  console.log('');
  console.log(`Unresolved API references (${unresolved.length}):`);
  for (const item of unresolved) console.log(`- ${item.file}: ${item.ref}`);
}

if (strict && unresolved.length) process.exit(1);
