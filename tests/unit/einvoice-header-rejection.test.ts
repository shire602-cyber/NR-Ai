// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadNamespace, useI18n } from "../../client/src/lib/i18n";
import { EInvoiceHeaderStrip } from "../../client/src/components/einvoice/EInvoiceHeaderStrip";
import { EInvoiceListCell } from "../../client/src/components/einvoice/EInvoiceListCell";
import { EInvoiceTrackBadges } from "../../client/src/components/einvoice/EInvoiceTrackBadges";
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
    ["en", "Not required"],
    ["ar", "غير مطلوب"],
  ] as const)("shows walk-in sales without remediation in %s", async (locale, label) => {
    await loadNamespace(locale, "einvoicing");
    const priorLocale = useI18n.getState().locale;
    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const priorActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const node = document.createElement("div");
    const root = createRoot(node);
    const client = new QueryClient();
    const invoiceId = "walk-in-sale";
    client.setQueryData(einvoiceStatusKey(invoiceId), {
      applicable: false,
      tracks: { delivery: { status: "not_applicable" }, reporting: { required: false } },
      issues: [],
    });
    try {
      useI18n.setState({ locale });
      await act(async () => {
        root.render(
          createElement(QueryClientProvider, {
            client,
            children: [
              createElement(EInvoiceHeaderStrip, { invoiceId, key: "header" }),
              createElement(EInvoiceListCell, {
                key: "list",
                invoice: { id: invoiceId },
                evidence: {
                  pill: {
                    invoiceId,
                    delivery: "not_applicable",
                    reporting: "not_required",
                    reportBy: null,
                    overdue: false,
                    reportingRequired: false,
                  },
                },
              }),
            ],
          })
        );
      });
      expect(node.querySelector("[data-testid=einvoice-header-strip]")?.textContent).toContain(
        label
      );
      expect(node.querySelector("[data-testid=einvoice-cell-walk-in-sale]")?.textContent).toBe(
        label
      );
      expect(node.querySelector("button, a")).toBeNull();
    } finally {
      await act(async () => root.unmount());
      client.clear();
      useI18n.setState({ locale: priorLocale });
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = priorActEnvironment;
    }
  });

  it("keeps the queue label when a worker has claimed but not handed off the invoice", async () => {
    await loadNamespace("en", "einvoicing");
    const html = renderToStaticMarkup(
      createElement(EInvoiceTrackBadges, {
        delivery: "sending",
        reporting: "pending",
        queuedForSubmission: true,
      })
    );
    expect(html).toContain('title="Delivery to customer: Queued for submission"');
    expect(html).not.toContain('title="Delivery to customer: Sending"');
  });
  it.each(["accepted", "cleared"])(
    "never implies delivery from a bare %s list record",
    async (status) => {
      await loadNamespace("en", "einvoicing");
      const html = renderToStaticMarkup(
        createElement(EInvoiceListCell, {
          invoice: { id: "historical-acube", einvoiceStatus: status },
        })
      );
      expect(html).toContain("Delivery unconfirmed");
      expect(html).not.toContain("Delivered");
      expect(html).not.toContain("Delivery failed");
      expect(html).toContain('title="Reporting requirement unknown"');
      expect(html).not.toContain("FTA reporting: Pending");
    }
  );
  it("requires recipient evidence even when a projected track claims delivery", async () => {
    await loadNamespace("en", "einvoicing");
    const html = renderToStaticMarkup(
      createElement(EInvoiceListCell, {
        invoice: { id: "historical-complyance", einvoiceStatus: "accepted" },
        evidence: {
          doc: {
            invoiceId: "historical-complyance",
            provider: "complyance",
            providerStatus: "final_invalid",
            providerMessageId: "sandbox-document",
            status: "accepted",
            environment: "sandbox",
            deliveryStatus: "delivered",
            reportingStatus: "pending",
            reportBy: null,
          },
        },
      })
    );
    expect(html).toContain("Delivery unconfirmed");
    expect(html).not.toContain("Delivered");
  });
  it.each([
    ["en", "FTA: report failed", "Report failed", "Sandbox", "Reporting requirement unknown"],
    ["ar", "الهيئة: تعذّر الإبلاغ", "تعذّر الإبلاغ", "بيئة تجريبية", "متطلبات الإبلاغ غير معروفة"],
  ] as const)(
    "qualifies sandbox reporting failures and exposes unknown obligations in %s",
    async (locale, chip, failure, sandbox, unknown) => {
      await loadNamespace(locale, "einvoicing");
      const node = document.createElement("div");
      const root = createRoot(node);
      const priorActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT;
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      try {
        useI18n.setState({ locale });
        const invoiceId = "sandbox-report-failed";
        const doc = {
          invoiceId,
          provider: "complyance",
          providerStatus: "final_invalid",
          providerMessageId: "sandbox-document",
          status: "submitted",
          environment: "sandbox" as const,
          deliveryStatus: "queued" as const,
          reportingStatus: "report_failed" as const,
          reportBy: null,
        };
        for (const reportingRequired of [false, true]) {
          await act(async () => {
            root.render(
              createElement(EInvoiceListCell, {
                invoice: { id: invoiceId },
                evidence: {
                  doc,
                  pill: {
                    invoiceId,
                    delivery: "queued",
                    reporting: "report_failed",
                    reportBy: null,
                    overdue: false,
                    reportingRequired,
                  },
                },
              })
            );
          });
          expect(node.textContent).toContain(`${reportingRequired ? failure : chip} · ${sandbox}`);
        }
        await act(async () => {
          root.render(
            createElement(EInvoiceTrackBadges, {
              delivery: "queued",
              reporting: "pending",
              obligationKnown: false,
            })
          );
        });
        expect(node.querySelector(`[title="${unknown}"]`)?.textContent).toBe(unknown);
      } finally {
        await act(async () => root.unmount());
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
          priorActEnvironment;
        useI18n.setState({ locale: "en" });
      }
    }
  );
  it.each([false, true])(
    "qualifies a sandbox rejection on the list (reporting required: %s)",
    async (reportingRequired) => {
      await loadNamespace("en", "einvoicing");
      const html = renderToStaticMarkup(
        createElement(EInvoiceListCell, {
          invoice: { id: "rejected-in-sandbox", einvoiceStatus: "rejected" },
          evidence: {
            doc: {
              invoiceId: "rejected-in-sandbox",
              provider: "acube",
              providerStatus: "rejected",
              providerMessageId: "sandbox-document",
              status: "rejected",
              environment: "sandbox",
              deliveryStatus: "rejected",
              reportingStatus: "pending",
              reportBy: null,
            },
            pill: {
              invoiceId: "rejected-in-sandbox",
              delivery: "rejected",
              reporting: "pending",
              reportBy: null,
              overdue: false,
              reportingRequired,
            },
          },
        })
      );
      expect(html).toContain("Rejected · Sandbox");
    }
  );
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
