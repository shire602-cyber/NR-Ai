/**
 * F13: the Evidence Center payload is server-composed English, so every sentence now travels with
 * a stable `{ key, params }` descriptor (shared/server-copy.ts EVIDENCE_TEMPLATES). The client
 * renders the descriptor from its en/ar catalogs; the English text stays for exports and
 * back-compat. This runs the real app: every user-visible sentence in the payload must carry a
 * descriptor that reproduces the English text from the en catalog and reads as Arabic from the ar
 * catalog (no leftover Latin words apart from document numbers, amounts, and Latin brand names), including the audit
 * trail rows written by the resolve action.
 */
import { describe, expect, it } from "vitest";
import enCatalog from "../../client/src/locales/en/components.json";
import arCatalog from "../../client/src/locales/ar/components.json";
import enEvidence from "../../client/src/locales/en/documentsEvidence.json";
import arEvidence from "../../client/src/locales/ar/documentsEvidence.json";
import { localizeEvidenceText } from "../../shared/server-copy";
import { stripAllowlisted } from "../e2e/lib/latin-text.mjs";
import { useHarness } from "./harness";
import { dubaiIso, dubaiToday } from "../helpers/dates";

const h = useHarness();

const en: Record<string, string> = { ...enCatalog, ...enEvidence };
const ar: Record<string, string> = { ...arCatalog, ...arEvidence };

type Ref = { key: string; params: Record<string, string> };
type Pair = { where: string; text: string; ref: Ref | undefined };

function collect(body: any): Pair[] {
  const out: Pair[] = [];
  const push = (where: string, text: unknown, ref: Ref | undefined) => {
    if (typeof text === "string" && text) out.push({ where, text, ref });
  };
  for (const w of body.workflows) {
    push(`workflow ${w.id} title`, w.title, w.copy?.title);
    push(`workflow ${w.id} metric`, w.metric, w.copy?.metric);
    push(`workflow ${w.id} description`, w.description, w.copy?.description);
    push(`workflow ${w.id} action`, w.primaryAction, w.copy?.primaryAction);
    w.bullets.forEach((b: string, i: number) =>
      push(`workflow ${w.id} bullet ${i}`, b, w.copy?.bullets?.[i] ?? undefined)
    );
  }
  for (const list of [body.missingEvidence, body.filingRiskScan]) {
    for (const i of list) {
      push(`issue ${i.id} title`, i.title, i.copy?.title);
      push(`issue ${i.id} detail`, i.detail, i.copy?.detail);
      push(`issue ${i.id} action`, i.actionLabel, i.copy?.actionLabel);
    }
  }
  for (const l of body.proofDrilldowns) {
    push(`proof ${l.id} label`, l.label, l.copy?.label);
    push(`proof ${l.id} documentLabel`, l.documentLabel, l.copy?.documentLabel);
    push(`proof ${l.id} documentPreview`, l.documentPreview, l.copy?.documentPreview);
  }
  for (const t of body.filingTimeline) {
    push(`timeline ${t.id} title`, t.title, t.copy?.title);
    push(`timeline ${t.id} consequence`, t.consequence, t.copy?.consequence);
  }
  for (const a of body.ownerActions) {
    push(`owner ${a.id} title`, a.title, a.copy?.title);
    push(`owner ${a.id} detail`, a.detail, a.copy?.detail);
    push(`owner ${a.id} action`, a.actionLabel, a.copy?.actionLabel);
  }
  return out;
}

/** Latin words left after stripping allow-listed brands, acronyms, numbers and ids. */
function latinWords(text: string): string[] {
  return stripAllowlisted(text).match(/[A-Za-z]{2,}/g) ?? [];
}

describe("F13 evidence centre copy keys", () => {
  it("every payload sentence carries a key that renders English identically and Arabic fully", async () => {
    const t = await h.createTenant({ name: "EvCopy" });
    // A draft invoice with VAT in the current quarter feeds the proof rows and the risk scan.
    const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Acme LLC",
      date: dubaiToday(),
      dueDate: dubaiIso(new Date(Date.now() + 14 * 86400000)),
      lines: [{ description: "Services", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    expect(inv.status, inv.text).toBe(200);

    const res = await t.as.get(`/api/companies/${t.company.id}/evidence-center`);
    expect(res.status, res.text).toBe(200);
    const pairs = collect(res.body);
    expect(pairs.length).toBeGreaterThan(40);

    const unkeyed = pairs.filter((p) => !p.ref).map((p) => `${p.where}: ${p.text}`);
    // Month-end checklist titles/details come from month-end.service and are adopted by template;
    // anything left unkeyed would show English in Arabic.
    expect(unkeyed).toEqual([]);

    for (const p of pairs) {
      const rendered = localizeEvidenceText(p.text, en, p.ref);
      expect(rendered, p.where).toBe(p.text);
      const arabic = localizeEvidenceText(p.text, ar, p.ref);
      expect(arabic, p.where).toMatch(/[؀-ۿ]/);
      expect(latinWords(arabic), `${p.where} -> ${arabic}`).toEqual([]);
    }

    // The same descriptor is stable across calls (keys + params, not rendered copy).
    const again = await t.as.get(`/api/companies/${t.company.id}/evidence-center`);
    const keys = (b: any) => collect(b).map((p) => p.ref?.key);
    expect(keys(again.body)).toEqual(keys(res.body));
  });

  it("audit trail rows written by resolve/waive map back to keys with the issue title localised", async () => {
    const t = await h.createTenant({ name: "EvAudit" });
    const first = await t.as.get(`/api/companies/${t.company.id}/evidence-center`);
    const issue = (first.body.missingEvidence as any[]).find(
      (i) => i.copy?.title?.key === "evidence.issue.noWorkpaper.title"
    );
    expect(issue, "no-workpaper issue present").toBeTruthy();
    const act = await t.as.post(
      `/api/companies/${t.company.id}/evidence-center/issues/${encodeURIComponent(issue.id)}/actions`,
      { action: "waive", reason: "Reviewed with the accountant" }
    );
    expect(act.status, act.text).toBe(200);

    const after = await t.as.get(`/api/companies/${t.company.id}/evidence-center`);
    const entry = (after.body.actionTrail as any[]).find((e) => e.action === "waive");
    expect(entry.description).toBe("Waived evidence issue: No VAT evidence workpaper exists yet");
    expect(entry.copy.description.key).toBe("evidence.audit.waived");
    const arabic = localizeEvidenceText(entry.description, ar, entry.copy.description);
    expect(arabic).toBe(
      "تم التنازل عن مسألة الأدلة: لا توجد ورقة عمل لأدلة ضريبة القيمة المضافة بعد"
    );
    expect(localizeEvidenceText(entry.description, en, entry.copy.description)).toBe(
      entry.description
    );
  });

  it("the corporate tax evidence pack returns keyed check labels and details", async () => {
    const t = await h.createTenant({ name: "EvCtPack" });
    const res = await t.as.get(`/api/companies/${t.company.id}/evidence-center/ct-pack`);
    expect(res.status, res.text).toBe(200);
    expect(res.body.checks.length).toBe(5);
    for (const check of res.body.checks as any[]) {
      expect(check.copy.label.key).toBe(`evidence.ct.check.${check.key}`);
      expect(localizeEvidenceText(check.label, en, check.copy.label)).toBe(check.label);
      expect(localizeEvidenceText(check.detail, en, check.copy.detail)).toBe(check.detail);
      expect(localizeEvidenceText(check.label, ar, check.copy.label)).toMatch(/[؀-ۿ]/);
      expect(localizeEvidenceText(check.detail, ar, check.copy.detail)).toMatch(/[؀-ۿ]/);
    }
  });
});
