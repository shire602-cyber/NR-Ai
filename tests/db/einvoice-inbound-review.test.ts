import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { fixtureCompany, PINT_AE_FIXTURES } from "../fixtures/pint-ae/fixtures";
import { useHarness } from "./harness";

const h = useHarness();

it("only offers review for received UAE credit notes with a same-company source and no existing booking", async () => {
  const tenant = await h.createTenant();
  const other = await h.createSecondTenant();
  const { generateEInvoiceXML } = await import("../../server/services/einvoice.service");
  const { archiveEInvoiceXml } = await import("../../server/services/einvoice/store");
  const credit = PINT_AE_FIXTURES.find((fixture) => fixture.name === "credit note")!;
  const outside = PINT_AE_FIXTURES.find((fixture) => fixture.name === "out of scope")!;
  const rows = [
    { number: "CN-RECEIVED", type: "381", reviewable: true },
    { number: "CN-OUT-OF-SCOPE", type: "81", reviewable: true },
    { number: "CN-SELF-BILLED", type: "261", reviewable: false },
    { number: "CN-NO-SOURCE", type: "381", missingArchive: true, reviewable: false },
    { number: "CN-FOREIGN-SOURCE", type: "381", foreignArchive: true, reviewable: false },
    { number: "CN-BOOKED", type: "381", debitNoteId: randomUUID(), reviewable: false },
    { number: "CN-BILLED", type: "381", billId: randomUUID(), reviewable: false },
    { number: "CN-INVALID", type: "381", status: "invalid", reviewable: false },
  ];

  for (const row of rows) {
    const { xml } = generateEInvoiceXML(
      { ...credit.invoice, number: row.number },
      row.type === "81" ? outside.lines : credit.lines,
      fixtureCompany,
      credit.customer,
      credit.opts
    );
    const archive = row.missingArchive
      ? null
      : await archiveEInvoiceXml({
          companyId: row.foreignArchive ? other.company.id : tenant.company.id,
          direction: "inbound",
          kind: "received",
          documentNumber: row.number,
          documentType: row.type,
          xml,
        });
    await h.sql(
      `INSERT INTO einvoice_inbound_documents
         (company_id, document_number, document_type, status, sha256, archive_id, debit_note_id, bill_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tenant.company.id,
        row.number,
        row.type,
        row.status ?? "received",
        archive?.sha256 ?? "missing-source",
        archive?.id ?? randomUUID(),
        row.debitNoteId ?? null,
        row.billId ?? null,
      ]
    );
  }

  const result = await tenant.as.get(`/api/companies/${tenant.company.id}/einvoicing/inbound`);
  expect(result.status).toBe(200);
  expect(result.body.items).toHaveLength(rows.length);
  expect(result.body.items).toEqual(
    expect.arrayContaining(
      rows.map((row) =>
        expect.objectContaining({
          documentNumber: row.number,
          vendorCreditReviewable: row.reviewable,
        })
      )
    )
  );
  expect(result.body.items.every((row: object) => !("debitNoteId" in row))).toBe(true);

  await h.sql(
    `INSERT INTO einvoice_inbound_documents
       (company_id, document_number, document_type, status, sha256, received_at)
     SELECT $1, 'INVOICE-' || n, '380', 'invalid', 'fixture', now() + interval '1 day'
     FROM generate_series(1, 110) AS n`,
    [tenant.company.id]
  );
  await h.sql(
    `UPDATE einvoice_inbound_documents
        SET received_at = timestamp '2026-05-01 00:00:00.123456'
      WHERE company_id = $1 AND document_number IN ('CN-RECEIVED', 'CN-OUT-OF-SCOPE')`,
    [tenant.company.id]
  );
  const pending = `/api/companies/${tenant.company.id}/einvoicing/inbound?review=vendor-credits&limit=1`;
  const first = await tenant.as.get(pending);
  expect(first.status, first.text).toBe(200);
  expect(first.body.items).toMatchObject([{ vendorCreditReviewable: true }]);
  expect(first.body.nextCursor).toBe(first.body.items[0].id);
  await h.sql(
    `UPDATE einvoice_inbound_documents SET status = 'credit_created', debit_note_id = gen_random_uuid()
      WHERE company_id = $1 AND id = $2`,
    [tenant.company.id, first.body.nextCursor]
  );
  const next = await tenant.as.get(`${pending}&cursor=${first.body.nextCursor}`);
  expect(next.status, next.text).toBe(200);
  expect(next.body.items).toMatchObject([{ vendorCreditReviewable: true }]);
  expect([...first.body.items, ...next.body.items].map((row) => row.documentNumber).sort()).toEqual(
    ["CN-OUT-OF-SCOPE", "CN-RECEIVED"]
  );
  expect(next.body.nextCursor).toBeNull();
});
