import { describe, expect, it } from "vitest";
import { paymentAccountChoices } from "../../client/src/components/banking/payment-accounts";

const a = (id: string, code: string, nameEn: string, extra: Record<string, unknown> = {}) => ({ id, code, nameEn, type: "asset", ...extra });
const chart = [a("cash", "1010", "Cash on Hand"), a("hdr", "1020", "Bank Accounts"), a("fab", "1021", "FAB Current"), a("usd", "1022", "FAB USD"), a("ar", "1040", "Accounts Receivable")];

describe("paymentAccountChoices", () => {
  it("never offers the header once the company has bank accounts of its own", () => {
    const c = paymentAccountChoices(chart, [{ glAccountId: "fab", isActive: true }, { glAccountId: "usd", isActive: true }]);
    expect(c.options.map((o) => o.code)).toEqual(["1010", "1021", "1022"]);
    expect(c.requiresChoice).toBe(true);
  });
  it("defaults to the main managed bank account", () => {
    expect(paymentAccountChoices(chart, [{ glAccountId: "fab", isActive: true }, { glAccountId: "usd", isActive: true }]).defaultId).toBe("fab");
    expect(paymentAccountChoices(chart, [{ glAccountId: "usd", isActive: true }]).defaultId).toBe("usd");
  });
  it("falls back to a child bank account, then to the header and cash for a company with no bank account of its own", () => {
    expect(paymentAccountChoices(chart, []).defaultId).toBe("fab");
    const plain = [a("cash", "1010", "Cash on Hand"), a("hdr", "1020", "Bank Accounts")];
    const c = paymentAccountChoices(plain, []);
    expect(c.options.map((o) => o.code)).toEqual(["1010", "1020"]);
    expect(c.defaultId).toBe("hdr");
    expect(c.requiresChoice).toBe(false);
  });
  it("skips inactive accounts and a deactivated bank account", () => {
    const c = paymentAccountChoices([...chart, a("old", "1023", "Old Bank", { isActive: false })], [{ glAccountId: "fab", isActive: false }]);
    expect(c.options.map((o) => o.code)).not.toContain("1023");
    expect(c.defaultId).toBe("fab");
  });
  it("is empty without any account", () => {
    expect(paymentAccountChoices([], [])).toEqual({ options: [], defaultId: "", requiresChoice: false });
  });
});
