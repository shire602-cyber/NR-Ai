// @vitest-environment jsdom
/**
 * PR 155 review: the cost centers page says what each of its three queries is doing (loading,
 * paused, retrying, failed, refresh failed) and draws counts, totals and empty states only from
 * successful data. Rendered against the real page, loader and React Query.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import CostCenters from "../../client/src/pages/CostCenters";
import { loadLocale, t } from "../../client/src/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c1", isLoading: false }),
}));
vi.mock("../../client/src/hooks/useSubscription", () => ({
  useSubscription: () => ({ canAccess: () => true, getRequiredTier: () => "professional" }),
}));

const REGISTER = "/api/companies/c1/cost-centers";
const PROFITABILITY = `${REGISTER}/profitability`;
const REPORT = `${REGISTER}/cc1/report`;

const center = { id: "cc1", companyId: "c1", code: "CC-1", name: "Sales team", isActive: true };
const zeroTotals = {
  costCenterCount: 1,
  activeCostCenterCount: 1,
  allocatedLineCount: 0,
  totalIncome: 0,
  totalExpenses: 0,
  netIncome: 0,
};
const profitability = {
  periodStart: null,
  periodEnd: null,
  costCenters: [],
  totals: zeroTotals,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const failure = () => json({ message: "boom" }, 500);
const never = () => new Promise<Response>(() => {});

type Handler = () => Response | Promise<Response>;
let handlers: Record<string, Handler>;
let signals: Record<string, AbortSignal | null | undefined>;
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

beforeAll(async () => {
  await loadLocale("en");
});

beforeEach(() => {
  handlers = {
    [REGISTER]: () => json([center]),
    [PROFITABILITY]: () => json(profitability),
    [REPORT]: () => json({ totalIncome: 0, totalExpenses: 0, netIncome: 0 }),
  };
  signals = {};
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const path = Object.keys(handlers).find((key) => String(input).endsWith(key));
    if (!path) throw new Error(`unexpected request ${input}`);
    signals[path] = init?.signal;
    return handlers[path]();
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

function render(retry: number | false = false, retryDelay = 60_000, seed?: () => void) {
  client = new QueryClient({ defaultOptions: { queries: { retry, retryDelay } } });
  seed?.();
  act(() => {
    root.render(createElement(QueryClientProvider, { client }, createElement(CostCenters)));
  });
}

async function until(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assertion();
  });
}

const byId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const text = (id: string) => byId(id)?.textContent ?? "";
const state = (id: string) => byId(id)?.getAttribute("data-state");
const click = (element: Element | null | undefined) => {
  expect(element).toBeTruthy();
  act(() => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const retryButton = (id: string) =>
  Array.from(byId(id)?.querySelectorAll("button") ?? []).find((button) =>
    button.textContent?.includes(t.en["components.errorRetry"])
  );

describe("cost centers load states", () => {
  it("initial load shows loading without counts, zero totals, a period or an empty state", async () => {
    handlers[REGISTER] = never;
    handlers[PROFITABILITY] = never;
    render();
    await until(() => expect(state("cost-center-register-notice")).toBe("pending"));
    expect(state("cost-center-pl-notice")).toBe("pending");
    expect(byId("cost-center-counts")).toBeNull();
    expect(text("cost-center-stat-income")).not.toContain("0.00");
    expect(container.textContent).toContain(t.en["screens.ccPeriodUnknown"]);
    expect(container.textContent).not.toContain(t.en["screens.noCostCenters"]);
  });

  it("a first load paused before any response says paused, not empty", async () => {
    onlineManager.setOnline(false);
    render();
    await until(() => expect(state("cost-center-register-notice")).toBe("paused"));
    expect(state("cost-center-pl-notice")).toBe("paused");
    expect(text("cost-center-register-notice")).toContain(t.en["screens.ccLoadPaused"]);
    expect(text("cost-center-pl-notice")).toContain(t.en["screens.ccLoadPaused"]);
    expect(byId("cost-center-stat-income")).toBeNull();
    expect(byId("cost-center-counts")).toBeNull();
    expect(container.textContent).not.toContain(t.en["screens.noCostCenters"]);
  });

  it("shows a retry in progress, then a paused retry", async () => {
    handlers[REGISTER] = failure;
    render(1);
    await until(() => expect(state("cost-center-register-notice")).toBe("retrying"));

    act(() => root.unmount());
    client.clear();
    root = createRoot(container);
    handlers[REGISTER] = () => {
      onlineManager.setOnline(false);
      return failure();
    };
    render(1, 10);
    await until(() => expect(state("cost-center-register-notice")).toBe("pausedRetry"));
    expect(byId("cost-center-counts")).toBeNull();
  });

  it("an initial failure offers a Retry that refetches only its own query", async () => {
    handlers[REGISTER] = failure;
    const requests: string[] = [];
    handlers[PROFITABILITY] = () => {
      requests.push("profitability");
      return json(profitability);
    };
    render();
    await until(() => expect(retryButton("cost-center-register-notice")).toBeTruthy());
    expect(text("cost-center-register-notice")).toContain(t.en["screens.ccRegisterError"]);
    expect(byId("cost-center-counts")).toBeNull();
    expect(container.textContent).not.toContain(t.en["screens.noCostCenters"]);

    handlers[REGISTER] = never;
    click(retryButton("cost-center-register-notice"));
    await until(() => expect(state("cost-center-register-notice")).toBe("retrying"));
    expect(requests).toHaveLength(1);
  });

  it("a failed first P&L load keeps the loaded register and retries only the P&L", async () => {
    let registerRequests = 0;
    handlers[REGISTER] = () => {
      registerRequests += 1;
      return json([center]);
    };
    handlers[PROFITABILITY] = failure;
    render();
    await until(() => {
      expect(retryButton("cost-center-pl-notice")).toBeTruthy();
      expect(text("cost-center-register")).toContain("Sales team");
    });
    expect(text("cost-center-pl-notice")).toContain(t.en["screens.ccPlError"]);
    expect(text("cost-center-pl-notice")).toContain(t.en["screens.ccLoadErrorBody"]);
    expect(container.textContent).toContain(t.en["screens.ccPeriodUnavailable"]);
    expect(byId("cost-center-stat-income")).toBeNull();

    handlers[PROFITABILITY] = () => json(profitability);
    click(retryButton("cost-center-pl-notice"));
    await until(() => expect(text("cost-center-stat-income")).toContain("0.00"));
    expect(byId("cost-center-pl-notice")).toBeNull();
    expect(registerRequests).toBe(1);
  });

  it("with a cached register, a never-loaded P&L says paused until back online", async () => {
    onlineManager.setOnline(false);
    render(false, 60_000, () => client.setQueryData([REGISTER], [center]));
    await until(() =>
      expect(text("cost-center-pl-notice")).toContain(t.en["screens.ccLoadPaused"])
    );
    expect(state("cost-center-pl-notice")).toBe("paused");
    expect(text("cost-center-register")).toContain("Sales team");
    expect(byId("cost-center-stat-income")).toBeNull();

    act(() => {
      onlineManager.setOnline(true);
    });
    await until(() => expect(text("cost-center-stat-income")).toContain("0.00"));
    expect(byId("cost-center-pl-notice")).toBeNull();
  });

  it("a failed refresh keeps the cached rows and totals, and Retry recovers", async () => {
    render();
    await until(() => expect(text("cost-center-register")).toContain("Sales team"));

    handlers[REGISTER] = failure;
    handlers[PROFITABILITY] = failure;
    await act(async () => {
      await client.refetchQueries();
    });
    await until(() => expect(state("cost-center-register-notice")).toBe("refreshError"));
    expect(text("cost-center-register")).toContain("Sales team");
    expect(state("cost-center-pl-notice")).toBe("refreshError");
    expect(text("cost-center-stat-income")).toContain("0.00");

    handlers[REGISTER] = () => json([center]);
    click(retryButton("cost-center-register-notice"));
    await until(() => expect(byId("cost-center-register-notice")).toBeNull());
    expect(state("cost-center-pl-notice")).toBe("refreshError");
  });

  it("a refresh paused with cached rows says so and keeps them", async () => {
    render();
    await until(() => expect(text("cost-center-register")).toContain("Sales team"));
    act(() => {
      onlineManager.setOnline(false);
      void client.refetchQueries();
    });
    await until(() => expect(state("cost-center-register-notice")).toBe("paused"));
    expect(text("cost-center-register")).toContain("Sales team");
  });

  it("a successful empty list shows the empty state and real zero counts, and no P&L", async () => {
    handlers[REGISTER] = () => json([]);
    render();
    await until(() => expect(container.textContent).toContain(t.en["screens.noCostCenters"]));
    expect(text("cost-center-counts")).toContain("0 cost centers");
    expect(byId("cost-center-pl")).toBeNull();
  });

  it("keeps zero totals from a successful report", async () => {
    render();
    await until(() => expect(text("cost-center-stat-income")).toContain("0.00"));
    expect(container.textContent).toContain(t.en["costCenters.allPostedPeriods"]);
    expect(container.textContent).toContain(
      t.en["pageLabels.noCostCenterAllocationsHaveBeenPostedYet"]
    );
  });

  it("the selected center report is pending, then fails with Retry, then shows zeroes", async () => {
    let respond!: (response: Response) => void;
    handlers[REPORT] = () => new Promise<Response>((resolve) => (respond = resolve));
    render();
    await until(() => expect(text("cost-center-register")).toContain("Sales team"));
    click(byId("cost-center-register")?.querySelector("tbody tr"));
    await until(() => expect(state("cost-center-report-notice")).toBe("pending"));
    expect(byId("cost-center-report")).toBeNull();

    await act(async () => respond(failure()));
    await until(() => expect(retryButton("cost-center-report-notice")).toBeTruthy());

    handlers[REPORT] = () => json({ totalIncome: 0, totalExpenses: 0, netIncome: 0 });
    click(retryButton("cost-center-report-notice"));
    await until(() => expect(text("cost-center-report")).toContain("0.00"));
    expect(byId("cost-center-report-notice")).toBeNull();
  });

  it("cancelling a query aborts its network request", async () => {
    handlers[REGISTER] = never;
    render();
    await until(() => expect(signals[REGISTER]).toBeTruthy());
    expect(signals[REGISTER]!.aborted).toBe(false);
    await act(async () => {
      await client.cancelQueries();
    });
    expect(signals[REGISTER]!.aborted).toBe(true);
  });
});
