/**
 * J4: every account / contact / product / cost-centre / vendor id in a write payload must belong
 * to the caller's company. Tenant B posts tenant A's ids; each create/update answers 404 at write
 * time (never a 2xx that only fails later at approve/post).
 */
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";
import { insertRow } from "./row-factory";
import { dubaiToday } from "../helpers/dates";

const h = useHarness();
const today = () => dubaiToday();

describe("J4: foreign ids in write payloads are rejected at write time", () => {
  it("J4: bills, quotes, purchase orders and fixed assets refuse another company's ids", async () => {
    const a = await h.createTenant({ name: "RefA" });
    const b = await h.createSecondTenant({ name: "RefB" });
    const ctxA = { companyId: a.company.id, userId: a.user.id };
    const foreign = {
      account: await insertRow(h.sql, "accounts", ctxA, { code: `8${Date.now() % 100000}` }),
      product: await insertRow(h.sql, "products", ctxA),
      contact: await insertRow(h.sql, "customer_contacts", ctxA),
      costCenter: await insertRow(h.sql, "cost_centers", ctxA),
      vendor: await insertRow(h.sql, "vendors", ctxA),
    };
    const base = `/api/companies/${b.company.id}`;
    const line = { description: "x", quantity: 1, unit_price: 10000, vat_rate: 5 };

    const cases: Array<[string, string, unknown]> = [
      ["bill account", `${base}/bills`, bill({ ...line, account_id: foreign.account })],
      ["bill product", `${base}/bills`, bill({ ...line, product_id: foreign.product })],
      ["bill cost centre", `${base}/bills`, bill({ ...line, cost_center_id: foreign.costCenter })],
      [
        "quote contact",
        `${base}/quotes`,
        {
          contactId: foreign.contact,
          date: today(),
          lines: [{ description: "x", quantity: 1, unitPrice: 10, vatRate: 5 }],
        },
      ],
      [
        "quote product",
        `${base}/quotes`,
        {
          customerName: "Q",
          date: today(),
          lines: [
            {
              description: "x",
              quantity: 1,
              unitPrice: 10,
              vatRate: 5,
              productId: foreign.product,
            },
          ],
        },
      ],
      [
        "purchase order account",
        `${base}/purchase-orders`,
        po([{ description: "x", quantity: 1, unitPrice: 10, accountId: foreign.account }]),
      ],
      [
        "purchase order product",
        `${base}/purchase-orders`,
        po([{ description: "x", quantity: 1, unitPrice: 10, productId: foreign.product }]),
      ],
      [
        "fixed asset cost account",
        `${base}/fixed-assets`,
        asset({ costAccountId: foreign.account }),
      ],
      [
        "fixed asset cost centre",
        `${base}/fixed-assets`,
        asset({ costCenterId: foreign.costCenter }),
      ],
    ];
    const failures: string[] = [];
    for (const [name, url, body] of cases) {
      const res = await b.as.post(url, body);
      if (![400, 404, 422].includes(res.status))
        failures.push(`${name}: ${res.status} ${res.text.slice(0, 120)}`);
    }
    expect(failures).toEqual([]);

    // The same lines with B's own ids still work.
    const own = await insertRow(
      h.sql,
      "accounts",
      { companyId: b.company.id, userId: b.user.id },
      {
        code: `7${Date.now() % 100000}`,
      }
    );
    const ok = await b.as.post(`${base}/bills`, bill({ ...line, account_id: own }));
    expect(ok.status, ok.text).toBe(200);
  });
});

function bill(lineItem: Record<string, unknown>) {
  return {
    vendor_name: "Acme Supplies",
    bill_date: today(),
    save_as_draft: true,
    line_items: [lineItem],
  };
}
function po(lines: unknown[]) {
  return { vendorName: "Acme Supplies", date: today(), lines };
}
function asset(extra: Record<string, unknown>) {
  return {
    assetName: "Laptop",
    category: "equipment",
    purchaseDate: today(),
    purchaseCost: 5000,
    usefulLifeYears: 5,
    ...extra,
  };
}
