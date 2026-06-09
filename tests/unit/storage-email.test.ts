import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = vi.hoisted(() => ({
  insertedValues: [] as any[],
  whereCalls: [] as any[],
}));

vi.mock('../../server/db', () => {
  const db: any = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async (where: any) => {
          dbState.whereCalls.push(where);
          return [];
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: any) => {
        dbState.insertedValues.push(values);
        return {
          returning: vi.fn(async () => [{
            id: 'user-1',
            name: values.name,
            email: values.email,
            passwordHash: values.passwordHash,
          }]),
        };
      }),
    })),
  };

  return { db };
});

import { DatabaseStorage } from '../../server/storage';

describe('user email storage', () => {
  beforeEach(() => {
    dbState.insertedValues = [];
    dbState.whereCalls = [];
    vi.clearAllMocks();
  });

  it('normalizes newly-created user emails to lowercase', async () => {
    const storage = new DatabaseStorage();

    const user = await storage.createUser({
      name: 'Owner',
      email: ' Owner@Example.COM ',
      password: 'password-123',
      passwordHash: 'hash',
    } as any);

    expect(user.email).toBe('owner@example.com');
    expect(dbState.insertedValues[0]).toMatchObject({
      email: 'owner@example.com',
    });
  });

  it('uses a normalized case-insensitive lookup path', async () => {
    const storage = new DatabaseStorage();

    await storage.getUserByEmail(' Owner@Example.COM ');

    expect(dbState.whereCalls).toHaveLength(1);
  });
});
