import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadNamespace } from "../../client/src/lib/i18n";
import { EInvoiceHeaderStrip } from "../../client/src/components/einvoice/EInvoiceHeaderStrip";
import { EInvoiceTrackBadges } from "../../client/src/components/einvoice/EInvoiceStatus";
import {
  deliveryFromLegacyStatus,
  isReportingOnlyFailure,
  recipientAcknowledgement,
  rejectionSummary,
} from "../../client/src/components/einvoice/einvoice-meta";
import { einvoiceStatusKey } from "../../client/src/components/einvoice/use-einvoice";

// F15 N2/N3: the invoice header strip shows the rejection reason and the FTA chip label.
describe("e-invoice header strip", () => {
  it.each([
    ["sandbox", "FTA: reported · Sandbox"],
    [null, "FTA: reported · Environment unverified"],
    ["production", "FTA: reported"],
  ])("shows the visible reporting label for environment %s", async (environment, label) => {
    await loadNamespace("en", "einvoicing");
    const html = renderToStaticMarkup(
      createElement(EInvoiceTrackBadges, {
        delivery: "delivered",
        reporting: "reported",
        environment,
        showReportingLabel: true,
      })
    );
    const badge = html.split('data-testid="einvoice-fta-chip"')[1];
    expect(badge?.match(/<span>([^<]+)<\/span>/)?.[1]).toBe(label);
  });
  it("shows a known deadline even while confirmation is unavailable", async () => {
    await loadNamespace("en", "einvoicing");
    const invoiceId = "fixture-invoice";
    const client = new QueryClient();
    client.setQueryData(einvoiceStatusKey(invoiceId), {
      tracks: {
        delivery: { status: "delivered" },
        reporting: {
          status: "pending",
          required: true,
          confirmationUnavailable: true,
          reportBy: "2026-12-01",
        },
      },
      transmission: { environment: "sandbox" },
      issues: [],
      rejection: null,
    });
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, {
        client,
        children: createElement(EInvoiceHeaderStrip, { invoiceId }),
      })
    );
    expect(html).toContain('data-testid="einvoice-header-reportby"');
    expect(html).toContain("Confirmation unavailable");
    client.clear();
  });
  it("renders an unknown reporting requirement on the compact badge", async () => {
    await loadNamespace("en", "einvoicing");
    const html = renderToStaticMarkup(
      createElement(EInvoiceTrackBadges, {
        delivery: "delivered",
        reporting: "not_required",
        obligationKnown: false,
      })
    );
    expect(html).toContain("<span>Reporting requirement unknown</span>");
    expect(html).not.toContain("Not required");
  });
  it("maps stored rejected documents to the rejected delivery state", () => {
    expect(deliveryFromLegacyStatus("rejected")).toBe("rejected");
  });
  it("distinguishes buyer-provider receipt from final acceptance in provider history", () => {
    expect(recipientAcknowledgement("acube", "delivered")).toBe("received");
    expect(recipientAcknowledgement("acube", "accepted")).toBe("accepted");
    expect(recipientAcknowledgement("complyance", "delivery_success")).toBe("received");
    expect(recipientAcknowledgement("complyance", "final_valid")).toBe("accepted");
    expect(recipientAcknowledgement("complyance", "final_rejected")).toBeNull();
  });
  it("keeps a reporting-only failure distinct from delivery failures and buyer rejection", () => {
    expect(isReportingOnlyFailure("delivered", "report_failed")).toBe(true);
    expect(isReportingOnlyFailure("delivery_failed", "report_failed")).toBe(false);
    expect(isReportingOnlyFailure("rejected", "report_failed")).toBe(false);
    expect(isReportingOnlyFailure("delivered", "reported")).toBe(false);
  });
  it.each([
    ["delivered", "production", "Report failed"],
    ["delivery_failed", "production", "Delivery failed"],
    ["rejected", "production", "Rejected"],
    ["rejected", "sandbox", "Rejected · Sandbox"],
    ["rejected", null, "Rejected · Environment unverified"],
  ])(
    "labels the header when reporting failed and delivery is %s (%s)",
    async (delivery, environment, label) => {
      await loadNamespace("en", "einvoicing");
      const invoiceId = "fixture-invoice";
      const client = new QueryClient();
      client.setQueryData(einvoiceStatusKey(invoiceId), {
        tracks: {
          delivery: { status: delivery, at: null },
          reporting: { status: "report_failed", required: true, reportBy: null },
        },
        transmission: { recipientAcknowledgement: null },
        issues: [],
        rejection: {
          environment,
          code: "EINVOICE_REPORT_FAILED",
          message: "Check the reporting record",
          reasons: [],
          resubmittable: false,
          providerHoldsDocument: true,
        },
      });
      const html = renderToStaticMarkup(
        createElement(QueryClientProvider, {
          client,
          children: createElement(EInvoiceHeaderStrip, { invoiceId }),
        })
      );
      const banner = html.match(/data-testid="einvoice-header-rejection"[^>]*>(.*?)<\/div>/)?.[1];
      expect(banner).toContain(`>${label}: </span>`);
      expect(banner).not.toContain("Resubmit");
      client.clear();
    }
  );
  it("summarises the first provider reason with its field and rule", () => {
    const s = rejectionSummary({
      code: "ACUBE_REJECTED",
      message: "Rejected",
      reasons: [
        { message: "Buyer TRN is invalid", field: "invoice.customerTrn", code: "PINT-R012" },
      ],
      retryScheduledAt: null,
      resubmittable: true,
    });
    expect(s).toMatchObject({
      message: "Buyer TRN is invalid",
      field: "invoice.customerTrn",
      rule: "PINT-R012",
    });
    expect(rejectionSummary(null)).toBeNull();
  });
  it("renders a rejection banner with resubmit and a labelled FTA chip, in both locales", () => {
    const strip = readFileSync("client/src/components/einvoice/EInvoiceHeaderStrip.tsx", "utf8");
    expect(strip).toContain("einvoice-header-rejection");
    expect(strip).toContain("showReportingLabel");
    for (const l of ["en", "ar"]) {
      const cat = JSON.parse(readFileSync(`client/src/locales/${l}/einvoicing.json`, "utf8"));
      for (const k of [
        "ftaChip_pending",
        "ftaChip_reported",
        "ftaChip_not_sent",
        "ftaChip_report_failed",
        "headerRejected",
      ]) {
        expect(cat[`einvoicing.${k}`]).toBeTruthy();
      }
    }
  });
});
