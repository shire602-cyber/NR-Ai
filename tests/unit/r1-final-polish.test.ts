import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { localizeNotification } from "../../client/src/lib/notification-display";
import { fieldLabelKey } from "../../client/src/components/einvoice/einvoice-meta";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const catalog = (lang: string, ns: string): Record<string, string> =>
  JSON.parse(read(`client/src/locales/${lang}/${ns}.json`));

describe("R1 final review: notification display", () => {
  const t = {
    ...catalog("en", "components"),
  } as Record<string, string>;

  it("formats server amount strings with grouping and the money style", () => {
    const view = localizeNotification(
      {
        title: "Payment received",
        message: "A payment of AED 15000.00 was recorded against invoice INV-1.",
      },
      t,
      "en"
    );
    expect(view.message).toContain("15,000.00");
    expect(view.message).not.toContain("15000.00");
  });

  it("renders payroll period as a month name, never 9/2026", () => {
    const en = localizeNotification(
      { title: "Payroll approved", message: "Payroll for 9/2026 was approved." },
      t,
      "en"
    );
    expect(en.message).toBe("Payroll for September 2026 was approved.");
    const ar = localizeNotification(
      { title: "Payroll approved", message: "Payroll for 9/2026 was approved." },
      catalog("ar", "components"),
      "ar"
    );
    expect(ar.message).not.toContain("9/2026");
    expect(ar.message).toContain("2026");
  });
});

describe("R1 final review: login, e-invoicing settings, e-invoice header", () => {
  it("login no longer renders developer SSO copy", () => {
    const src = read("client/src/pages/Login.tsx");
    expect(src).not.toContain("not configured on this server");
    expect(src).not.toContain("SsoStatusNote");
  });

  it("settings drop the adapter/environment row and the duplicate ASP card", () => {
    const src = read("client/src/pages/EInvoicingSettings.tsx");
    expect(src).not.toContain("aspProvider");
    expect(src).not.toContain("asp-status");
    const card = read("client/src/components/einvoice/AcubeConnectCard.tsx");
    expect(card).toContain("acube-request-connection");
    expect(catalog("en", "einvoicing")["einvoicing.accreditation"]).toBe(
      "A-Cube accreditation no."
    );
  });

  it("the invalid state names the missing buyer address field", () => {
    expect(fieldLabelKey("customer.address")).toBe("einvoicing.field_customerAddress");
    const strip = read("client/src/components/einvoice/EInvoiceHeaderStrip.tsx");
    expect(strip).toContain("einvoice-header-fix");
    expect(catalog("ar", "einvoicing")["einvoicing.headerFix"]).toBeTruthy();
  });

  it("the invoice form warns about the buyer address before issue", () => {
    const src = read("client/src/pages/Invoices.tsx");
    expect(src).toContain("einvoice-buyer-address-hint");
    expect(catalog("en", "invoices")["invoices.einvoiceBuyerHint"]).toMatch(/street, city/);
  });
});
