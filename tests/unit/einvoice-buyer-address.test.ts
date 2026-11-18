import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  BUYER_ADDRESS_MISSING,
  validateForEInvoicing,
} from "../../server/services/einvoice.service";
import { PINT_AE_FIXTURES, fixtureCompany, uaeBuyer } from "../fixtures/pint-ae/fixtures";

const f = PINT_AE_FIXTURES[0];
const check = (customer: Record<string, unknown>) =>
  validateForEInvoicing(f.invoice, f.lines, fixtureCompany, { customer: customer as never });

describe("buyer address preflight (ibr-144-ae)", () => {
  it("names customer.address with a stable code when the UAE buyer has no address at all", () => {
    const issues = check({ ...uaeBuyer, address: null, city: null, emirate: null });
    expect(issues.find((i) => i.code === BUYER_ADDRESS_MISSING)).toMatchObject({
      field: "customer.address",
    });
    expect(issues.map((i) => i.field)).not.toContain("document.schematron");
  });

  it("names which part is missing for a partial address", () => {
    const issue = check({ ...uaeBuyer, city: null }).find((i) => i.code === BUYER_ADDRESS_MISSING);
    expect(issue?.message).toMatch(/city/);
    expect(issue?.message).not.toMatch(/Buyer street/);
  });

  it("passes a complete buyer", () => {
    expect(check({ ...uaeBuyer }).filter((i) => i.field === "customer.address")).toEqual([]);
  });

  it("has EN and AR fix text on both the invoice list and the e-invoice status screen", async () => {
    const { einvoiceIssueTextKey } = await import("../../client/src/lib/einvoice-issues");
    const { issueTextKey } = await import("../../client/src/components/einvoice/einvoice-meta");
    for (const [ns, key] of [
      ["invoices", einvoiceIssueTextKey(BUYER_ADDRESS_MISSING)],
      ["einvoicing", issueTextKey(BUYER_ADDRESS_MISSING)],
    ] as const) {
      expect(key).toBeTruthy();
      for (const lang of ["en", "ar"]) {
        const cat = JSON.parse(
          fs.readFileSync(
            path.join(__dirname, "..", "..", "client", "src", "locales", lang, `${ns}.json`),
            "utf8"
          )
        ) as Record<string, string>;
        expect(cat[key!], `${lang} ${key}`).toBeTruthy();
        if (lang === "ar") expect(cat[key!]).toMatch(/[؀-ۿ]/);
      }
    }
  });
});
