import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const scopePath = path.join(root, 'config/audit-scope.json');

if (!fs.existsSync(scopePath)) {
  console.error('config/audit-scope.json is missing.');
  process.exit(1);
}

const scope = JSON.parse(fs.readFileSync(scopePath, 'utf8'));

console.log('# System Audit Matrix');
console.log('');
console.log('| Area | Journey/API | Role | Environment | Test Type | Expected Result | Actual Result | Severity | Owner | Fix Status |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');

for (const workstream of scope.workstreams ?? []) {
  for (const item of workstream.items ?? []) {
    const [name, role, environment, testType, expected] = item;
    console.log(`| ${workstream.area} | ${name} | ${role} | ${environment} | ${testType} | ${expected} | TBD | TBD | TBD | Not started |`);
  }
}
