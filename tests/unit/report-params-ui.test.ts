import { describe, expect, it } from "vitest";
import "../../server/reports/definitions";
import { listReports } from "../../server/reports/registry";
import {
  parseRunQuery,
  resolveAsOfPreset as serverAsOf,
  resolveRangePreset as serverRange,
} from "../../server/reports/params";
import { reportCatalog } from "../../client/src/lib/reportCatalog";
import {
  AS_OF_PRESETS,
  RANGE_PRESETS,
  dubaiToday,
  resolveAsOfPreset,
  resolveRangePreset,
} from "../../client/src/lib/report-presets";
import { REPORT_UI_RULES, reportUiRule } from "../../client/src/lib/report-ui-rules";
import {
  buildRunQuery,
  comparisonChoices,
  defaultViewState,
  reportRunPath,
  withAsOfPreset,
  withRangePreset,
} from "../../client/src/lib/reportRunApi";

// 31 Mar 2028 (leap year) 22:30 UTC is already 1 Apr in Dubai; 29 Feb 2028 and a fiscal April start exercise the edges.
const NOWS = [
  new Date("2026-10-02T09:00:00Z"),
  new Date("2026-03-31T22:30:00Z"),
  new Date("2028-02-29T10:00:00Z"),
  new Date("2027-01-01T00:30:00Z"),
  new Date("2026-12-31T20:30:00Z"),
];

describe("range and as-of presets agree with the server", () => {
  for (const now of NOWS) {
    for (const month of [1, 4, 7]) {
      it(`${now.toISOString()} fiscal month ${month}`, () => {
        for (const preset of RANGE_PRESETS) {
          expect(resolveRangePreset(preset, now, month), preset).toEqual(
            serverRange(preset, now, month)
          );
        }
        for (const preset of AS_OF_PRESETS) {
          expect(resolveAsOfPreset(preset, now, month), preset).toBe(
            serverAsOf(preset, now, month)
          );
        }
      });
    }
  }

  it("Dubai midnight: 20:00 UTC is already the next Dubai day", () => {
    expect(dubaiToday(new Date("2026-10-02T19:59:00Z"))).toBe("2026-10-02");
    expect(dubaiToday(new Date("2026-10-02T20:00:00Z"))).toBe("2026-10-03");
  });
});

describe("the viewer's UI rules match the server definitions", () => {
  const registered = listReports();

  it("has no rule for a report that is gone", () => {
    const ids = new Set(registered.map((r) => r.id));
    expect(Object.keys(REPORT_UI_RULES).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("filters and flags match (a report with no rule needs none: add its filters to report-ui-rules.ts)", () => {
    for (const def of registered) {
      const rule = reportUiRule(def.id);
      expect([...rule.filters].sort(), `${def.id} filters`).toEqual(
        [...(def.filters ?? [])].sort()
      );
      expect(Boolean(rule.sensitive), `${def.id} sensitive`).toBe(Boolean(def.sensitive));
      expect(Boolean(rule.noFutureAsOf), `${def.id} noFutureAsOf`).toBe(Boolean(def.noFutureAsOf));
      expect(Boolean(rule.ownComparison), `${def.id} ownComparison`).toBe(
        Boolean(def.ownComparison)
      );
      expect(rule.defaultCompare, `${def.id} defaultCompare`).toBe(def.defaultCompare);
      expect(Boolean(rule.budgetComparison), `${def.id} budgetComparison`).toBe(
        Boolean(def.budgetComparison)
      );
    }
  });
});

describe("preset to query string", () => {
  const defaults = { now: new Date("2026-10-02T09:00:00Z"), fiscalStartMonth: 1 };
  const kindsOf = (id: string) => reportCatalog.find((r) => r.id === id)!.params!;

  it("a range report sends from and to, never asOf", () => {
    const state = withRangePreset(defaultViewState("profit-loss", defaults), "lastMonth", defaults);
    const q = new URLSearchParams(
      buildRunQuery("profit-loss", kindsOf("profit-loss"), state, { lang: "en" })
    );
    expect(q.get("from")).toBe("2026-09-01");
    expect(q.get("to")).toBe("2026-09-30");
    expect(q.has("asOf")).toBe(false);
    expect(q.get("lang")).toBe("en");
    expect(q.has("compare")).toBe(false);
  });

  it("an as-of report sends asOf, never from or to", () => {
    const state = withAsOfPreset(defaultViewState("ar-aging", defaults), "lastMonthEnd", defaults);
    const q = new URLSearchParams(
      buildRunQuery("ar-aging", kindsOf("ar-aging"), state, { lang: "ar", format: "pdf" })
    );
    expect(q.get("asOf")).toBe("2026-09-30");
    expect(q.has("from")).toBe(false);
    expect(q.get("format")).toBe("pdf");
    expect(q.get("lang")).toBe("ar");
  });

  it("a comparison is sent only when the report has one", () => {
    const base = { ...defaultViewState("profit-loss", defaults), compare: "priorYear" as const };
    expect(
      new URLSearchParams(
        buildRunQuery("profit-loss", kindsOf("profit-loss"), base, { lang: "en" })
      ).get("compare")
    ).toBe("priorYear");
    expect(
      new URLSearchParams(
        buildRunQuery("vat-summary", kindsOf("vat-summary"), base, { lang: "en" })
      ).has("compare")
    ).toBe(false);
  });

  it("a custom comparison needs its days; half-filled it is left out", () => {
    const base = { ...defaultViewState("profit-loss", defaults), compare: "custom" as const };
    expect(
      new URLSearchParams(
        buildRunQuery("profit-loss", kindsOf("profit-loss"), base, { lang: "en" })
      ).has("compare")
    ).toBe(false);
    const full = { ...base, compareFrom: "2025-01-01", compareTo: "2025-03-31" };
    const q = new URLSearchParams(
      buildRunQuery("profit-loss", kindsOf("profit-loss"), full, { lang: "en" })
    );
    expect([q.get("compare"), q.get("compareFrom"), q.get("compareTo")]).toEqual([
      "custom",
      "2025-01-01",
      "2025-03-31",
    ]);
  });

  it("only the report's own filters are sent", () => {
    const state = {
      ...defaultViewState("general-ledger", defaults),
      filters: { accountId: "a", source: "invoice", userId: "u" },
    };
    const q = new URLSearchParams(
      buildRunQuery("general-ledger", kindsOf("general-ledger"), state, { lang: "en" })
    );
    expect(q.get("accountId")).toBe("a");
    expect(q.get("source")).toBe("invoice");
    expect(q.has("userId")).toBe(false);
  });

  it("offers a comparison choice only where the catalog says so, and 'none' only where it is optional", () => {
    expect(comparisonChoices("profit-loss", kindsOf("profit-loss"))).toEqual([
      "none",
      "priorPeriod",
      "priorYear",
      "custom",
    ]);
    expect(
      comparisonChoices("comparative-trial-balance", kindsOf("comparative-trial-balance"))
    ).toEqual(["priorPeriod", "priorYear", "custom"]);
    expect(comparisonChoices("ar-aging", kindsOf("ar-aging"))).toEqual([]);
    expect(defaultViewState("comparative-trial-balance", defaults).compare).toBe("priorPeriod");
  });

  it("the run path puts the report in the path and the query after it", () => {
    expect(reportRunPath("c1", "profit-loss", "from=2026-01-01")).toBe(
      "/api/companies/c1/reports/run/profit-loss?from=2026-01-01"
    );
    expect(reportRunPath("c1", "profit-loss", "")).toBe(
      "/api/companies/c1/reports/run/profit-loss"
    );
  });

  it("every live report's default query is accepted by the server's own parser", () => {
    for (const entry of reportCatalog.filter((r) => r.status === "live")) {
      const rule = reportUiRule(entry.id);
      const kinds = entry.params!;
      const state = defaultViewState(entry.id, defaults);
      const query = Object.fromEntries(
        new URLSearchParams(buildRunQuery(entry.id, kinds, state, { lang: "ar", limit: 100 }))
      );
      const parsed = parseRunQuery(
        query,
        {
          kinds,
          filters: rule.filters,
          noFutureAsOf: rule.noFutureAsOf,
          budgetComparison: rule.budgetComparison,
        },
        { now: defaults.now }
      );
      expect(parsed.ok, `${entry.id}: ${JSON.stringify((parsed as any).issue)}`).toBe(true);
    }
  });
});

describe("choices kept in the address bar", () => {
  const defaults = { now: new Date("2026-10-02T09:00:00Z"), fiscalStartMonth: 1 };
  const kindsOf = (id: string) => reportCatalog.find((r) => r.id === id)!.params!;

  it("round-trips a custom range, a comparison and filters", async () => {
    const { buildShareQuery, stateFromSearch } = await import("../../client/src/lib/reportRunApi");
    const state = {
      ...defaultViewState("general-ledger", defaults),
      rangePreset: "custom" as const,
      from: "2026-02-01",
      to: "2026-02-28",
      filters: { accountId: "9b2f6c3e-1a4d-4e8f-9a7b-0d1c2e3f4a5b", source: "invoice" },
    };
    const search = buildShareQuery("general-ledger", kindsOf("general-ledger"), state);
    expect(search).not.toContain("lang=");
    const back = stateFromSearch("general-ledger", kindsOf("general-ledger"), search, defaults);
    expect([back.from, back.to, back.rangePreset]).toEqual(["2026-02-01", "2026-02-28", "custom"]);
    expect(back.filters).toEqual(state.filters);

    const pl = { ...defaultViewState("profit-loss", defaults), compare: "priorYear" as const };
    const back2 = stateFromSearch(
      "profit-loss",
      kindsOf("profit-loss"),
      buildShareQuery("profit-loss", kindsOf("profit-loss"), pl),
      defaults
    );
    expect(back2.compare).toBe("priorYear");
  });

  it("ignores malformed days, unknown filters and a comparison the report does not have", async () => {
    const { stateFromSearch } = await import("../../client/src/lib/reportRunApi");
    const s = stateFromSearch(
      "ar-aging",
      kindsOf("ar-aging"),
      "asOf=not-a-day&compare=priorYear&accountId=x&from=2026-01-01&to=2026-02-01",
      defaults
    );
    expect(s.asOfPreset).toBe("today");
    expect(s.compare).toBe("none");
    expect(s.filters).toEqual({});
    expect(s.rangePreset).toBe("thisYear");
  });

  it("a report that always compares keeps a comparison even if the address says none", async () => {
    const { stateFromSearch } = await import("../../client/src/lib/reportRunApi");
    const s = stateFromSearch(
      "comparative-trial-balance",
      kindsOf("comparative-trial-balance"),
      "compare=none",
      defaults
    );
    expect(s.compare).toBe("priorPeriod");
  });
});

describe("the Reports page tabs feed the viewer", () => {
  const defaults = { now: new Date("2026-10-02T09:00:00Z"), fiscalStartMonth: 1 };

  it("a range report takes the tab's days; as-of reports use the range end, ageing uses its own date", async () => {
    const { stateForTabReport } = await import("../../client/src/lib/reportRunApi");
    const pl = stateForTabReport("profit-loss", { from: "2026-01-01", to: "2026-03-31" }, defaults);
    expect([pl.rangePreset, pl.from, pl.to]).toEqual(["custom", "2026-01-01", "2026-03-31"]);
    const bs = stateForTabReport(
      "balance-sheet",
      { from: "2026-01-01", to: "2026-03-31" },
      defaults
    );
    expect(bs.asOf).toBe("2026-03-31");
    const ar = stateForTabReport(
      "ar-aging",
      { from: "2026-01-01", to: "2026-03-31", agingAsOf: "2026-02-28" },
      defaults
    );
    expect(ar.asOf).toBe("2026-02-28");
    const arToday = stateForTabReport(
      "ar-aging",
      { from: "2026-01-01", to: "2026-03-31" },
      defaults
    );
    expect(arToday.asOf).toBe("2026-10-02");
  });

  it("with no custom range the fiscal year to date and today stay", async () => {
    const { stateForTabReport } = await import("../../client/src/lib/reportRunApi");
    const s = stateForTabReport("trial-balance", {}, defaults);
    expect([s.rangePreset, s.asOf]).toEqual(["thisYear", "2026-10-02"]);
  });
});

describe("a bookmarked range that is a preset shows as that preset", () => {
  const defaults = { now: new Date("2026-10-02T09:00:00Z"), fiscalStartMonth: 1 };
  it("recognises this fiscal year and last month, keeps anything else custom", async () => {
    const { stateFromSearch } = await import("../../client/src/lib/reportRunApi");
    const kinds = reportCatalog.find((r) => r.id === "profit-loss")!.params!;
    expect(
      stateFromSearch("profit-loss", kinds, "from=2026-01-01&to=2026-10-02", defaults).rangePreset
    ).toBe("thisYear");
    expect(
      stateFromSearch("profit-loss", kinds, "from=2026-09-01&to=2026-09-30", defaults).rangePreset
    ).toBe("lastMonth");
    expect(
      stateFromSearch("profit-loss", kinds, "from=2026-02-01&to=2026-02-15", defaults).rangePreset
    ).toBe("custom");
    const ageKinds = reportCatalog.find((r) => r.id === "ar-aging")!.params!;
    expect(stateFromSearch("ar-aging", ageKinds, "asOf=2026-10-02", defaults).asOfPreset).toBe(
      "today"
    );
  });
});

describe("strict consolidation", () => {
  const defaults = { now: new Date("2026-10-02T09:00:00Z"), fiscalStartMonth: 1 };
  const kinds = reportCatalog.find((r) => r.id === "consolidated-statements")!.params!;

  it("sends strict=1 only for the consolidation, only when ticked, and the server's parser accepts it", async () => {
    const { buildRunQuery, buildShareQuery, stateFromSearch } =
      await import("../../client/src/lib/reportRunApi");
    const base = defaultViewState("consolidated-statements", defaults);
    expect(
      new URLSearchParams(
        buildRunQuery("consolidated-statements", kinds, base, { lang: "en" })
      ).has("strict")
    ).toBe(false);
    const strict = { ...base, filters: { ...base.filters, strict: "1" } };
    const query = buildRunQuery("consolidated-statements", kinds, strict, { lang: "en" });
    expect(new URLSearchParams(query).get("strict")).toBe("1");
    const parsed = parseRunQuery(
      Object.fromEntries(new URLSearchParams(query)),
      { kinds, filters: ["companyIds", "statement"] },
      { now: defaults.now }
    );
    expect(parsed.ok).toBe(true);
    // another report never sends it
    const pl = { ...defaultViewState("profit-loss", defaults), filters: { strict: "1" } as any };
    expect(
      new URLSearchParams(
        buildRunQuery(
          "profit-loss",
          reportCatalog.find((r) => r.id === "profit-loss")!.params!,
          pl,
          { lang: "en" }
        )
      ).has("strict")
    ).toBe(false);
    const back = stateFromSearch(
      "consolidated-statements",
      kinds,
      buildShareQuery("consolidated-statements", kinds, strict),
      defaults
    );
    expect(back.filters.strict).toBe("1");
  });

  it("an unknown or inapplicable key is UNKNOWN_PARAM (not INVALID_PARAMS) from the server's parser", () => {
    const plKinds = reportCatalog.find((r) => r.id === "profit-loss")!.params!;
    const a = parseRunQuery({ bogus: "1" }, { kinds: plKinds, filters: [] }, { now: defaults.now });
    const b = parseRunQuery(
      { asOf: "2026-01-01" },
      { kinds: plKinds, filters: [] },
      { now: defaults.now }
    );
    expect(a.ok ? null : a.issue.code).toBe("UNKNOWN_PARAM");
    expect(b.ok ? null : b.issue.code).toBe("UNKNOWN_PARAM");
  });
});
