// @vitest-environment jsdom
/**
 * E1 (J1-r2 / J2-r2 / J3-r2) client behaviour: honest forgot-password copy, credited / applied
 * invoice statuses with no pay action on a credit note, the Add-rate prefill, the e-invoice
 * rule hints, and the quote VAT options.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function submitForgot(delivery: "unavailable" | "available", locale: "en" | "ar") {
  const i18n = await import("../../client/src/lib/i18n");
  i18n.useI18n.setState({ locale });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).includes("forgot-password")
        ? { message: "x", emailDelivery: delivery }
        : { captcha: { status: "off" } };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    })
  );
  const { default: ForgotPassword } = await import("../../client/src/pages/ForgotPassword");
  const { Router } = await import("wouter");
  await act(async () => {
    root.render(createElement(Router, null, createElement(ForgotPassword)));
  });
  const input = container.querySelector<HTMLInputElement>("[data-testid=input-email]")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "owner@example.com");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 50));
  });
  return container.querySelector("[data-testid=text-forgot-result]")?.textContent ?? "";
}

describe("E1 forgot-password honesty", () => {
  it("does not promise an email when delivery is unavailable (en and ar)", async () => {
    const i18n = await import("../../client/src/lib/i18n");
    const en = await submitForgot("unavailable", "en");
    expect(en).toBe(
      `${i18n.t.en["marketing.forgotNoProviderTitle"]}${i18n.t.en["marketing.forgotNoProvider"]}`
    );
    expect(en).not.toMatch(/you will get a reset link/i);
    act(() => root.unmount());
    root = createRoot(container);
    const ar = await submitForgot("unavailable", "ar");
    expect(ar).toContain(i18n.t.ar["marketing.forgotNoProviderTitle"]);
    expect(ar).not.toContain(i18n.t.ar["marketing.forgotDoneTitle"]);
  });

  it("keeps the normal message when email delivery works", async () => {
    const i18n = await import("../../client/src/lib/i18n");
    const en = await submitForgot("available", "en");
    expect(en).toContain(i18n.t.en["marketing.forgotDoneTitle"]);
  });
});

describe("E1 credited / applied statuses", () => {
  it("shows credited for an invoice settled only by credit notes and applied for the credit note", async () => {
    const { invoiceDisplayStatus } = await import("../../client/../shared/invoice-balance");
    const base = { total: "840.00" } as never;
    expect(
      invoiceDisplayStatus({
        ...(base as object),
        status: "paid",
        invoiceType: "invoice",
        amountPaid: 0,
        amountCredited: 840,
      } as never)
    ).toBe("credited");
    // Paid in cash stays paid, even with a small credit.
    expect(
      invoiceDisplayStatus({
        status: "paid",
        invoiceType: "invoice",
        total: "840.00",
        amountPaid: 800,
        amountCredited: 40,
      } as never)
    ).toBe("paid");
    expect(
      invoiceDisplayStatus({
        status: "sent",
        invoiceType: "credit_note",
        total: "-840.00",
      } as never)
    ).toBe("applied");
  });

  it("offers no Record payment on a credit note, and the Paid tile skips credited invoices", async () => {
    const { invoiceRowActions } = await import("../../client/src/lib/invoice-row-actions");
    expect(invoiceRowActions({ status: "sent", invoiceType: "credit_note" }).canRecordPayment).toBe(
      false
    );
    expect(invoiceRowActions({ status: "sent", invoiceType: "invoice" }).canRecordPayment).toBe(
      true
    );
    const { computeInvoiceTiles } = await import("../../client/src/lib/invoice-tiles");
    const tiles = computeInvoiceTiles(
      [
        {
          status: "paid",
          invoiceType: "invoice",
          total: "840",
          amountPaid: 0,
          amountCredited: 840,
        },
        {
          status: "paid",
          invoiceType: "invoice",
          total: "100",
          amountPaid: 100,
          amountCredited: 0,
        },
      ] as never,
      new Date()
    );
    const paid = tiles.find((x) => x.key === "paid")!;
    expect(paid.count).toBe(1);
  });
});

describe("E1 small client rules", () => {
  it("prefills the Add-rate box with the peg for USD/AED and AED/USD only", async () => {
    const { pegRatePrefill } = await import("../../client/src/lib/document-currency");
    expect(pegRatePrefill("USD", "AED")).toBe("3.6725");
    expect(pegRatePrefill("AED", "USD")).toBe("0.272294");
    expect(pegRatePrefill("EUR", "AED")).toBe("");
  });

  it("links buyer-identity e-invoice rules to the customer contact", async () => {
    const { einvoiceFieldHint } = await import("../../client/src/lib/einvoice-issues");
    const hint = einvoiceFieldHint("PINT AE rule ibr-080-ae");
    expect(hint.href).toBe("/contacts");
    expect(hint.whereKey).toBe("invoices.einvoiceWhere.customer");
  });

  it("the quote form offers only UAE treatments (no 10%)", async () => {
    const fs = await import("node:fs");
    // Source check: rendering the full quote editor needs the whole router/query stack, and the
    // contract is the option list itself.
    const src = fs.readFileSync("client/src/pages/Quotes.tsx", "utf8");
    expect(src).toContain('"standard_rated", "zero_rated", "exempt", "out_of_scope"');
    expect(src).not.toContain('value="10"');
  });
});
