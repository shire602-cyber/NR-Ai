import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const routesDir = path.join(root, 'server/routes');
const routesFile = path.join(root, 'server/routes.ts');
const registryFile = path.join(root, 'config/route-registry.json');

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function routeModuleName(filename) {
  return filename.replace(/\.routes\.ts$/, '');
}

const routeFiles = fs
  .readdirSync(routesDir)
  .filter((file) => file.endsWith('.routes.ts'))
  .map(routeModuleName)
  .sort();

const source = fs.readFileSync(routesFile, 'utf8');
const registered = new Set(
  [...source.matchAll(/from ['"]\.\/routes\/([^'"]+)\.routes['"]/g)].map((match) => match[1]),
);

const registry = readJson(registryFile);
const intentionallyUnregistered = new Set(registry.intentionallyUnregisteredRouteModules ?? []);

const missingFiles = [...registered].filter((moduleName) => !routeFiles.includes(moduleName));
const unregistered = routeFiles.filter(
  (moduleName) => !registered.has(moduleName) && !intentionallyUnregistered.has(moduleName),
);
const staleIntentional = [...intentionallyUnregistered].filter((moduleName) => !routeFiles.includes(moduleName));

if (missingFiles.length || unregistered.length || staleIntentional.length) {
  if (missingFiles.length) {
    console.error(
      `server/routes.ts imports route modules that do not exist: ${missingFiles.join(', ')}`,
    );
  }
  if (unregistered.length) {
    console.error(
      `Route modules are not registered in server/routes.ts: ${unregistered.join(', ')}`,
    );
    console.error(
      'Register them or add them to config/route-registry.json with a deliberate parked-feature reason.',
    );
  }
  if (staleIntentional.length) {
    console.error(
      `config/route-registry.json lists route modules that no longer exist: ${staleIntentional.join(', ')}`,
    );
  }
  process.exit(1);
}

console.log(`Route registration check passed (${routeFiles.length} modules).`);
