import { afterEach, describe, expect, it, vi } from "vitest";
import { focusManager, onlineManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  receiptsReadState,
  rollbackReceipts,
  updateReceiptsOptimistically,
} from "../../client/src/lib/receiptsCache";
import arScreens from "../../client/src/locales/ar/screens.json";
import enScreens from "../../client/src/locales/en/screens.json";

type Row = { id: string; posted?: boolean };

const queryKey = ["/api/companies", "c1", "receipts"];
const rows: Row[] = [{ id: "a" }, { id: "b" }];
const removeA = (list: Row[]) => list.filter((row) => row.id !== "a");

const cleanups: Array<() => void> = [];

function makeClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cleanups.push(() => client.clear());
  return client;
}

function observe(client: QueryClient, queryFn: () => Promise<Row[]>, retry = 0) {
  const observer = new QueryObserver<Row[]>(client, {
    queryKey,
    queryFn,
    retry,
    retryDelay: 0,
  });
  cleanups.push(observer.subscribe(() => {}));
  return observer;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup());
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

describe("receipts read state (PR143)", () => {
  it("does not treat a first load paused offline as resolved", () => {
    onlineManager.setOnline(false);
    const observer = observe(makeClient(), async () => []);
    const result = observer.getCurrentResult();

    expect(result.fetchStatus).toBe("paused");
    expect(receiptsReadState(result)).toBe("waiting");
  });

  it("waits when a retry pauses in an online but hidden tab", async () => {
    focusManager.setFocused(false);
    const observer = observe(
      makeClient(),
      async () => {
        throw new Error("boom");
      },
      1
    );

    await vi.waitFor(() => expect(observer.getCurrentResult().isPaused).toBe(true));
    expect(onlineManager.isOnline()).toBe(true);
    expect(receiptsReadState(observer.getCurrentResult())).toBe("waiting");
  });

  it("reports a failed first load as failed, not empty", async () => {
    const observer = observe(makeClient(), async () => {
      throw new Error("boom");
    });

    await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true));
    expect(observer.getCurrentResult().isLoadingError).toBe(true);
    expect(receiptsReadState(observer.getCurrentResult())).toBe("failed");
  });

  it.each([
    ["empty", [] as Row[]],
    ["populated", rows],
  ])("keeps an %s cached list and flags the failed refresh", async (_name, cached) => {
    const client = makeClient();
    client.setQueryData(queryKey, cached);
    const observer = observe(client, async () => {
      throw new Error("boom");
    });

    await observer.refetch();
    const result = observer.getCurrentResult();

    expect(result.isRefetchError).toBe(true);
    expect(result.isLoadingError).toBe(false);
    expect(result.data).toEqual(cached);
    expect(receiptsReadState(result)).toBe("stale");
  });

  it("recovers a failed first load to ready when a retry succeeds with an empty list", async () => {
    let fail = true;
    const observer = observe(makeClient(), async () => {
      if (fail) throw new Error("boom");
      return [] as Row[];
    });

    await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true));
    expect(receiptsReadState(observer.getCurrentResult())).toBe("failed");

    fail = false;
    await observer.refetch();
    const result = observer.getCurrentResult();

    expect(result.data).toEqual([]);
    expect(receiptsReadState(result)).toBe("ready");
  });

  it("recovers a previously empty cached list to ready after a failed refresh then a successful retry", async () => {
    const client = makeClient();
    client.setQueryData<Row[]>(queryKey, []);
    let fail = true;
    const observer = observe(client, async () => {
      if (fail) throw new Error("boom");
      return [] as Row[];
    });

    await observer.refetch();
    expect(receiptsReadState(observer.getCurrentResult())).toBe("stale");

    fail = false;
    await observer.refetch();
    const result = observer.getCurrentResult();

    expect(result.isRefetchError).toBe(false);
    expect(receiptsReadState(result)).toBe("ready");
  });
});

describe("receipts optimistic cache (PR143)", () => {
  it("does not create a cache entry that was absent", async () => {
    const client = makeClient();
    const snapshot = await updateReceiptsOptimistically(client, queryKey, removeA);

    expect(client.getQueryState(queryKey)).toBeUndefined();
    await rollbackReceipts(client, snapshot);
    expect(client.getQueryState(queryKey)).toBeUndefined();
  });

  it("keeps an existing empty cache empty", async () => {
    const client = makeClient();
    client.setQueryData<Row[]>(queryKey, []);
    const snapshot = await updateReceiptsOptimistically(client, queryKey, removeA);

    expect(client.getQueryData(queryKey)).toEqual([]);
    await rollbackReceipts(client, snapshot);
    expect(client.getQueryData(queryKey)).toEqual([]);
  });

  it("does not mutate the cached rows", async () => {
    const client = makeClient();
    const original = [{ id: "a" }, { id: "b" }];
    client.setQueryData<Row[]>(queryKey, original);
    await updateReceiptsOptimistically<Row>(client, queryKey, (list) =>
      list.map((row) => ({ ...row, posted: true }))
    );

    expect(original).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("cancels a read in flight before the optimistic update", async () => {
    const client = makeClient();
    client.setQueryData(queryKey, rows);
    const late = deferred<Row[]>();
    let signal: AbortSignal | undefined;
    const read = client
      .fetchQuery({
        queryKey,
        queryFn: (context) => {
          signal = context.signal;
          return late.promise;
        },
        staleTime: 0,
      })
      .catch(() => undefined);

    await updateReceiptsOptimistically(client, queryKey, removeA);
    expect(signal?.aborted).toBe(true);
    late.resolve(rows);
    await read;

    expect(client.getQueryData(queryKey)).toEqual([{ id: "b" }]);
  });

  it("cancels a read started during the mutation before restoring the snapshot", async () => {
    const client = makeClient();
    client.setQueryData(queryKey, rows);
    const snapshot = await updateReceiptsOptimistically(client, queryKey, removeA);
    const late = deferred<Row[]>();
    let signal: AbortSignal | undefined;
    const read = client
      .fetchQuery({
        queryKey,
        queryFn: (context) => {
          signal = context.signal;
          return late.promise;
        },
        staleTime: 0,
      })
      .catch(() => undefined);

    await rollbackReceipts(client, snapshot);
    expect(signal?.aborted).toBe(true);
    late.resolve([{ id: "stale" }]);
    await read;

    expect(client.getQueryData(queryKey)).toEqual(rows);
  });
});

describe("receipts read state copy (PR143)", () => {
  it("has en and ar for the waiting and refresh failure states", () => {
    for (const key of [
      "screens.receiptsWaitingTitle",
      "screens.receiptsWaitingBody",
      "screens.receiptsRefreshFailedTitle",
      "screens.receiptsRefreshFailedBody",
    ] as const) {
      expect(enScreens[key]).toBeTruthy();
      expect(arScreens[key]).toBeTruthy();
    }
  });
});
