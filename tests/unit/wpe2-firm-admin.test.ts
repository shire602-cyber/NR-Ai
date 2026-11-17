// @vitest-environment jsdom
/**
 * WP-E2: value programmes table, anomaly checks embedded in the Assistant, the clients list
 * without the command-centre blocks, the inline role picker, and Arabic rendering of those
 * screens (no English app copy).
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c-1", company: { id: "c-1" }, isLoading: false }),
}));
vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c-1", company: { id: "c-1" }, isLoading: false }),
}));

vi.mock("../../client/src/components/ActiveCompanyProvider", () => ({
  useActiveCompany: () => ({
    company: null,
    isFirmContext: false,
    setActiveClientCompany: () => undefined,
    clearActiveClientCompany: () => undefined,
  }),
}));

let container: HTMLDivElement;
let root: Root;
const LATIN_WORD = /[A-Za-z]{3,}/;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const VALUE_OPS = {
  summary: {
    totalClients: 2,
    cashAtRisk: 12000,
    penaltyRiskClients: 1,
    auditPacksReady: 0,
    closeReadyClients: 1,
    reviewerQueueItems: 3,
    whatsappQueueItems: 0,
    projectedNraMonthlyRevenue: 0,
    nraServiceAr: 500,
    migrationBlockers: 0,
  },
  opportunities: [
    "audit_defense",
    "bank_close",
    "penalty_prevention",
    "cash_recovery",
    "nra_profitability",
    "compliance_risk",
    "ai_review",
    "whatsapp_cockpit",
    "monthly_cfo_pack",
    "migration_concierge",
  ].map((lane, i) => ({
    lane,
    title: `Server title ${lane}`,
    valueMetric: `${i} server metric`,
    count: i,
    impactAed: i * 1000,
    topClient: i === 3 ? "Al Noor Trading LLC" : null,
  })),
  actions: [
    {
      id: "a1",
      lane: "cash_recovery",
      priority: "high",
      companyId: "x1",
      companyName: "Al Noor Trading LLC",
      title: "Recover overdue receivables",
      detail: "2 collection or document messages ready",
      impactAed: 9200,
      href: "/firm/clients/x1",
    },
    {
      id: "a2",
      lane: "bank_close",
      priority: "medium",
      companyId: "x2",
      companyName: "Oasis Consulting FZ-LLC",
      title: "Unblock month-end close",
      detail: "3 bank items, 1 receipts need review",
      impactAed: 0,
      href: "/firm/clients/x2",
    },
  ],
  clients: [],
};

const REVIEW_QUEUE = [
  {
    id: "anomaly:1",
    kind: "anomaly",
    priority: "medium",
    companyId: "x1",
    companyName: "Unknown client",
    entityId: "e1",
    entityType: "receipt",
    title: "Vat Rate Mismatch",
    explanation: "Receipt from Careem: VAT AED 5.00 is not 5% of the net AED 105.00.",
    suggestedAction: "Review the source transaction and resolve or document the exception.",
    rule: "vat_rate_mismatch",
    message: {
      key: "anomaly.vatMismatchReceipt",
      params: { merchant: "Careem", vat: "5.00", net: "105.00" },
    },
    confidence: 0.55,
    amountAed: 0,
    dueDate: null,
    href: "/firm/clients/x1",
  },
];

const ANOMALIES = {
  anomalies: [
    {
      id: "al1",
      type: "duplicate",
      rule: "duplicate_amount",
      severity: "warning",
      description:
        "2 receipts with the same amount (AED 105.00) on 2026-11-14. Possible duplicate entries from Careem, Careem.",
      message: {
        key: "anomaly.duplicateReceipts",
        params: { n: "2", amount: "105.00", date: "2026-11-14", merchants: "Careem, Careem" },
      },
      amount: 105,
      date: "2026-11-14",
      relatedId: "r1",
      relatedType: "receipt",
    },
  ],
  summary: { total: 1, critical: 0, warning: 1, info: 0 },
  scannedAt: "2026-11-14T10:00:00Z",
};
const NO_ANOMALIES = {
  anomalies: [],
  summary: { total: 0, critical: 0, warning: 0, info: 0 },
  scannedAt: null,
};

let anomalyBody: unknown = NO_ANOMALIES;

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/firm/value-ops/review-queue")) return json(REVIEW_QUEUE);
      if (url.includes("/api/firm/value-ops")) return json(VALUE_OPS);
      if (url.includes("/anomalies")) return json(anomalyBody);
      if (url.includes("/api/firm/clients"))
        return json([
          {
            id: "x1",
            name: "Al Noor Trading LLC",
            trnVatNumber: "100234567800003",
            industry: null,
            invoiceCount: 3,
            lastReceiptDate: null,
            outstandingAr: 100,
            serviceScope: ["vat", "bookkeeping"],
            assignedStaff: [],
          },
        ]);
      if (url.includes("/api/firm/bookkeeper-dashboard"))
        return json({
          summary: { critical: 0, attention: 0, vatDue28Days: 0, bookkeepingBlocked: 0 },
          vatCohorts: [],
          workload: { unassignedClients: 0 },
          clients: [],
        });
      if (url.includes("/api/firm/overview"))
        return json({ totalClients: 1, vatDueThisMonth: 0, overdueAr: 0, needsAttention: 0 });
      if (url.includes("/team")) return json([]);
      return json({});
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale("en"));
});

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function setLocale(locale: "en" | "ar") {
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale(locale));
}

async function mount(component: React.ComponentType, qc?: QueryClient) {
  const { queryClient } = await import("../../client/src/lib/queryClient");
  const client = qc ?? queryClient;
  if (!qc) client.clear();
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(component)));
  });
  await flush();
}

describe("value programmes", () => {
  it("shows one row per programme with count, value and next client, and opens its actions", async () => {
    const { default: ValueOps } = await import("../../client/src/pages/firm/ValueOps");
    await mount(ValueOps);
    const rows = container.querySelectorAll('[data-testid^="value-ops-programme-"]');
    expect(rows.length).toBe(10);
    const text = container.querySelector('[data-testid="value-ops-programmes"]')!.textContent!;
    expect(text).toContain("Cash recovery");
    expect(text).toContain("Al Noor Trading LLC");
    // The server's English headline strings are no longer shown as tiles.
    expect(container.textContent).not.toContain("server metric");
    expect(container.textContent).not.toContain("Server title");
    // Row click filters the actions to that programme.
    await act(async () => {
      container
        .querySelector<HTMLElement>('[data-testid="value-ops-programme-cash_recovery"]')!
        .click();
    });
    await flush();
    expect(container.textContent).toContain("Recover overdue receivables");
    expect(container.textContent).not.toContain("Unblock month-end close");
    expect(container.textContent).toContain("Programme: Cash recovery");
  });

  it("has no English app copy in Arabic (names and amounts aside)", async () => {
    const { default: ValueOps } = await import("../../client/src/pages/firm/ValueOps");
    await setLocale("ar");
    await mount(ValueOps);
    const strip = (s: string) =>
      s
        .replace(
          /Al Noor Trading LLC|Oasis Consulting FZ-LLC|AED|NRA|WhatsApp|CFO|VAT|AI|TRN|Muhasib/g,
          ""
        )
        .replace(/translate="no"/g, "");
    expect(
      strip(container.querySelector('[data-testid="value-ops-programmes"]')!.textContent!)
    ).not.toMatch(LATIN_WORD);
    // Review queue tab: anomaly title, explanation and suggested action come from the catalogs.
    await act(async () => {
      const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
      tabs[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      tabs[1].click();
    });
    await flush();
    const panel = container.querySelector('[role="tabpanel"][data-state="active"]')!;
    expect(strip(panel.textContent!).replace(/Careem/g, "")).not.toMatch(LATIN_WORD);
  });
});

describe("anomaly checks embedded in the assistant", () => {
  it("shows no tiles at zero, a secondary scan button and sentence case", async () => {
    const { AnomalyChecks } = await import("../../client/src/pages/AnomalyDetection");
    anomalyBody = NO_ANOMALIES;
    await mount(() => createElement(AnomalyChecks, { embedded: true }));
    expect(container.querySelector(".text-kpi")).toBeNull();
    const scan = container.querySelector<HTMLButtonElement>('[data-testid="button-run-scan"]')!;
    expect(scan.className).not.toContain("bg-primary");
    expect(scan.textContent).toBe("Run scan");
    expect(container.textContent).toContain("No anomalies found");
    expect(container.textContent).not.toMatch(/Run Scan|No Anomalies Found|Total Anomalies/);
  });

  it("renders the alert sentence from its key in the reader's language", async () => {
    const { AnomalyChecks } = await import("../../client/src/pages/AnomalyDetection");
    anomalyBody = ANOMALIES;
    await mount(() => createElement(AnomalyChecks, { embedded: true }));
    expect(container.textContent).toContain("14 Nov 2026");
    await setLocale("ar");
    await flush();
    const text = container.textContent!;
    expect(text).toContain("14 نوفمبر 2026");
    expect(text.replace(/Careem/g, "")).not.toMatch(LATIN_WORD);
  });
});

describe("clients list", () => {
  it("is the clients table only: no command centre blocks, one open action and a menu", async () => {
    const { default: ClientPortfolio } =
      await import("../../client/src/pages/firm/ClientPortfolio");
    await mount(ClientPortfolio);
    expect(container.querySelector('[data-testid="clients-table"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="practice-plan-tab"]')).toBeNull();
    expect(container.textContent).not.toContain("production matrix");
    expect(container.textContent).not.toMatch(/Production planner|Service matrix/i);
    expect(container.textContent).toContain("Al Noor Trading LLC");
    expect(container.textContent).toContain("Open books");
  });
});

describe("team list", () => {
  it("changes a role from a select in the row; a locked owner row stays a pill", async () => {
    const { default: TeamManagement } = await import("../../client/src/pages/TeamManagement");
    const { companyAccessQueryKey } = await import("../../client/src/lib/auth");
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const member = (id: string, role: string, name: string) => ({
      id,
      userId: `u-${id}`,
      companyId: "c-1",
      role,
      createdAt: "2026-11-01T00:00:00Z",
      user: { id: `u-${id}`, email: `${id}@example.com`, name },
    });
    qc.setQueryData(
      ["/api/companies", "c-1", "team"],
      [member("m-owner", "owner", "Omar Owner"), member("m-acc", "accountant", "Sara Accountant")]
    );
    qc.setQueryData(["/api/companies", "c-1", "team", "invitations"], []);
    qc.setQueryData(companyAccessQueryKey("c-1"), {
      role: "admin",
      permissions: ["team.manage", "team.read"],
      grantableRoles: ["accountant", "viewer"],
      viaFirmAccess: false,
    });
    await mount(TeamManagement, qc);
    expect(container.querySelector('[data-testid="select-role-m-acc"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="select-role-m-owner"]')).toBeNull();
    expect(container.querySelector('[data-testid="button-edit-m-acc"]')).toBeNull();
    expect(container.querySelector('[data-testid="member-m-owner"]')!.textContent).toContain(
      "Owner"
    );
  });
});
