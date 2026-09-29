import { describe, expect, it } from "vitest";
import { parseBankTransactionInput } from "../../server/services/bank-transaction-input.service";

const NOW = new Date("2026-09-29T08:00:00Z");
const parse = (body: unknown) => parseBankTransactionInput(body, NOW);

describe("parseBankTransactionInput", () => {
  it("a plain YYYY-MM-DD is stored as that calendar day at UTC midnight", () => {
    const r = parse({ transactionDate: "2026-09-20", description: "Deposit", amount: 250.5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.transactionDate).toBeInstanceOf(Date);
      expect(r.value.transactionDate.toISOString()).toBe("2026-09-20T00:00:00.000Z");
      expect(r.value.amount).toBe(250.5);
      expect(r.value.importSource).toBe("manual");
    }
  });

  it("an ISO datetime becomes its UAE calendar day", () => {
    const r = parse({ transactionDate: "2026-09-19T20:00:00.000Z", description: "d", amount: "10" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.transactionDate.toISOString()).toBe("2026-09-20T00:00:00.000Z");
      expect(r.value.amount).toBe(10);
    }
  });

  it("an invalid date is a 400", () => {
    for (const transactionDate of ["not-a-date", "2026-02-30", "", null, 12]) {
      const r = parse({ transactionDate, description: "d", amount: 1 });
      expect(r).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("a future date is refused", () => {
    const r = parse({ transactionDate: "2026-10-05", description: "d", amount: 1 });
    expect(r).toMatchObject({ ok: false, status: 422, code: "BANK_TRANSACTION_DATE_IN_FUTURE" });
  });

  it("today is fine", () => {
    expect(parse({ transactionDate: "2026-09-29", description: "d", amount: 1 }).ok).toBe(true);
  });

  it("description and a finite amount are required", () => {
    expect(parse({ transactionDate: "2026-09-20", amount: 1 })).toMatchObject({ ok: false, status: 400 });
    expect(parse({ transactionDate: "2026-09-20", description: "  ", amount: 1 })).toMatchObject({ ok: false, status: 400 });
    expect(parse({ transactionDate: "2026-09-20", description: "d" })).toMatchObject({ ok: false, status: 400 });
    expect(parse({ transactionDate: "2026-09-20", description: "d", amount: "abc" })).toMatchObject({ ok: false, status: 400 });
    expect(parse({ transactionDate: "2026-09-20", description: "d", amount: Infinity })).toMatchObject({ ok: false, status: 400 });
  });

  it("only allow-listed fields pass: reconciliation state and tenant scope cannot be set", () => {
    const r = parse({
      transactionDate: "2026-09-20",
      description: "d",
      amount: 5,
      companyId: "other",
      isReconciled: true,
      matchedInvoiceId: "x",
      reference: "REF1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).not.toHaveProperty("companyId");
      expect(r.value).not.toHaveProperty("isReconciled");
      expect(r.value).not.toHaveProperty("matchedInvoiceId");
      expect(r.value.reference).toBe("REF1");
    }
  });
});
