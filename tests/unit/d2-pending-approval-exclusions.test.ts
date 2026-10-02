// A bill waiting for approvals ('pending_approval') is not on the ledger. Every query that keeps pending bills
// out of the VAT return, the FAF, the dashboard and the opening-balance checks must keep this one out too, or its
// input VAT would be recovered before the bill is posted.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const FILES = [
  "server/services/vat-period-purchases.service.ts",
  "server/services/faf-export.service.ts",
  "server/services/vat-autopilot.service.ts",
  "server/routes/dashboard.routes.ts",
  "server/services/opening-balance.service.ts",
];

describe("pending_approval bills stay out of posted-only queries", () => {
  for (const file of FILES) {
    it(`${file} excludes pending_approval wherever it excludes pending bills`, () => {
      const source = readFileSync(join(root, file), "utf8");
      const lists = source.match(/NOT IN \([^)]*'pending'[^)]*\)/g) ?? [];
      expect(lists.length).toBeGreaterThan(0);
      for (const list of lists) expect(list).toContain("'pending_approval'");
    });
  }
});
