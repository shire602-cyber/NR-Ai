import { describe, expect, it } from "vitest";
import { parseXml, textAt } from "../../server/services/einvoice/dom";
import { ublToGets } from "../../server/services/einvoice/providers/complyance-gets";
import { useHarness } from "./harness";

const h = useHarness();

describe("UAE PINT AE cash sales", () => {
  it("excludes an explicitly identified consumer cash sale from validation, delivery and filing", async () => {
    const tenant = await h.createTenant();
    const base = `/api/companies/${tenant.company.id}`;
    const colleague = await h.createSecondTenant();
    await h.sql(
      "INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'accountant')",
      [tenant.company.id, colleague.user.id]
    );
    const bank = await tenant.as.post(`${base}/bank-accounts`, {
      nameEn: "Cash receipts account",
      bankName: "Test bank",
    });
    expect(bank.status, bank.text).toBe(201);
    const sale = await tenant.as.post(`${base}/cash-sales`, {
      customerName: "Walk-in customer",
      buyerType: "consumer",
      date: new Date().toISOString().slice(0, 10),
      placeOfSupplyEmirate: "dubai",
      paymentAccountId: bank.body.glAccountId,
      method: "cash",
      lines: [{ description: "Counter service", quantity: 1, unitPrice: 100, vatRate: 0.05 }],
    });
    expect(sale.status, sale.text).toBe(201);
    expect(sale.body).toMatchObject({
      number: expect.stringMatching(/^CS-/),
      einvoiceApplicable: false,
    });

    const { drainDomainEvents } = await import("../../server/platform/domain-events");
    await drainDomainEvents();
    const signals = await h.sql<{ user_id: string; event_key: string }>(
      "SELECT user_id, event_key FROM notifications WHERE company_id = $1 AND event_key = ANY($2::text[])",
      [
        tenant.company.id,
        [
          `invoice.issued:${sale.body.id}`,
          `invoice.paid:${sale.body.id}`,
          `payment.received:${sale.body.payment.id}`,
        ],
      ]
    );
    expect(signals.map(({ user_id }) => user_id)).toEqual(Array(3).fill(colleague.user.id));

    const invoice = `/api/invoices/${sale.body.id}`;
    const validation = await tenant.as.get(`${invoice}/einvoice/validate`);
    expect(validation.status, validation.text).toBe(200);
    expect(validation.body).toMatchObject({ applicable: false, issues: [] });
    const detail = await tenant.as.get(`${invoice}/einvoice/status`);
    expect(detail.status, detail.text).toBe(200);
    expect(detail.body).toMatchObject({
      applicable: false,
      issues: [],
      tracks: {
        delivery: { status: "not_applicable" },
        reporting: { status: "not_required", required: false, reportBy: null },
      },
      transmission: { canSubmit: false },
    });
    const list = await tenant.as.get(`${base}/einvoicing/compliance?invoiceIds=${sale.body.id}`);
    expect(list.status, list.text).toBe(200);
    expect(list.body.items).toContainEqual(
      expect.objectContaining({
        invoiceId: sale.body.id,
        delivery: "not_applicable",
        reporting: "not_required",
        reportingRequired: false,
      })
    );
    const generate = await tenant.as.post(`${invoice}/generate-einvoice`, {});
    expect(generate.status, generate.text).toBe(409);
    expect(generate.body.code).toBe("EINVOICE_NOT_REQUIRED");
    const submit = await tenant.as.post(`${invoice}/einvoice/submit`, {});
    expect(submit.status, submit.text).toBe(409);
    expect(submit.body.code).toBe("EINVOICE_NOT_REQUIRED");
  });

  it.each(["business", "government", undefined] as const)(
    "keeps a cash buyer with type %s and no TRN or endpoint available for remediation",
    async (buyerType) => {
      const tenant = await h.createTenant();
      const base = `/api/companies/${tenant.company.id}`;
      const bank = await tenant.as.post(`${base}/bank-accounts`, {
        nameEn: "Cash receipts account",
        bankName: "Test bank",
      });
      expect(bank.status, bank.text).toBe(201);
      const sale = await tenant.as.post(`${base}/cash-sales`, {
        customerName: "Counter buyer",
        buyerType,
        date: new Date().toISOString().slice(0, 10),
        placeOfSupplyEmirate: "dubai",
        paymentAccountId: bank.body.glAccountId,
        lines: [{ description: "Counter service", quantity: 1, unitPrice: 100, vatRate: 0.05 }],
      });
      expect(sale.status, sale.text).toBe(201);
      expect(sale.body).toMatchObject({ buyerType: buyerType ?? null, einvoiceApplicable: true });
      const url = `/api/invoices/${sale.body.id}/einvoice`;
      const validation = await tenant.as.get(`${url}/validate`);
      expect(validation.status, validation.text).toBe(200);
      expect(validation.body).toMatchObject({
        applicable: true,
        issues: expect.arrayContaining([expect.objectContaining({ field: "customer.endpointId" })]),
      });
      const detail = await tenant.as.get(`${url}/status`);
      expect(detail.body.applicable).toBe(true);
      expect(detail.body.tracks.delivery.status).not.toBe("not_applicable");
      const compliance = await tenant.as.get(
        `${base}/einvoicing/compliance?invoiceIds=${sale.body.id}`
      );
      expect(compliance.body.items).toContainEqual(
        expect.objectContaining({ invoiceId: sale.body.id })
      );
    }
  );

  it("keeps an endpoint-only cash buyer in e-invoicing scope", async () => {
    const tenant = await h.createTenant();
    const base = `/api/companies/${tenant.company.id}`;
    const contact = await tenant.as.post(`${base}/customer-contacts`, {
      name: "Public agency",
    });
    expect(contact.status, contact.text).toBeLessThan(300);
    const endpoint = await tenant.as.put(`${base}/einvoicing/buyer-endpoints/${contact.body.id}`, {
      scheme: "0235",
      participantId: "1007654321",
    });
    expect(endpoint.status, endpoint.text).toBe(200);
    const bank = await tenant.as.post(`${base}/bank-accounts`, {
      nameEn: "Cash receipts account",
      bankName: "Test bank",
    });
    expect(bank.status, bank.text).toBe(201);
    const sale = await tenant.as.post(`${base}/cash-sales`, {
      contactId: contact.body.id,
      date: new Date().toISOString().slice(0, 10),
      placeOfSupplyEmirate: "dubai",
      paymentAccountId: bank.body.glAccountId,
      method: "cash",
      lines: [{ description: "Counter service", quantity: 1, unitPrice: 100, vatRate: 0.05 }],
    });
    expect(sale.status, sale.text).toBe(201);
    expect(sale.body.einvoiceApplicable).toBe(true);
    const validation = await tenant.as.get(`/api/invoices/${sale.body.id}/einvoice/validate`);
    expect(validation.status, validation.text).toBe(200);
    expect(validation.body.applicable).toBe(true);
  });

  it.each([
    { method: "cash", code: "10", gets: "IN_CASH" },
    { method: "credit_card", code: "54", gets: "CREDIT_CARD" },
    { method: "debit_card", code: "55", gets: "DEBIT_CARD" },
    { method: "card", code: null, gets: null },
  ])(
    "keeps the issued cash-sale series and checks the real $method payment method",
    async ({ method, code, gets }) => {
      const tenant = await h.createTenant({
        companyColumns: {
          trn_vat_number: "100123456700003",
          legal_name: "Pearl Trading L.L.C.",
          address_street: "Office 1204, Al Saqr Tower",
          address_city: "Dubai",
          address_country: "AE",
          emirate: "dubai",
          trade_licence_no: "CN-1234567",
          trade_licence_authority: "Dubai Department of Economy and Tourism",
          address_district: "Trade Centre",
          address_po_box: "12345",
        },
      });
      const base = `/api/companies/${tenant.company.id}`;
      const contact = await tenant.as.post(`${base}/customer-contacts`, {
        name: "Acme Gulf FZ-LLC",
        trnNumber: "100765432100003",
        address: "Building 7, Al Majaz",
        city: "Sharjah",
        emirate: "sharjah",
        postalCode: "45678",
        country: "AE",
      });
      expect(contact.status, contact.text).toBeLessThan(300);
      const endpoint = `${base}/einvoicing/buyer-endpoints/${contact.body.id}`;
      if (method === "cash") {
        const wrong = await tenant.as.put(endpoint, {
          scheme: "0235",
          participantId: "1009999999",
        });
        expect(wrong.status, wrong.text).toBe(422);
        expect(wrong.body.code).toBe("EINVOICE_BUYER_ENDPOINT_MISMATCH");
        const matched = await tenant.as.put(endpoint, { participantId: "1007654321" });
        expect(matched.status, matched.text).toBe(200);
      }
      const bank = await tenant.as.post(`${base}/bank-accounts`, {
        nameEn: "Cash receipts account",
        bankName: "Test bank",
      });
      expect(bank.status, bank.text).toBe(201);
      const sale = await tenant.as.post(`${base}/cash-sales`, {
        contactId: contact.body.id,
        date: new Date().toISOString().slice(0, 10),
        placeOfSupplyEmirate: "dubai",
        paymentAccountId: bank.body.glAccountId,
        method,
        lines: [{ description: "Counter sale", quantity: 1, unitPrice: 100, vatRate: 0.05 }],
      });
      expect(sale.status, sale.text).toBe(201);
      expect(sale.body.number).toMatch(/^CS-/);
      expect(sale.body.status).toBe("paid");
      expect(sale.body.einvoiceApplicable).toBe(true);

      const invoiceBase = `/api/invoices/${sale.body.id}`;
      if (method === "cash") {
        await h.sql("UPDATE customer_contacts SET trn_number = $2 WHERE id = $1", [
          contact.body.id,
          "100999999900003",
        ]);
      }
      const generated = await tenant.as.post(`${invoiceBase}/generate-einvoice`, {});
      if (method === "card") {
        expect(generated.status, generated.text).toBe(422);
        expect(generated.body.issues).toContainEqual(
          expect.objectContaining({ code: "EINVOICE_PAYMENT_CARD_TYPE_REQUIRED" })
        );
        return;
      }
      expect(generated.status, generated.text).toBe(200);
      expect(generated.body.validation).toMatchObject({ valid: true });
      const xmlResponse = await tenant.as.get(`${invoiceBase}/einvoice-xml`);
      expect(xmlResponse.status).toBe(200);
      const root = parseXml(xmlResponse.text).documentElement;
      expect(textAt(root, "cbc:ID")).toBe(sale.body.number);
      expect(textAt(root, "cbc:InvoiceTypeCode")).toBe("380");
      expect(textAt(root, "cac:PaymentMeans/cbc:PaymentMeansCode")).toBe(code);
      expect(
        textAt(root, "cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID")
      ).toBe("100765432100003");
      expect(ublToGets(xmlResponse.text).payload).toMatchObject({
        header: { documentNumber: sale.body.number },
        parties: {
          seller: { address: { addressLine2: "Trade Centre, PO Box 12345" } },
          buyer: { address: { postalCode: "45678", stateOrProvince: "SHJ" } },
        },
        payment: { paymentMeans: [{ paymentMeansCode: gets }] },
        totals: { prepaidAmount: 105, amountDue: 0, totalAmountIncludingTax: 105 },
      });
      if (method === "cash") {
        const updated = await tenant.as.put(endpoint, { participantId: "1009999999" });
        expect(updated.status, updated.text).toBe(200);
        const conflicting = await tenant.as.post(`${invoiceBase}/generate-einvoice`, {});
        expect(conflicting.status, conflicting.text).toBe(422);
        expect(conflicting.body.issues).toContainEqual(
          expect.objectContaining({ code: "EINVOICE_BUYER_ENDPOINT_MISMATCH" })
        );
      }
    }
  );
});
