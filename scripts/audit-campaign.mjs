import { spawnSync } from 'node:child_process';
import process from 'node:process';

const skipBuild = process.argv.includes('--skip-build');
const skipTests = process.argv.includes('--skip-tests');
const includeDevAudit = process.argv.includes('--include-dev-audit');

const steps = [
  ['npm', ['run', 'check']],
  ['npm', ['run', 'check:api-contract']],
  ['npm', ['run', 'audit:inventory', '--', '--summary']],
  ['npm', ['run', 'audit:api-coverage']],
  ['npm', ['audit', '--omit=dev', '--audit-level=moderate']],
];

if (!skipTests) steps.push(['npm', ['test']]);
if (!skipBuild) steps.push(['npm', ['run', 'build']]);
if (includeDevAudit) steps.push(['npm', ['audit', '--audit-level=moderate']]);

let failed = 0;
for (const [command, args] of steps) {
  const label = `${command} ${args.join(' ')}`;
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    failed++;
    console.error(`FAILED: ${label}`);
  }
}

if (failed) {
  console.error(`\nAudit campaign failed ${failed} step(s).`);
  process.exit(1);
}

console.log('\nAudit campaign baseline passed.');
