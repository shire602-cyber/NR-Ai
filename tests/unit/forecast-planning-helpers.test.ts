/**
 * W3-E pure helpers: dashboard periods and month keys, forecast stepping, budget variance sign
 * and plan months, validators, anomaly z-score, news feed parsing.
 * Issue ids: R13-09, R13-10, R13-11, R13-19, R13-24, R13-31, R13-35, R12-04.
 */
import { describe, expect, it } from "vitest";
import {
  lastMonthKeys,
  resolveDashboardPeriod,
} from "../../server/services/dashboard-stats.service";
import { stepDate } from "../../server/services/cashflow-forecast.service";
import {
  alertCandidates,
  planMonths,
  varianceFor,
} from "../../server/services/budget-variance.service";
import { zScore } from "../../server/services/anomaly-detection.service";
import {
  configuredFeedUrls,
  getNewsFeedStatus,
  parseFeed,
  sourceForUrl,
} from "../../server/services/news-ingest.service";
import {
  budgetLineCreateBody,
  budgetPlanCreateBody,
  budgetPlanUpdateBody,
} from "../../shared/validators/budgets";

describe("R13-09 month keys are built from integers", () => {
  it("never skips or repeats a month from the 29th-31st", () => {
    for (const today of ["2026-10-31", "2026-03-31", "2026-01-29", "2026-12-31", "2024-02-29"]) {
      const keys = lastMonthKeys(today, 6).map((k) => k.key);
      expect(new Set(keys).size).toBe(6);
      expect(keys.at(-1)).toBe(today.slice(0, 7));
    }
    expect(lastMonthKeys("2026-10-31", 6).map((k) => k.label)).toEqual([
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
    ]);
    expect(lastMonthKeys("2026-02-10", 3).map((k) => k.key)).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });
});

describe("R13-19 dashboard periods", () => {
  it("resolves month, quarter, ytd (fiscal) and custom", () => {
    expect(resolveDashboardPeriod({}, "2026-11-15")).toMatchObject({
      preset: "month",
      from: "2026-11-01",
      to: "2026-11-15",
    });
    expect(resolveDashboardPeriod({ preset: "quarter" }, "2026-11-15").from).toBe("2026-10-01");
    expect(resolveDashboardPeriod({ preset: "ytd" }, "2026-11-15").from).toBe("2026-01-01");
    expect(resolveDashboardPeriod({ preset: "ytd" }, "2026-11-15", 7).from).toBe("2026-07-01");
    expect(resolveDashboardPeriod({ preset: "ytd" }, "2026-03-15", 7).from).toBe("2025-07-01");
    expect(
      resolveDashboardPeriod(
        { preset: "custom", from: "2026-01-01", to: "2026-02-01" },
        "2026-11-15"
      ).to
    ).toBe("2026-02-01");
  });

  it("rejects unknown presets and bad custom ranges with a code", () => {
    expect(() => resolveDashboardPeriod({ preset: "week" }, "2026-11-15")).toThrow(/preset/);
    expect(() => resolveDashboardPeriod({ preset: "custom" }, "2026-11-15")).toThrow(/from and to/);
    expect(() =>
      resolveDashboardPeriod(
        { preset: "custom", from: "2026-02-01", to: "2026-01-01" },
        "2026-11-15"
      )
    ).toThrow(/on or before/);
  });
});

describe("R13-24 recurring cadence", () => {
  it("steps by frequency with month-end clamping and rejects unknown frequencies", () => {
    expect(stepDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(stepDate("2026-11-20", "weekly")).toBe("2026-11-27");
    expect(stepDate("2026-11-20", "quarterly")).toBe("2027-02-20");
    expect(stepDate("2026-11-20", "yearly")).toBe("2027-11-20");
    expect(stepDate("2026-11-20", "whenever")).toBeNull();
  });
});

describe("R13-11 variance sign by account type", () => {
  it("income above budget is favourable, expense above budget is not", () => {
    expect(varianceFor("income", 1000, 1400)).toEqual({
      variance: 400,
      variancePercent: 40,
      favourable: true,
    });
    expect(varianceFor("income", 1000, 600)).toMatchObject({ variance: -400, favourable: false });
    expect(varianceFor("expense", 500, 800)).toEqual({
      variance: -300,
      variancePercent: -60,
      favourable: false,
    });
    expect(varianceFor("expense", 500, 300)).toMatchObject({ variance: 200, favourable: true });
    expect(varianceFor("expense", 0, 0)).toEqual({
      variance: 0,
      variancePercent: 0,
      favourable: true,
    });
  });

  it("maps plan months to distinct year-months", () => {
    expect(planMonths("2026-12-01", "2027-01-31")).toEqual([
      { key: "2026-12", column: "dec" },
      { key: "2027-01", column: "jan" },
    ]);
    expect(planMonths("2026-01-01", "2026-12-31")).toHaveLength(12);
  });

  it("alerts only on unfavourable, past-threshold, non-future months", () => {
    const report = {
      budget: { id: "b" },
      varianceLines: [
        {
          id: "l1",
          category: "Rent",
          accountId: "a1",
          accountType: "expense",
          months: {
            sep: {
              periodKey: "2026-09",
              budget: 100,
              actual: 105,
              variance: -5,
              variancePercent: -5,
              favourable: false,
            },
            oct: {
              periodKey: "2026-10",
              budget: 100,
              actual: 150,
              variance: -50,
              variancePercent: -50,
              favourable: false,
            },
            dec: {
              periodKey: "2026-12",
              budget: 100,
              actual: 300,
              variance: -200,
              variancePercent: -200,
              favourable: false,
            },
          },
        },
      ],
    } as unknown as Parameters<typeof alertCandidates>[0];
    const out = alertCandidates(report, 10, "2026-11-15");
    expect(out.map((o) => o.period)).toEqual(["2026-10"]);
  });
});

describe("R13-10 budget validators", () => {
  const plan = { name: "FY", fiscalYear: 2026, startDate: "2026-01-01", endDate: "2026-12-31" };
  it("accepts a calendar-year plan and rejects reversed, long and garbage input", () => {
    expect(budgetPlanCreateBody.safeParse(plan).success).toBe(true);
    expect(budgetPlanCreateBody.safeParse({ ...plan, endDate: "2025-12-31" }).success).toBe(false);
    expect(budgetPlanCreateBody.safeParse({ ...plan, endDate: "2027-01-31" }).success).toBe(false);
    expect(budgetPlanCreateBody.safeParse({ ...plan, fiscalYear: "abc" }).success).toBe(false);
    expect(budgetPlanCreateBody.safeParse({ ...plan, extra: 1 }).success).toBe(false);
    expect(budgetPlanUpdateBody.safeParse({ status: "approved" }).success).toBe(false);
    expect(budgetPlanUpdateBody.safeParse({ status: "closed" }).success).toBe(true);
  });

  it("rejects NaN, text and negatives (unless contra) in month amounts", () => {
    // E2 (J3-r2): a new line names its income / expense account.
    const a = { category: "x", accountId: "11111111-1111-4111-8111-111111111111" };
    expect(budgetLineCreateBody.safeParse({ ...a, nov: "abc" }).success).toBe(false);
    expect(budgetLineCreateBody.safeParse({ ...a, nov: -1 }).success).toBe(false);
    expect(budgetLineCreateBody.safeParse({ ...a, isContra: true, nov: -1 }).success).toBe(true);
    expect(budgetLineCreateBody.safeParse({ ...a, nov: "12.345" }).success).toBe(false);
    const ok = budgetLineCreateBody.parse({ ...a, nov: "10.5" });
    expect(ok.nov).toBe("10.50");
  });
});

describe("R13-31 z-score baseline", () => {
  it("needs three months and a non-flat baseline", () => {
    expect(zScore([100, 100], 500)).toBeNull();
    expect(zScore([100, 100, 100], 500)).toBeNull();
    const z = zScore([1000, 1100, 900, 1000], 5000);
    expect(z!.z).toBeGreaterThan(10);
    expect(z!.mean).toBe(1000);
  });
});

describe("R13-35 news feed", () => {
  const rss = `<rss version="2.0"><channel>
    <item><title>One &amp; two</title><link>https://tax.gov.ae/1</link><guid>g1</guid>
      <pubDate>Mon, 09 Nov 2026 08:00:00 GMT</pubDate><description>&lt;b&gt;Bold&lt;/b&gt; text</description></item>
    <item><title></title><pubDate>Mon, 09 Nov 2026 08:00:00 GMT</pubDate></item>
    <item><title>No date</title><guid>g3</guid></item>
  </channel></rss>`;
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom item</title><id>urn:1</id>
    <link href="https://www.mof.gov.ae/a"/><updated>2026-11-10T08:00:00Z</updated><summary>S</summary></entry></feed>`;

  it("parses RSS and Atom, strips markup and skips incomplete items", () => {
    const items = parseFeed(rss);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ externalId: "g1", title: "One & two", summary: "Bold text" });
    const a = parseFeed(atom);
    expect(a[0]).toMatchObject({
      externalId: "urn:1",
      sourceUrl: "https://www.mof.gov.ae/a",
      title: "Atom item",
    });
  });

  it("is requires_external until NEWS_FEED_URLS has an https URL", () => {
    expect(getNewsFeedStatus({}).status).toBe("requires_external");
    expect(getNewsFeedStatus({ NEWS_FEED_URLS: "http://insecure.example/feed" }).status).toBe(
      "requires_external"
    );
    const live = getNewsFeedStatus({
      NEWS_FEED_URLS: "https://tax.gov.ae/feed, https://www.gulfnews.com/rss",
    });
    expect(live).toMatchObject({ status: "live", feedCount: 2 });
    expect(configuredFeedUrls({ NEWS_FEED_URLS: "not a url,https://a.example/f" })).toEqual([
      "https://a.example/f",
    ]);
    expect(sourceForUrl("https://www.tax.gov.ae/x")).toBe("fta");
    expect(sourceForUrl("https://gulfnews.com/rss")).toBe("gulf_news");
    expect(sourceForUrl("https://other.example/rss")).toBe("other");
  });
});
