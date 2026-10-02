// Runs the report viewer's own client modules under Node and prints what they would send to / read from the server,
// so tests/integration/phase8-d4.test.mjs can check the real UI contract against a live server (Phase 8 D4, frontend).
//   echo '{"drills":[{"target":"invoice","id":"x"}]}' | npx tsx tests/integration/helpers/report-ui-contract.mts
import { readFileSync } from "node:fs";
import { reportCatalog } from "../../../client/src/lib/reportCatalog";
import { drillHref } from "../../../client/src/lib/report-drill";
import { AS_OF_PRESETS, RANGE_PRESETS } from "../../../client/src/lib/report-presets";
import { AGEING_BUCKET_KEYS, dashboardStatsPath, normalizeBuckets, vatDueView } from "../../../client/src/lib/dashboardStats";
import { buildRunQuery, comparisonChoices, defaultViewState, reportRunPath, stateForTabReport } from "../../../client/src/lib/report-query";

const input = JSON.parse(readFileSync(0, "utf8") || "{}") as {
  companyId?: string;
  drills?: Array<{ target: string; id: string }>;
  stats?: { arAging?: Record<string, number>; apAging?: Record<string, number>; vatDueNext?: any };
};

const live = reportCatalog.filter((r) => r.status === "live" && r.params && r.params.length > 0);
const reports = live.map((r) => {
  const kinds = r.params!;
  const state = defaultViewState(r.id);
  const compare = comparisonChoices(r.id, kinds)
    .filter((mode) => mode !== "none" && mode !== "custom")
    .map((mode) => ({ mode, query: buildRunQuery(r.id, kinds, { ...state, compare: mode }, { lang: "ar", limit: 250 }) }));
  const tab = stateForTabReport(r.id, { from: "2026-01-01", to: "2026-03-31", agingAsOf: "2026-02-28" });
  return {
    id: r.id,
    kinds,
    path: reportRunPath(input.companyId ?? "COMPANY", r.id, ""),
    query: buildRunQuery(r.id, kinds, state, { lang: "ar", limit: 250 }),
    nextPageQuery: buildRunQuery(r.id, kinds, state, { lang: "en", limit: 1, offset: 1 }),
    compare,
    tabQuery: buildRunQuery(r.id, kinds, tab, { lang: "en" }),
    csvQuery: buildRunQuery(r.id, kinds, state, { lang: "ar", format: "csv" }),
  };
});

console.log(
  JSON.stringify({
    reports,
    rangePresets: RANGE_PRESETS,
    asOfPresets: AS_OF_PRESETS,
    bucketKeys: AGEING_BUCKET_KEYS,
    dashboardPaths: { month: dashboardStatsPath("COMPANY", "month"), ytd: dashboardStatsPath("COMPANY", "ytd") },
    drillHrefs: (input.drills ?? []).map((d) => drillHref(d as any)),
    ageing: input.stats ? { ar: normalizeBuckets(input.stats.arAging), ap: normalizeBuckets(input.stats.apAging), vat: vatDueView(input.stats.vatDueNext) } : null,
  })
);
