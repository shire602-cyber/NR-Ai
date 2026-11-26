import { expect, it } from "vitest";
import { accountByCode, useHarness } from "./harness";

const h = useHarness();

it("preserves the retained receipt's image after a split sibling is deleted", async () => {
  const t = await h.createTenant();
  const receipts = `/api/companies/${t.company.id}/receipts`;
  const imageData =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
  const created = await t.as.post(receipts, {
    date: "2026-01-15",
    merchant: "Fixture",
    amount: 100,
    vatAmount: 0,
    imageData,
  });
  expect(created.status, created.text).toBe(200);
  const split = await t.as.post(`/api/receipts/${created.body.id}/split`, {
    parts: [{ amount: 70 }, { amount: 30 }],
  });
  expect(split.status, split.text).toBe(201);
  const [expired, retained] = split.body.receipts;
  const imageUrl = `${receipts}/${retained.id}/image`;
  expect((await t.as.get(imageUrl)).status).toBe(200);
  await h.sql("UPDATE receipts SET created_at = now() - interval '6 years' WHERE id=$1", [
    expired.id,
  ]);
  expect((await t.as.delete(`/api/receipts/${expired.id}`)).status).toBe(200);
  expect((await t.as.get(imageUrl)).status).toBe(200);
});

it("keeps receipt posting retryable when writing its VAT treatment fails", async () => {
  const t = await h.createTenant();
  const created = await t.as.post(`/api/companies/${t.company.id}/receipts`, {
    date: "2026-01-15",
    merchant: "Fixture",
    amount: 100,
    vatAmount: 5,
  });
  expect(created.status, created.text).toBe(200);
  const expense = await accountByCode(t, "5000");
  const bank = await accountByCode(t, "1020");
  const postReceipt = () =>
    t.as.post(`/api/receipts/${created.body.id}/post`, {
      accountId: expense.id,
      paymentAccountId: bank.id,
    });
  await h.sql(`CREATE FUNCTION au7_fail_vat() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'simulated VAT treatment write failure'; END; $$`);
  await h.sql(
    "CREATE TRIGGER au7_fail_vat BEFORE INSERT ON receipt_vat_treatments FOR EACH ROW EXECUTE FUNCTION au7_fail_vat()"
  );
  try {
    expect((await postReceipt()).status).toBeGreaterThanOrEqual(400);
  } finally {
    await h.sql("DROP TRIGGER au7_fail_vat ON receipt_vat_treatments");
    await h.sql("DROP FUNCTION au7_fail_vat()");
  }
  const [state] = await h.sql("SELECT posted, journal_entry_id FROM receipts WHERE id=$1", [
    created.body.id,
  ]);
  expect.soft(state).toEqual({ posted: false, journal_entry_id: null });
  expect((await postReceipt()).status).toBe(200);
});
