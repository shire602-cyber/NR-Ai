#!/usr/bin/env node

const baseUrl = (process.env.SMOKE_BASE_URL || process.argv[2] || '').replace(/\/$/, '');
const email = process.env.SMOKE_EMAIL;
const password = process.env.SMOKE_PASSWORD;
const expectedCommit = process.env.SMOKE_EXPECTED_COMMIT;
const readOnly = process.env.SMOKE_READ_ONLY === 'true';
const requireOAuthConfigured = process.env.SMOKE_REQUIRE_OAUTH_CONFIG === 'true';
const runWorkspaceMutations = process.env.SMOKE_WORKSPACE_MUTATIONS === 'true';

if (!baseUrl) {
  console.error('SMOKE_BASE_URL or first argument is required');
  process.exit(1);
}

if (!readOnly && (!email || !password)) {
  console.error('SMOKE_EMAIL and SMOKE_PASSWORD are required for protected-route smoke checks');
  process.exit(1);
}

const cookieJar = new Map();
let bearerToken = '';
let csrfToken = '';

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
  const method = (options.method || 'GET').toUpperCase();
  const headers = {
    ...(options.headers || {}),
    ...(cookieJar.size ? { Cookie: cookieHeader() } : {}),
    ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
    ...(csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? { 'x-csrf-token': csrfToken } : {}),
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
await checkJson('version', '/api/version', (body) => {
  if (body?.status !== 'ok' || !body?.commit) return false;
  if (expectedCommit && !String(body.commit).startsWith(expectedCommit)) return false;
  return true;
});
await checkJson('oauth providers', '/api/auth/oauth/providers', (body) => {
  if (!Array.isArray(body?.providers)) return false;
  const byId = new Map(body.providers.map((provider) => [provider?.id, provider]));
  const google = byId.get('google');
  const microsoft = byId.get('microsoft');
  if (!google || !microsoft) return false;
  if (requireOAuthConfigured) {
    return google.configured === true && microsoft.configured === true;
  }
  return typeof google.configured === 'boolean' && typeof microsoft.configured === 'boolean';
});

if (readOnly) {
  console.log('production read-only smoke checks passed');
  process.exit(0);
}

const loginBody = await checkJson('login', '/api/auth/login', (body) => body?.user?.id, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
bearerToken = loginBody?.token || loginBody?.accessToken || bearerToken;
const csrfBody = await checkJson('csrf token', '/api/csrf-token', (body) => body?.csrfToken);
csrfToken = csrfBody.csrfToken;

await checkJson('auth session', '/api/auth/me', (body) => body?.id === loginBody.user.id);
await checkJson('firm clients', '/api/firm/clients', (body) => Array.isArray(body));
await checkJson('firm bookkeeper dashboard', '/api/firm/bookkeeper-dashboard', (body) => body?.summary && Array.isArray(body?.vatCohorts) && Array.isArray(body?.clients));
await checkJson('firm health', '/api/firm/health', (body) => Array.isArray(body?.clients) && body?.summary);
await checkJson('firm deadlines', '/api/firm/health/deadlines', (body) => Array.isArray(body?.deadlines));
await checkJson('firm comms log', '/api/firm/comms/log', (body) => Array.isArray(body?.data));
await checkJson('value ops dashboard', '/api/firm/value-ops', (body) => body?.summary && Array.isArray(body?.clients));
await checkJson('value ops action brief', '/api/firm/value-ops/action-brief', (body) => Array.isArray(body?.summary) && Array.isArray(body?.clientBriefs));
await checkJson('value ops review queue', '/api/firm/value-ops/review-queue', (body) => Array.isArray(body));
await checkJson('command center dashboard', '/api/firm/command-center/dashboard', (body) => body?.summary && Array.isArray(body?.healthScores));
await checkJson('growth opportunities', '/api/firm/growth-opportunities', (body) => body?.summary && Array.isArray(body?.opportunities));
await checkJson('vat workpapers', '/api/firm/vat-workpapers', (body) => Array.isArray(body?.workpapers));

if (runWorkspaceMutations) {
  const clients = await checkJson('workspace mutation clients', '/api/firm/clients', (body) => Array.isArray(body) && body.length > 0);
  const companyId = process.env.SMOKE_COMPANY_ID || clients[0]?.id;
  if (!companyId) throw new Error('SMOKE_WORKSPACE_MUTATIONS requires an accessible firm client');

  await checkJson('growth opportunities refresh', '/api/firm/growth-opportunities/refresh', (body) => body?.summary && Array.isArray(body?.opportunities), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  const periodStart = process.env.SMOKE_VAT_PERIOD_START || '2026-01-01';
  const periodEnd = process.env.SMOKE_VAT_PERIOD_END || '2026-03-31';
  const dueDate = process.env.SMOKE_VAT_DUE_DATE || '2026-04-28';
  const workpaper = await checkJson('create/open VAT workpaper', '/api/firm/vat-workpapers', (body) => body?.id, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId, periodStart, periodEnd, dueDate, notes: 'Staging smoke workpaper' }),
  });

  const rowSeed = Date.now();
  await checkJson('add approved VAT row', `/api/firm/vat-workpapers/${workpaper.id}/rows`, (body) => body?.id && body?.status === 'approved', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rowCategory: 'standard_sale',
      invoiceNumber: `SMOKE-SALE-${rowSeed}`,
      documentDate: periodStart,
      counterpartyName: 'Smoke Customer',
      emirate: 'dubai',
      taxableAmount: 100,
      vatAmount: 5,
      grossAmount: 105,
      status: 'approved',
      sourceMethod: 'manual',
      notes: 'Staging smoke approved row',
    }),
  });

  const baselineRecalc = await checkJson('baseline VAT workpaper before OCR draft', `/api/firm/vat-workpapers/${workpaper.id}/recalculate`, (body) => body?.totals, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const baselineInputVat = Number(baselineRecalc?.totals?.box9ExpensesVat ?? 0);

  const draftRow = await checkJson('add OCR draft VAT row', `/api/firm/vat-workpapers/${workpaper.id}/scan`, (body) => body?.row?.id && body?.row?.status === 'draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attachment: {
        fileName: `smoke-${rowSeed}.txt`,
        mimeType: 'text/plain',
        fileDataBase64: Buffer.from(`Smoke VAT evidence upload ${rowSeed}`, 'utf8').toString('base64'),
        extractedText: 'Smoke OCR draft. This row must not count until approved.',
        extractionJson: { smoke: true },
      },
      draftRow: {
        rowCategory: 'standard_expense',
        invoiceNumber: `SMOKE-OCR-${rowSeed}`,
        documentDate: periodStart,
        counterpartyName: 'Smoke Supplier',
        taxableAmount: 200,
        vatAmount: 10,
        grossAmount: 210,
        notes: 'Staging smoke OCR draft row',
      },
    }),
  });
  if (!draftRow?.attachment?.id || !draftRow?.attachment?.filePath) {
    throw new Error('VAT OCR evidence file was not stored for download');
  }
  await check('download VAT evidence file', `/api/firm/vat-workpapers/${workpaper.id}/attachments/${draftRow.attachment.id}/download`);

  const recalculated = await checkJson('recalculate VAT workpaper excludes draft', `/api/firm/vat-workpapers/${workpaper.id}/recalculate`, (body) => body?.totals, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (Number(recalculated?.totals?.box9ExpensesVat ?? 0) !== baselineInputVat) {
    throw new Error('VAT OCR draft row counted before approval');
  }

  await checkJson('approve OCR draft row', `/api/firm/vat-workpapers/${workpaper.id}/rows/${draftRow.row.id}`, (body) => body?.status === 'approved', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'approved' }),
  });

  const approvedRecalc = await checkJson('recalculate VAT workpaper includes approved draft', `/api/firm/vat-workpapers/${workpaper.id}/recalculate`, (body) => body?.totals, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (Number(approvedRecalc?.totals?.box9ExpensesVat ?? 0) < baselineInputVat + 10) {
    throw new Error('Approved OCR draft row was not included in VAT totals');
  }

  await checkJson('generate VAT return from workpaper', `/api/firm/vat-workpapers/${workpaper.id}/generate-return`, (body) => body?.vatReturn?.id && /No FTA submission/i.test(body?.message || ''), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

console.log('production smoke checks passed');
