import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EInvoiceDocument, Invoice } from "../../shared/schema";
import { db } from "../../server/db";
import { scopedCompanyPermissionFailure } from "../../server/middleware/companyRolePolicy";
import {
  assertCanVerifyEInvoiceTracking,
  canRetryOriginalRejectedNumber,
  correctableComplyanceReference,
  legacyTrackingAvailability,
  legacyTrackingReference,
  needsLegacySubmissionRecovery,
} from "../../server/services/einvoice/legacy-tracking";
import { companyProviderConfiguration } from "../../server/services/einvoice/providers/company-provider";
import { providerModule } from "../../server/services/einvoice/providers/registry";
import type { EInvoiceDb } from "../../server/services/einvoice/store";

vi.mock("../../server/db", () => ({ db: { select: vi.fn() } }));
vi.mock("../../server/middleware/companyRolePolicy", () => ({
  scopedCompanyPermissionFailure: vi.fn(),
}));
vi.mock("../../server/services/einvoice/providers/company-provider", () => ({
  companyProviderConfiguration: vi.fn(),
}));

const COMPANY = "original-seller";
const INVOICE = "original-invoice";
const NUMBER = "INV-42";
const MESSAGE = "provider-original-reference";
const NOW = new Date("2026-11-18T10:00:00Z");
const PIN = {
  environment: "sandbox",
  operationId: "original-operation",
  invoiceNumber: NUMBER,
  scope: "original-account-scope",
};

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: INVOICE,
    companyId: COMPANY,
    number: NUMBER,
    einvoiceStatus: "failed",
    einvoiceProvider: "acube",
    einvoiceProviderMessageId: null,
    einvoiceSubmittedAt: null,
    ...overrides,
  } as Invoice;
}

function document(overrides: Partial<EInvoiceDocument> = {}): EInvoiceDocument {
  return {
    companyId: COMPANY,
    invoiceId: INVOICE,
    provider: "acube",
    status: "failed",
    deliveryStatus: "delivery_failed",
    providerStatus: null,
    providerMessageId: null,
    lastErrorCode: "TRANSPORT_ERROR",
    attempts: 1,
    nextRetryAt: null,
    submitClaimedAt: null,
    validation: null,
    ...overrides,
  } as EInvoiceDocument;
}

function acubeReject(overrides: Partial<EInvoiceDocument> = {}, pin: Record<string, unknown> = {}) {
  return document({
    status: "rejected",
    deliveryStatus: "rejected",
    lastErrorCode: "ACUBE_VALIDATION",
    validation: { submission: { ...PIN, ...pin } },
    ...overrides,
  });
}

function complyanceInvoice(overrides: Partial<Invoice> = {}) {
  return invoice({
    einvoiceProvider: "complyance",
    einvoiceProviderMessageId: MESSAGE,
    einvoiceStatus: "rejected",
    ...overrides,
  });
}

function complyanceReject(
  overrides: Partial<EInvoiceDocument> = {},
  pin: Record<string, unknown> = {}
) {
  return document({
    provider: "complyance",
    providerMessageId: MESSAGE,
    status: "rejected",
    deliveryStatus: "rejected",
    providerStatus: "rejected",
    lastErrorCode: "COMPLYANCE_VALIDATION",
    validation: {
      submission: {
        ...PIN,
        correctableRejection: true,
        sourceName: "original-seller-source",
        supplierTin: "1001234567",
        ...pin,
      },
    },
    ...overrides,
  });
}

describe("A-Cube correction under the original invoice number", () => {
  it("allows a definitive pre-handoff validation refusal in either pinned environment", () => {
    expect(canRetryOriginalRejectedNumber(invoice(), acubeReject())).toBe(true);
    const missingInvoiceMirror = invoice({ einvoiceProvider: null });
    const firstLegacyAttempt = acubeReject({}, { environment: "production", operationId: null });
    expect(canRetryOriginalRejectedNumber(missingInvoiceMirror, firstLegacyAttempt)).toBe(true);
    expect(needsLegacySubmissionRecovery(invoice(), firstLegacyAttempt)).toBe(false);
  });

  it.each([
    ["alternate provider", { provider: "complyance" }],
    ["non-rejected outcome", { status: "failed" }],
    ["transport failure", { lastErrorCode: "TRANSPORT_ERROR" }],
    ["a provider-side status", { providerStatus: "rejected" }],
    ["a stored provider ID", { providerMessageId: MESSAGE }],
    ["a scheduled retry", { nextRetryAt: NOW }],
    ["a worker claim", { submitClaimedAt: NOW }],
    ["an unpinned historical response", { validation: {} }],
  ] satisfies [string, Partial<EInvoiceDocument>][])("blocks %s", (_, changes) => {
    expect(canRetryOriginalRejectedNumber(invoice(), acubeReject(changes))).toBe(false);
  });

  it("blocks conflicting invoice mirrors, a changed number, and inconclusive legacy attempts", () => {
    expect(canRetryOriginalRejectedNumber(invoice(), undefined)).toBe(false);
    expect(
      canRetryOriginalRejectedNumber(invoice({ einvoiceProvider: "complyance" }), acubeReject())
    ).toBe(false);
    expect(
      canRetryOriginalRejectedNumber(invoice({ einvoiceProviderMessageId: MESSAGE }), acubeReject())
    ).toBe(false);
    expect(canRetryOriginalRejectedNumber(invoice(), acubeReject({}, { scope: null }))).toBe(false);
    expect(canRetryOriginalRejectedNumber(invoice({ number: "INV-43" }), acubeReject())).toBe(
      false
    );
    expect(
      canRetryOriginalRejectedNumber(invoice(), acubeReject({ attempts: 2 }, { operationId: null }))
    ).toBe(false);
    expect(
      canRetryOriginalRejectedNumber(invoice(), acubeReject({}, { environment: "mock" }))
    ).toBe(false);
  });
});

describe("Complyance same-resource correction", () => {
  it("returns the exact original ID for a verified Needs Correction document in either environment", () => {
    expect(correctableComplyanceReference(complyanceInvoice(), complyanceReject())).toBe(MESSAGE);
    expect(
      correctableComplyanceReference(
        complyanceInvoice(),
        complyanceReject({}, { environment: "production" })
      )
    ).toBe(MESSAGE);
  });

  it.each([
    ["another provider", { provider: "acube" }],
    ["a non-rejected document", { status: "submitted" }],
    ["terminal delivery failure", { providerStatus: "delivery_failed" }],
    ["terminal tax or buyer rejection", { lastErrorCode: "COMPLYANCE_FINAL_INVALID" }],
    ["a scheduled operation", { nextRetryAt: NOW }],
    ["an active claim", { submitClaimedAt: NOW }],
    ["the missing provider ID", { providerMessageId: null }],
    ["an unpinned environment", { validation: {} }],
  ] satisfies [string, Partial<EInvoiceDocument>][])("rejects %s", (_, changes) => {
    expect(
      correctableComplyanceReference(complyanceInvoice(), complyanceReject(changes))
    ).toBeNull();
  });

  it.each([
    ["unverified correction eligibility", { correctableRejection: false }],
    ["uncertain earlier correction", { correctionUncertain: true }],
    ["unknown account scope", { scope: null }],
    ["unknown seller TIN", { supplierTin: null }],
    ["unknown integration source", { sourceName: null }],
    ["changed invoice number", { invoiceNumber: "INV-43" }],
  ] satisfies [string, Record<string, unknown>][])("rejects %s", (_, changes) => {
    expect(
      correctableComplyanceReference(complyanceInvoice(), complyanceReject({}, changes))
    ).toBeNull();
  });

  it("rejects a conflicting registered provider or held document ID", () => {
    expect(correctableComplyanceReference(complyanceInvoice(), undefined)).toBeNull();
    expect(
      correctableComplyanceReference(
        complyanceInvoice({ einvoiceProvider: "acube" }),
        complyanceReject()
      )
    ).toBeNull();
    expect(
      correctableComplyanceReference(
        complyanceInvoice({ einvoiceProviderMessageId: "someone-elses-reference" }),
        complyanceReject()
      )
    ).toBeNull();
  });
});

describe("legacy handoff recovery hold", () => {
  it("holds unknown A-Cube attempts even without a tracking row or error code", () => {
    expect(needsLegacySubmissionRecovery(invoice(), undefined)).toBe(true);
    expect(
      needsLegacySubmissionRecovery(
        invoice({ einvoiceProvider: null, einvoiceStatus: "submitted" }),
        undefined
      )
    ).toBe(true);
    expect(
      needsLegacySubmissionRecovery(
        invoice({ einvoiceStatus: null, einvoiceSubmittedAt: NOW }),
        undefined
      )
    ).toBe(true);
    expect(
      needsLegacySubmissionRecovery(invoice({ einvoiceStatus: "generated" }), document())
    ).toBe(true);
    expect(
      needsLegacySubmissionRecovery(
        invoice({ einvoiceStatus: "generated" }),
        document({ attempts: 0, submitClaimedAt: NOW })
      )
    ).toBe(true);
    expect(
      needsLegacySubmissionRecovery(
        invoice({ einvoiceStatus: "generated" }),
        document({ attempts: 0, deliveryStatus: "needs_link" })
      )
    ).toBe(true);
    expect(
      needsLegacySubmissionRecovery(invoice({ einvoiceProvider: null }), document({ attempts: 0 }))
    ).toBe(true);
  });

  it("preserves the regular paths for drafts, mock data, held references, and durable work", () => {
    expect(
      needsLegacySubmissionRecovery(
        invoice({ einvoiceStatus: "generated", einvoiceProvider: null }),
        undefined
      )
    ).toBe(false);
    expect(
      needsLegacySubmissionRecovery(
        invoice({ einvoiceProvider: null }),
        document({ attempts: 0, provider: null })
      )
    ).toBe(false);
    expect(needsLegacySubmissionRecovery(invoice({ einvoiceProvider: "mock" }), undefined)).toBe(
      false
    );
    expect(
      needsLegacySubmissionRecovery(
        invoice({ einvoiceProvider: null }),
        document({ provider: "mock" })
      )
    ).toBe(false);
    expect(
      needsLegacySubmissionRecovery(
        invoice({ einvoiceProvider: "acube" }),
        document({ provider: "mock" })
      )
    ).toBe(true);
    expect(
      needsLegacySubmissionRecovery(invoice({ einvoiceProviderMessageId: MESSAGE }), undefined)
    ).toBe(false);
    expect(needsLegacySubmissionRecovery(invoice(), document({ providerMessageId: MESSAGE }))).toBe(
      false
    );
    expect(
      needsLegacySubmissionRecovery(invoice(), document({ validation: { submission: PIN } }))
    ).toBe(false);
  });

  it("holds a Complyance validation or XML failure missing its ID after durable retries settle", () => {
    const submitted = complyanceInvoice({ einvoiceProviderMessageId: null });
    const missingId = { providerMessageId: null };
    expect(needsLegacySubmissionRecovery(submitted, complyanceReject(missingId))).toBe(true);
    expect(
      needsLegacySubmissionRecovery(
        submitted,
        complyanceReject({ ...missingId, lastErrorCode: "COMPLYANCE_XML_FAILED" })
      )
    ).toBe(true);
    expect(
      needsLegacySubmissionRecovery(submitted, complyanceReject({ ...missingId, nextRetryAt: NOW }))
    ).toBe(false);
    expect(
      needsLegacySubmissionRecovery(
        submitted,
        complyanceReject({ ...missingId, submitClaimedAt: NOW })
      )
    ).toBe(false);
    expect(
      needsLegacySubmissionRecovery(
        submitted,
        complyanceReject({ ...missingId, lastErrorCode: null })
      )
    ).toBe(false);
  });
});

describe("legacy tracking reference and recovery availability", () => {
  const configuration = vi.mocked(companyProviderConfiguration);

  beforeEach(() => configuration.mockReset());

  it("uses either stored mirror and supports both providers", () => {
    expect(
      legacyTrackingReference(invoice({ einvoiceProviderMessageId: MESSAGE }), undefined)
    ).toEqual({ provider: "acube", messageId: MESSAGE });
    expect(
      legacyTrackingReference(
        invoice({ einvoiceProvider: null, einvoiceStatus: null }),
        complyanceReject()
      )
    ).toEqual({ provider: "complyance", messageId: MESSAGE });
    expect(legacyTrackingReference(complyanceInvoice(), complyanceReject())).toEqual({
      provider: "complyance",
      messageId: MESSAGE,
    });
  });

  it("rejects cross-tenant records, inconsistent references and documents that were never handed off", () => {
    const held = invoice({ einvoiceProviderMessageId: MESSAGE });
    expect(legacyTrackingReference(held, document({ companyId: "other-company" }))).toBeNull();
    expect(legacyTrackingReference(held, document({ invoiceId: "other-invoice" }))).toBeNull();
    expect(legacyTrackingReference(held, document({ provider: "complyance" }))).toBeNull();
    expect(
      legacyTrackingReference(held, document({ providerMessageId: "other-provider-id" }))
    ).toBeNull();
    expect(
      legacyTrackingReference(
        invoice({ einvoiceProvider: "mock", einvoiceProviderMessageId: MESSAGE }),
        undefined
      )
    ).toBeNull();
    expect(
      legacyTrackingReference(
        invoice({ einvoiceStatus: "generated", einvoiceProviderMessageId: MESSAGE }),
        document({ status: "generated" })
      )
    ).toBeNull();
    expect(legacyTrackingReference(invoice(), undefined)).toBeNull();
  });

  it("shows configured local recovery choices for stored, searched, and manually entered references", async () => {
    configuration.mockResolvedValueOnce({
      module: providerModule("acube")!,
      environment: "sandbox",
      env: {},
      webhookSecret: null,
    });
    await expect(
      legacyTrackingAvailability(invoice({ einvoiceProviderMessageId: MESSAGE }), undefined)
    ).resolves.toEqual({ provider: "acube", reference: "stored", environments: ["sandbox"] });
    configuration.mockResolvedValueOnce(null);
    await expect(legacyTrackingAvailability(invoice(), document())).resolves.toEqual({
      provider: "acube",
      reference: "search",
      environments: [],
    });
    configuration.mockResolvedValueOnce({
      module: providerModule("complyance")!,
      environment: "production",
      env: {},
      webhookSecret: null,
    });
    await expect(
      legacyTrackingAvailability(
        complyanceInvoice({ einvoiceProviderMessageId: null }),
        complyanceReject({ providerMessageId: null }, { environment: "production" })
      )
    ).resolves.toEqual({
      provider: "complyance",
      reference: "manual",
      environments: ["production"],
    });
    expect(configuration.mock.calls).toEqual([
      [COMPANY, "acube"],
      [COMPANY, "acube"],
      [COMPANY, "complyance"],
    ]);
  });

  it("hides recovery while a claim is active or a complete verified reference is present", async () => {
    await expect(
      legacyTrackingAvailability(invoice(), document({ submitClaimedAt: new Date() }))
    ).resolves.toBeNull();
    await expect(
      legacyTrackingAvailability(complyanceInvoice(), complyanceReject())
    ).resolves.toBeNull();
    await expect(
      legacyTrackingAvailability(invoice(), document({ companyId: "other-company" }))
    ).resolves.toBeNull();
    await expect(
      legacyTrackingAvailability(invoice({ einvoiceProvider: null }), document({ provider: null }))
    ).resolves.toBeNull();
    await expect(
      legacyTrackingAvailability(invoice({ einvoiceStatus: "generated" }), undefined)
    ).resolves.toBeNull();
    expect(configuration).not.toHaveBeenCalled();
  });

  it("permits read-only investigation of an expired claim but cannot switch its pinned environment", async () => {
    configuration.mockResolvedValue({
      module: providerModule("acube")!,
      environment: "production",
      env: {},
      webhookSecret: null,
    });
    await expect(
      legacyTrackingAvailability(invoice(), document({ submitClaimedAt: new Date(0) }))
    ).resolves.toEqual({ provider: "acube", reference: "search", environments: ["production"] });
    const verifiedDocumentOnly = document({
      providerMessageId: MESSAGE,
      validation: { submission: PIN },
    });
    await expect(legacyTrackingAvailability(invoice(), verifiedDocumentOnly)).resolves.toEqual({
      provider: "acube",
      reference: "stored",
      environments: [],
    });
  });
});

describe("legacy tracking verification authority", () => {
  const permission = vi.mocked(scopedCompanyPermissionFailure);
  const actor = {
    id: "tax-submitter",
    isAdmin: false,
    userType: "customer",
    firmRole: null,
    emailVerified: true,
  };

  function actorLookup(result: (typeof actor)[]) {
    const lock = vi.fn().mockResolvedValue(result);
    const where = vi.fn().mockReturnValue(Object.assign(Promise.resolve(result), { for: lock }));
    const conn = { select: () => ({ from: () => ({ where }) }) } as unknown as EInvoiceDb;
    return { conn, lock };
  }

  beforeEach(() => permission.mockReset());

  it("fails closed without a current actor or verifiable email", async () => {
    await expect(
      assertCanVerifyEInvoiceTracking(actor.id, COMPANY, actorLookup([]).conn)
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED", statusCode: 401 });
    expect(permission).not.toHaveBeenCalled();
    permission.mockResolvedValueOnce(null);
    const unverified = actorLookup([{ ...actor, emailVerified: false }]);
    await expect(
      assertCanVerifyEInvoiceTracking(actor.id, COMPANY, unverified.conn)
    ).rejects.toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED", statusCode: 403 });
  });

  it("masks absent tenant scope and distinguishes a permitted member who cannot submit tax documents", async () => {
    const { conn } = actorLookup([actor]);
    permission.mockResolvedValueOnce({ code: "COMPANY_ACCESS_DENIED" });
    await expect(assertCanVerifyEInvoiceTracking(actor.id, COMPANY, conn)).rejects.toMatchObject({
      code: "INVOICE_NOT_FOUND",
      statusCode: 404,
    });
    permission.mockResolvedValueOnce({ code: "PERMISSION_DENIED", role: "viewer" });
    await expect(assertCanVerifyEInvoiceTracking(actor.id, COMPANY, conn)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      statusCode: 403,
    });
  });

  it("locks the current user and tenant permission during the verification write", async () => {
    const { conn, lock } = actorLookup([actor]);
    permission.mockResolvedValueOnce(null);
    await expect(
      assertCanVerifyEInvoiceTracking(actor.id, COMPANY, conn, "share")
    ).resolves.toBeUndefined();
    expect(lock).toHaveBeenCalledWith("share");
    expect(permission).toHaveBeenCalledWith(actor, COMPANY, "tax.submit", conn, "share");
  });
});

describe("pre-upgrade A-Cube refusal provenance", () => {
  const localConfig = vi.mocked(companyProviderConfiguration);
  const read = vi.mocked(db.select);
  const refused = invoice({
    einvoiceStatus: "rejected",
    einvoiceXml: "<Invoice/>",
    einvoiceHash: "source-hash",
    einvoiceUuid: "source-uuid",
  });
  const legacy = acubeReject({
    validation: { valid: true },
    xmlHash: refused.einvoiceHash,
    uuid: refused.einvoiceUuid,
  });
  const outcome = {
    provider: "acube",
    status: "rejected",
    environment: "sandbox",
    providerMessageId: "",
  };
  const originalAudit = {
    id: "audit-original",
    action: "invoice.einvoice_submit",
    createdAt: NOW,
    details: JSON.stringify({ after: outcome }),
  };
  const directRefusal = { status: "rejected", provider: "acube", code: "ACUBE_VALIDATION" };

  function databaseResults(...results: unknown[][]) {
    for (const rows of results)
      read.mockReturnValueOnce({
        from: () => ({ where: () => ({ limit: async () => rows }) }),
      } as unknown as ReturnType<typeof db.select>);
  }

  beforeEach(() => {
    read.mockReset();
    localConfig.mockReset().mockResolvedValue(null);
  });

  it("exposes only the environment recorded by the original audited refusal", async () => {
    databaseResults([originalAudit], [directRefusal], []);
    localConfig.mockResolvedValueOnce({
      env: {},
      module: providerModule("acube")!,
      environment: "sandbox",
      webhookSecret: null,
    });
    await expect(
      legacyTrackingAvailability(refused, legacy, { einvoicePartner: "acube" })
    ).resolves.toEqual({
      provider: "acube",
      reference: "refusal",
      environments: ["sandbox"],
    });
    expect(localConfig).toHaveBeenCalledWith(COMPANY, "acube", { environment: "sandbox" });
  });

  it("keeps a verified historical refusal visible with no available environment when another provider is selected", async () => {
    databaseResults([originalAudit], [directRefusal], []);
    await expect(
      legacyTrackingAvailability(refused, legacy, { einvoicePartner: "complyance" })
    ).resolves.toEqual({
      provider: "acube",
      reference: "refusal",
      environments: [],
    });
    expect(localConfig).not.toHaveBeenCalled();
  });

  it("holds multiple attempts, contradictory history, and previously archived submissions for read-only tracking", async () => {
    databaseResults([originalAudit, originalAudit]);
    await expect(legacyTrackingAvailability(refused, legacy)).resolves.toMatchObject({
      reference: "search",
    });
    databaseResults(
      [originalAudit],
      [directRefusal, { ...directRefusal, status: "delivery_failed" }]
    );
    await expect(legacyTrackingAvailability(refused, legacy)).resolves.toMatchObject({
      reference: "search",
    });
    databaseResults([originalAudit], [directRefusal], [{ id: "existing-submission" }]);
    await expect(legacyTrackingAvailability(refused, legacy)).resolves.toMatchObject({
      reference: "search",
    });
  });

  it.each([
    [
      "a nonempty document ID",
      JSON.stringify({ after: { ...outcome, providerMessageId: MESSAGE } }),
    ],
    ["a missing environment", JSON.stringify({ after: { ...outcome, environment: undefined } })],
    ["a malformed historical audit", "{ malformed"],
  ])("does not infer a definitive refusal from %s", async (_, details) => {
    databaseResults([{ ...originalAudit, details }], [directRefusal], []);
    await expect(legacyTrackingAvailability(refused, legacy)).resolves.toMatchObject({
      reference: "search",
    });
  });
});
