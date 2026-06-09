import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

// Verifies the auth ROUTE wiring for the email fix (the helpers themselves are
// covered in email-auth.test.ts). The audit fix made forgot-password actually
// dispatch an email with an ABSOLUTE link (was log-only + host-less env.APP_URL),
// while preserving email-enumeration safety and never 500-ing on a mail outage.
const state = vi.hoisted(() => ({
  user: { id: 'user-1', email: 'user@example.com', name: 'User' } as Record<string, unknown> | undefined,
  resetSpy: vi.fn(async () => ({ sent: true, provider: 'resend' as const })),
}));

vi.mock('../../server/middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { req.user = { id: 'user-1' }; next(); },
  generateToken: vi.fn(() => 'tok'),
}));
vi.mock('../../server/services/oauth.service', () => ({
  frontendBaseUrl: () => 'https://app.muhasib.test',
}));
vi.mock('../../server/services/email.service', () => ({
  sendPasswordResetEmail: (...args: any[]) => state.resetSpy(...args),
  sendVerificationEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock('../../server/storage', () => ({
  storage: {
    getUserByEmail: vi.fn(async () => state.user),
    deletePasswordResetTokensForUser: vi.fn(async () => {}),
    createPasswordResetToken: vi.fn(async () => ({ id: 'prt-1' })),
  },
}));

import { registerAuthRoutes } from '../../server/routes/auth.routes';

function buildApp() {
  const app = express();
  app.use(express.json());
  registerAuthRoutes(app);
  return app;
}

async function post(path: string, body: unknown) {
  const app = buildApp();
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === 'string' || !addr) throw new Error('no address');
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe('POST /api/auth/forgot-password email wiring', () => {
  beforeEach(() => {
    state.user = { id: 'user-1', email: 'user@example.com', name: 'User' };
    state.resetSpy = vi.fn(async () => ({ sent: true, provider: 'resend' as const }));
  });

  it('dispatches a reset email with an ABSOLUTE frontend URL for a known user', async () => {
    const res = await post('/api/auth/forgot-password', { email: 'user@example.com' });
    expect(res.status).toBe(200);
    expect(state.resetSpy).toHaveBeenCalledOnce();
    const [to, url] = state.resetSpy.mock.calls[0];
    expect(to).toBe('user@example.com');
    expect(url).toMatch(/^https:\/\/app\.muhasib\.test\/reset-password\?token=/);
    // generic response, never reveals send outcome
    expect(res.body.message).toMatch(/if that email is registered/i);
    expect(res.body).not.toHaveProperty('sent');
  });

  it('is email-enumeration safe: unknown user gets the same generic 200 and no email is sent', async () => {
    state.user = undefined;
    const res = await post('/api/auth/forgot-password', { email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if that email is registered/i);
    expect(state.resetSpy).not.toHaveBeenCalled();
  });

  it('never 500s when the mail provider throws (best-effort send)', async () => {
    state.resetSpy = vi.fn(async () => { throw new Error('smtp down'); });
    const res = await post('/api/auth/forgot-password', { email: 'user@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if that email is registered/i);
  });
});
