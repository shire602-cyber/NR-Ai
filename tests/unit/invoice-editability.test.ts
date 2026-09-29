/** The Edit action is only offered for invoices the server will let you edit. */
import { describe, expect, it } from "vitest";
import { canEditInvoice } from "../../client/src/lib/invoice-editability";

describe("canEditInvoice", () => {
  it.each(["credited", "paid", "void", "cancelled"])("refuses %s invoices", (status) => {
    expect(canEditInvoice(status)).toBe(false);
  });

  it.each(["draft", "sent", "posted", "partial", "overdue"])("allows %s invoices", (status) => {
    expect(canEditInvoice(status)).toBe(true);
  });

  it("is case-insensitive and tolerates missing status", () => {
    expect(canEditInvoice("PAID")).toBe(false);
    expect(canEditInvoice(undefined)).toBe(true);
    expect(canEditInvoice(null)).toBe(true);
  });
});
