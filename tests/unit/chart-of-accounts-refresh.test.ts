// @vitest-environment jsdom
// A GET that started before an account write must not land after it (stale data over fresh).
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider, QueryObserver, type DefaultOptions } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "co-1" }),
}));
vi.mock("../../client/src/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({ gate: () => ({}) }),
}));
// Only the write is faked: React Query, its singleton client and refreshAfterWrite are real.
vi.mock("../../client/src/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../client/src/lib/queryClient")>()),
  apiRequest: vi.fn(() => Promise.resolve({})),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const balancesKey = ["/api/companies", "co-1", "accounts-with-balances"];
const accountsKey = ["/api/companies", "co-1", "accounts"];

function row(id: string, code: string, name: string) {
  return {
    account: {
      id,
      code,
      name,
      nameEn: name,
      nameAr: null,
      type: "asset",
      parentId: null,
      isActive: true,
    },
    balance: 0,
    debitTotal: 0,
    creditTotal: 0,
  };
}

interface Read {
  key: string;
  signal: AbortSignal;
  resolve: (data: unknown) => void;
}

let container: HTMLDivElement;
let root: Root;
let reads: Read[];
let savedDefaults: DefaultOptions;
let unsubscribe: (() => void) | undefined;

const readsOf = (queryKey: string[]) => reads.filter((r) => r.key === queryKey.join("/"));

beforeAll(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => undefined))
  );
  const { loadLocale, useI18n } = await import("../../client/src/lib/i18n");
  await loadLocale("en");
  act(() => useI18n.getState().setLocale("en"));
});

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  reads = [];
  const { queryClient, apiRequest } = await import("../../client/src/lib/queryClient");
  vi.mocked(apiRequest).mockClear();
  savedDefaults = queryClient.getDefaultOptions();
  // Every read stays pending until the test resolves it.
  queryClient.setDefaultOptions({
    queries: {
      retry: false,
      queryFn: ({ queryKey, signal }) =>
        new Promise((resolve) => reads.push({ key: queryKey.join("/"), signal, resolve })),
    },
  });
});

afterEach(async () => {
  const { queryClient } = await import("../../client/src/lib/queryClient");
  unsubscribe?.();
  unsubscribe = undefined;
  act(() => root.unmount());
  container.remove();
  await queryClient.cancelQueries();
  queryClient.clear();
  queryClient.setDefaultOptions(savedDefaults);
});

async function tick() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

async function until(predicate: () => boolean) {
  for (let i = 0; i < 200 && !predicate(); i++) await tick();
  expect(predicate()).toBe(true);
}

async function resolveRead(read: Read, data: unknown) {
  await act(async () => {
    read.resolve(data);
  });
  await tick();
}

async function renderPage() {
  const { queryClient } = await import("../../client/src/lib/queryClient");
  const { default: ChartOfAccounts } = await import("../../client/src/pages/ChartOfAccounts");
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(ChartOfAccounts))
    );
  });
  await until(() => readsOf(balancesKey).length === 1);
  return queryClient;
}

function click(testId: string) {
  const el = document.body.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  expect(el).not.toBeNull();
  act(() => el!.click());
}

const rowText = (id: string) =>
  container.querySelector(`[data-testid="row-account-${id}"]`)?.textContent;

describe("chart of accounts refresh after a write", { timeout: 30000 }, () => {
  it("drops a cold balances GET when an account is created from the drawer", async () => {
    const client = await renderPage();
    const stale = readsOf(balancesKey)[0];

    click("button-add-account");
    const name = document.body.querySelector<HTMLInputElement>(
      '[data-testid="input-account-name-en"]'
    )!;
    act(() => {
      // React tracks the input value, so set it through the native setter before the event.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        name,
        "Petty cash"
      );
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click("button-save-account");

    await until(() => readsOf(balancesKey).length === 2);
    expect(stale.signal.aborted).toBe(true);

    await resolveRead(readsOf(balancesKey)[1], [row("new", "5010", "Petty cash")]);
    await until(() => !!rowText("new")?.includes("Petty cash"));

    await resolveRead(stale, []);
    expect(rowText("new")).toContain("Petty cash");
    expect(client.getQueryData(balancesKey)).toEqual([row("new", "5010", "Petty cash")]);
  });

  it("drops both in-flight account GETs when a parent is saved", async () => {
    const client = await renderPage();
    await resolveRead(readsOf(balancesKey)[0], [row("cash", "1000", "Cash on hand")]);
    await until(() => !!rowText("cash"));

    // Another consumer's first load of the plain list, and a balances refetch, both in flight.
    unsubscribe = new QueryObserver(client, { queryKey: accountsKey }).subscribe(() => undefined);
    act(() => {
      void client.refetchQueries({ queryKey: balancesKey });
    });
    await until(() => readsOf(accountsKey).length === 1 && readsOf(balancesKey).length === 2);
    const stalePlain = readsOf(accountsKey)[0];
    const staleBalances = readsOf(balancesKey)[1];

    click("button-set-parent-cash");
    click("button-save-parent");

    await until(() => readsOf(accountsKey).length === 2 && readsOf(balancesKey).length === 3);
    expect(stalePlain.signal.aborted).toBe(true);
    expect(staleBalances.signal.aborted).toBe(true);

    const freshBalances = [row("cash", "1000", "Cash after save")];
    const freshPlain = [freshBalances[0].account];
    await resolveRead(readsOf(balancesKey)[2], freshBalances);
    await resolveRead(readsOf(accountsKey)[1], freshPlain);
    await until(() => !!rowText("cash")?.includes("Cash after save"));

    await resolveRead(staleBalances, [row("cash", "1000", "Cash before save")]);
    await resolveRead(stalePlain, []);
    expect(rowText("cash")).toContain("Cash after save");
    expect(client.getQueryData(balancesKey)).toEqual(freshBalances);
    expect(client.getQueryData(accountsKey)).toEqual(freshPlain);
  });
});
