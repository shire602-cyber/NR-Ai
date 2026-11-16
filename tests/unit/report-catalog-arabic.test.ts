/**
 * F7 / R18-02: the report catalog keeps English labels in client/src/lib/reportCatalog.ts
 * (single source, stable ids) and Arabic display strings as a keyed overlay in
 * client/src/locales/ar-catalog/reportCatalog.json. Every field the report launcher and
 * dashboard render must have a real Arabic entry, and stale keys must not linger.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  readyReportCatalog,
  reportAutomationStarters,
  reportCatalog,
  reportComparisonPresets,
  reportDecisionShortcuts,
  reportPackTemplates,
  reportPersonaWorkspaces,
  reportSuiteProfiles,
} from "../../client/src/lib/reportCatalog";
import { catalogText, catalogTextKey } from "../../client/src/lib/reportCatalogText";
import { reportNameAr, reportQuestionAr } from "../../client/src/lib/reportCatalogI18n";
import { loadLocale, t } from "../../client/src/lib/i18n";

const overlay = JSON.parse(
  readFileSync(join(process.cwd(), "client/src/locales/ar-catalog/reportCatalog.json"), "utf8")
) as Record<string, string>;

const ARABIC = /[؀-ۿ]/;

/** Every (key, English) pair the launcher / dashboard render. */
function renderedCatalogFields(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const w of reportPersonaWorkspaces) {
    out.push([catalogTextKey("workspace", w.persona, "navLabel"), w.navLabel]);
    out.push([catalogTextKey("workspace", w.persona, "automationOutcome"), w.automationOutcome]);
  }
  for (const r of readyReportCatalog) {
    out.push([catalogTextKey("report", r.id, "name"), r.name]);
    out.push([catalogTextKey("report", r.id, "decisionQuestion"), r.decisionQuestion]);
    out.push([catalogTextKey("category", r.category, "label"), r.category]);
  }
  for (const s of reportSuiteProfiles) {
    for (const f of ["title", "workflow", "outcome"] as const)
      out.push([catalogTextKey("suite", s.id, f), s[f]]);
  }
  for (const s of reportDecisionShortcuts) {
    for (const f of ["question", "answer"] as const)
      out.push([catalogTextKey("shortcut", s.id, f), s[f]]);
  }
  for (const p of reportComparisonPresets) {
    for (const f of ["title", "question", "baseline", "automationTrigger"] as const)
      out.push([catalogTextKey("preset", p.id, f), p[f]]);
  }
  for (const p of reportPackTemplates) {
    for (const f of ["title", "outcome", "cadence", "delivery"] as const)
      out.push([catalogTextKey("pack", p.id, f), p[f]]);
  }
  for (const s of reportAutomationStarters) {
    for (const f of ["title", "outcome"] as const)
      out.push([catalogTextKey("starter", s.id, f), s[f]]);
  }
  return out;
}

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

describe("F7 report catalog Arabic overlay", () => {
  it("[R18-02] every rendered catalog field has an Arabic entry in Arabic script", () => {
    const missing: string[] = [];
    for (const [key, english] of renderedCatalogFields()) {
      const value = overlay[key];
      if (!value || !ARABIC.test(value)) missing.push(`${key} (${english})`);
    }
    expect(missing).toEqual([]);
  });

  it("[R18-02] overlay keys all point at a live catalog id (no stale keys)", () => {
    const valid = new Set(renderedCatalogFields().map(([key]) => key));
    for (const r of reportCatalog) {
      valid.add(catalogTextKey("report", r.id, "name"));
      valid.add(catalogTextKey("report", r.id, "decisionQuestion"));
    }
    expect(Object.keys(overlay).filter((key) => !valid.has(key))).toEqual([]);
  });

  it("[R18-02] loadLocale('ar') merges the overlay; English falls back to the catalog", () => {
    const suite = reportSuiteProfiles[0];
    const ar = t.ar as Record<string, string>;
    const en = t.en as Record<string, string>;
    expect(catalogText(ar, "ar", "suite", suite.id, "title", suite.title)).toBe(
      overlay[catalogTextKey("suite", suite.id, "title")]
    );
    expect(catalogText(en, "en", "suite", suite.id, "title", suite.title)).toBe(suite.title);
    expect(catalogText(ar, "ar", "suite", "no-such-suite", "title", "Fallback")).toBe("Fallback");
    // the overlay is not an English namespace
    expect(en[catalogTextKey("suite", suite.id, "title")]).toBeUndefined();
  });

  it("[R18-02] the Report Center name/question maps derive from the same overlay", () => {
    expect(reportNameAr["profit-loss"]).toBe(overlay["reportCatalog.report.profit-loss.name"]);
    expect(reportQuestionAr["balance-sheet"]).toBe(
      overlay["reportCatalog.report.balance-sheet.decisionQuestion"]
    );
    expect(Object.keys(reportNameAr).length).toBeGreaterThanOrEqual(readyReportCatalog.length);
  });
});
