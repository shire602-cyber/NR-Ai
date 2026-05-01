import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

const storageMocks = vi.hoisted(() => ({
  createDocument: vi.fn(),
  createMessage: vi.fn(),
}));

vi.mock('../../server/middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'portal-user-1', email: 'portal@example.com', isAdmin: false, userType: 'client_portal' };
    next();
  },
}));

vi.mock('../../server/storage', () => ({
  storage: {
    getCompaniesByUserId: vi.fn(async () => [{ id: 'company-1', name: 'Client Co' }]),
    getDocuments: vi.fn(async () => []),
    getMessages: vi.fn(async () => []),
    createDocument: storageMocks.createDocument,
    createMessage: storageMocks.createMessage,
  },
}));

vi.mock('../../server/services/pdf-invoice.service', () => ({
  generateInvoicePDF: vi.fn(async () => Buffer.from('pdf')),
}));

import { registerClientPortalRoutes } from '../../server/routes/client-portal.routes';

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerClientPortalRoutes(app);
  return app;
}

async function request(app: express.Express, path: string): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === 'string' || !addr) throw new Error('no address');
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello', name: 'doc' }),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('client portal read-only writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects document uploads from portal users', async () => {
    const res = await request(appWithRoutes(), '/api/client-portal/documents');

    expect(res.status).toBe(405);
    expect(res.body.message).toMatch(/read-only/i);
    expect(storageMocks.createDocument).not.toHaveBeenCalled();
  });

  it('rejects message creation from portal users', async () => {
    const res = await request(appWithRoutes(), '/api/client-portal/messages');

    expect(res.status).toBe(405);
    expect(res.body.message).toMatch(/read-only/i);
    expect(storageMocks.createMessage).not.toHaveBeenCalled();
  });
});
