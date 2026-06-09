import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';

// The audit found every bcrypt hash site used cost factor 10. OWASP recommends
// >= 12. These tests pin the configured cost to a single env-driven source of
// truth (server/config/bcrypt.ts -> BCRYPT_COST) with a hard floor of 12.
describe('BCRYPT_COST configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db';
    process.env.SESSION_SECRET = 'a'.repeat(32);
    process.env.JWT_SECRET = 'b'.repeat(32);
    process.env.NODE_ENV = 'test';
    delete process.env.BCRYPT_COST;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('defaults to 12 when BCRYPT_COST is unset', async () => {
    const { BCRYPT_COST } = await import('../../server/config/bcrypt');
    expect(BCRYPT_COST).toBe(12);
    expect(BCRYPT_COST).toBeGreaterThanOrEqual(12);
  });

  it('honours a valid BCRYPT_COST override from the environment', async () => {
    process.env.BCRYPT_COST = '13';
    const { BCRYPT_COST } = await import('../../server/config/bcrypt');
    expect(BCRYPT_COST).toBe(13);
  });

  it('rejects a BCRYPT_COST below the security floor (12) at startup', async () => {
    process.env.BCRYPT_COST = '10';
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const { validateEnv } = await import('../../server/config/env');
    expect(() => validateEnv()).toThrow('process.exit called');
    mockExit.mockRestore();
  });

  it('produces hashes at the configured cost and verifies them', async () => {
    const { BCRYPT_COST } = await import('../../server/config/bcrypt');
    const hash = await bcrypt.hash('correct horse battery staple', BCRYPT_COST);
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare('correct horse battery staple', hash)).toBe(true);
  });

  it('still verifies legacy cost-10 hashes (no forced re-hash needed)', async () => {
    // Existing users were hashed at cost 10; raising the configured cost must
    // not lock them out — bcrypt encodes the cost in the hash itself.
    const legacy = await bcrypt.hash('legacy-password', 10);
    expect(legacy).toMatch(/^\$2[aby]\$10\$/);
    expect(await bcrypt.compare('legacy-password', legacy)).toBe(true);
  });
});
