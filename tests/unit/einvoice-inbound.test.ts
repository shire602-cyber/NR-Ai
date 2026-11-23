/**
 * R04-23: inbound supplier e-invoices — HMAC verification, UBL parsing and the
 * mapping to the bills service input (the DB flow is tests/db/einvoice-inbound.test.ts).
 */
import { describe, expect, it } from "vitest";
import { inboundBillSchema } from "../../shared/validators/bills";
import {
  inboundWebhookSecret,
  parseInboundUbl,
  signInbound,
  toInboundBill,
  verifyInboundSignature,
} from "../../server/services/einvoice/inbound";
import { generateEInvoiceXML } from "../../server/services/einvoice.service";
import { PINT_AE_FIXTURES, fixtureCompany } from "../fixtures/pint-ae/fixtures";
import { einvoicingScope, bandForRevenue } from "../../server/services/einvoice/scope";

const secret = "s".repeat(32);
const companyId = "00000000-0000-4000-8000-0000000000aa";

describe("R04-23 inbound webhook HMAC", () => {
  const body = Buffer.from("<Invoice/>");
  const now = new Date("2027-01-15T10:00:00Z");
  const ts = String(Math.floor(now.getTime() / 1000));

  it("is disabled without a strong secret", () => {
    expect(inboundWebhookSecret({} as NodeJS.ProcessEnv)).toBeNull();
    expect(inboundWebhookSecret({ EINVOICE_INBOUND_WEBHOOK_SECRET: "short" } as never)).toBeNull();
    expect(inboundWebhookSecret({ EINVOICE_INBOUND_WEBHOOK_SECRET: secret } as never)).toBe(secret);
  });

  it("accepts a valid signature and rejects tampering, replay to another company and stale timestamps", () => {
    const sig = signInbound(body, ts, companyId, secret);
    expect(verifyInboundSignature(body, sig, ts, companyId, secret, now)).toBe(true);
    expect(
      verifyInboundSignature(Buffer.from("<Invoice />"), sig, ts, companyId, secret, now)
    ).toBe(false);
    expect(
      verifyInboundSignature(body, sig, ts, "00000000-0000-4000-8000-0000000000bb", secret, now)
    ).toBe(false);
    expect(
      verifyInboundSignature(
        body,
        sig,
        ts,
        companyId,
        secret,
        new Date(now.getTime() + 10 * 60_000)
      )
    ).toBe(false);
    expect(verifyInboundSignature(body, undefined, ts, companyId, secret, now)).toBe(false);
  });
});

describe("R04-23 inbound UBL → draft bill input", () => {
  const f = PINT_AE_FIXTURES[0];
  const { xml } = generateEInvoiceXML(f.invoice, f.lines, fixtureCompany, f.customer, f.opts);

  it("parses supplier, buyer, dates and lines (document allowance allocated)", () => {
    const p = parseInboundUbl(xml);
    expect(p).toMatchObject({
      root: "Invoice",
      typeCode: "380",
      documentNumber: "INV-2027-0001",
      issueDate: "2027-01-15",
      dueDate: "2027-02-14",
      currency: "AED",
      supplierName: "Pearl Trading L.L.C.",
      supplierTrn: "100123456700003",
      buyerTrn: "100765432100003",
      buyerEndpoint: "1007654321",
    });
    expect(p.lines.reduce((s, l) => s + l.netFils, 0)).toBe(169000);
  });

  it("maps to a payload the bills service accepts, totals preserved", () => {
    const raw = toInboundBill(parseInboundUbl(xml));
    const parsed = inboundBillSchema.parse(raw);
    expect(parsed.origin).toBe("einvoice");
    expect(parsed.billNumber).toBe("INV-2027-0001");
    const net = parsed.lines.reduce((s, l) => s + Math.round((l.quantity ?? 1) * l.unitPrice), 0);
    expect(net).toBe(169000);
    expect(parsed.lines.every((l) => l.vatRate === 5 && l.supplyType === "standard_rated")).toBe(
      true
    );
  });

  it("rejects malformed or non-UBL documents with a 400 code", () => {
    expect(() => parseInboundUbl("<Invoice")).toThrowError(/well-formed/);
    expect(() => parseInboundUbl("<Order/>")).toThrowError(/UBL Invoice or CreditNote/);
    expect(() => parseInboundUbl('<!DOCTYPE x [<!ENTITY e "x">]><Invoice/>')).toThrowError();
  });
});

describe("R07-13 scope switch by turnover band", () => {
  it("large businesses go live 1 Jan 2027, others 1 Jul 2027, government 1 Oct 2027", () => {
    const today = new Date("2026-11-15T00:00:00Z");
    expect(
      einvoicingScope({ einvoiceScope: "b2b", einvoiceTurnoverBand: "large" }, today)
    ).toMatchObject({
      goLiveDate: "2027-01-01",
      appointAspBy: "2026-10-30",
      mandatory: false,
      daysToGoLive: 47,
      source: "band",
    });
    expect(
      einvoicingScope({ einvoiceScope: "b2b", einvoiceTurnoverBand: "standard" }, today).goLiveDate
    ).toBe("2027-07-01");
    expect(
      einvoicingScope({ einvoiceScope: "b2g", einvoiceTurnoverBand: "government" }, today)
        .goLiveDate
    ).toBe("2027-10-01");
  });

  it("becomes mandatory on the go-live date; an explicit date overrides the band; none is never mandatory", () => {
    const d = new Date("2027-01-01T08:00:00Z");
    expect(
      einvoicingScope({ einvoiceScope: "b2b_b2g", einvoiceTurnoverBand: "large" }, d).mandatory
    ).toBe(true);
    expect(
      einvoicingScope(
        {
          einvoiceScope: "b2b",
          einvoiceTurnoverBand: "standard",
          einvoiceGoLiveDate: "2026-12-01",
        },
        d
      )
    ).toMatchObject({ mandatory: true, source: "override" });
    expect(
      einvoicingScope({ einvoiceScope: "none", einvoiceTurnoverBand: "large" }, d).mandatory
    ).toBe(false);
    expect(einvoicingScope({}, d)).toMatchObject({
      scope: null,
      goLiveDate: null,
      source: "unset",
    });
    expect(bandForRevenue(50_000_000)).toBe("large");
    expect(bandForRevenue(49_999_999)).toBe("standard");
  });
});
