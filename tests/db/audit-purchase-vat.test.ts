import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const domestic = { description: "Supplies", unit_price: 1000, vat_rate: 5 };
const reverseCharge = {
  description: "Imported service",
  unit_price: 1000,
  vat_rate: 5,
  vat_supply_type: "reverse_charge",
};

interface SavedLine {
  id: string;
  description: string;
  quantity: string;
  unit_price: string;
  vat_rate: string;
  account_id: string | null;
  product_id: string | null;
  cost_center_id: string | null;
}

function editorLine(line: SavedLine) {
  return {
    id: line.id,
    description: line.description,
    quantity: Number(line.quantity),
    unit_price: Number(line.unit_price),
    vat_rate: Number(line.vat_rate),
    account_id: line.account_id,
    product_id: line.product_id,
    cost_center_id: line.cost_center_id,
  };
}

function registeredTenant() {
  return h.createTenant({
    companyColumns: { emirate: "dubai", trn_vat_number: "100222333400003" },
  });
}

async function bill(t: Tenant, fields: Record<string, unknown>) {
  const response = await t.as.post(`/api/companies/${t.company.id}/bills`, {
    vendor_name: "Audit supplier",
    vendor_trn: "100000000000003",
    bill_number: "VAT-001",
    bill_date: "2026-01-15",
    save_as_draft: true,
    line_items: [domestic],
    ...fields,
  });
  expect(response.status, response.text).toBe(200);
  return response.body;
}

async function vatBoxes(t: Tenant, date = "2026-01-15") {
  const result = await t.as.get(
    `/api/companies/${t.company.id}/vat/compute?from=${date}&to=${date}`
  );
  expect(result.status, result.text).toBe(200);
  return result.body.boxes;
}

async function boxes(t: Tenant, billId: string, date?: string) {
  const submitted = await t.as.post(`/api/bills/${billId}/submit`, {});
  expect(submitted.status, submitted.text).toBe(200);
  const approved = await t.as.post(`/api/bills/${billId}/approve`, {});
  expect(approved.status, approved.text).toBe(200);
  return { approved: approved.body, vat: await vatBoxes(t, date) };
}

describe("Purchase VAT audit", () => {
  it.each([
    { encoding: "supply type", legacy: false },
    { encoding: "legacy flag", legacy: true },
  ])(
    "keeps partial and full edits equivalent for reverse charge stored as $encoding",
    async ({ legacy }) => {
      const t = await registeredTenant();
      const b = await bill(t, { line_items: [domestic, reverseCharge] });
      expect(b.total_amount).toBe("2050.00");
      await h.sql(
        `UPDATE bill_line_items
            SET vat_supply_type = CASE WHEN $2 THEN 'standard_rated' ELSE vat_supply_type END,
                reverse_charge = $2
          WHERE bill_id = $1 AND vat_supply_type = 'reverse_charge'`,
        [b.id, legacy]
      );
      const edited = await t.as.patch(`/api/bills/${b.id}`, { withholding_amount: 10 });
      expect(edited.status, edited.text).toBe(200);
      expect(edited.body.total_amount).toBe("2040.00");
      const { approved, vat } = await boxes(t, b.id);
      expect(approved.total_amount).toBe("2040.00");
      expect(vat).toMatchObject({
        box3ReverseChargeVat: 50,
        box9ExpensesVat: 50,
        box10ReverseChargeVat: 50,
      });
      const fullDate = "2026-01-16";
      const full = await bill(t, {
        bill_date: fullDate,
        bill_number: "VAT-FULL",
        withholding_amount: 10,
        line_items: [domestic, reverseCharge],
      });
      await h.sql(
        `UPDATE bill_line_items
            SET vat_supply_type = CASE WHEN $2 THEN 'standard_rated' ELSE vat_supply_type END,
                reverse_charge = $2
          WHERE bill_id = $1 AND vat_supply_type = 'reverse_charge'`,
        [full.id, legacy]
      );
      // The editor submits the effective treatment for either stored encoding.
      const replaced = await t.as.patch(`/api/bills/${full.id}`, {
        line_items: [domestic, reverseCharge],
        notes: "Full edit",
      });
      expect(replaced.status, replaced.text).toBe(200);
      expect(replaced.body.total_amount).toBe(edited.body.total_amount);
      expect(replaced.body.vat_amount).toBe(edited.body.vat_amount);
      expect((await boxes(t, full.id, fullDate)).vat).toEqual(vat);
    }
  );

  it("preserves recorded amounts for a legacy rounded quantity during withholding edits", async () => {
    const t = await registeredTenant();
    const b = await bill(t, { line_items: [domestic, { ...reverseCharge, unit_price: 4 }] });
    // Emulate an older bill entered at 0.004 × AED 1,000 before storage rounded quantity.
    await h.sql(
      "UPDATE bill_line_items SET quantity = 0, unit_price = 1000 WHERE bill_id = $1 AND vat_supply_type = 'reverse_charge'",
      [b.id]
    );
    const savedLines = () =>
      h.sql("SELECT * FROM bill_line_items WHERE bill_id = $1 ORDER BY id", [b.id]);
    const originalLines = await savedLines();
    const edited = await t.as.patch(`/api/bills/${b.id}`, { withholding_amount: 10 });
    expect(edited.status, edited.text).toBe(200);
    expect(edited.body).toMatchObject({
      subtotal: "1004.00",
      vat_amount: "50.20",
      total_amount: "1044.00",
    });
    expect(edited.body.line_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          quantity: "0.00",
          unit_price: "1000.00",
          amount: "4.00",
          vat_amount: "0.20",
        }),
      ])
    );
    const { vat } = await boxes(t, b.id);
    expect(vat).toMatchObject({
      box3ReverseChargeVat: 0.2,
      box9ExpensesVat: 50,
      box10ReverseChargeVat: 0.2,
    });
    const revision = await t.as.post(`/api/bills/${b.id}/revise`, {
      reason: "Correct withholding",
      withholding_amount: 11,
    });
    expect(revision.status, revision.text).toBe(200);
    expect(revision.body).toMatchObject({
      subtotal: "1004.00",
      vat_amount: "50.20",
      total_amount: "1043.00",
    });
    expect(await savedLines()).toEqual(originalLines);
    expect(await vatBoxes(t)).toEqual(vat);
  });

  it.each([false, true])(
    "applies header-off identically to PATCH and editor payloads (legacy inherited: %s)",
    async (legacy) => {
      const t = await registeredTenant();
      const cases = [];
      for (const full of [false, true]) {
        const date = full ? "2026-01-17" : "2026-01-16";
        const draft = await bill(t, {
          bill_date: date,
          reverse_charge: true,
          line_items: [domestic, reverseCharge],
        });
        if (legacy) {
          await h.sql(
            `UPDATE bill_line_items SET vat_supply_type = 'reverse_charge', reverse_charge = true
              WHERE bill_id = $1 AND description = $2`,
            [draft.id, domestic.description]
          );
        }
        const url = `/api/bills/${draft.id}`;
        const saved = await t.as.get(url);
        const line_items = saved.body.line_items.map(editorLine);
        const off = await t.as.patch(url, {
          reverse_charge: false,
          ...(full && { line_items }),
        });
        expect(off.status, off.text).toBe(200);
        expect(off.body).toMatchObject({ total_amount: "2050.00", vat_amount: "100.00" });
        const { vat } = await boxes(t, draft.id, date);
        expect(vat).toMatchObject({
          box3ReverseChargeVat: 50,
          box9ExpensesVat: 50,
          box10ReverseChargeVat: 50,
        });
        cases.push(vat);
      }
      expect(cases[0]).toEqual(cases[1]);
    }
  );

  it.each([false, true])(
    "keeps saved lines, totals and VAT boxes on single-field PATCHes (customs: %s)",
    async (isImport) => {
      const t = await registeredTenant();
      const [account] = await h.sql<{ id: string }>(
        "SELECT id FROM accounts WHERE company_id = $1 AND code = '5050'",
        [t.company.id]
      );
      const fields = {
        currency: "USD",
        exchange_rate: "3.675123",
        is_import: isImport,
        customs_declaration_no: isImport ? "DXB-2026-0042" : null,
        import_vat_amount: isImport ? 60 : null,
        withholding_amount: 10,
        line_items: [
          { ...domestic, vat_rate: 0, account_id: account.id },
          { ...reverseCharge, quantity: 1.234, account_id: account.id },
        ],
      };
      const date = (i: number) => `2026-02-${String(i + 1).padStart(2, "0")}`;
      const baseline = await bill(t, { ...fields, bill_date: date(0) });
      const { vat } = await boxes(t, baseline.id, date(0));
      const patches = [
        { notes: "Updated metadata" },
        { due_date: "2026-03-20" },
        { category: "supplies" },
        { bill_number: "Renumbered" },
        { currency: "USD" },
        { withholding_amount: 10 },
        { is_import: isImport },
        { reverse_charge: isImport },
      ];
      for (const [i, patch] of patches.entries()) {
        const billDate = date(i + 1);
        const draft = await bill(t, { ...fields, bill_number: `SWEEP-${i}`, bill_date: billDate });
        const updated = await t.as.patch(`/api/bills/${draft.id}`, patch);
        expect(updated.status, updated.text).toBe(200);
        expect(updated.body.line_items, JSON.stringify(patch)).toEqual(draft.line_items);
        expect(updated.body).toMatchObject({
          subtotal: draft.subtotal,
          vat_amount: draft.vat_amount,
          total_amount: draft.total_amount,
          exchange_rate: draft.exchange_rate,
          import_vat_amount: draft.import_vat_amount,
        });
        expect((await boxes(t, draft.id, billDate)).vat, JSON.stringify(patch)).toEqual(vat);
      }
    }
  );

  it("uses the customs declaration after successive edits that omit import VAT", async () => {
    const t = await registeredTenant();
    const b = await bill(t, {
      is_import: true,
      customs_declaration_no: "DXB-2026-0042",
      import_vat_amount: 60,
    });
    expect(b.vat_amount).toBe("60.00");
    const first = await t.as.patch(`/api/bills/${b.id}`, { withholding_amount: 10 });
    expect(first.status, first.text).toBe(200);
    expect(first.body.import_vat_amount).toBe("60.00");
    const second = await t.as.patch(`/api/bills/${b.id}`, { withholding_amount: 20 });
    expect(second.status, second.text).toBe(200);
    expect(second.body).toMatchObject({ import_vat_amount: "60.00", vat_amount: "60.00" });
    const { vat } = await boxes(t, b.id);
    expect(vat).toMatchObject({ box6ImportsVat: 60, box10ReverseChargeVat: 60 });
  });
});

describe("PR 184 bill valuation matrix", () => {
  const encodings = [
    { name: "legacy flag", lines: [reverseCharge] },
    { name: "enum", lines: [reverseCharge] },
    { name: "bill-wide", lines: [domestic], header: true },
    {
      name: "mixed",
      lines: [
        domestic,
        reverseCharge,
        { ...domestic, description: "Zero", vat_rate: 0, vat_supply_type: "zero_rated" },
        { ...domestic, description: "Exempt", vat_rate: 0, vat_supply_type: "exempt" },
      ],
    },
  ];
  const cases = encodings.flatMap((encoding) =>
    [1, 1.23, 1.234, 0.004].flatMap((quantity) =>
      ["AED", "USD"].map((currency) => ({ ...encoding, quantity, currency }))
    )
  );
  let tenant: Promise<Tenant> | undefined;
  const totals = (b: {
    subtotal: string;
    total_amount: string;
    vat_amount: string;
    exchange_rate: string;
  }) => ({
    subtotal: b.subtotal,
    total_amount: b.total_amount,
    vat_amount: b.vat_amount,
    exchange_rate: b.exchange_rate,
  });

  it.each(cases.map((fixture, index) => ({ ...fixture, index })))(
    "$name / $quantity / $currency",
    async ({ name, lines, header, quantity, currency, index }) => {
      const t = await (tenant ??= registeredTenant());
      const date = (step: number) =>
        new Date(Date.UTC(2026, 0, 1 + index * 6 + step)).toISOString().slice(0, 10);
      const lineItems = lines.map((line) => ({ ...line, quantity }));
      const fields = {
        currency,
        exchange_rate: currency === "USD" ? "3.675123" : "1",
        reverse_charge: header ?? false,
        line_items: lineItems,
      };
      const recurringUrl = `/api/companies/${t.company.id}/recurring-bills`;
      // Stored templates carry inputs, so even the legacy-flag case uses the equivalent enum
      // here. The draft fixtures below exercise the legacy flag on persisted bill lines.
      const recurring = await t.as.post(recurringUrl, {
        name: `Matrix ${index}`,
        frequency: "yearly",
        next_run_on: date(0),
        template: {
          ...fields,
          vendor_name: "Audit supplier",
          vendor_trn: "100000000000003",
          bill_number: `MATRIX-${index}-0`,
        },
      });
      expect(recurring.status, recurring.text).toBe(201);
      const run = await t.as.post(`${recurringUrl}/${recurring.body.id}/run`, {});
      expect(run.status, run.text).toBe(200);
      expect(run.body.created).toBe(true);
      expect(
        await h.sql("SELECT next_run_on::text, last_bill_id FROM recurring_bills WHERE id = $1", [
          recurring.body.id,
        ])
      ).toEqual([{ next_run_on: date(0).replace("2026", "2027"), last_bill_id: run.body.bill.id }]);
      const approvedRun = await t.as.post(`/api/bills/${run.body.bill.id}/approve`, {});
      expect(approvedRun.status, approvedRun.text).toBe(200);
      const baselineTotals = totals(approvedRun.body);
      const baselineVat = await vatBoxes(t, date(0));
      const net = Math.round(quantity * 1000 * 100) / 100;
      const lineVat = Math.round(net * 5) / 100;
      expect(baselineTotals).toMatchObject({
        subtotal: (net * lines.length).toFixed(2),
        vat_amount: (lineVat * (name === "mixed" ? 2 : 1)).toFixed(2),
        total_amount: (net * lines.length + (name === "mixed" ? lineVat : 0)).toFixed(2),
      });

      let changed: { billTotals: ReturnType<typeof totals>; vat: unknown } | undefined;
      for (const [step, path] of [
        [1, "header"],
        [2, "line"],
        [3, "full"],
        [4, "line-price"],
        [5, "full-price"],
      ] as const) {
        const draft = await bill(t, {
          ...fields,
          bill_date: date(step),
          bill_number: `MATRIX-${index}-${step}`,
        });
        expect(totals(draft)).toEqual(baselineTotals);
        if (name === "legacy flag" || name === "bill-wide") {
          await h.sql(
            `UPDATE bill_line_items SET vat_supply_type = $2, reverse_charge = true WHERE bill_id = $1`,
            [draft.id, name === "legacy flag" ? "standard_rated" : "reverse_charge"]
          );
        }
        const url = `/api/bills/${draft.id}`;
        const before = await t.as.get(url);
        expect(before.status, before.text).toBe(200);
        const changePrice = path.endsWith("-price");
        const editorLines = (saved: SavedLine[], updatePrice = false) =>
          saved.map((line) => ({
            ...editorLine(line),
            ...(updatePrice && line.description === lines[0].description && { unit_price: 1100 }),
          }));
        const editorHeader = {
          currency,
          exchange_rate: currency === "USD" ? "3.675123" : null,
          reverse_charge: header ?? false,
          is_import: false,
          import_vat_amount: null,
          notes: "Editor save",
        };
        const patch =
          path === "header"
            ? { withholding_amount: 0 }
            : {
                ...(path.startsWith("full") && editorHeader),
                line_items: editorLines(before.body.line_items, changePrice),
              };
        const edited = await t.as.patch(url, patch);
        expect(edited.status, edited.text).toBe(200);
        const result = await boxes(t, draft.id, date(step));
        if (changePrice) {
          const expectedDelta = Math.round(quantity * 100 * 100) / 100;
          expect(Number(edited.body.subtotal)).toBeCloseTo(
            Number(draft.subtotal) + expectedDelta,
            8
          );
          const actual = { billTotals: totals(result.approved), vat: result.vat };
          if (changed) expect(actual).toEqual(changed);
          changed = actual;
        } else {
          expect(totals(edited.body)).toEqual(baselineTotals);
          expect(result.vat).toEqual(baselineVat);
        }
        if (path === "full") {
          const revision = await t.as.post(`${url}/revise`, {
            ...editorHeader,
            line_items: editorLines(edited.body.line_items),
            reason: "Update notes",
          });
          expect(revision.status, revision.text).toBe(200);
          expect(totals(revision.body)).toEqual(baselineTotals);
          expect(await vatBoxes(t, date(step))).toEqual(baselineVat);
        }
      }
    }
  );
});
