import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Environment Validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should accept valid environment variables', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db';
    process.env.SESSION_SECRET = 'a'.repeat(32);
    process.env.JWT_SECRET = 'b'.repeat(32);
    process.env.NODE_ENV = 'test';
    process.env.PORT = '5000';

    const { validateEnv } = await import('../../server/config/env');
    const env = validateEnv();

    expect(env.DATABASE_URL).toBe('postgresql://user:pass@host:5432/db');
    expect(env.PORT).toBe(5000);
    expect(env.NODE_ENV).toBe('test');
  });

  it('should reject missing DATABASE_URL', async () => {
    delete process.env.DATABASE_URL;
    process.env.SESSION_SECRET = 'a'.repeat(32);
    process.env.JWT_SECRET = 'b'.repeat(32);

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    const { validateEnv } = await import('../../server/config/env');

    expect(() => validateEnv()).toThrow('process.exit called');
    mockExit.mockRestore();
  });

  it('should reject short SESSION_SECRET', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db';
    process.env.SESSION_SECRET = 'tooshort';
    process.env.JWT_SECRET = 'b'.repeat(32);

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    const { validateEnv } = await import('../../server/config/env');

    expect(() => validateEnv()).toThrow('process.exit called');
    mockExit.mockRestore();
  });

  it('should default NODE_ENV to development', async () => {
    delete process.env.NODE_ENV;
    process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db';
    process.env.SESSION_SECRET = 'a'.repeat(32);
    process.env.JWT_SECRET = 'b'.repeat(32);

    const { validateEnv } = await import('../../server/config/env');
    const env = validateEnv();

    expect(env.NODE_ENV).toBe('development');
  });

  it('should default PORT to 5000', async () => {
    delete process.env.PORT;
    process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db';
    process.env.SESSION_SECRET = 'a'.repeat(32);
    process.env.JWT_SECRET = 'b'.repeat(32);

    const { validateEnv } = await import('../../server/config/env');
    const env = validateEnv();

    expect(env.PORT).toBe(5000);
  });
});
