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
let bearerToken = '';

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

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
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
    ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
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

async function checkJson(name, path, predicate, options = {}) {
  const response = await check(name, path, options);
  const body = await readJson(response);
  if (predicate && !predicate(body)) {
    throw new Error(`${name} returned an unexpected body: ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

await check('liveness', '/health/live');
await check('readiness', '/health/ready');
await checkJson('version', '/api/version', (body) => body?.status === 'ok' && body?.commit);

const loginBody = await checkJson('login', '/api/auth/login', (body) => body?.user?.id, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
bearerToken = loginBody?.token || loginBody?.accessToken || bearerToken;

await checkJson('auth session', '/api/auth/me', (body) => body?.id === loginBody.user.id);
await checkJson('firm clients', '/api/firm/clients', (body) => Array.isArray(body));
await checkJson('firm bookkeeper dashboard', '/api/firm/bookkeeper-dashboard', (body) => body?.summary && Array.isArray(body?.vatCohorts) && Array.isArray(body?.clients));
await checkJson('firm health', '/api/firm/health', (body) => Array.isArray(body?.clients) && body?.summary);
await checkJson('firm deadlines', '/api/firm/health/deadlines', (body) => Array.isArray(body));
await checkJson('firm comms log', '/api/firm/comms/log', (body) => Array.isArray(body?.data));
await checkJson('value ops dashboard', '/api/firm/value-ops', (body) => body?.summary && Array.isArray(body?.clients));
await checkJson('value ops action brief', '/api/firm/value-ops/action-brief', (body) => Array.isArray(body?.summary) && Array.isArray(body?.clientBriefs));
await checkJson('value ops review queue', '/api/firm/value-ops/review-queue', (body) => Array.isArray(body));
await checkJson('command center dashboard', '/api/firm/command-center/dashboard', (body) => body?.summary && Array.isArray(body?.clients));

console.log('production smoke checks passed');
