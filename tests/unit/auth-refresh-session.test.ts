import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = vi.hoisted(() => ({
  selectRows: [] as any[][],
  insertValues: [] as any[],
  updateSets: [] as any[],
  executedSql: [] as string[],
  transactionCount: 0,
}));

vi.mock('../../server/db', () => {
  const db: any = {
    insert: vi.fn(() => ({
      values: vi.fn(async (values: any) => {
        dbState.insertValues.push(values);
        return [];
      }),
      onConflictDoNothing: vi.fn(async () => []),
    })),
    update: vi.fn(() => ({
      set: vi.fn((data: any) => ({
        where: vi.fn(async (where: any) => {
          dbState.updateSets.push({ data, where });
          return { rowCount: 1 };
        }),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => dbState.selectRows.shift() ?? []),
      })),
    })),
    execute: vi.fn(async (query: any) => {
      const text = typeof query === 'string'
        ? query
        : Array.isArray(query?.queryChunks)
          ? query.queryChunks.map((chunk: any) => Array.isArray(chunk?.value) ? chunk.value.join('') : String(chunk)).join('')
          : String(query?.sql ?? query);
      dbState.executedSql.push(text);
      return { rows: dbState.selectRows.shift() ?? [] };
    }),
    delete: vi.fn(() => ({
      where: vi.fn(async () => ({ rowCount: 0 })),
    })),
  };

  db.transaction = vi.fn(async (callback: (tx: any) => Promise<any>) => {
    dbState.transactionCount++;
    return callback(db);
  });

  return { db };
});

import {
  createRefreshSession,
  hashToken,
  revokeRefreshSession,
  rotateRefreshSession,
} from '../../server/services/auth-tokens.service';

describe('refresh session rotation', () => {
  beforeEach(() => {
    dbState.selectRows = [];
    dbState.insertValues = [];
    dbState.updateSets = [];
    dbState.executedSql = [];
    dbState.transactionCount = 0;
    vi.clearAllMocks();
  });

  it('stores only a hash for newly issued refresh tokens', async () => {
    const issued = await createRefreshSession('user-1', {
      userAgent: 'vitest',
      ipAddress: '127.0.0.1',
    });

    expect(issued.token).toHaveLength(96);
    expect(dbState.insertValues[0]).toMatchObject({
      userId: 'user-1',
      tokenHash: hashToken(issued.token),
      userAgent: 'vitest',
      ipAddress: '127.0.0.1',
    });
    expect(dbState.insertValues[0].tokenHash).not.toBe(issued.token);
  });

  it('rotates refresh tokens one time and revokes the old session', async () => {
    dbState.selectRows.push([{
      id: 'session-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      replacedByTokenHash: null,
      userAgent: 'old-agent',
      ipAddress: 'old-ip',
    }]);

    const result = await rotateRefreshSession('old-token', {
      userAgent: 'new-agent',
      ipAddress: 'new-ip',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected rotation to succeed');
    expect(dbState.transactionCount).toBe(1);
    expect(dbState.executedSql.some((text) => text.includes('FOR UPDATE'))).toBe(true);
    expect(dbState.insertValues[0]).toMatchObject({
      userId: 'user-1',
      tokenHash: result.tokenHash,
      userAgent: 'new-agent',
      ipAddress: 'new-ip',
    });
    expect(dbState.updateSets.some(({ data }) => (
      data.revokedAt instanceof Date &&
      data.replacedByTokenHash === result.tokenHash &&
      data.lastUsedAt instanceof Date
    ))).toBe(true);
  });

  it('treats a reused rotated token as compromised and revokes active user sessions', async () => {
    dbState.selectRows.push([{
      id: 'session-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(Date.now() - 1_000),
      replacedByTokenHash: 'new-token-hash',
      reuseDetectedAt: null,
    }]);

    const result = await rotateRefreshSession('old-token');

    expect(result).toEqual({ ok: false, reason: 'reused' });
    expect(dbState.updateSets.some(({ data }) => data.reuseDetectedAt instanceof Date)).toBe(true);
    expect(dbState.updateSets.some(({ data }) => data.revokedAt instanceof Date)).toBe(true);
  });

  it('logout revokes the refresh session by hashed token', async () => {
    await revokeRefreshSession('refresh-token');

    expect(dbState.updateSets[0].data.revokedAt).toBeInstanceOf(Date);
    expect(dbState.updateSets[0].data).not.toHaveProperty('tokenHash');
  });
});
