// @vitest-environment jsdom
/** A portal list request is aborted when its last observer leaves, including on a supplier switch. */
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { portalQuery } from "../../client/src/lib/queryClient";

const requests: Array<{ supplier: string | null; signal: AbortSignal }> = [];
let client: QueryClient;

beforeEach(() => {
  requests.length = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal!;
          requests.push({
            supplier: new Headers(init.headers).get("X-Portal-Account"),
            signal,
          });
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    )
  );
});

afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});

const options = (supplier: string) => portalQuery("/api/client-portal/invoices", supplier);

describe("portal query cancellation", () => {
  it("aborts the old supplier's request on a switch and the new one on unmount", async () => {
    const observer = new QueryObserver(client, options("a1"));
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ supplier: "a1" });
    expect(requests[0].signal.aborted).toBe(false);

    observer.setOptions(options("a2"));
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0].signal.aborted).toBe(true);
    expect(requests[1]).toMatchObject({ supplier: "a2" });
    expect(requests[1].signal.aborted).toBe(false);

    unsubscribe();
    expect(requests[1].signal.aborted).toBe(true);
  });

  it("keeps the request while another observer is still mounted", async () => {
    const first = new QueryObserver(client, options("a1")).subscribe(() => undefined);
    const second = new QueryObserver(client, options("a1")).subscribe(() => undefined);
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    first();
    expect(requests[0].signal.aborted).toBe(false);
    second();
    expect(requests[0].signal.aborted).toBe(true);
  });
});
