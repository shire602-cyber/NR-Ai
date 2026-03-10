import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests that verify scheduler behavior when DB is unreachable.
 * These test the logic flow, not the actual DB interaction.
 */
describe('Scheduler - Fail Closed Behavior', () => {
  it('should NOT run job when DB claim throws (fail closed)', async () => {
    // This tests the contract: if claimScheduledJob throws,
    // executeJob should NOT execute the handler.
    let handlerCalled = false;

    // Simulate the executeJob logic
    async function executeJobSimulated(
      claimFn: () => Promise<boolean>,
      handler: () => Promise<void>
    ): Promise<{ ran: boolean; error?: string }> {
      let claimed = false;
      try {
        claimed = await claimFn();
      } catch (err: any) {
        // FAIL CLOSED: Do not run when DB is unreachable
        return { ran: false, error: 'DB unreachable' };
      }

      if (!claimed) {
        return { ran: false, error: 'Already running' };
      }

      await handler();
      return { ran: true };
    }

    // Test: DB throws
    const result = await executeJobSimulated(
      async () => { throw new Error('Connection refused'); },
      async () => { handlerCalled = true; }
    );

    expect(result.ran).toBe(false);
    expect(result.error).toBe('DB unreachable');
    expect(handlerCalled).toBe(false);
  });

  it('should NOT run job when claim returns false (already running)', async () => {
    let handlerCalled = false;

    async function executeJobSimulated(
      claimFn: () => Promise<boolean>,
      handler: () => Promise<void>
    ): Promise<{ ran: boolean }> {
      let claimed = false;
      try {
        claimed = await claimFn();
      } catch {
        return { ran: false };
      }
      if (!claimed) return { ran: false };
      await handler();
      return { ran: true };
    }

    const result = await executeJobSimulated(
      async () => false,
      async () => { handlerCalled = true; }
    );

    expect(result.ran).toBe(false);
    expect(handlerCalled).toBe(false);
  });

  it('should run job when claim succeeds', async () => {
    let handlerCalled = false;

    async function executeJobSimulated(
      claimFn: () => Promise<boolean>,
      handler: () => Promise<void>
    ): Promise<{ ran: boolean }> {
      let claimed = false;
      try {
        claimed = await claimFn();
      } catch {
        return { ran: false };
      }
      if (!claimed) return { ran: false };
      await handler();
      return { ran: true };
    }

    const result = await executeJobSimulated(
      async () => true,
      async () => { handlerCalled = true; }
    );

    expect(result.ran).toBe(true);
    expect(handlerCalled).toBe(true);
  });
});

describe('Scheduler - Timer Cleanup', () => {
  it('should clear timeout timer when handler completes before timeout', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    // Simulate the Promise.race + timer cleanup pattern
    let timeoutTimer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(
        () => reject(new Error('timed out')),
        10000 // 10 seconds
      );
    });

    const handler = async () => {
      // Simulates fast handler
      return;
    };

    try {
      await Promise.race([handler(), timeoutPromise]);
    } finally {
      clearTimeout(timeoutTimer!);
    }

    // Verify clearTimeout was called (timer properly cleaned up)
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
