/**
 * F7 / F12 / F14 (R18-02): the report catalog keeps English labels in
 * client/src/lib/reportCatalog.ts (single source, stable ids) and Arabic display strings as a keyed
 * overlay in client/src/locales/ar-catalog/reportCatalog.json. Every user-visible string field of
 * every catalog entity (workspaces, setup and workflow steps, playbooks, quick access, saved views,
 * suites, reports, packs, management briefs, comparison presets, starters, impact profiles,
 * decision shortcuts, trigger rules, delivery subscriptions, product-depth areas and their nested
 * rows), every comparison metric label/signal, every generated display string (UI labels and
 * templated sentences) must have a real Arabic entry, and stale keys must not linger.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as catalog from "../../client/src/lib/reportCatalog";
import {
  reportCatalog,
  reportComparisonPresets,
  reportDeliverySubscriptions,
  reportManagementBriefProfiles,
  reportPersonaWorkspaces,
  reportSuiteProfiles,
} from "../../client/src/lib/reportCatalog";
import { catalogTextEntries } from "../../client/src/lib/reportCatalogFields";
import {
  GENERATED_TEXT_KEYS,
  catalogText,
  catalogTextByEnglish,
  catalogTextKey,
} from "../../client/src/lib/reportCatalogText";
import { REPORT_PATTERNS, REPORT_UI_TEXT } from "../../client/src/lib/reportCatalogGenerated";
import { reportNameAr, reportQuestionAr } from "../../client/src/lib/reportCatalogI18n";
import { loadLocale, t } from "../../client/src/lib/i18n";

const overlay = JSON.parse(
  readFileSync(join(process.cwd(), "client/src/locales/ar-catalog/reportCatalog.json"), "utf8")
) as Record<string, string>;

const ARABIC = /[؀-ۿ]/;
// Latin words allowed inside Arabic overlay values (brands, formats, codes).
const ALLOWED_LATIN =
  /^(?:PDF|Excel|Google|Sheets|VAT|WPS|SIF|AED|FX|NBV|OCR|UTC|CTA|KPI|API|A\/R|A\/P|P&L|DSO|DPO|Roll-up)$/;

function sourceFile(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/** Every comparison metric the Reports page emits: id, label, signal and custom period labels. */
function metricsFromSource() {
  const rows: Array<{ id: string; label: string | null; signal: string; extra: string[] }> = [];
  for (const file of ["financialMetrics", "automationMetrics", "complianceMetrics"]) {
    const src = sourceFile(`client/src/pages/reports/comparisons/${file}.ts`);
    for (const match of src.matchAll(/makeComparisonMetric\(\{([\s\S]*?)\n\s{4}\}\)/g)) {
      const body = match[1];
      const id = /\bid:\s*"([^"]+)"/.exec(body)?.[1];
      const label = /\blabel:\s*(?:\n\s*)?"([^"]+)"/.exec(body)?.[1] ?? null;
      const signal = /\bsignal:\s*(?:\n\s*)?"([^"]+)"/.exec(body)?.[1];
      expect(id, body.slice(0, 80)).toBeTruthy();
      expect(signal, `${id} signal`).toBeTruthy();
      const extra = [...body.matchAll(/\b(?:currentLabel|previousLabel):\s*"([^"]+)"/g)].map(
        (m) => m[1]
      );
      rows.push({ id: id!, label, signal: signal!, extra });
    }
  }
  return rows;
}

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

describe("F14 report catalog Arabic overlay", () => {
  it("[F14] every user-visible catalog field has an Arabic entry in Arabic script", () => {
    const entries = catalogTextEntries();
    expect(entries.length).toBeGreaterThan(900);
    const missing = entries
      .filter((entry) => {
        const value = overlay[entry.key];
        return !value || !ARABIC.test(value);
      })
      .map((entry) => `${entry.key} (${entry.english})`);
    expect(missing).toEqual([]);
  });

  it("[F14] the field list covers every prose string of every catalog entity", () => {
    // Structural / non-rendered keys: ids and references, enums, hrefs, search keywords, units.
    const STRUCTURAL =
      /(^|\.)(id|persona|personas|href|tab|primaryTab|status|severity|icon|commandIcon|commandKeywords|display|dataBasis|command|section|currency|phase|reportId|primaryReportId|metricId|owner|freelancer|accountant|[A-Za-z]+Ids?)$/;
    const covered = new Set(catalogTextEntries().map((entry) => entry.english));
    const uncovered: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (typeof value === "string") {
        const leaf = (path.split(".").pop() ?? path).replace(/\[\d+\]/g, "");
        if (STRUCTURAL.test(leaf)) return;
        if (!covered.has(value)) uncovered.push(`${path}: ${value}`);
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`));
      } else if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
      }
    };
    const CATALOG_ENTITIES = [
      "reportPersonaWorkspaces",
      "reportQuickAccessProfiles",
      "reportSavedViewProfiles",
      "reportSuiteProfiles",
      "reportCatalog",
      "reportPackTemplates",
      "reportManagementBriefProfiles",
      "reportComparisonPresets",
      "reportAutomationStarters",
      "reportAutomationImpactProfiles",
      "reportDecisionShortcuts",
      "reportAutomationTriggerRules",
      "reportDeliverySubscriptions",
      "reportProductDepthAreas",
    ] as const;
    for (const name of CATALOG_ENTITIES) walk((catalog as Record<string, unknown>)[name], name);
    // reportId lists inside roadmap prose and sourceEntities are covered; anything else is a gap.
    expect(uncovered.filter((line) => !/\.commandKeywords:|\.workflowSearch/.test(line))).toEqual(
      []
    );
  });

  it("[F14] overlay keys all point at a live catalog id, metric, UI string or pattern (no stale keys)", () => {
    const valid = new Set(catalogTextEntries().map((entry) => entry.key));
    for (const r of reportCatalog) {
      valid.add(catalogTextKey("report", r.id, "name"));
      valid.add(catalogTextKey("report", r.id, "decisionQuestion"));
    }
    for (const sub of reportDeliverySubscriptions) {
      valid.add(catalogTextKey("delivery", sub.id, "title"));
    }
    for (const metric of metricsFromSource()) {
      valid.add(`reportCatalog.metric.${metric.id}.label`);
      valid.add(`reportCatalog.metric.${metric.id}.signal`);
      if (metric.id.startsWith("consolidated-")) {
        valid.add(`reportCatalog.metric.${metric.id}.labelRollup`);
      }
    }
    for (const id of Object.keys(REPORT_UI_TEXT)) valid.add(`reportCatalog.ui.${id}`);
    for (const pattern of REPORT_PATTERNS) valid.add(`reportCatalog.pat.${pattern.id}`);
    for (const key of Object.values(GENERATED_TEXT_KEYS)) valid.add(key);
    expect(Object.keys(overlay).filter((key) => !valid.has(key))).toEqual([]);
  });

  it("[F14] every comparison metric label, signal and period label has Arabic", () => {
    const metrics = metricsFromSource();
    expect(metrics.length).toBeGreaterThan(140);
    const missing: string[] = [];
    for (const metric of metrics) {
      const keys = [`reportCatalog.metric.${metric.id}.signal`];
      if (metric.label) keys.push(`reportCatalog.metric.${metric.id}.label`);
      if (metric.id.startsWith("consolidated-")) {
        keys.push(
          `reportCatalog.metric.${metric.id}.label`,
          `reportCatalog.metric.${metric.id}.labelRollup`
        );
      }
      for (const key of keys) if (!overlay[key] || !ARABIC.test(overlay[key])) missing.push(key);
      for (const text of metric.extra) {
        const arabic = catalogTextByEnglish(t.ar as Record<string, string>, "ar", text);
        if (arabic === text || !ARABIC.test(arabic)) missing.push(`${metric.id}: ${text}`);
      }
    }
    // every metric a preset or brief references is a real metric
    const known = new Set(metrics.map((metric) => metric.id));
    const referenced = [
      ...reportComparisonPresets.flatMap((preset) => preset.metricIds),
      ...reportManagementBriefProfiles.flatMap((brief) => brief.kpiMetricIds),
    ];
    for (const id of referenced) if (!known.has(id)) missing.push(`unknown metric ${id}`);
    expect(missing).toEqual([]);
  });

  it("[F14] every generated UI string and sentence pattern has Arabic that renders", () => {
    const arTable = t.ar as Record<string, string>;
    const problems: string[] = [];
    for (const [id, english] of Object.entries(REPORT_UI_TEXT)) {
      const value = overlay[`reportCatalog.ui.${id}`];
      if (!value || !ARABIC.test(value)) problems.push(`ui ${id}`);
      else if (catalogTextByEnglish(arTable, "ar", english) !== value)
        problems.push(`ui index ${id}`);
    }
    for (const pattern of REPORT_PATTERNS) {
      const template = overlay[`reportCatalog.pat.${pattern.id}`];
      if (!template || !ARABIC.test(template)) {
        problems.push(`pattern ${pattern.id}: no Arabic`);
        continue;
      }
      const match = pattern.re.exec(pattern.sample);
      if (!match) {
        problems.push(`pattern ${pattern.id}: sample does not match`);
        continue;
      }
      const groups = match.length - 1;
      const used = [...template.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
      if (used.some((n) => n < 1 || n > groups))
        problems.push(`pattern ${pattern.id}: bad placeholder`);
      const rendered = catalogTextByEnglish(arTable, "ar", pattern.sample);
      if (rendered === pattern.sample || /\{\d+\}/.test(rendered)) {
        problems.push(`pattern ${pattern.id}: sample not translated`);
      }
    }
    for (const [english, key] of Object.entries(GENERATED_TEXT_KEYS)) {
      if (!overlay[key] || !ARABIC.test(overlay[key])) problems.push(`generated ${english}`);
    }
    expect(problems).toEqual([]);
  });

  it("[F14] translated catalog sentences keep no stray Latin words", () => {
    const stray: string[] = [];
    for (const [key, value] of Object.entries(overlay)) {
      // strip placeholders, numbers and allowed brands, then look for Latin words
      const words = value
        .replace(/\{[^}]+\}/g, " ")
        .match(/[A-Za-z][A-Za-z/&-]+/g)
        ?.filter((word) => !ALLOWED_LATIN.test(word));
      if (words?.length) stray.push(`${key}: ${words.join(" ")}`);
    }
    expect(stray).toEqual([]);
  });

  it("[F14] the same English text never maps to two different Arabic strings", () => {
    const seen = new Map<string, { key: string; arabic: string }>();
    const conflicts: string[] = [];
    const remember = (english: string, key: string) => {
      const arabic = overlay[key];
      if (!arabic) return;
      const previous = seen.get(english);
      if (previous && previous.arabic !== arabic) {
        conflicts.push(`${english}: ${previous.key} vs ${key}`);
      } else if (!previous) seen.set(english, { key, arabic });
    };
    for (const entry of catalogTextEntries()) remember(entry.english, entry.key);
    for (const [id, english] of Object.entries(REPORT_UI_TEXT)) {
      remember(english, `reportCatalog.ui.${id}`);
    }
    expect(conflicts).toEqual([]);
  });

  it("[F14] loadLocale('ar') merges the overlay; English falls back to the catalog", () => {
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
    // value lookups: catalog text translates, English and unknown text pass through
    const workspace = reportPersonaWorkspaces[0];
    expect(catalogTextByEnglish(ar, "ar", workspace.focus)).toBe(
      overlay[catalogTextKey("workspace", workspace.persona, "focus")]
    );
    expect(catalogTextByEnglish(en, "en", workspace.focus)).toBe(workspace.focus);
    expect(catalogTextByEnglish(ar, "ar", "Totally unknown sentence")).toBe(
      "Totally unknown sentence"
    );
  });

  it("[F14] raw status values pass through so render-side logic keeps working", () => {
    const ar = t.ar as Record<string, string>;
    for (const raw of [
      "failed",
      "sent",
      "queued",
      "blocked",
      "review",
      "ready",
      "critical",
      "owner",
    ]) {
      expect(catalogTextByEnglish(ar, "ar", raw)).toBe(raw);
    }
  });

  it("[F14] English dates and delivery timestamps are localised", () => {
    const ar = t.ar as Record<string, string>;
    expect(catalogTextByEnglish(ar, "ar", "Nov 01, 2026 - Nov 16, 2026")).toMatch(ARABIC);
    expect(catalogTextByEnglish(ar, "ar", "November 2026")).toMatch(ARABIC);
    expect(catalogTextByEnglish(ar, "ar", "Nov 16, 09:00")).toMatch(ARABIC);
  });

  it("[R18-02] the Report Center name/question maps derive from the same overlay", () => {
    expect(reportNameAr["profit-loss"]).toBe(overlay["reportCatalog.report.profit-loss.name"]);
    expect(reportQuestionAr["balance-sheet"]).toBe(
      overlay["reportCatalog.report.balance-sheet.decisionQuestion"]
    );
    expect(Object.keys(reportNameAr).length).toBeGreaterThanOrEqual(reportCatalog.length);
  });
});
