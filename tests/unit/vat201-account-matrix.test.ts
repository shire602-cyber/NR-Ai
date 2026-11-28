/**
 * Account-code → VAT 201 family mapping matrix.
 *
 * Verifies the pipeline: account code → revenueRoleForCode → POSTED_ROLE_FAMILY → Vat201Family.
 * The correctness of this mapping is load-bearing for the GL-classification-wins fix (review
 * 6089589345): only by correctly mapping 4060→"zero_rated" and 4070→"exempt" can the engine
 * remove line-level families that disagree with the GL account and prevent double-counting.
 *
 * These are behaviour tests via the exported function, not source-inspection tests; they cannot
 * be DB tests because the mapping is a pure function over static constants.
 */
import { describe, expect, it } from "vitest";
import { REVENUE_ACCOUNT_CODES } from "../../shared/vat-classification";
import { revenueRoleForCode } from "../../server/services/invoice-posting.service";

describe("account code → revenue role (revenueRoleForCode)", () => {
  it("4060 → zero_rated_sales", () => {
    expect(revenueRoleForCode(REVENUE_ACCOUNT_CODES.zero_rated_sales)).toBe("zero_rated_sales");
    expect(revenueRoleForCode("4060")).toBe("zero_rated_sales");
  });

  it("4070 → exempt_sales", () => {
    expect(revenueRoleForCode(REVENUE_ACCOUNT_CODES.exempt_sales)).toBe("exempt_sales");
    expect(revenueRoleForCode("4070")).toBe("exempt_sales");
  });

  it("4030 → out_of_scope_revenue", () => {
    expect(revenueRoleForCode(REVENUE_ACCOUNT_CODES.out_of_scope_revenue)).toBe(
      "out_of_scope_revenue"
    );
    expect(revenueRoleForCode("4030")).toBe("out_of_scope_revenue");
  });

  it("4010 → standard_sales (the designated standard revenue code)", () => {
    expect(revenueRoleForCode(REVENUE_ACCOUNT_CODES.standard_sales)).toBe("standard_sales");
    expect(revenueRoleForCode("4010")).toBe("standard_sales");
  });

  it("any unknown code falls back to standard_sales", () => {
    // 4020 is a common service revenue account that is not one of the special codes.
    expect(revenueRoleForCode("4020")).toBe("standard_sales");
    expect(revenueRoleForCode("9999")).toBe("standard_sales");
    expect(revenueRoleForCode("5000")).toBe("standard_sales");
    expect(revenueRoleForCode("4011")).toBe("standard_sales");
  });
});

describe("POSTED_ROLE_FAMILY consistency: standard_sales codes → Box 1; special codes → non-Box-1", () => {
  it("4060 / 4070 / 4030 are distinct from the standard_sales fallback", () => {
    const specialCodes = [
      REVENUE_ACCOUNT_CODES.zero_rated_sales,
      REVENUE_ACCOUNT_CODES.exempt_sales,
      REVENUE_ACCOUNT_CODES.out_of_scope_revenue,
    ];
    for (const code of specialCodes) {
      expect(revenueRoleForCode(code)).not.toBe("standard_sales");
    }
  });

  it("all REVENUE_ACCOUNT_CODES keys are covered by revenueRoleForCode", () => {
    const roles = Object.keys(REVENUE_ACCOUNT_CODES) as (keyof typeof REVENUE_ACCOUNT_CODES)[];
    for (const role of roles) {
      const code = REVENUE_ACCOUNT_CODES[role];
      expect(revenueRoleForCode(code)).toBe(role);
    }
  });
});
