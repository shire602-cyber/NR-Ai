import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver, isCancelledError } from "@tanstack/react-query";
import { openReceiptById, refreshReceiptsAfterWrite } from "../../client/src/lib/receiptsCache";

describe("openReceiptById", () => {
  const key = ["/api/companies", "c1", "receipts"];
  type Row = { id: string };

  function setup(reads: Array<Promise<Row[]>>) {
    let calls = 0;
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, queryFn: () => reads[Math.min(calls++, reads.length - 1)] },
      },
    });
    client.setQueryData<Row[]>(key, [{ id: "other" }]);
    const observer = new QueryObserver<Row[]>(client, { queryKey: key, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    return { client, unsubscribe, calls: () => calls };
  }
  const defer = () => {
    let resolve!: (rows: Row[]) => void;
    const promise = new Promise<Row[]>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };
  const tick = () => new Promise((r) => setTimeout(r, 5));

  it("opens the receipt only from the replacement read after a write cancels the lookup", async () => {
    const stale = defer();
    const replacement = defer();
    const { client, unsubscribe, calls } = setup([stale.promise, replacement.promise]);
    const opened: Row[] = [];

    const lookup = openReceiptById<Row>({
      client,
      queryKey: key,
      id: "target",
      cached: client.getQueryData<Row[]>(key),
      signal: new AbortController().signal,
      onOpen: (row) => opened.push(row),
    });
    await vi.waitFor(() => expect(calls()).toBe(1));

    const refresh = refreshReceiptsAfterWrite(client, key);
    await vi.waitFor(() => expect(calls()).toBe(2));
    await tick();
    expect(opened).toEqual([]);

    stale.resolve([{ id: "target" }]); // the cancelled read must not open anything
    await tick();
    expect(opened).toEqual([]);

    replacement.resolve([{ id: "other" }, { id: "target" }]);
    await Promise.all([lookup, refresh]);
    expect(opened).toEqual([{ id: "target" }]);
    expect(calls()).toBe(2); // the lookup joined the replacement instead of starting another
    unsubscribe();
  });

  it("opens the target when the replacement read resolves immediately, with no third read", async () => {
    const stale = defer();
    const { client, unsubscribe, calls } = setup([
      stale.promise,
      Promise.resolve([{ id: "target" }]),
    ]);
    const onOpen = vi.fn();

    const lookup = openReceiptById<Row>({
      client,
      queryKey: key,
      id: "target",
      cached: client.getQueryData<Row[]>(key),
      signal: new AbortController().signal,
      onOpen,
    });
    await vi.waitFor(() => expect(calls()).toBe(1));

    await Promise.all([refreshReceiptsAfterWrite(client, key), lookup]);
    stale.resolve([{ id: "other" }]);
    await tick();

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith({ id: "target" });
    expect(calls()).toBe(2);
    unsubscribe();
  });

  it("does not open after the lookup is aborted", async () => {
    const read = defer();
    const { client, unsubscribe } = setup([read.promise]);
    const controller = new AbortController();
    const onOpen = vi.fn();
    const lookup = openReceiptById<Row>({
      client,
      queryKey: key,
      id: "target",
      cached: undefined,
      signal: controller.signal,
      onOpen,
    });
    controller.abort();
    read.resolve([{ id: "target" }]);
    await lookup;
    expect(onOpen).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("ends quietly on a genuine read failure", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, queryFn: () => Promise.reject(new Error("boom")) },
      },
    });
    const onOpen = vi.fn();
    await expect(
      openReceiptById<Row>({
        client,
        queryKey: key,
        id: "target",
        cached: undefined,
        signal: new AbortController().signal,
        onOpen,
      })
    ).resolves.toBeUndefined();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

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
