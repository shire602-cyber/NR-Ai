import express from 'express';
import type { Server } from 'http';
import { afterEach, describe, expect, it } from 'vitest';

import { authEmailKey, buildLimiter, type RouteLimit } from '../../server/middleware/rateLimit';

const servers: Server[] = [];

async function withServer(app: express.Express, run: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  await run(`http://127.0.0.1:${address.port}`);
}

async function postLogin(baseUrl: string, email: string, password = 'bad') {
  const response = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await response.json().catch(() => ({}));
  return { response, json };
}

function appWithLoginLimiter(limit: Partial<RouteLimit> = {}) {
  const app = express();
  app.use(express.json());
  app.use('/login', buildLimiter({
    windowMs: 60_000,
    max: 2,
    message: 'Limited',
    keyGenerator: authEmailKey,
    skipSuccessfulRequests: true,
    ...limit,
  }));
  app.post('/login', (req, res) => {
    if (req.body.password === 'correct') return res.json({ ok: true });
    return res.status(401).json({ message: 'Invalid credentials' });
  });
  return app;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('auth login rate limiting', () => {
  it('limits repeated failures for the same email', async () => {
    await withServer(appWithLoginLimiter(), async (baseUrl) => {
      expect((await postLogin(baseUrl, 'same@example.com')).response.status).toBe(401);
      expect((await postLogin(baseUrl, 'same@example.com')).response.status).toBe(401);

      const limited = await postLogin(baseUrl, 'same@example.com');
      expect(limited.response.status).toBe(429);
      expect(limited.json).toMatchObject({
        code: 'RATE_LIMITED',
        details: { retryAfterSeconds: expect.any(Number) },
      });
    });
  });

  it('does not block different emails sharing the same IP bucket', async () => {
    await withServer(appWithLoginLimiter(), async (baseUrl) => {
      expect((await postLogin(baseUrl, 'first@example.com')).response.status).toBe(401);
      expect((await postLogin(baseUrl, 'first@example.com')).response.status).toBe(401);
      expect((await postLogin(baseUrl, 'first@example.com')).response.status).toBe(429);

      expect((await postLogin(baseUrl, 'second@example.com')).response.status).toBe(401);
    });
  });

  it('does not count successful logins against the failed-attempt budget', async () => {
    await withServer(appWithLoginLimiter(), async (baseUrl) => {
      for (let i = 0; i < 5; i++) {
        expect((await postLogin(baseUrl, 'user@example.com', 'correct')).response.status).toBe(200);
      }

      expect((await postLogin(baseUrl, 'user@example.com')).response.status).toBe(401);
      expect((await postLogin(baseUrl, 'user@example.com')).response.status).toBe(401);
      expect((await postLogin(baseUrl, 'user@example.com')).response.status).toBe(429);
    });
  });

  it('returns a retryAfterSeconds value based on the sliding reset time', async () => {
    await withServer(appWithLoginLimiter({ windowMs: 2_200, max: 1 }), async (baseUrl) => {
      expect((await postLogin(baseUrl, 'timer@example.com')).response.status).toBe(401);

      const firstLimited = await postLogin(baseUrl, 'timer@example.com');
      expect(firstLimited.response.status).toBe(429);
      expect(firstLimited.json.details.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(firstLimited.json.details.retryAfterSeconds).toBeLessThanOrEqual(3);

      await new Promise((resolve) => setTimeout(resolve, 1_250));

      const secondLimited = await postLogin(baseUrl, 'timer@example.com');
      expect(secondLimited.response.status).toBe(429);
      expect(secondLimited.json.details.retryAfterSeconds).toBeLessThan(firstLimited.json.details.retryAfterSeconds);
    });
  });

  it('can exclude read-only auth routes from stricter route buckets', async () => {
    const app = express();
    app.use('/api/auth', buildLimiter({
      windowMs: 60_000,
      max: 1,
      message: 'Limited',
      skip: (req) => req.method === 'GET' && req.originalUrl === '/api/auth/me',
    }));
    app.get('/api/auth/me', (_req, res) => res.json({ ok: true }));
    app.get('/api/auth/other', (_req, res) => res.json({ ok: true }));

    await withServer(app, async (baseUrl) => {
      for (let i = 0; i < 5; i++) {
        const response = await fetch(`${baseUrl}/api/auth/me`);
        expect(response.status).toBe(200);
      }

      expect((await fetch(`${baseUrl}/api/auth/other`)).status).toBe(200);
      expect((await fetch(`${baseUrl}/api/auth/other`)).status).toBe(429);
    });
  });
});
