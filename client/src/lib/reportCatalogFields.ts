/**
 * Enumerates every user-visible prose field of the report catalog (F14).
 *
 * reportCatalog.ts is the single English source with stable ids. Arabic lives in
 * client/src/locales/ar-catalog/reportCatalog.json under
 * `reportCatalog.<kind>.<id>.<field>`; nested rows use a dotted field path under their parent
 * entity (`brief.<id>.kpiWidgets.<widgetId>.label`, `subgoal.<id>.checkpoints.<cpId>.detail`,
 * `starter.<id>.setupSteps.0`). This module is the one list of those fields: the unit test asserts
 * every entry has an Arabic overlay (and the overlay has no stale keys), and
 * `catalogTextByEnglish` derives the English -> Arabic index used by `useCatalogText().cx()` so a
 * surface can translate a catalog string it only holds as a value.
 *
 * Ids, hrefs, report/entity references, enums (status, severity, persona) and `commandKeywords`
 * (search keywords, never rendered) are intentionally not listed.
 */
import {
  readyReportCatalog,
  reportAutomationImpactProfiles,
  reportAutomationStarters,
  reportAutomationTriggerRules,
  reportComparisonPresets,
  reportDecisionShortcuts,
  reportDeliverySubscriptions,
  reportManagementBriefProfiles,
  reportPackTemplates,
  reportPersonaWorkspaces,
  reportProductDepthAreas,
  reportQuickAccessProfiles,
  reportSavedViewProfiles,
  reportSuiteProfiles,
} from "./reportCatalog";

export interface CatalogTextEntry {
  /** Overlay key, `reportCatalog.<kind>.<id>.<field path>`. */
  key: string;
  english: string;
  kind: string;
  id: string;
  field: string;
}

function entries(): CatalogTextEntry[] {
  const out: CatalogTextEntry[] = [];
  const add = (kind: string, id: string, field: string, english: string | undefined) => {
    if (english === undefined || english === "") return;
    out.push({ key: `reportCatalog.${kind}.${id}.${field}`, english, kind, id, field });
  };
  const addAll = <T extends object>(
    kind: string,
    id: string,
    row: T,
    fields: readonly (keyof T & string)[],
    prefix = ""
  ) => {
    for (const field of fields) add(kind, id, `${prefix}${field}`, row[field] as unknown as string);
  };

  for (const w of reportPersonaWorkspaces) {
    addAll("workspace", w.persona, w, [
      "title",
      "navLabel",
      "automationNavLabel",
      "focus",
      "automationOutcome",
    ]);
    addAll(
      "workspace",
      w.persona,
      w.packSchedule,
      ["cadence", "delivery", "recipients", "trigger", "automation"],
      "packSchedule."
    );
    for (const s of w.setupChecklist) addAll("setupStep", s.id, s, ["title", "outcome"]);
    for (const s of w.workflowSteps)
      addAll("workflowStep", s.id, s, ["title", "outcome", "cadence", "primaryAction"]);
    for (const p of w.automations) addAll("playbook", p.id, p, ["title", "trigger", "cta"]);
  }
  for (const q of reportQuickAccessProfiles) addAll("quickAccess", q.id, q, ["title", "outcome"]);
  for (const v of reportSavedViewProfiles)
    addAll("savedView", v.id, v, [
      "title",
      "description",
      "dateRangePreset",
      "comparisonPeriod",
      "basis",
      "dimension",
      "exportFormat",
      "automationTrigger",
    ]);
  for (const s of reportSuiteProfiles)
    addAll("suite", s.id, s, ["title", "outcome", "workflow", "primaryAction"]);
  for (const r of readyReportCatalog) {
    addAll("report", r.id, r, ["name", "decisionQuestion", "comparison", "automation"]);
    if (r.roadmapPrerequisites)
      addAll(
        "report",
        r.id,
        r.roadmapPrerequisites,
        ["dataSource", "workflowDependency", "automationRule"],
        "roadmapPrerequisites."
      );
    if (r.roadmapPriority)
      add("report", r.id, "roadmapPriority.rationale", r.roadmapPriority.rationale);
    add("category", r.category, "label", r.category);
  }
  for (const p of reportPackTemplates)
    addAll("pack", p.id, p, [
      "title",
      "audience",
      "outcome",
      "cadence",
      "delivery",
      "comparisonFocus",
      "automationTrigger",
    ]);
  for (const b of reportManagementBriefProfiles) {
    addAll("brief", b.id, b, ["title", "audience", "outcome"]);
    for (const w of b.kpiWidgets)
      addAll("brief", b.id, w, ["label", "question"], `kpiWidgets.${w.id}.`);
    for (const n of b.narrativeSections)
      addAll("brief", b.id, n, ["title", "prompt"], `narrativeSections.${n.id}.`);
    for (const d of b.dimensionBreakdowns)
      addAll("brief", b.id, d, ["label", "dimension", "question"], `dimensionBreakdowns.${d.id}.`);
    if (b.batchAction) addAll("brief", b.id, b.batchAction, ["label", "detail"], "batchAction.");
  }
  for (const p of reportComparisonPresets)
    addAll("preset", p.id, p, ["title", "question", "baseline", "automationTrigger"]);
  for (const s of reportAutomationStarters) {
    addAll("starter", s.id, s, [
      "title",
      "audience",
      "outcome",
      "setupTime",
      "trigger",
      "primaryAction",
    ]);
    s.setupSteps.forEach((step, index) => add("starter", s.id, `setupSteps.${index}`, step));
  }
  for (const p of reportAutomationImpactProfiles) {
    addAll("impact", p.persona, p, [
      "title",
      "outcome",
      "manualWorkLabel",
      "timeSavedLabel",
      "itemUnitLabel",
    ]);
    p.evidence.forEach((e, index) => {
      add("impact", p.persona, `evidence.${index}.label`, e.label);
      add("impact", p.persona, `evidence.${index}.detail`, e.detail);
    });
    for (const o of p.outcomeSignals)
      addAll(
        "impact",
        p.persona,
        o,
        ["label", "currentProxy", "missingCounter", "guardrail"],
        `outcomeSignals.${o.id}.`
      );
  }
  for (const s of reportDecisionShortcuts) addAll("shortcut", s.id, s, ["question", "answer"]);
  for (const r of reportAutomationTriggerRules)
    addAll("rule", r.id, r, ["title", "condition", "threshold", "cadence", "actionLabel"]);
  for (const d of reportDeliverySubscriptions)
    addAll("delivery", d.id, d, [
      "title",
      "audience",
      "cadence",
      "channel",
      "format",
      "recipients",
      "deliveryGuardrail",
    ]);
  for (const area of reportProductDepthAreas) {
    addAll("depthArea", area.id, area, ["title", "objective"]);
    for (const g of area.subgoals) {
      addAll("subgoal", g.id, g, [
        "title",
        "outcome",
        "workflowSearch",
        "evidence",
        "nextAction",
        "dataDependency",
      ]);
      for (const c of g.evidenceCheckpoints ?? [])
        addAll("subgoal", g.id, c, ["label", "detail"], `checkpoints.${c.id}.`);
      for (const d of g.sourceDrilldownTargets ?? []) {
        addAll(
          "subgoal",
          g.id,
          d,
          ["title", "availableEvidence", "universalLinkGap"],
          `drilldowns.${d.id}.`
        );
        d.sourceEntities.forEach((entity, index) =>
          add("subgoal", g.id, `drilldowns.${d.id}.sourceEntities.${index}`, entity)
        );
      }
      for (const r of g.requiredSourceRecords ?? [])
        addAll("subgoal", g.id, r, ["label", "systemOfRecord", "unlocks"], `records.${r.id}.`);
    }
  }
  return out;
}

let cached: CatalogTextEntry[] | null = null;

/** Every prose field of the catalog with its overlay key and English source (memoised). */
export function catalogTextEntries(): CatalogTextEntry[] {
  cached ??= entries();
  return cached;
}
