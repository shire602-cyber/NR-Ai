import { afterEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "../../shared/schema";
import { customerEInvoiceLabel } from "../../client/src/lib/einvoice-outcome";
import portalAr from "../../client/src/locales/ar/portal.json";
import portalEn from "../../client/src/locales/en/portal.json";
import {
  customerEInvoiceOutcome,
  getCustomerEInvoiceOutcome,
  type EInvoiceCustomerEvidence,
} from "../../server/services/einvoice/customer-outcome";
import { providerCallbackUrl } from "../../server/services/einvoice/providers/callback-url";
import { getEInvoiceDocument } from "../../server/services/einvoice/store";

vi.mock("../../server/services/einvoice/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/services/einvoice/store")>()),
  getEInvoiceDocument: vi.fn(),
}));

const customerEInvoiceStatus = (...args: Parameters<typeof customerEInvoiceOutcome>) =>
  customerEInvoiceOutcome(...args)?.status ?? null;

const invoice = {
  einvoiceStatus: "cleared",
  einvoiceProvider: "acube",
  einvoiceProviderMessageId: "AcubeDocument",
};

const document: EInvoiceCustomerEvidence = {
  status: "cleared",
  provider: "acube",
  providerMessageId: "AcubeDocument",
  providerStatus: "processed",
  deliveryStatus: "delivered",
  reportingStatus: "reported",
  validation: { submission: { reportingEvidence: { reported: "2026-11-20T08:00:00Z" } } },
};

describe("customer e-invoice outcomes", () => {
  it.each(["production", "sandbox", null])(
    "returns only the recipient acceptance and stored %s environment",
    (environment) => {
      expect(
        customerEInvoiceOutcome(invoice, {
          ...document,
          providerStatus: "accepted",
          validation: { submission: { environment } },
        })
      ).toEqual({ status: "accepted", environment });
    }
  );
  it.each([portalEn, portalAr])("qualifies receipt and clearance outside production", (t) => {
    const generic = t["portal.doc.einvoice"];
    const accepted = `${generic} · ${t["portal.doc.einvoiceAccepted"]}`;
    const received = `${generic} · ${t["portal.doc.einvoiceDelivered"]}`;
    expect(customerEInvoiceLabel({ status: "cleared", environment: "production" }, t)).toBe(
      accepted
    );
    expect(customerEInvoiceLabel({ status: "cleared", environment: null }, t)).toBe(
      `${accepted} · ${t["portal.doc.einvoiceEnvironmentUnknown"]}`
    );
    expect(customerEInvoiceLabel({ status: "delivered", environment: "sandbox" }, t)).toBe(
      `${received} · ${t["portal.doc.einvoiceSandbox"]}`
    );
  });
  it("preserves local states and does not expose a status before any is recorded", () => {
    expect(customerEInvoiceStatus({ ...invoice, einvoiceStatus: null }, null)).toBeNull();
    expect(customerEInvoiceStatus({ ...invoice, einvoiceStatus: "generated" }, undefined)).toBe(
      "generated"
    );
    expect(
      customerEInvoiceStatus(invoice, {
        ...document,
        status: "queued",
        deliveryStatus: "queued",
        providerStatus: "accepted",
      })
    ).toBe("queued");
  });

  it.each([
    ["processed", "submitted"],
    [" delivered ", "delivered"],
    ["ACCEPTED", "accepted"],
    [null, "submitted"],
  ])("A-Cube %s projects to %s independently of old reporting snapshots", (raw, status) => {
    expect(customerEInvoiceStatus(invoice, { ...document, providerStatus: raw })).toBe(status);
  });

  it.each([
    ["delivery_success", "reported", document.validation, "delivered"],
    ["final_valid", "reported", document.validation, "cleared"],
    ["final_valid", "reported", null, "accepted"],
    ["final_valid", "reported", { submission: {} }, "accepted"],
    [
      "final_valid",
      "reported",
      { submission: { reportingEvidence: { reported: "unconfirmed" } } },
      "accepted",
    ],
    ["final_valid", "report_failed", null, "accepted"],
    ["final_valid", "pending", null, "accepted"],
    ["processing", "reported", document.validation, "submitted"],
  ])(
    "Complyance %s with %s and saved approval %j projects to %s",
    (raw, reporting, validation, status) => {
      expect(
        customerEInvoiceStatus(
          { ...invoice, einvoiceProvider: "complyance" },
          {
            ...document,
            provider: "complyance",
            providerStatus: raw,
            reportingStatus: reporting,
            validation,
          }
        )
      ).toBe(status);
    }
  );

  it("uses corroborating references only and falls back when one side is incomplete", () => {
    const accepted = { ...document, providerStatus: "accepted", deliveryStatus: null };
    expect(customerEInvoiceStatus(invoice, { ...accepted, provider: null })).toBe("accepted");
    expect(customerEInvoiceStatus({ ...invoice, einvoiceProvider: null }, accepted)).toBe(
      "accepted"
    );
    expect(customerEInvoiceStatus(invoice, { ...accepted, providerMessageId: null })).toBe(
      "accepted"
    );
    expect(customerEInvoiceStatus({ ...invoice, einvoiceProviderMessageId: null }, accepted)).toBe(
      "accepted"
    );
    expect(customerEInvoiceStatus(invoice, { ...accepted, provider: "complyance" })).toBe(
      "generated"
    );
    expect(
      customerEInvoiceStatus(invoice, { ...accepted, providerMessageId: "acubedocument" })
    ).toBe("generated");
    expect(
      customerEInvoiceStatus(
        { ...invoice, einvoiceProviderMessageId: null },
        {
          ...accepted,
          providerMessageId: null,
        }
      )
    ).toBe("generated");
    expect(customerEInvoiceStatus(invoice, null)).toBe("submitted");
    expect(
      customerEInvoiceStatus(
        { ...invoice, einvoiceProvider: null },
        {
          ...accepted,
          provider: null,
          status: "delivered",
        }
      )
    ).toBe("submitted");
  });

  it.each([
    ["rejected", "rejected"],
    ["delivery_failed", "failed"],
    ["sending", "submitted"],
  ])("delivery track %s governs a stale acceptance marker", (deliveryStatus, status) => {
    expect(
      customerEInvoiceStatus(invoice, { ...document, providerStatus: "accepted", deliveryStatus })
    ).toBe(status);
  });

  it("loads a single authorized invoice's evidence with both tenant and invoice identifiers", async () => {
    const scopedInvoice = { ...invoice, companyId: "company-one", id: "invoice-one" } as Invoice;
    vi.mocked(getEInvoiceDocument).mockResolvedValueOnce(undefined);
    await expect(getCustomerEInvoiceOutcome(scopedInvoice)).resolves.toEqual({
      status: "submitted",
      environment: null,
    });
    expect(getEInvoiceDocument).toHaveBeenCalledExactlyOnceWith("company-one", "invoice-one");
  });
});

describe("provider callback URL configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the provider-specific HTTPS origin and the scoped environment and company path", () => {
    vi.stubEnv("AUTH_PUBLIC_URL", "https://app.example.test");
    vi.stubEnv("ACUBE_WEBHOOK_BASE_URL", "https://acube-callback.example.test:444/");
    vi.stubEnv("COMPLYANCE_WEBHOOK_BASE_URL", undefined);
    expect(providerCallbackUrl("acube", "sandbox", "company-one")).toBe(
      "https://acube-callback.example.test:444/api/webhooks/einvoice/acube/sandbox/company-one"
    );
    expect(providerCallbackUrl("complyance", "production", "company-two")).toBe(
      "https://app.example.test/api/webhooks/einvoice/complyance/production/company-two"
    );
  });

  it.each([
    undefined,
    "not a URL",
    "http://callback.example.test",
    "https://callback.example.test/another-route",
    "https://callback.example.test?query=1",
    "https://callback.example.test#anchor",
    "https://operator@callback.example.test",
    "https://:placeholder@callback.example.test",
  ])("publishes no callback for unusable origin %s", (origin) => {
    vi.stubEnv("AUTH_PUBLIC_URL", origin === undefined ? undefined : "https://app.example.test");
    vi.stubEnv("ACUBE_WEBHOOK_BASE_URL", origin);
    expect(providerCallbackUrl("acube", "sandbox", "company-one")).toBeNull();
  });
});
