// @vitest-environment jsdom
import { act } from "react";
import { focusManager, onlineManager, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  byTestId,
  click,
  COMPANY_ID,
  flush,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  pickOption,
  renderPage,
  setFixtures,
  unmountPage,
} from "./helpers/form-harness";
import PartyStatements from "../../client/src/pages/reports/PartyStatements";
import arCommon from "../../client/src/locales/ar/common.json";
import arFirm from "../../client/src/locales/ar/firm.json";
import arReportCenter from "../../client/src/locales/ar/reportCenter.json";

// Failure switches the mocked network layer reads on every request.
const ctrl = vi.hoisted(() => ({
  /** statement requests fail: "offline" = fetch rejected, "server" = HTTP 500 */
  statement: null as null | "offline" | "server",
  /** party list requests (keyed by the last query-key segment) that fail with HTTP 500 */
  lists: new Set<string>(),
}));

vi.mock("../../client/src/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/lib/i18n")>();
  const dict = {
    ...(await import("../../client/src/locales/ar/common.json")).default,
    ...(await import("../../client/src/locales/ar/firm.json")).default,
    ...(await import("../../client/src/locales/ar/reportCenter.json")).default,
  } as Record<string, string>;
  return { ...actual, useTranslation: () => ({ t: dict, locale: "ar" }) };
});
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());
vi.mock("../../client/src/lib/queryClient", async () => {
  const base = formHarnessQueryClientMock();
  const inner = base.apiRequest.getMockImplementation()!;
  const serverError = () =>
    Object.assign(new base.ApiError("boom: raw server detail"), { status: 500 });
  // Party lists use the client's default queryFn; wrap it (public API) so a test can fail one list.
  const defaults = base.queryClient.getDefaultOptions();
  const fixtureQueryFn = defaults.queries!.queryFn as (ctx: {
    queryKey: readonly unknown[];
  }) => Promise<unknown>;
  base.queryClient.setDefaultOptions({
    ...defaults,
    queries: {
      ...defaults.queries,
      queryFn: async (ctx: { queryKey: readonly unknown[] }) => {
        if (ctrl.lists.has(String(ctx.queryKey[ctx.queryKey.length - 1]))) throw serverError();
        return fixtureQueryFn(ctx);
      },
    },
  });
  return {
    ...base,
    apiRequest: vi.fn(async (method: string, url: string, body?: unknown) => {
      if (url.includes("-statements/")) {
        if (ctrl.statement === "server") throw serverError();
        if (ctrl.statement === "offline") throw new Error("boom: raw server detail");
      }
      return inner(method, url, body);
    }),
  };
});

(Element.prototype as { scrollIntoView?: unknown }).scrollIntoView ??= () => {};

const base = `/api/companies/${COMPANY_ID}`;
const ar = { ...arCommon, ...arFirm, ...arReportCenter } as Record<string, string>;
const SUPPLIER = "مورد";

const lineOf = (reference: string, description: string, debit: number) => ({
  date: "2026-11-20",
  type: "invoice",
  reference,
  description,
  debit,
  credit: 0,
  balance: debit,
});
const statementOf = (id: string, name: string, lines: ReturnType<typeof lineOf>[] = []) => ({
  party: { id, name, email: null },
  from: null,
  asOf: "2026-11-25",
  sections: [{ currency: "AED", openingBalance: 0, closingBalance: 0, lines }],
});
const customerFixtures = (lines: ReturnType<typeof lineOf>[] = []) => ({
  [`${base}/customer-contacts`]: [{ id: "c1", name: "Al Noor" }],
  [`${base}/customer-statements/c1`]: statementOf("c1", "Al Noor", lines),
});
const CACHED_LINE = lineOf("INV-CACHED-001", "cached sale", 10500);
const REFRESHED_LINE = lineOf("INV-REFRESHED-002", "refreshed sale", 20500);

const setOnline = (online: boolean) => act(async () => onlineManager.setOnline(online));
const setFocused = (focused: boolean) => act(async () => focusManager.setFocused(focused));
const PAUSED_TITLE = arReportCenter["reportCenter.partyLoadPausedTitle"];
const PAUSED_BODY = arReportCenter["reportCenter.partyLoadPausedBody"];
async function refetch(match: (key: readonly unknown[]) => boolean) {
  const { queryClient } = (await import("../../client/src/lib/queryClient")) as unknown as {
    queryClient: QueryClient;
  };
  await act(async () => {
    await queryClient.refetchQueries({ predicate: (q) => match(q.queryKey) });
  });
  await flush();
}
/** Start a refetch without awaiting it: while offline it pauses and would never resolve. */
async function startRefetch(match: (key: readonly unknown[]) => boolean) {
  const { queryClient } = (await import("../../client/src/lib/queryClient")) as unknown as {
    queryClient: QueryClient;
  };
  await act(async () => {
    void queryClient.refetchQueries({ predicate: (q) => match(q.queryKey) });
  });
  await flush();
}
const refetchList = (name: string) => refetch((k) => k[k.length - 1] === name);
const refetchStatements = () => refetch((k) => String(k[0]).includes("-statements/"));

async function pressKey(key: string) {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
  await flush();
}
const listbox = () => document.querySelector('[role="listbox"]');
async function openParty() {
  const trigger = byTestId("select-statement-party")!;
  await act(async () => {
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    );
  });
  await flush();
  return listbox()?.textContent ?? "";
}
/** Close the Radix dropdown so the page's own Retry buttons are reachable. */
async function closeParty() {
  await pressKey("Escape");
  expect(listbox()).toBeNull();
}
const retryButton = (testId: string) => byTestId(testId)?.querySelector("button") ?? null;
const hasCard = () => !!byTestId("card-party-statement");
const pageText = () => document.body.textContent ?? "";

async function showCustomerStatement(lines: ReturnType<typeof lineOf>[] = []) {
  setFixtures(customerFixtures(lines));
  await renderPage(PartyStatements);
  await pickOption(byTestId("select-statement-party"), "Al Noor");
  await flushUntil(hasCard);
  expect(hasCard()).toBe(true);
}

describe("party statements screen (Arabic)", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  let restoreQueryDefaults: (() => void) | null = null;
  afterEach(async () => {
    ctrl.statement = null;
    ctrl.lists.clear();
    await setOnline(true);
    // Drop the focus override (back to the document's own visibility) and the retry defaults.
    await act(async () => focusManager.setFocused(undefined));
    restoreQueryDefaults?.();
    restoreQueryDefaults = null;
    await unmountPage();
    vi.unstubAllGlobals();
  });

  it("shows a successful empty list as empty, on the page and in the dropdown, with no error", async () => {
    setFixtures({ [`${base}/customer-contacts`]: [] });
    await renderPage(PartyStatements);
    await flushUntil(() => pageText().includes(ar["reportCenter.partyNoCustomers"]));
    expect(pageText()).toContain(ar["reportCenter.partyNoCustomers"]);
    expect(byTestId("party-list-error")).toBeNull();
    expect(byTestId("party-list-paused")).toBeNull();
    const text = await openParty();
    expect(text).toContain(ar["reportCenter.partyNoCustomers"]);
    expect(text).not.toContain(ar["firm.loadFailedTitle"]);
    expect(text).not.toContain(PAUSED_TITLE);
  });

  it.each([
    ["customer", "reportCenter.partyNoCustomers"],
    ["supplier", "reportCenter.partyNoSuppliers"],
  ])(
    "shows a paused state for the %s list while offline, then recovers on reconnect",
    async (kind, emptyKey) => {
      setFixtures({
        [`${base}/customer-contacts`]: [{ id: "c1", name: "Al Noor" }],
        [`${base}/vendors`]: [{ id: "v1", name: "Gulf Supplies" }],
      });
      await setOnline(false);
      await renderPage(PartyStatements);
      if (kind === "supplier") await pickOption(byTestId("select-statement-kind"), SUPPLIER);
      expect(byTestId("party-list-paused")?.textContent).toContain(PAUSED_TITLE);
      expect(byTestId("party-list-paused")?.textContent).toContain(PAUSED_BODY);
      expect(byTestId("party-list-error")).toBeNull();
      expect(pageText()).not.toContain(ar[emptyKey]);
      const text = await openParty();
      expect(text).toContain(PAUSED_TITLE);
      expect(text).not.toContain(ar[emptyKey]);
      await closeParty();

      await setOnline(true);
      await flushUntil(() => !byTestId("party-list-paused"));
      expect(byTestId("party-list-paused")).toBeNull();
    }
  );

  it("separates a failed list from an empty one in the dropdown, and Retry recovers", async () => {
    ctrl.lists.add("customer-contacts");
    setFixtures(customerFixtures());
    await renderPage(PartyStatements);
    await flushUntil(() => !!byTestId("party-list-error"));
    const error = byTestId("party-list-error")!;
    expect(error.textContent).toContain(ar["firm.loadFailedTitle"]);
    expect(error.textContent).toContain(ar["firm.loadFailedBody"]);
    expect(pageText()).not.toContain("raw server detail");
    expect(pageText()).not.toContain(ar["reportCenter.partyNoCustomers"]);
    const text = await openParty();
    expect(text).toContain(ar["firm.loadFailedTitle"]);
    expect(text).not.toContain(ar["reportCenter.partyNoCustomers"]);
    await closeParty();

    ctrl.lists.clear();
    await click(retryButton("party-list-error"));
    await flushUntil(() => !byTestId("party-list-error"));
    expect(byTestId("party-list-error")).toBeNull();
    await pickOption(byTestId("select-statement-party"), "Al Noor");
    expect(pageText()).toContain("Al Noor");
  });

  it("says a statement for a cached party is paused while offline, then loads when back online", async () => {
    setFixtures(customerFixtures());
    await renderPage(PartyStatements);
    await flushUntil(() => pageText().includes(ar["reportCenter.partyStatementPick"]));
    expect(pageText()).toContain(ar["reportCenter.partyStatementPick"]);
    await setOnline(false);
    await pickOption(byTestId("select-statement-party"), "Al Noor");
    expect(byTestId("party-statement-paused")?.textContent).toContain(PAUSED_TITLE);
    expect(hasCard()).toBe(false);
    expect(byTestId("party-statement-error")).toBeNull();
    expect(byTestId("party-list-paused")).toBeNull();

    await setOnline(true);
    await flushUntil(hasCard);
    expect(hasCard()).toBe(true);
    expect(byTestId("party-statement-paused")).toBeNull();
  });

  it("shows a translated retryable statement error, not the raw message, then recovers on Retry", async () => {
    ctrl.statement = "offline";
    setFixtures({
      [`${base}/vendors`]: [{ id: "v1", name: "Gulf Supplies" }],
      [`${base}/supplier-statements/v1`]: statementOf("v1", "Gulf Supplies"),
    });
    await renderPage(PartyStatements);
    await pickOption(byTestId("select-statement-kind"), SUPPLIER);
    await pickOption(byTestId("select-statement-party"), "Gulf Supplies");
    await flushUntil(() => !!byTestId("party-statement-error"));
    const error = byTestId("party-statement-error")!;
    expect(error.textContent).toContain(ar["reportCenter.partyStatementLoadFailed"]);
    expect(error.textContent).toContain(ar["firm.loadOfflineBody"]);
    expect(retryButton("party-statement-error")?.textContent).toContain(ar["firm.retry"]);
    expect(pageText()).not.toContain("raw server detail");

    ctrl.statement = null;
    await click(retryButton("party-statement-error"));
    await flushUntil(hasCard);
    expect(hasCard()).toBe(true);
    expect(byTestId("party-statement-error")).toBeNull();
    expect(pageText()).toContain("Gulf Supplies");
  });

  it("shows opening and closing balances with an empty note, and no table, for a section without lines", async () => {
    await showCustomerStatement();
    expect(pageText()).toContain(ar["reportCenter.partyStatementOpening"]);
    expect(pageText()).toContain(ar["reportCenter.partyStatementClosing"]);
    expect(pageText()).toContain(ar["reportCenter.partyStatementEmpty"]);
    expect(document.querySelector("table")).toBeNull();
    expect(pageText()).not.toContain("2026-11-25");
  });

  it("keeps cached rows and says so while a statement refresh is paused offline, then renders the refreshed rows", async () => {
    await showCustomerStatement([CACHED_LINE]);
    expect(pageText()).toContain(CACHED_LINE.reference);

    await setOnline(false);
    setFixtures(customerFixtures([REFRESHED_LINE]));
    await startRefetch((k) => String(k[0]).includes("-statements/"));
    expect(byTestId("party-statement-paused")?.textContent).toContain(PAUSED_TITLE);
    expect(byTestId("party-statement-error")).toBeNull();
    expect(hasCard()).toBe(true);
    expect(pageText()).toContain(CACHED_LINE.reference);
    expect(pageText()).not.toContain(ar["reportCenter.partyStatementEmpty"]);

    await setOnline(true);
    await flushUntil(() => pageText().includes(REFRESHED_LINE.reference));
    expect(pageText()).toContain(REFRESHED_LINE.reference);
    expect(pageText()).not.toContain(CACHED_LINE.reference);
    expect(byTestId("party-statement-paused")).toBeNull();
    expect(byTestId("party-statement-error")).toBeNull();
  });

  it("keeps the cached party list selectable while its refresh is paused offline", async () => {
    await showCustomerStatement([CACHED_LINE]);
    await setOnline(false);
    await startRefetch((k) => k[k.length - 1] === "customer-contacts");
    expect(byTestId("party-list-paused")?.textContent).toContain(PAUSED_TITLE);
    expect(byTestId("party-list-error")).toBeNull();
    expect(hasCard()).toBe(true);
    const text = await openParty();
    expect(text).toContain("Al Noor");
    expect(text).not.toContain(ar["reportCenter.partyNoCustomers"]);
    await closeParty();

    await setOnline(true);
    await flushUntil(() => !byTestId("party-list-paused"));
    expect(byTestId("party-list-paused")).toBeNull();
  });

  it("shows the paused state, not the stale error, when Retry is pressed offline after a failed refresh, and resumes on reconnect", async () => {
    await showCustomerStatement([CACHED_LINE]);
    ctrl.statement = "server";
    ctrl.lists.add("customer-contacts");
    await refetchList("customer-contacts");
    await refetchStatements();
    await flushUntil(() => !!byTestId("party-list-error") && !!byTestId("party-statement-error"));
    expect(pageText()).toContain(CACHED_LINE.reference);

    await setOnline(false);
    await click(retryButton("party-statement-error"));
    await click(retryButton("party-list-error"));
    await flushUntil(() => !!byTestId("party-statement-paused") && !!byTestId("party-list-paused"));
    expect(byTestId("party-statement-error")).toBeNull();
    expect(byTestId("party-list-error")).toBeNull();
    expect(byTestId("party-statement-paused")?.textContent).toContain(PAUSED_BODY);
    expect(byTestId("party-list-paused")?.textContent).toContain(PAUSED_BODY);
    expect(hasCard()).toBe(true);
    expect(pageText()).toContain(CACHED_LINE.reference);
    expect(pageText()).not.toContain(ar["reportCenter.partyStatementEmpty"]);
    const text = await openParty();
    expect(text).toContain("Al Noor");
    expect(text).not.toContain(ar["reportCenter.partyNoCustomers"]);
    await closeParty();

    // The network returns and the paused Retry resumes against a healthy server.
    ctrl.statement = null;
    ctrl.lists.clear();
    setFixtures(customerFixtures([REFRESHED_LINE]));
    await setOnline(true);
    await flushUntil(() => pageText().includes(REFRESHED_LINE.reference));
    expect(pageText()).toContain(REFRESHED_LINE.reference);
    expect(pageText()).not.toContain(CACHED_LINE.reference);
    expect(byTestId("party-statement-paused")).toBeNull();
    expect(byTestId("party-statement-error")).toBeNull();
    expect(byTestId("party-list-paused")).toBeNull();
    expect(byTestId("party-list-error")).toBeNull();
  });

  it("pauses automatic retries with neutral copy while the tab is unfocused but online, keeps cached data, and resumes on refocus", async () => {
    const { queryClient } = (await import("../../client/src/lib/queryClient")) as unknown as {
      queryClient: QueryClient;
    };
    const savedDefaults = queryClient.getDefaultOptions();
    restoreQueryDefaults = () => queryClient.setDefaultOptions(savedDefaults);
    // One automatic retry with no delay, so the retry reaches the focus gate straight away.
    queryClient.setDefaultOptions({
      ...savedDefaults,
      queries: { ...savedDefaults.queries, retry: 1, retryDelay: 0 },
    });

    await showCustomerStatement([CACHED_LINE]);
    expect(onlineManager.isOnline()).toBe(true);

    // Unfocused, still online: the first attempt fails, and its automatic retry must wait.
    await setFocused(false);
    expect(onlineManager.isOnline()).toBe(true);
    ctrl.statement = "server";
    ctrl.lists.add("customer-contacts");
    await startRefetch(
      (k) => k[k.length - 1] === "customer-contacts" || String(k[0]).includes("-statements/")
    );
    await flushUntil(() => !!byTestId("party-list-paused") && !!byTestId("party-statement-paused"));
    for (const id of ["party-list-paused", "party-statement-paused"]) {
      const banner = byTestId(id);
      expect(banner?.textContent).toContain(PAUSED_TITLE);
      expect(banner?.textContent).toContain(PAUSED_BODY);
      expect(banner?.textContent).not.toContain(ar["common.errorHeading.offline"]);
    }
    expect(byTestId("party-list-error")).toBeNull();
    expect(byTestId("party-statement-error")).toBeNull();
    // Cached rows stay: reference plus description, and the cached party option.
    expect(hasCard()).toBe(true);
    const cachedRow = byTestId("card-party-statement")?.querySelector("tbody tr");
    expect(cachedRow?.textContent).toContain(CACHED_LINE.reference);
    expect(cachedRow?.textContent).toContain(CACHED_LINE.description);
    expect(pageText()).not.toContain(ar["reportCenter.partyStatementEmpty"]);
    const text = await openParty();
    expect(text).toContain("Al Noor");
    expect(text).not.toContain(ar["reportCenter.partyNoCustomers"]);
    await closeParty();

    // Refocus resumes the paused retries; the server is healthy again by then.
    ctrl.statement = null;
    ctrl.lists.clear();
    setFixtures(customerFixtures([REFRESHED_LINE]));
    await setFocused(true);
    await flushUntil(() => pageText().includes(REFRESHED_LINE.reference));
    expect(pageText()).toContain(REFRESHED_LINE.reference);
    expect(pageText()).not.toContain(CACHED_LINE.reference);
    expect(byTestId("party-list-paused")).toBeNull();
    expect(byTestId("party-statement-paused")).toBeNull();
    expect(byTestId("party-list-error")).toBeNull();
    expect(byTestId("party-statement-error")).toBeNull();
  });

  it("keeps a loaded statement visible when list and statement refreshes both fail, each retried on its own", async () => {
    await showCustomerStatement([CACHED_LINE]);
    ctrl.statement = "server";
    ctrl.lists.add("customer-contacts");
    await refetchList("customer-contacts");
    await refetchStatements();
    await flushUntil(() => !!byTestId("party-list-error") && !!byTestId("party-statement-error"));
    expect(byTestId("party-list-error")?.textContent).toContain(ar["firm.loadFailedTitle"]);
    expect(byTestId("party-statement-error")?.textContent).toContain(
      ar["reportCenter.partyStatementLoadFailed"]
    );
    expect(hasCard()).toBe(true);
    expect(pageText()).toContain("Al Noor");
    const cachedRow = byTestId("card-party-statement")?.querySelector("tbody tr");
    expect(cachedRow?.textContent).toContain(CACHED_LINE.reference);
    expect(cachedRow?.textContent).toContain(CACHED_LINE.description);
    expect(pageText()).not.toContain(ar["reportCenter.partyStatementEmpty"]);

    // The cached list stays selectable; the failure does not turn it into "no customers".
    const text = await openParty();
    expect(text).toContain("Al Noor");
    expect(text).not.toContain(ar["reportCenter.partyNoCustomers"]);
    await closeParty();

    // Retrying the list leaves the statement failure (and its Retry) in place.
    ctrl.lists.clear();
    await click(retryButton("party-list-error"));
    await flushUntil(() => !byTestId("party-list-error"));
    expect(byTestId("party-list-error")).toBeNull();
    expect(byTestId("party-statement-error")).not.toBeNull();
    expect(hasCard()).toBe(true);

    ctrl.statement = null;
    await click(retryButton("party-statement-error"));
    await flushUntil(() => !byTestId("party-statement-error"));
    expect(byTestId("party-statement-error")).toBeNull();
    expect(hasCard()).toBe(true);
    expect(pageText()).toContain("Al Noor");
  });
});
