// @vitest-environment jsdom
// R3 final round (CTO final review items 16, 17, 21, 23): dashboard "needs you" chips, command
// palette records / query echo / recents, Reports copy, and the books-status strip + avatar help.
// The chip, record-search and recents logic is exercised as behaviour (pure functions + jsdom
// storage). The remaining source checks pin wiring inside screens that only render inside the
// full authenticated shell with live API data (palette groups, report header copy, the strip on
// three pages, the avatar menu); the screenshots in design/FINAL2/R3 cover their rendering.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildNeedsYouChips,
  countOverdueInvoices,
} from "../../client/src/pages/dashboard/needsYou";
import {
  interpretPaletteQuery,
  paletteFilter,
  pushPaletteRecent,
  readPaletteRecents,
  searchPaletteRecords,
} from "../../client/src/lib/commandPaletteRecords";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const catalog = (loc: "en" | "ar", ns: string) =>
  JSON.parse(read(`client/src/locales/${loc}/${ns}.json`)) as Record<string, string>;

const dashEn = catalog("en", "dashboard");

describe("CTO 16: dashboard needs-you chips", () => {
  const today = "2026-11-16";
  const invoices = [
    { status: "sent", dueDate: "2026-10-01T00:00:00.000Z" },
    { status: "partial", dueDate: "2026-11-15" },
    { status: "sent", dueDate: "2026-11-16" }, // due today: not overdue
    { status: "paid", dueDate: "2026-01-01" },
    { status: "draft", dueDate: "2026-01-01" },
  ];

  it("counts sent / part-paid invoices past due only", () => {
    expect(countOverdueInvoices(invoices, today)).toBe(2);
  });

  it("builds up to four linked chips in a fixed order", () => {
    const chips = buildNeedsYouChips(
      {
        invoices,
        bankLines: [{ isReconciled: false }, { isReconciled: true }, { isReconciled: false }],
        payrollRuns: [{ status: "calculated" }, { status: "approved" }],
        vatStatus: { filingStatus: "due_soon", dueInDays: 5 },
        todayIso: today,
      },
      dashEn
    );
    expect(chips.map((c) => c.id)).toEqual([
      "overdue-invoices",
      "bank-review",
      "vat-return",
      "payroll-approval",
    ]);
    expect(chips.map((c) => c.href)).toEqual([
      "/invoices?status=overdue",
      "/bank-reconciliation",
      "/vat-filing",
      "/payroll",
    ]);
    expect(chips[0].label).toBe("2 overdue invoices");
    expect(chips[1].label).toBe("2 bank lines to review");
    expect(chips[2].label).toBe("VAT return due in 5 days");
    expect(chips[3].label).toBe("1 payroll run to approve");
  });

  it("shows nothing to do when the queues are empty, and an overdue VAT return as danger", () => {
    expect(buildNeedsYouChips({ invoices: [], todayIso: today }, dashEn)).toEqual([]);
    const [vat] = buildNeedsYouChips(
      { invoices: [], vatStatus: { filingStatus: "overdue" }, todayIso: today },
      dashEn
    );
    expect(vat.tone).toBe("danger");
    expect(vat.label).toBe("VAT return overdue");
  });

  it("replaces the insight sentence in the dashboard header and has Arabic copy", () => {
    const hero = read("client/src/pages/dashboard/DashboardHero.tsx");
    expect(hero).toContain("<NeedsYouStrip");
    expect(hero).not.toContain("dashboard.insightMargin");
    const ar = catalog("ar", "dashboard");
    for (const key of Object.keys(dashEn).filter((k) => k.startsWith("dashboard.needs"))) {
      expect(ar[key], key).toMatch(/[؀-ۿ]/);
    }
  });
});

describe("CTO 17: command palette", () => {
  beforeEach(() => window.localStorage.clear());

  it("interprets document numbers, amounts, TRNs and text", () => {
    expect(interpretPaletteQuery("INV-0012").kind).toBe("documentNumber");
    expect(interpretPaletteQuery("1,250.50")).toMatchObject({ kind: "amount", amount: 1250.5 });
    expect(interpretPaletteQuery("100211110000003").kind).toBe("trn");
    expect(interpretPaletteQuery("gulf horizon").kind).toBe("text");
  });

  it("finds invoice, customer and vendor records with a type and a deep link", () => {
    const data = {
      invoices: [
        {
          id: "i1",
          number: "INV-0012",
          customerName: "Gulf Horizon Trading LLC",
          total: "1250.50",
        },
        { id: "i2", number: "INV-0013", customerName: "شركة النور للتجارة", total: 300 },
      ],
      customers: [{ id: "c1", name: "Gulf Horizon Trading LLC", trnNumber: "100211120000003" }],
      vendors: [{ id: "v1", name: "Gulf Hosting LLC" }],
    };
    const byText = searchPaletteRecords("gulf", data);
    expect(byText.map((r) => r.kind)).toEqual(["invoice", "customer", "vendor"]);
    expect(byText[0].href).toBe("/invoices?open=i1");
    expect(byText[1].href).toBe("/contacts?q=Gulf%20Horizon%20Trading%20LLC");
    expect(searchPaletteRecords("1250.50", data).map((r) => r.id)).toEqual(["invoice-i1"]);
    expect(searchPaletteRecords("النور", data).map((r) => r.id)).toEqual(["invoice-i2"]);
    expect(searchPaletteRecords("100211120000003", data).map((r) => r.id)).toEqual(["customer-c1"]);
    expect(searchPaletteRecords("g", data)).toEqual([]);
  });

  it("filters palette items by whole query words, not fuzzy letters", () => {
    expect(paletteFilter("Receipt gap close Unposted receipts", "blue palm")).toBe(0);
    expect(paletteFilter("record invoice-1 INV-0012 Blue Palm Services LLC", "blue palm")).toBe(1);
    expect(paletteFilter("VAT Filing", "vat", ["returns"])).toBe(1);
    expect(paletteFilter("anything", "  ")).toBe(1);
  });

  it("keeps five most-recent entries, deduplicated, and ignores bad storage", () => {
    for (let i = 0; i < 7; i++) pushPaletteRecent({ id: `p${i}`, label: `P${i}`, href: `/p${i}` });
    pushPaletteRecent({ id: "p3", label: "P3", href: "/p3" });
    expect(readPaletteRecents().map((r) => r.id)).toEqual(["p3", "p6", "p5", "p4", "p2"]);
    window.localStorage.setItem("muhasib-command-recents", "{oops");
    expect(readPaletteRecents()).toEqual([]);
    window.localStorage.setItem(
      "muhasib-command-recents",
      JSON.stringify([{ id: "x", label: "X", href: "https://evil.example" }])
    );
    expect(readPaletteRecents()).toEqual([]);
  });

  it("renders Recent + Actions in the empty state and echoes the query", () => {
    const src = read("client/src/components/CommandPalette.tsx");
    expect(src).toContain('data-testid="command-group-recent"');
    expect(src).toContain('data-testid="command-group-actions"');
    expect(src).toContain('data-testid="command-group-records"');
    expect(src).toContain('data-testid="command-palette-echo"');
    expect(src).toContain('href: "/receipts?upload=1"');
    const shellEn = catalog("en", "shell");
    expect(shellEn["shell.cmdActionScanReceipt"]).toBe("Scan receipt");
    expect(shellEn["shell.cmdGroupRecent"]).toBe("Recent");
    // Record deep links are honoured by the target pages.
    expect(read("client/src/pages/Invoices.tsx")).toContain('params.get("open")');
    expect(read("client/src/pages/CustomerContacts.tsx")).toContain('.get("q")');
  });
});

describe("CTO 21: Reports copy", () => {
  it("says Audit evidence, drops automation-ready, and labels the picker field Report", () => {
    const i18n = read("client/src/lib/i18n.ts");
    expect(i18n).toContain('viewProof: "Audit evidence"');
    expect(i18n).not.toContain("automation-ready workspaces");
    const header = read("client/src/pages/reports/panels/ReportsHeader.tsx");
    expect(header).not.toContain("View proof");
    expect(header).toContain('k="reportCenter.reportFieldLabel"');
    expect(catalog("en", "reportCenter")["reportCenter.reportFieldLabel"]).toBe("Report");
  });

  it("wraps long report names to two lines instead of truncating them", () => {
    // Spec 3.11 (WP-D): statements and reports render as rows of one catalogue module.
    const panel = read("client/src/pages/reports/panels/ReportCatalogue.tsx");
    expect(panel).toContain("line-clamp-2 break-words text-body font-medium");
  });
});

describe("CTO 23: books status strip and avatar help", () => {
  it("puts the books-balanced / period-lock strip on ledger and report screens", () => {
    const strip = read("client/src/components/reports/BooksStatusStrip.tsx");
    expect(strip).toContain("/period-lock");
    expect(strip).toContain("/reports/trial-balance");
    for (const page of [
      "client/src/pages/Journal.tsx",
      "client/src/pages/reports/panels/ReportsHeader.tsx",
      "client/src/pages/FinancialStatements.tsx",
    ]) {
      expect(read(page), page).toContain("<BooksStatusStrip");
    }
  });

  it("gives the avatar a menu with Help centre and Talk to an accountant", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain("<AccountMenu />");
    const menu = read("client/src/components/layout/AccountMenu.tsx");
    expect(menu).toContain('href="/help"');
    expect(menu).toContain('data-testid="menu-account-talk-to-accountant"');
    expect(menu).toContain('data-testid="button-profile"');
    const ar = catalog("ar", "shell");
    expect(ar["shell.accountTalkToAccountant"]).toBe("تحدّث مع محاسب");
  });
});
