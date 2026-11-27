/**
 * LIVE A-Cube SANDBOX suite. Skipped unless ACUBE_EMAIL, ACUBE_PASSWORD and ASP_DRYRUN_SELLER_TRN
 * are all set, so `npm test` and CI skip it cleanly. Run it with `npm run test:acube-sandbox`.
 *
 * - It only ever talks to the sandbox: ACUBE_ENV is forced to "sandbox" and the suite REFUSES to
 *   run when ACUBE_ENV=production.
 * - Documents come from scripts/ops/asp-sample-document.ts, the same builder as the dry run.
 * - It prints the raw status words and the 422 body shape (never credentials or tokens) so the
 *   fixtures in tests/fixtures/pint-ae/asp/acube/ can be re-recorded.
 * - ASP_DRYRUN_SELLER_TRN must be the TRN of the legal entity linked in the sandbox, otherwise
 *   A-Cube answers 404 (legal entity) and the suite reports that as the failure.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  AcubeEInvoiceProvider,
  resetAcubeTokenCache,
} from "../../server/services/einvoice/providers/acube";
import type { EInvoiceProviderResult } from "../../server/services/einvoice-provider";
import { buildSampleDocument, invalidateSampleXml } from "../../scripts/ops/asp-sample-document";

const configured = !!(
  process.env.ACUBE_EMAIL?.trim() &&
  process.env.ACUBE_PASSWORD?.trim() &&
  process.env.ASP_DRYRUN_SELLER_TRN?.trim()
);
const FINAL = new Set(["accepted", "rejected"]);
const log = (label: string, value: unknown) =>
  console.info(`[acube-sandbox] ${label}: ${JSON.stringify(value)}`);

/** Result fields that are safe to print: no raw body, no credentials. */
const summary = (r: EInvoiceProviderResult) => ({
  status: r.status,
  delivery: r.delivery ?? null,
  reporting: r.reporting ?? null,
  providerStatus: r.providerStatus ?? null,
  providerMessageId: r.providerMessageId || null,
  errorCode: r.errorCode ?? null,
  detail: r.detail ?? null,
});

describe.skipIf(!configured)("A-Cube SANDBOX (live)", () => {
  let provider: AcubeEInvoiceProvider;
  const state: { invoiceNumber?: string; invoiceDate?: string; invoiceId?: string } = {};

  beforeAll(() => {
    if ((process.env.ACUBE_ENV ?? "").trim().toLowerCase() === "production") {
      throw new Error(
        "REFUSED: ACUBE_ENV=production. This suite only talks to the A-Cube sandbox."
      );
    }
    resetAcubeTokenCache();
    provider = new AcubeEInvoiceProvider({
      ...process.env,
      EINVOICE_PROVIDER: "acube",
      ACUBE_ENV: "sandbox",
    });
    expect(provider.environment).toBe("sandbox");
    log("target", { baseUrl: provider.cfg.baseUrl, loginUrl: provider.cfg.loginUrl });
  });

  const poll = async (id: string, documentType: string) => {
    const seen: string[] = [];
    let last: EInvoiceProviderResult | null = null;
    for (let i = 0; i < 8; i++) {
      last = await provider.getStatus(id, { documentType });
      const word = last.providerStatus ?? `(${last.errorCode ?? "no status"})`;
      if (seen[seen.length - 1] !== word) seen.push(word);
      if (last.providerStatus && FINAL.has(last.providerStatus.toLowerCase())) break;
      await new Promise((r) => setTimeout(r, 4000));
    }
    log("status words in order", seen);
    return last!;
  };

  it("logs in and receives a JWT", async () => {
    const token = await provider.token();
    expect(token.split(".")).toHaveLength(3);
  });

  it("submits a sample invoice and polls its status", async () => {
    const doc = await buildSampleDocument();
    expect(doc.validation.valid).toBe(true);
    const res = await provider.submit({
      invoiceId: doc.invoice.id,
      invoiceNumber: doc.invoice.number,
      uuid: doc.uuid,
      xml: doc.xml,
      documentType: "380",
      companyId: doc.company.id,
    });
    log("invoice submit", summary(res));
    if (res.reasons?.length) log("invoice rejection reasons", res.reasons);
    expect(res.providerMessageId, res.detail ?? "no document id").not.toBe("");
    state.invoiceNumber = doc.invoice.number;
    state.invoiceDate = new Date(doc.invoice.date).toISOString().slice(0, 10);
    state.invoiceId = res.providerMessageId;

    const status = await poll(res.providerMessageId, "380");
    log("invoice final poll", summary(status));
    expect(status.providerMessageId).toBe(res.providerMessageId);
    expect(status.providerStatus).toBeTruthy();
  }, 120_000);

  it("submits a credit note against that invoice", async () => {
    expect(state.invoiceNumber, "the invoice step must pass first").toBeTruthy();
    const doc = await buildSampleDocument({
      creditNoteFor: { number: state.invoiceNumber!, date: state.invoiceDate! },
    });
    expect(doc.documentType).toBe("381");
    const res = await provider.submit({
      invoiceId: doc.invoice.id,
      invoiceNumber: doc.invoice.number,
      uuid: doc.uuid,
      xml: doc.xml,
      documentType: "381",
      companyId: doc.company.id,
    });
    log("credit note submit", summary(res));
    if (res.reasons?.length) log("credit note rejection reasons", res.reasons);
    expect(res.providerMessageId, res.detail ?? "no document id").not.toBe("");
    const status = await provider.getStatus(res.providerMessageId, { documentType: "381" });
    log("credit note status", summary(status));
    expect(status.providerStatus).toBeTruthy();
  }, 120_000);

  it("rejects a deliberately invalid document with a 422 violation list", async () => {
    const doc = await buildSampleDocument({ prefix: "DRYRUN-BAD" });
    const res = await provider.submit({
      invoiceId: doc.invoice.id,
      invoiceNumber: doc.invoice.number,
      uuid: doc.uuid,
      xml: invalidateSampleXml(doc.xml),
      documentType: "380",
      companyId: doc.company.id,
    });
    log("invalid submit", summary(res));
    const raw = (res.raw ?? {}) as Record<string, unknown>;
    const violations = Array.isArray(raw.violations)
      ? (raw.violations as Record<string, unknown>[])
      : [];
    // The body shape, for re-recording fixtures: top-level keys and per-violation keys and values.
    log("422 body keys", Object.keys(raw));
    log(
      "422 violations",
      violations.map((v) => ({
        keys: Object.keys(v),
        propertyPath: v.propertyPath,
        code: v.code,
        message: v.message,
        hint: v.hint,
      }))
    );
    expect(res.status).toBe("rejected");
    expect(res.errorCode).toBe("ACUBE_VALIDATION");
    expect(res.reasons?.length ?? 0).toBeGreaterThan(0);
  }, 120_000);
});
