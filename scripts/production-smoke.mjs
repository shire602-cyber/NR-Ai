#!/usr/bin/env node

const baseUrl = (process.env.SMOKE_BASE_URL || process.argv[2] || '').replace(/\/$/, '');
const email = process.env.SMOKE_EMAIL;
const password = process.env.SMOKE_PASSWORD;

if (!baseUrl) {
  console.error('SMOKE_BASE_URL or first argument is required');
  process.exit(1);
}

if (!email || !password) {
  console.error('SMOKE_EMAIL and SMOKE_PASSWORD are required for protected-route smoke checks');
  process.exit(1);
}

const cookieJar = new Map();

function rememberCookies(headers) {
  const raw = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : headers.get('set-cookie')
      ? [headers.get('set-cookie')]
      : [];

  for (const header of raw) {
    const [pair] = header.split(';');
    const [name, value] = pair.split('=');
    if (name && value !== undefined) cookieJar.set(name.trim(), value.trim());
  }
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function check(name, path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = {
    ...(options.headers || {}),
    ...(cookieJar.size ? { Cookie: cookieHeader() } : {}),
  };
  const response = await fetch(url, { ...options, headers });
  rememberCookies(response.headers);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${name} failed: ${response.status} ${response.statusText} ${body.slice(0, 300)}`);
  }

  console.log(`ok: ${name}`);
  return response;
}

await check('liveness', '/health/live');
await check('readiness', '/health/ready');

await check('login', '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});

await check('firm clients', '/api/firm/clients');
await check('value ops dashboard', '/api/firm/value-ops');
await check('value ops action brief', '/api/firm/value-ops/action-brief');
await check('value ops review queue', '/api/firm/value-ops/review-queue');

console.log('production smoke checks passed');
