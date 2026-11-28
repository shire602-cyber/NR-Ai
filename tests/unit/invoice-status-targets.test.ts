import { describe, expect, it } from "vitest";
import { invoiceStatusTargets } from "../../client/src/lib/invoice-status";

describe("J2: the invoice status dropdown offers only transitions the API accepts", () => {
  it("never offers paid or partial (those come from the payment flow)", () => {
    for (const status of ["draft", "sent", "partial", "paid", "void", "cancelled"]) {
      const targets: string[] = invoiceStatusTargets({ status });
      expect(targets).not.toContain("paid");
      expect(targets).not.toContain("partial");
    }
  });

  it("draft can be issued or voided; sent can be voided; settled/terminal invoices offer nothing", () => {
    expect(invoiceStatusTargets({ status: "draft" })).toEqual(["draft", "sent", "void"]);
    expect(invoiceStatusTargets({ status: "sent" })).toEqual(["sent", "void"]);
    for (const status of ["partial", "paid", "void", "cancelled"]) {
      expect(invoiceStatusTargets({ status })).toEqual([]);
    }
  });
});
