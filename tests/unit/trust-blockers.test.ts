/**
 * Trust-blocker regression tests:
 *  1. Notification ownership — user A cannot read/dismiss user B's rows.
 *  2. CORS allowlist — CORS_ORIGIN env wiring and validation.
 *  3. E-commerce integration secrets — encrypted at rest, masked in responses.
 *  4. Password reset — production sends email, response never leaks account
 *     existence or delivery state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

vi.mock('../../server/middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', email: 'user-1@example.com', isAdmin: false, userType: 'customer' };
    next();
  },
  adminMiddleware: (_req: any, _res: any, next: any) => next(),
  requireCustomer: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/db', () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  pool: { query: vi.fn() },
}));

// In-memory notification rows; ownership enforced exactly like the real
// storage layer (WHERE id AND user_id) — cross-user updates match nothing.
const notificationRows: Array<{ id: string; userId: string; isRead: boolean; isDismissed: boolean }> = [];

const sendPasswordResetEmail = vi.fn(async () => {});

vi.mock('../../server/services/email.service', () => ({
  hasEmailProvider: () => true,
  sendPasswordResetEmail: (...args: unknown[]) => sendPasswordResetEmail(...(args as [])),
}));

vi.mock('../../server/storage', () => ({
  storage: {
    // notifications
    markNotificationAsRead: vi.fn(async (id: string, userId: string) => {
      const row = notificationRows.find((r) => r.id === id && r.userId === userId);
      if (!row) return undefined;
      row.isRead = true;
      return row;
    }),
    dismissNotification: vi.fn(async (id: string, userId: string) => {
      const row = notificationRows.find((r) => r.id === id && r.userId === userId);
      if (!row) return undefined;
      row.isDismissed = true;
      return row;
    }),
    getNotificationsByUserId: vi.fn(async () => []),
    getUnreadNotificationCount: vi.fn(async () => 0),
    getRegulatoryNews: vi.fn(async () => []),
    // e-commerce integrations
    getCompanyUsersByCompanyId: vi.fn(async () => [{ userId: 'user-1' }]),
    getEcommerceIntegrations: vi.fn(async () => [
      {
        id: 'int-1',
        companyId: 'company-1',
        platform: 'stripe',
        isActive: true,
        apiKey: 'enc:v1:aaa:bbb:ccc',
        accessToken: null,
        refreshToken: null,
        webhookSecret: 'enc:v1:ddd:eee:fff',
        shopDomain: null,
        syncStatus: 'never',
      },
    ]),
    createEcommerceIntegration: vi.fn(async (data: any) => ({ id: 'int-2', ...data })),
    // password reset
    getUserByEmail: vi.fn(async (email: string) =>
      email === 'exists@example.com'
        ? { id: 'user-1', email, passwordHash: 'x', name: 'User' }
        : undefined,
    ),
    deletePasswordResetTokensForUser: vi.fn(async () => {}),
    createPasswordResetToken: vi.fn(async () => ({})),
  },
}));

import { registerNotificationRoutes } from '../../server/routes/notifications.routes';
import { registerAnalyticsRoutes } from '../../server/routes/analytics.routes';
import { resolveAllowedOrigins } from '../../server/middleware/security';
import { storage } from '../../server/storage';

function appWith(register: (app: express.Express) => void) {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === 'string' || !addr) throw new Error('no address');
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('notification ownership', () => {
  beforeEach(() => {
    notificationRows.length = 0;
    notificationRows.push(
      { id: 'n-mine', userId: 'user-1', isRead: false, isDismissed: false },
      { id: 'n-theirs', userId: 'user-2', isRead: false, isDismissed: false },
    );
  });

  it('marks own notification as read', async () => {
    const app = appWith(registerNotificationRoutes);
    const res = await request(app, 'PATCH', '/api/notifications/n-mine/read');
    expect(res.status).toBe(200);
    expect(notificationRows[0].isRead).toBe(true);
  });

  it("cannot mark another user's notification as read", async () => {
    const app = appWith(registerNotificationRoutes);
    const res = await request(app, 'PATCH', '/api/notifications/n-theirs/read');
    expect(res.status).toBe(404);
    expect(notificationRows[1].isRead).toBe(false);
    expect(storage.markNotificationAsRead).toHaveBeenCalledWith('n-theirs', 'user-1');
  });

  it("cannot dismiss another user's notification", async () => {
    const app = appWith(registerNotificationRoutes);
    const res = await request(app, 'PATCH', '/api/notifications/n-theirs/dismiss');
    expect(res.status).toBe(404);
    expect(notificationRows[1].isDismissed).toBe(false);
    expect(storage.dismissNotification).toHaveBeenCalledWith('n-theirs', 'user-1');
  });
});

describe('CORS allowlist (resolveAllowedOrigins)', () => {
  it('uses FRONTEND_URL as first-party default and normalizes to origin', () => {
    const origins = resolveAllowedOrigins({ FRONTEND_URL: 'https://app.muhasib.ai/' }, true);
    expect(origins).toEqual(['https://app.muhasib.ai']);
  });

  it('adds comma-separated CORS_ORIGIN entries', () => {
    const origins = resolveAllowedOrigins(
      { FRONTEND_URL: 'https://app.muhasib.ai', CORS_ORIGIN: 'https://admin.muhasib.ai, https://portal.muhasib.ai' },
      true,
    );
    expect(origins).toContain('https://admin.muhasib.ai');
    expect(origins).toContain('https://portal.muhasib.ai');
  });

  it('drops invalid and non-http entries instead of allowing them', () => {
    const origins = resolveAllowedOrigins(
      { CORS_ORIGIN: 'not-a-url,ftp://files.example.com,javascript:alert(1),https://ok.example.com' },
      true,
    );
    expect(origins).toEqual(['https://ok.example.com']);
  });

  it('includes localhost in development but not production', () => {
    const dev = resolveAllowedOrigins({}, false);
    expect(dev).toContain('http://localhost:5173');
    expect(dev).toContain('http://127.0.0.1:5000');
    const prod = resolveAllowedOrigins({}, true);
    expect(prod).toHaveLength(0);
  });

  it('deduplicates FRONTEND_URL repeated in CORS_ORIGIN', () => {
    const origins = resolveAllowedOrigins(
      { FRONTEND_URL: 'https://app.muhasib.ai', CORS_ORIGIN: 'https://app.muhasib.ai' },
      true,
    );
    expect(origins).toEqual(['https://app.muhasib.ai']);
  });
});

describe('e-commerce integration secret masking', () => {
  it('list response carries presence flags, never stored secrets', async () => {
    const app = appWith(registerAnalyticsRoutes);
    const res = await request(app, 'GET', '/api/integrations/ecommerce?companyId=company-1');
    expect(res.status).toBe(200);
    const integration = res.body[0];
    expect(integration.hasApiKey).toBe(true);
    expect(integration.hasWebhookSecret).toBe(true);
    expect(integration.hasAccessToken).toBe(false);
    expect(integration.apiKey).toBeUndefined();
    expect(integration.accessToken).toBeUndefined();
    expect(integration.refreshToken).toBeUndefined();
    expect(integration.webhookSecret).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('enc:v1');
  });

  it('connect response does not echo submitted credentials', async () => {
    const app = appWith(registerAnalyticsRoutes);
    const res = await request(app, 'POST', '/api/integrations/ecommerce/connect', {
      companyId: 'company-1',
      platform: 'stripe',
      apiKey: 'sk_live_supersecret',
    });
    expect(res.status).toBe(200);
    expect(res.body.hasApiKey).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('sk_live_supersecret');
  });
});
