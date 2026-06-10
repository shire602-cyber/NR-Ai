import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const asMarkdown = process.argv.includes('--markdown');
const summaryOnly = process.argv.includes('--summary');

function read(relPath) {
  const fullPath = path.join(root, relPath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
}

function walk(relDir, predicate = () => true) {
  const absDir = path.join(root, relDir);
  if (!fs.existsSync(absDir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const relPath = path.join(relDir, entry.name);
    if (entry.isDirectory()) results.push(...walk(relPath, predicate));
    else if (predicate(relPath)) results.push(relPath.replaceAll(path.sep, '/'));
  }
  return results.sort();
}

function unique(items) {
  return [...new Set(items)].sort();
}

function extractMatches(source, regex, group = 1) {
  return [...source.matchAll(regex)].map((match) => match[group]).filter(Boolean);
}

function parseJson(relPath, fallback) {
  try {
    return JSON.parse(read(relPath));
  } catch {
    return fallback;
  }
}

const appSource = read('client/src/App.tsx');
const routeSource = read('server/routes.ts');
const packageJson = parseJson('package.json', { scripts: {}, dependencies: {}, devDependencies: {} });
const routeRegistry = parseJson('config/route-registry.json', {
  intentionallyUnregisteredRouteModules: [],
});

const pageFiles = walk('client/src/pages', (file) => /\.(tsx|ts)$/.test(file));
const serverRouteFiles = walk('server/routes', (file) => file.endsWith('.routes.ts'));
const serviceFiles = walk('server/services', (file) => /\.(ts|js)$/.test(file));
const testFiles = walk('tests', (file) => /\.(test\.)?(ts|tsx|js|sh)$/.test(file));
const scriptFiles = walk('scripts', (file) => /\.(mjs|js|ts|sh)$/.test(file));
const migrationFiles = walk('migrations', (file) => /\.(sql|json)$/.test(file));

const frontendRoutes = unique(extractMatches(appSource, /<Route\s+path=["']([^"']+)["']/g));
const registeredRouteModules = unique(
  extractMatches(routeSource, /from ['"]\.\/routes\/([^'"]+)\.routes['"]/g),
);
const routeModules = serverRouteFiles.map((file) => path.basename(file).replace(/\.routes\.ts$/, ''));

const serverRoutes = [];
for (const file of serverRouteFiles) {
  const source = read(file);
  const routes = extractMatches(
    source,
    /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g,
    2,
  );
  const mounts = extractMatches(source, /\bapp\.use\(\s*['"`]([^'"`]+)['"`]/g);
  serverRoutes.push({
    file,
    module: path.basename(file).replace(/\.routes\.ts$/, ''),
    registered: registeredRouteModules.includes(path.basename(file).replace(/\.routes\.ts$/, '')),
    mounts,
    routes: unique(routes),
  });
}

const clientFiles = walk('client/src', (file) => /\.(ts|tsx)$/.test(file));
const apiReferences = [];
const apiRegex = /[`'"]((?:\/api|\/nra)\/[^`'"\s),>]*)/g;
for (const file of clientFiles) {
  const refs = unique(extractMatches(read(file), apiRegex));
  for (const ref of refs) apiReferences.push({ file, ref });
}

const envVars = unique(extractMatches(read('server/config/env.ts'), /\b([A-Z][A-Z0-9_]+):\s*z\./g));
const backgroundJobs = unique(
  serviceFiles.filter((file) => /scheduler|cron|notification|socket|webhook|chasing|autopilot/i.test(file)),
);
const integrations = unique(
  [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...serviceFiles.map((file) => path.basename(file).replace(/\.(service\.)?ts$/, '')),
  ].filter((name) =>
    /openai|anthropic|stripe|whatsapp|google|resend|nodemailer|redis|socket|tesseract|pdf|excel|bank|webhook|push/i.test(
      name,
    ),
  ),
);

const inventory = {
  repo: path.basename(root),
  generatedAt: new Date().toISOString(),
  counts: {
    frontendPages: pageFiles.length,
    frontendRoutes: frontendRoutes.length,
    backendRouteModules: routeModules.length,
    registeredBackendRouteModules: registeredRouteModules.length,
    intentionallyUnregisteredRouteModules:
      routeRegistry.intentionallyUnregisteredRouteModules?.length ?? 0,
    serverRouteDeclarations: serverRoutes.reduce((sum, item) => sum + item.routes.length, 0),
    clientApiReferences: apiReferences.length,
    services: serviceFiles.length,
    tests: testFiles.length,
    migrations: migrationFiles.length,
    scripts: scriptFiles.length,
    envVars: envVars.length,
  },
  frontendRoutes,
  registeredRouteModules,
  intentionallyUnregisteredRouteModules:
    routeRegistry.intentionallyUnregisteredRouteModules ?? [],
  unregisteredRouteModules: routeModules.filter(
    (moduleName) =>
      !registeredRouteModules.includes(moduleName) &&
      !(routeRegistry.intentionallyUnregisteredRouteModules ?? []).includes(moduleName),
  ),
  serverRoutes,
  apiReferences,
  envVars,
  backgroundJobs,
  integrations,
  scripts: Object.keys(packageJson.scripts ?? {}).sort(),
};

if (!asMarkdown) {
  console.log(JSON.stringify(inventory, null, 2));
  process.exit(inventory.unregisteredRouteModules.length ? 1 : 0);
}

console.log(`# Audit Inventory - ${inventory.repo}`);
console.log('');
console.log(`Generated: ${inventory.generatedAt}`);
console.log('');
console.log('| Metric | Count |');
console.log('| --- | ---: |');
for (const [key, value] of Object.entries(inventory.counts)) console.log(`| ${key} | ${value} |`);

if (summaryOnly) process.exit(inventory.unregisteredRouteModules.length ? 1 : 0);

console.log('');
console.log('## Frontend Routes');
for (const route of inventory.frontendRoutes) console.log(`- ${route}`);

console.log('');
console.log('## Backend Route Modules');
for (const moduleName of inventory.registeredRouteModules) console.log(`- ${moduleName}`);

if (inventory.intentionallyUnregisteredRouteModules.length) {
  console.log('');
  console.log('## Intentionally Parked Backend Route Modules');
  for (const moduleName of inventory.intentionallyUnregisteredRouteModules) console.log(`- ${moduleName}`);
}

console.log('');
console.log('## Environment Variables');
for (const envVar of inventory.envVars) console.log(`- ${envVar}`);

console.log('');
console.log('## Background Jobs And Integrations');
for (const job of inventory.backgroundJobs) console.log(`- ${job}`);
for (const integration of inventory.integrations) console.log(`- ${integration}`);
