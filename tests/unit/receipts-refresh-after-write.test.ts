import { describe, expect, it } from "vitest";
import { QueryClient, QueryObserver, isCancelledError } from "@tanstack/react-query";
import { refreshReceiptsAfterWrite } from "../../client/src/lib/receiptsCache";

describe("refreshReceiptsAfterWrite", () => {
  const key = ["/api/companies", "c1", "receipts"];

  it("cancels a read in flight before the write and refetches, even with no data yet", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let release: (rows: string[]) => void = () => {};
    let calls = 0;
    const observer = new QueryObserver<string[]>(client, {
      queryKey: key,
      queryFn: () => {
        calls += 1;
        if (calls > 1) return Promise.resolve(["after-write"]);
        return new Promise<string[]>((resolve) => {
          release = resolve;
        });
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    expect(client.getQueryData(key)).toBeUndefined();

    await refreshReceiptsAfterWrite(client, key);
    // The pre-write read resolving late must not overwrite the refetched rows.
    release(["before-write"]);
    await Promise.resolve();

    expect(calls).toBe(2);
    expect(client.getQueryData(key)).toEqual(["after-write"]);
    unsubscribe();
  });

  it("rejects a cancelled fetchQuery with an error isCancelledError recognises", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const pending = client.fetchQuery({
      queryKey: key,
      queryFn: () => new Promise<string[]>(() => {}),
    });
    const outcome = pending.then(
      () => null,
      (error: unknown) => error
    );
    await refreshReceiptsAfterWrite(client, key);
    expect(isCancelledError(await outcome)).toBe(true);
  });
});
