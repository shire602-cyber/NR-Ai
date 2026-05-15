import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const configPath = path.join(root, 'config/api-contract.json');

if (!fs.existsSync(configPath)) {
  console.error('config/api-contract.json is missing.');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const failures = [];

for (const contract of config.requiredServerContracts ?? []) {
  const filePath = path.join(root, contract.file);
  if (!fs.existsSync(filePath)) {
    failures.push(`${contract.name}: missing ${contract.file}`);
    continue;
  }

  const source = fs.readFileSync(filePath, 'utf8');
  for (const fragment of contract.mustContain ?? []) {
    if (!source.includes(fragment)) {
      failures.push(`${contract.name}: ${contract.file} does not contain ${fragment}`);
    }
  }
}

if (failures.length) {
  console.error('API contract check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`API contract check passed (${config.requiredServerContracts?.length ?? 0} contracts).`);
