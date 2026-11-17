import { describe, expect, it, vi } from "vitest";

describe("J4: the client never evaluates strings (CSP script-src has no unsafe-eval)", () => {
  it("building and parsing zod schemas after zod-config does not call new Function", async () => {
    const RealFunction = globalThis.Function;
    const calls: unknown[][] = [];
    const Spy = new Proxy(RealFunction, {
      construct(target, args, newTarget) {
        calls.push(args);
        return Reflect.construct(target, args, newTarget);
      },
    });
    vi.stubGlobal("Function", Spy);
    try {
      await import("../../client/src/lib/zod-config");
      const { z } = await import("zod");
      const schema = z.object({ email: z.string().email(), n: z.number().int() });
      expect(schema.safeParse({ email: "a@b.co", n: 3 }).success).toBe(true);
      expect(schema.safeParse({ email: "x", n: 1.5 }).success).toBe(false);
      expect(calls).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
