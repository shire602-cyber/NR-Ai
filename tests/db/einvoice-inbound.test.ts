/**
 * R04-23: inbound supplier e-invoices through the HMAC-signed webhook create
 * DRAFT vendor bills via bills.createDraftFromInbound, with duplicate
 * detection by document id, validation, archive and honest 503s.
 */
import crypto from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";
import { PINT_AE_FIXTURES, fixtureCompany, type PintAeFixture } from "../fixtures/pint-ae/fixtures";

type Generate = typeof import("../../server/services/einvoice.service").generateEInvoiceXML;
let generateEInvoiceXML: Generate;
beforeAll(async () => {
  // Server modules load after the harness bound this file's database.
  ({ generateEInvoiceXML } = await import("../../server/services/einvoice.service"));
});

/** Independent HMAC (the ASP side): sha256 over "<ts>.<companyId>.<body>". */
function signInbound(raw: Buffer, ts: string, companyId: string, secret: string): string {
  const mac = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${companyId}.`)
    .update(raw)
    .digest("hex");
  return `sha256=${mac}`;
}

const h = useHarness();
const SECRET = "inbound-test-secret-0123456789abcdef";
const BUYER_TRN = "100555666700003";

/** A supplier invoice (Pearl Trading → the tenant), as the ASP would deliver it. */
function supplierInvoice(over: { number?: string; buyerTrn?: string; breakCity?: boolean } = {}) {
  const f = PINT_AE_FIXTURES[0] as PintAeFixture;
  const invoice = {
    ...f.invoice,
    number: over.number ?? "SUP-2027-0042",
  } as PintAeFixture["invoice"];
  const customer = {
    ...f.customer,
    trn: over.buyerTrn ?? BUYER_TRN,
    endpointId: (over.buyerTrn ?? BUYER_TRN).slice(0, 10),
  };
  let { xml } = generateEInvoiceXML(invoice, f.lines, fixtureCompany, customer, f.opts);
  if (over.breakCity) xml = xml.replace(/<cbc:CityName>Dubai<\/cbc:CityName>/g, "");
  return xml;
}

function deliver(t: Tenant, xml: string, opts: { secret?: string; companyId?: string } = {}) {
  const companyId = opts.companyId ?? t.company.id;
  const ts = String(Math.floor(Date.now() / 1000));
  const raw = Buffer.from(xml, "utf8");
  return h.anon.post(`/api/webhooks/einvoice/${companyId}/inbound`, undefined, {
    raw,
    headers: {
      "Content-Type": "application/xml",
      "x-einvoice-timestamp": ts,
      "x-einvoice-signature": signInbound(raw, ts, companyId, opts.secret ?? SECRET),
      "x-einvoice-message-id": "asp-in-1",
    },
  });
}

const tenant = () => h.createTenant({ companyColumns: { trn_vat_number: BUYER_TRN } });

afterEach(() => {
  delete process.env.EINVOICE_INBOUND_WEBHOOK_SECRET;
});

describe("W4-C inbound e-invoices → draft bills", () => {
  it("[R04-23] is disabled (503) without a webhook secret", async () => {
    const t = await tenant();
    const r = await deliver(t, supplierInvoice());
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("EINVOICE_INBOUND_DISABLED");
  });

  it("[R04-23] rejects a bad signature (401) and a delivery signed for another company", async () => {
    process.env.EINVOICE_INBOUND_WEBHOOK_SECRET = SECRET;
    const t = await tenant();
    const wrongKey = await deliver(t, supplierInvoice(), { secret: "x".repeat(40) });
    expect(wrongKey.status).toBe(401);
    const other = await h.createSecondTenant();
    const ts = String(Math.floor(Date.now() / 1000));
    const raw = Buffer.from(supplierInvoice());
    const replay = await h.anon.post(
      `/api/webhooks/einvoice/${other.company.id}/inbound`,
      undefined,
      {
        raw,
        headers: {
          "Content-Type": "application/xml",
          "x-einvoice-timestamp": ts,
          "x-einvoice-signature": signInbound(raw, ts, t.company.id, SECRET),
        },
      }
    );
    expect(replay.status).toBe(401);
    expect(
      (
        await h.sql(`SELECT count(*)::int AS n FROM vendor_bills WHERE company_id = ANY($1)`, [
          [t.company.id, other.company.id],
        ])
      )[0].n
    ).toBe(0);
  });

  it("[R04-23] creates one draft bill, archives the XML and detects the duplicate", async () => {
    process.env.EINVOICE_INBOUND_WEBHOOK_SECRET = SECRET;
    const t = await tenant();
    const xml = supplierInvoice();
    const first = await deliver(t, xml);
    expect(first.status, first.text).toBe(201);
    expect(first.body.status).toBe("bill_created");
    const bills = await h.sql(
      `SELECT id, status, vendor_name, bill_number, total_amount::text AS total, vat_amount::text AS vat
         FROM vendor_bills WHERE company_id = $1`,
      [t.company.id]
    );
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({
      id: first.body.billId,
      status: "draft",
      vendor_name: "Pearl Trading L.L.C.",
      bill_number: "SUP-2027-0042",
    });
    expect(Number(bills[0].total)).toBeCloseTo(1774.5, 2);
    expect(Number(bills[0].vat)).toBeCloseTo(84.5, 2);
    const archive = await h.sql(
      `SELECT direction, kind, document_number FROM einvoice_archive WHERE company_id = $1`,
      [t.company.id]
    );
    expect(archive).toEqual([
      { direction: "inbound", kind: "received", document_number: "SUP-2027-0042" },
    ]);

    const dup = await deliver(t, xml);
    expect(dup.status).toBe(200);
    expect(dup.body).toMatchObject({ duplicate: true, billId: first.body.billId });
    expect(
      (
        await h.sql(`SELECT count(*)::int AS n FROM vendor_bills WHERE company_id = $1`, [
          t.company.id,
        ])
      )[0].n
    ).toBe(1);

    const list = await t.as.get(`/api/companies/${t.company.id}/einvoicing/inbound`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    const other = await h.createSecondTenant();
    const leak = await other.as.get(`/api/companies/${t.company.id}/einvoicing/inbound`);
    expect([403, 404]).toContain(leak.status);
  });

  it("[R04-23] refuses a document addressed to another buyer and stores invalid ones without a bill", async () => {
    process.env.EINVOICE_INBOUND_WEBHOOK_SECRET = SECRET;
    const t = await tenant();
    const wrong = await deliver(t, supplierInvoice({ buyerTrn: "100999888700003" }));
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe("EINVOICE_INBOUND_WRONG_RECIPIENT");

    const invalid = await deliver(t, supplierInvoice({ number: "SUP-BAD-1", breakCity: true }));
    expect(invalid.status).toBe(422);
    expect(invalid.body.code).toBe("EINVOICE_INBOUND_INVALID");
    expect(invalid.body.validation.schematron.errorCount).toBeGreaterThan(0);
    const rows = await h.sql(
      `SELECT status, bill_id FROM einvoice_inbound_documents WHERE company_id = $1`,
      [t.company.id]
    );
    expect(rows).toEqual([{ status: "invalid", bill_id: null }]);

    const garbage = await deliver(t, "<Invoice");
    expect(garbage.status).toBe(400);
    expect(garbage.body.code).toBe("EINVOICE_INBOUND_UNPARSEABLE");
  });

  it("[R04-23] answers 503 when the bills module is not registered", async () => {
    process.env.EINVOICE_INBOUND_WEBHOOK_SECRET = SECRET;
    const t = await tenant();
    const registry = await import("../../server/platform/service-registry");
    const original = registry.resolve<(...a: never[]) => unknown>("bills.createDraftFromInbound");
    registry.resetServices("bills.createDraftFromInbound");
    try {
      const r = await deliver(t, supplierInvoice({ number: "SUP-503" }));
      expect(r.status).toBe(503);
      expect(r.body.code).toBe("SERVICE_UNAVAILABLE");
    } finally {
      registry.provide("bills.createDraftFromInbound", original, { replace: true });
    }
    expect(
      (
        await h.sql(
          `SELECT count(*)::int AS n FROM einvoice_inbound_documents WHERE company_id = $1`,
          [t.company.id]
        )
      )[0].n
    ).toBe(0);
  });
});
