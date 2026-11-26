import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";
import { PINT_AE_FIXTURES, fixtureCompany, type PintAeFixture } from "../fixtures/pint-ae/fixtures";

const h = useHarness();
describe("AU7 durable delivery", () => {
  it("reconciles a transient draft-creation error when an inbound document is delivered again", async () => {
    const buyerTrn = "100555666700003";
    const tenant = await h.createTenant({
      companyColumns: { trn_vat_number: buyerTrn },
    });
    const fixture = PINT_AE_FIXTURES[0] as PintAeFixture;
    const { generateEInvoiceXML } = await import("../../server/services/einvoice.service");
    const { processInboundEInvoice } = await import("../../server/services/einvoice/inbound");
    const registry = await import("../../server/platform/service-registry");
    const original = registry.resolve<(...args: never[]) => unknown>(
      "bills.prepareDraftFromInbound"
    );
    const { xml } = generateEInvoiceXML(
      { ...fixture.invoice, number: "AU7-SUP-01" },
      fixture.lines,
      fixtureCompany,
      { ...fixture.customer, trn: buyerTrn, endpointId: buyerTrn.slice(0, 10) },
      fixture.opts
    );
    const input = {
      company: { id: tenant.company.id, trnVatNumber: buyerTrn },
      xml,
    };
    registry.provide(
      "bills.prepareDraftFromInbound",
      async () => {
        throw new Error("simulated local transient error");
      },
      { replace: true }
    );
    try {
      await expect(processInboundEInvoice(input)).rejects.toThrow(
        "simulated local transient error"
      );
    } finally {
      registry.provide("bills.prepareDraftFromInbound", original, {
        replace: true,
      });
    }
    const result = await processInboundEInvoice(input);
    const [state] = await h.sql(
      "SELECT status, bill_id, (SELECT count(*)::int FROM vendor_bills WHERE company_id = $1) AS bill_count FROM einvoice_inbound_documents WHERE company_id = $1",
      [tenant.company.id]
    );
    expect({ redeliveryStatus: result.status, ...state }).toMatchObject({
      status: "bill_created",
      bill_count: 1,
    });
  });
});
