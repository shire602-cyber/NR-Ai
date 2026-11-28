/**
 * Loop 2: document numbering and firm WIP billing read the Dubai calendar day.
 * At 21:30Z the UTC date is still the previous day (and the previous year on 31 Dec) while
 * Dubai is already on the next one.
 */
import { afterEach, expect, it } from "vitest";
import { freezeTime, useHarness } from "./harness";

// Firm sign-up is closed by default; the firm owner fixture needs it open.
process.env.FIRM_SELF_SIGNUP = "true";

const h = useHarness();
let thaw: (() => void) | null = null;
afterEach(() => {
  thaw?.();
  thaw = null;
});

async function service() {
  return import("../../server/services/invoice-numbering.service");
}

it("a number issued after 20:00Z on 31 Dec takes the new Dubai year and its own sequence", async () => {
  const { allocateInvoiceNumber, peekNextInvoiceNumber } = await service();
  const t = await h.createTenant({ name: "NewYearNumbering" });
  const cid = t.company.id;
  expect(await allocateInvoiceNumber(cid, "invoice", new Date("2026-12-31"))).toBe(
    "INV-2026-00001"
  );

  thaw = freezeTime("2026-12-31T21:30:00Z");
  expect(await peekNextInvoiceNumber(cid, "invoice")).toBe("INV-2027-00001");
  expect(await allocateInvoiceNumber(cid, "invoice")).toBe("INV-2027-00001");
  expect(await allocateInvoiceNumber(cid, "cash_sale")).toBe("CS-2027-00001");
  expect(await allocateInvoiceNumber(cid, "invoice")).toBe("INV-2027-00002");
  thaw();
  thaw = null;

  // The 2026 sequence is untouched: an explicit 2026 date continues it.
  expect(await allocateInvoiceNumber(cid, "invoice", new Date("2026-12-31"))).toBe(
    "INV-2026-00002"
  );
});

it("an explicit date-only value keeps its own calendar year whatever the clock says", async () => {
  const { allocateInvoiceNumber } = await service();
  const t = await h.createTenant({ name: "DateOnlyNumbering" });
  thaw = freezeTime("2026-12-31T21:30:00Z");
  expect(await allocateInvoiceNumber(t.company.id, "invoice", new Date("2026-12-31"))).toBe(
    "INV-2026-00001"
  );
  expect(await allocateInvoiceNumber(t.company.id, "invoice", new Date("2027-01-01"))).toBe(
    "INV-2027-00001"
  );
});

it("a mid-year 30 Nov clock after 20:00Z keeps the same year and continues the sequence", async () => {
  const { allocateInvoiceNumber } = await service();
  const t = await h.createTenant({ name: "NovNumbering" });
  const cid = t.company.id;
  expect(await allocateInvoiceNumber(cid, "invoice", new Date("2026-11-30"))).toBe(
    "INV-2026-00001"
  );
  thaw = freezeTime("2026-11-30T21:30:00Z");
  expect(await allocateInvoiceNumber(cid, "invoice")).toBe("INV-2026-00002");
});

it("billWip defaults its invoice date to the Dubai day", async () => {
  thaw = freezeTime("2026-11-30T21:30:00Z");
  const owner = await h.createTenant({ name: "WipOwner", firmRole: "firm_owner" });
  const client = await h.createTenant({ name: "WipClient" });
  const cid = client.company.id;
  const invite = await owner.as.post("/api/firm/client-links", { inviteeEmail: client.email });
  expect(invite.status, invite.text).toBe(201);
  const joined = await client.as.post(`/api/firm-invitations/${invite.body.link.id}/accept`, {
    companyId: cid,
  });
  expect(joined.status, joined.text).toBe(200);
  const entry = await owner.as.post("/api/firm/time-entries", {
    companyId: cid,
    entryDate: "2026-11-30",
    minutes: 60,
    hourlyRate: 400,
    description: "Review",
  });
  expect(entry.status, entry.text).toBe(201);
  const bill = await owner.as.post(`/api/firm/clients/${cid}/bill-wip`, {});
  expect(bill.status, bill.text).toBe(201);
  const [row] = await h.sql<{ d: string; due: string }>(
    `SELECT to_char(invoice_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d,
            to_char(due_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS due
       FROM service_invoices WHERE id = $1`,
    [bill.body.invoice.id]
  );
  expect(row).toEqual({ d: "2026-12-01", due: "2026-12-31" });
});
