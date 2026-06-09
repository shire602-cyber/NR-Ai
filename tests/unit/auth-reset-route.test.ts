import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearAuthCookies: vi.fn(),
  deletePasswordResetTokensForUser: vi.fn(),
  findValidPasswordResetToken: vi.fn(),
  markPasswordResetTokenUsed: vi.fn(),
  revokeUserRefreshSessions: vi.fn(),
  updateUserPassword: vi.fn(),
}));

vi.mock('../../server/middleware/auth', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  generateToken: vi.fn(() => 'access-token'),
}));

vi.mock('../../server/services/auth-cookies.service', () => ({
  clearAuthCookies: mocks.clearAuthCookies,
  getAccessTokenFromRequest: vi.fn(() => null),
  getRefreshTokenFromRequest: vi.fn(() => null),
  sessionMetaFromRequest: vi.fn(() => ({ userAgent: null, ipAddress: null })),
  setAuthCookies: vi.fn(),
}));

vi.mock('../../server/services/auth-tokens.service', () => ({
  blacklistToken: vi.fn(),
  consumeEmailVerificationToken: vi.fn(),
  createEmailVerificationToken: vi.fn(),
  createRefreshSession: vi.fn(async () => ({
    token: 'refresh-token',
    expiresAt: new Date(Date.now() + 60_000),
  })),
  revokeRefreshSession: vi.fn(),
  revokeUserRefreshSessions: mocks.revokeUserRefreshSessions,
  rotateRefreshSession: vi.fn(),
}));

vi.mock('../../server/services/oauth.service', () => ({
  assertOAuthEmailVerifiedForAccountLink: vi.fn(),
  consumeOAuthState: vi.fn(),
  createOAuthAuthorizationUrl: vi.fn(),
  exchangeOAuthCallback: vi.fn(),
  getAuthIdentity: vi.fn(),
  getOAuthProviderInfo: vi.fn(() => []),
  getUserByNormalizedOAuthEmail: vi.fn(),
  isOAuthProviderId: vi.fn(() => false),
  linkAuthIdentity: vi.fn(),
  markOAuthLogin: vi.fn(),
  oauthCallbackFailureUrl: vi.fn(() => 'https://app.muhasib.test/login?oauth_error=1'),
  oauthCallbackSuccessUrl: vi.fn(() => 'https://app.muhasib.test/auth/callback'),
  oauthRedirectUri: vi.fn(() => 'https://app.muhasib.test/api/auth/oauth/google/callback'),
}));

vi.mock('../../server/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
  },
}));

vi.mock('../../server/storage', () => ({
  storage: {
    createActivityLog: vi.fn(),
    createCompany: vi.fn(),
    createCompanyUser: vi.fn(),
    createPasswordResetToken: vi.fn(),
    createReferral: vi.fn(),
    createSubscription: vi.fn(),
    createUser: vi.fn(),
    deletePasswordResetTokensForUser: mocks.deletePasswordResetTokensForUser,
    findValidPasswordResetToken: mocks.findValidPasswordResetToken,
    getInvitationByToken: vi.fn(),
    getReferralByCodeAndEmail: vi.fn(),
    getReferralCodeByCode: vi.fn(),
    getUser: vi.fn(),
    getUserByEmail: vi.fn(),
    markPasswordResetTokenUsed: mocks.markPasswordResetTokenUsed,
    updateInvitationStatus: vi.fn(),
    updateReferral: vi.fn(),
    updateReferralCode: vi.fn(),
    updateUserPassword: mocks.updateUserPassword,
  },
}));

import { registerAuthRoutes } from '../../server/routes/auth.routes';

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerAuthRoutes(app);
  return app;
}

async function post(app: express.Express, path: string, body: unknown): Promise<{ status: number; body: any }> {
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('password reset route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findValidPasswordResetToken.mockResolvedValue({
      id: 'reset-token-1',
      userId: 'user-1',
    });
  });

  it('revokes refresh sessions after a successful password reset', async () => {
    const res = await post(appWithRoutes(), '/api/auth/reset-password', {
      token: 'a'.repeat(32),
      password: 'new-password',
    });

    expect(res.status).toBe(200);
    expect(mocks.updateUserPassword).toHaveBeenCalledWith('user-1', expect.any(String));
    expect(mocks.markPasswordResetTokenUsed).toHaveBeenCalledWith('reset-token-1');
    expect(mocks.deletePasswordResetTokensForUser).toHaveBeenCalledWith('user-1');
    expect(mocks.revokeUserRefreshSessions).toHaveBeenCalledWith('user-1');
    expect(mocks.clearAuthCookies).toHaveBeenCalled();
  });
});
