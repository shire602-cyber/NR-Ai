import { describe, expect, it } from "vitest";
import { VAT201_BOX_KEYS } from "../../server/tax/vat-boxes";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const supplierInvoice =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
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
  it("keeps a current-format mixed bill at AED 2,040 after a withholding edit", async () => {
    const t = await registeredTenant();
    const b = await bill(t, { line_items: [domestic, reverseCharge] });
    expect(b.total_amount).toBe("2050.00");
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
    const replaced = await t.as.patch(`/api/bills/${full.id}`, {
      line_items: [domestic, reverseCharge],
      notes: "Full edit",
    });
    expect(replaced.status, replaced.text).toBe(200);
    expect(replaced.body.total_amount).toBe(edited.body.total_amount);
    expect(replaced.body.vat_amount).toBe(edited.body.vat_amount);
    expect((await boxes(t, full.id, fullDate)).vat).toEqual(vat);
  });

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
          { ...reverseCharge, quantity: 1.23, account_id: account.id },
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

describe("PR 184 current-format imports", () => {
  it.each([
    {
      name: "exempt supplier line with customs VAT",
      line: { ...domestic, vat_supply_type: "exempt", vat_rate: 0 },
      declaredVat: 60,
      lineVat: "0.00",
    },
    {
      name: "standard supplier line with customs VAT",
      line: domestic,
      declaredVat: 60,
      lineVat: "50.00",
    },
    {
      name: "import valued from line VAT",
      line: { ...domestic, unit_price: 1200 },
      declaredVat: undefined,
      lineVat: "60.00",
    },
  ])("keeps $name editable and preserves VAT 201", async ({ line, declaredVat, lineVat }) => {
    const t = await registeredTenant();
    const draft = await bill(t, {
      is_import: true,
      import_vat_amount: declaredVat,
      line_items: [line],
    });
    const url = `/api/bills/${draft.id}`;
    const editorPayload = {
      reverse_charge: false,
      is_import: true,
      import_vat_amount: declaredVat === undefined ? null : String(declaredVat),
      line_items: draft.line_items.map(editorLine),
    };
    for (const patch of [
      { notes: "Header PATCH" },
      { withholding_amount: 10 },
      { ...editorPayload, notes: "Editor save" },
    ]) {
      const edited = await t.as.patch(url, patch);
      expect(edited.status, edited.text).toBe(200);
      expect(edited.body.vat_amount).toBe("60.00");
      expect(edited.body.line_items[0].vat_amount).toBe(lineVat);
    }

    const { vat } = await boxes(t, draft.id);
    expect(vat).toMatchObject({ box6ImportsVat: 60, box10ReverseChargeVat: 60 });
    const posted = await t.as.get(url);
    expect(posted.status, posted.text).toBe(200);
    const revised = await t.as.post(`${url}/revise`, {
      ...editorPayload,
      line_items: posted.body.line_items.map(editorLine),
      notes: "Revised notes",
      reason: "Correct notes",
    });
    expect(revised.status, revised.text).toBe(200);
    expect(revised.body.vat_amount).toBe("60.00");
    expect(await vatBoxes(t)).toEqual(vat);
  });

  it("clears customs VAT when import treatment is removed and requires a new amount to restore it", async () => {
    const t = await registeredTenant();
    const draft = await bill(t, { is_import: true, import_vat_amount: 60 });
    const url = `/api/bills/${draft.id}`;
    const domesticEdit = await t.as.patch(url, { is_import: false, reverse_charge: false });
    expect(domesticEdit.status, domesticEdit.text).toBe(200);
    expect(domesticEdit.body).toMatchObject({
      is_import: false,
      import_vat_amount: "0.00",
      vat_amount: "50.00",
      total_amount: "1050.00",
    });
    for (const patch of [{ is_import: true }, { is_import: true, import_vat_amount: null }]) {
      const missing = await t.as.patch(url, patch);
      expect(missing.status, missing.text).toBe(400);
      expect(missing.body.code).toBe("IMPORT_VAT_AMOUNT_REQUIRED");
    }
    const unchanged = await t.as.get(url);
    expect(unchanged.body).toMatchObject({ is_import: false, import_vat_amount: "0.00" });
    const restored = await t.as.patch(url, { is_import: true, import_vat_amount: 65 });
    expect(restored.status, restored.text).toBe(200);
    expect(restored.body).toMatchObject({
      is_import: true,
      import_vat_amount: "65.00",
      vat_amount: "65.00",
      total_amount: "1000.00",
    });
    const { vat } = await boxes(t, draft.id);
    expect(vat).toMatchObject({ box6ImportsVat: 65, box10ReverseChargeVat: 65 });
  });
});

describe("PR 184 reverse-charge edit matrix", () => {
  const headerStates = [true, false];
  const fixtures = ["reverse_charge", "standard_rated"].flatMap((supply) =>
    headerStates.flatMap((before) =>
      headerStates.map((after) => ({
        label: supply + " / " + before + " → " + after,
        supply,
        before,
        after,
      }))
    )
  );
  let tenant: Promise<Tenant> | undefined;

  function expected(reverseCharge: boolean) {
    return {
      payable: reverseCharge ? "1000.00" : "1050.00",
      journal: {
        "1050": "50.00",
        "2010": reverseCharge ? "-1000.00" : "-1050.00",
        ...(reverseCharge && { "2020": "-50.00" }),
        "5000": "1000.00",
      },
      vat: {
        ...Object.fromEntries(VAT201_BOX_KEYS.map((key) => [key, 0])),
        ...(reverseCharge
          ? {
              box3ReverseChargeAmount: 1000,
              box3ReverseChargeVat: 50,
              box8TotalAmount: 1000,
              box8TotalVat: 50,
              box10ReverseChargeAmount: 1000,
              box10ReverseChargeVat: 50,
              box12TotalDueTax: 50,
            }
          : { box9ExpensesAmount: 1000, box9ExpensesVat: 50, box14PayableTax: -50 }),
        box11TotalAmount: 1000,
        box11TotalVat: 50,
        box13RecoverableTax: 50,
      },
    };
  }

  async function postedState(t: Tenant, id: string, date: string) {
    const result = await t.as.get(`/api/bills/${id}`);
    expect(result.status, result.text).toBe(200);
    const journal = await h.sql<{ code: string; balance: string }>(
      `SELECT a.code, SUM(jl.debit - jl.credit)::text AS balance
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.source_id = $2 AND je.status = 'posted'
          AND je.source IN ('bill', 'bill_reversal')
        GROUP BY a.code HAVING SUM(jl.debit - jl.credit) <> 0`,
      [t.company.id, id]
    );
    return {
      payable: result.body.total_amount,
      journal: Object.fromEntries(journal.map(({ code, balance }) => [code, balance])),
      vat: await vatBoxes(t, date),
    };
  }

  it.each(fixtures.map((fixture, index) => ({ ...fixture, index })))(
    "$label",
    async ({ supply, before, after, index }) => {
      const t = await (tenant ??= registeredTenant());
      const date = (step: number) =>
        new Date(Date.UTC(2027, 0, 1 + index * 7 + step)).toISOString().slice(0, 10);
      const marked = supply === "reverse_charge";
      const template = {
        vendor_name: "Audit supplier",
        vendor_trn: "100000000000003",
        line_items: [
          { ...domestic, vat_supply_type: marked ? "reverse_charge" : "standard_rated" },
        ],
      };
      const newDraft = async (step: number) => {
        const draft = await bill(t, {
          ...template,
          bill_date: date(step),
          bill_number: `RC-EDIT-${index}-${step}`,
          reverse_charge: before,
        });
        return draft;
      };
      const approve = async (id: string, submit = true) => {
        if (submit) {
          const submitted = await t.as.post(`/api/bills/${id}/submit`, {});
          expect(submitted.status, submitted.text).toBe(200);
        }
        const approved = await t.as.post(`/api/bills/${id}/approve`, {});
        expect(approved.status, approved.text).toBe(200);
      };
      const editorHeader = {
        vendor_name: template.vendor_name,
        vendor_trn: template.vendor_trn,
        currency: "AED",
        reverse_charge: after,
        is_import: false,
        import_vat_amount: null,
      };
      const taxChange = before === after ? {} : { reverse_charge: after };
      const original = await newDraft(0);
      await approve(original.id);
      const baseline = await postedState(t, original.id, date(0));
      expect(baseline).toEqual(expected(before || marked));
      const target = before === after ? baseline : expected(after || marked);

      const revised = await t.as.post(`/api/bills/${original.id}/revise`, {
        ...editorHeader,
        line_items: [editorLine(original.line_items[0])],
        notes: "Revision",
        reason: "Review reverse charge",
      });
      expect(revised.status, revised.text).toBe(200);
      expect(await postedState(t, original.id, date(0)), "revision").toEqual(target);

      const paths = [
        "header PATCH",
        "withholding-only PATCH",
        "line PATCH",
        "notes-only editor save",
        "one-field editor save",
      ] as const;
      for (const [index, path] of paths.entries()) {
        const step = index + 1;
        const draft = await newDraft(step);
        const url = `/api/bills/${draft.id}`;
        if (before !== after && (path === "withholding-only PATCH" || path === "line PATCH")) {
          // Keep the withholding and line requests isolated after a separate header toggle.
          const toggled = await t.as.patch(url, taxChange);
          expect(toggled.status, toggled.text).toBe(200);
          expect(toggled.body.total_amount).toBe(target.payable);
        }
        const line = editorLine(draft.line_items[0]);
        const changedLine = { ...line, description: "Updated supplies" };
        const payloads = {
          "header PATCH": { notes: "Updated", ...taxChange },
          "withholding-only PATCH": { withholding_amount: 0 },
          "line PATCH": { line_items: [changedLine] },
          "notes-only editor save": { ...editorHeader, line_items: [line], notes: "Updated" },
          "one-field editor save": { ...editorHeader, line_items: [changedLine] },
        };
        const edited = await t.as.patch(url, payloads[path]);
        expect(edited.status, edited.text).toBe(200);
        expect(edited.body).toMatchObject({ total_amount: target.payable, vat_amount: "50.00" });
        await approve(draft.id);
        expect(await postedState(t, draft.id, date(step)), path).toEqual(target);
      }

      // A template stores create inputs, so serialize the equivalent current treatment.
      const recurringUrl = `/api/companies/${t.company.id}/recurring-bills`;
      const recurring = await t.as.post(recurringUrl, {
        name: `RC edit ${index}`,
        frequency: "yearly",
        next_run_on: date(6),
        template: { ...template, bill_number: `RC-EDIT-${index}-RUN`, reverse_charge: after },
      });
      expect(recurring.status, recurring.text).toBe(201);
      const run = await t.as.post(`${recurringUrl}/${recurring.body.id}/run`, {});
      expect(run.status, run.text).toBe(200);
      expect(run.body.created).toBe(true);
      await approve(run.body.bill.id, false);
      expect(await postedState(t, run.body.bill.id, date(6)), "recurring run").toEqual(target);
    }
  );
});

describe("PR 184 bill valuation matrix", () => {
  const mixed = [
    domestic,
    reverseCharge,
    { ...domestic, description: "Zero", vat_rate: 0, vat_supply_type: "zero_rated" },
    { ...domestic, description: "Exempt", vat_rate: 0, vat_supply_type: "exempt" },
  ];
  const encodings = [
    { name: "enum", lines: [reverseCharge] },
    { name: "bill-wide", lines: [domestic], header: true },
    { name: "mixed", lines: mixed },
    { name: "domestic", lines: [domestic] },
  ];
  const cases = encodings.flatMap((encoding) =>
    [1, 1.23].flatMap((quantity) =>
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
        new Date(Date.UTC(2026, 0, 1 + index * 7 + step)).toISOString().slice(0, 10);
      const lineItems = lines.map((line) => ({ ...line, quantity }));
      const fields = {
        currency,
        exchange_rate: currency === "USD" ? "3.675123" : "1",
        reverse_charge: header ?? false,
        line_items: lineItems,
      };
      const recurringUrl = `/api/companies/${t.company.id}/recurring-bills`;
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
      expect(
        (await t.as.get(`/api/bills/${run.body.bill.id}`)).body.line_items.map((line: SavedLine) =>
          Number(line.quantity)
        )
      ).toEqual(lines.map(() => quantity));
      const net = Math.round(quantity * 1000 * 100) / 100;
      const lineVat = Math.round(net * 5) / 100;
      const mixedBill = lines.length > 1;
      expect(baselineTotals).toMatchObject({
        subtotal: (net * lines.length).toFixed(2),
        vat_amount: (lineVat * (mixedBill ? 2 : 1)).toFixed(2),
        total_amount: (
          net * lines.length +
          (mixedBill || name === "domestic" ? lineVat : 0)
        ).toFixed(2),
      });

      let changed: { billTotals: ReturnType<typeof totals>; vat: unknown } | undefined;
      for (const [step, path] of [
        [1, "header"],
        [2, "withholding"],
        [3, "line"],
        [4, "full"],
        [5, "line-price"],
        [6, "full-price"],
      ] as const) {
        const draft = await bill(t, {
          ...fields,
          bill_date: date(step),
          bill_number: `MATRIX-${index}-${step}`,
        });
        expect(totals(draft)).toEqual(baselineTotals);
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
            ? { notes: "Header PATCH" }
            : path === "withholding"
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

describe("PR 184 production bill encodings", () => {
  it("returns BILL_LOCKED for a posted legacy bill and accepts its supplier invoice", async () => {
    const t = await h.createTenant({ planId: "professional" });
    const draft = await bill(t, {});
    const url = `/api/bills/${draft.id}`;
    await h.sql("UPDATE bill_line_items SET vat_amount = 0 WHERE bill_id = $1", [draft.id]);
    await h.sql("UPDATE vendor_bills SET status = 'approved' WHERE id = $1", [draft.id]);

    const edit = await t.as.patch(url, { notes: "Update a posted bill" });
    expect(edit.status, edit.text).toBe(409);
    expect(edit.body.code).toBe("BILL_LOCKED");
    const tag = await t.as.post(`/api/companies/${t.company.id}/cost-centers/tag-lines`, {
      documentType: "bill",
      documentId: draft.id,
      lineIds: [draft.line_items[0].id],
      costCenterId: null,
    });
    expect(tag.status, tag.text).toBe(409);
    expect(tag.body.code).toBe("BILL_LOCKED");
    const attachment = await t.as.post(`${url}/attachment`, {
      file: supplierInvoice,
      filename: "supplier-invoice.png",
    });
    expect(attachment.status, attachment.text).toBe(200);
    expect((await t.as.get(`${url}/attachment`)).status).toBe(200);
  });

  it("uses line-level reverse charge for a debit note and refuses ambiguous mixed VAT", async () => {
    const t = await registeredTenant();
    const reverseChargeBill = await bill(t, { line_items: [reverseCharge] });
    const mixedBill = await bill(t, {
      bill_number: "VAT-MIXED",
      line_items: [domestic, reverseCharge],
    });
    const expense = await accountByCode(t, "5000");
    const note = (billId: string) =>
      t.as.post(`/api/companies/${t.company.id}/debit-notes`, {
        bill_id: billId,
        note_date: "2026-01-16",
        reason: "Supplier credit",
        lines: [
          { description: "Supplier credit", amount: 100, vat_rate: 5, account_id: expense.id },
        ],
      });
    const credited = await note(reverseChargeBill.id);
    expect(credited.status, credited.text).toBe(201);
    expect(credited.body.vat_treatment).toBe("reverse_charge");
    expect(Number(credited.body.total_amount)).toBe(100);
    const refused = await note(mixedBill.id);
    expect(refused.status, refused.text).toBe(422);
    expect(refused.body.code).toBe("DEBIT_NOTE_MIXED_BILL_VAT");
  });

  it.each([
    { name: "reverse charge", header: { reverse_charge: true }, line: domestic },
    { name: "line reverse charge", header: {}, line: reverseCharge },
    { name: "import", header: { is_import: true, import_vat_amount: 50 }, line: domestic },
  ])(
    "allows editing, attachments and cost-centre tags on a $name bill",
    async ({ header, line }) => {
      const t = await h.createTenant({ planId: "professional" });
      const draft = await bill(t, { ...header, line_items: [line] });
      const url = `/api/bills/${draft.id}`;
      // Before #184 the writer persisted the effective reverse-charge flag on each line.
      await h.sql("UPDATE bill_line_items SET reverse_charge = true WHERE bill_id = $1", [
        draft.id,
      ]);
      const attachment = await t.as.post(`${url}/attachment`, {
        file: supplierInvoice,
        filename: "supplier-invoice.png",
      });
      expect(attachment.status, attachment.text).toBe(200);
      const centre = await t.as.post(`/api/companies/${t.company.id}/cost-centers`, {
        code: "PUR",
        name: "Purchasing",
        type: "cost_centre",
      });
      expect(centre.status, centre.text).toBe(201);
      const tag = await t.as.post(`/api/companies/${t.company.id}/cost-centers/tag-lines`, {
        documentType: "bill",
        documentId: draft.id,
        lineIds: [draft.line_items[0].id],
        costCenterId: centre.body.id,
      });
      expect(tag.status, tag.text).toBe(200);
      const edited = await t.as.patch(url, { withholding_amount: 10 });
      expect(edited.status, edited.text).toBe(200);
      expect(edited.body.vat_amount).toBe(draft.vat_amount);
    }
  );
});

describe("PR 184 legacy bills match the test branch and reject edits", () => {
  const fixtures = [
    { name: "header VAT domestic", lines: [domestic], headerVat: true, billWide: false },
    {
      name: "header VAT mixed",
      lines: [domestic, reverseCharge],
      headerVat: true,
      billWide: false,
    },
    {
      name: "header VAT exempt",
      lines: [{ ...domestic, vat_supply_type: "exempt", vat_rate: 0 }],
      headerVat: true,
      billWide: true,
    },
  ];

  async function persisted(id: string) {
    return {
      bill: await h.sql("SELECT row_to_json(b)::text FROM vendor_bills b WHERE id = $1", [id]),
      lines: await h.sql(
        "SELECT row_to_json(l)::text FROM bill_line_items l WHERE bill_id = $1 ORDER BY id",
        [id]
      ),
      entries: await h.sql(
        "SELECT row_to_json(e)::text FROM journal_entries e WHERE source_id = $1 ORDER BY id",
        [id]
      ),
      journalLines: await h.sql(
        `SELECT row_to_json(l)::text FROM journal_lines l
          JOIN journal_entries e ON e.id = l.entry_id WHERE e.source_id = $1 ORDER BY l.id`,
        [id]
      ),
    };
  }

  it.each(fixtures)("$name", async ({ lines, headerVat, billWide }) => {
    const t = await h.createTenant({
      planId: "professional",
      companyColumns: { emirate: "dubai" },
    });
    const draft = await bill(t, { reverse_charge: billWide, line_items: lines });
    const id = draft.id;
    for (const line of lines) {
      const supply = "vat_supply_type" in line ? line.vat_supply_type : "standard_rated";
      await h.sql(
        `UPDATE bill_line_items SET vat_supply_type = $2, reverse_charge = $3, vat_amount = $4
          WHERE bill_id = $1 AND description = $5`,
        [id, supply, supply === "reverse_charge" || billWide, headerVat ? 0 : 50, line.description]
      );
    }
    const net = lines.length * 1000;
    const vat = headerVat ? 50 : 100;
    const payable = net + (billWide ? 0 : vat);
    if (headerVat) {
      await h.sql(
        `UPDATE vendor_bills SET vat_amount = 50, total_amount = $2,
            import_vat_amount = CASE WHEN $3 THEN 50 ELSE import_vat_amount END WHERE id = $1`,
        [id, payable, billWide]
      );
    }
    const url = `/api/bills/${id}`;
    const original = await persisted(id);
    const editorLines = draft.line_items.map(editorLine);
    for (const payload of [
      { notes: "Notes only" },
      { withholding_amount: 10 },
      { line_items: editorLines },
      {
        vendor_name: "Editor save",
        currency: "AED",
        reverse_charge: false,
        line_items: editorLines,
      },
    ]) {
      const edited = await t.as.patch(url, payload);
      expect(edited.status, edited.text).toBe(409);
      expect(edited.body.code).toBe("LEGACY_BILL_RECLASSIFY_REQUIRED");
      expect(await persisted(id)).toEqual(original);
    }
    const tag = await t.as.post(`/api/companies/${t.company.id}/cost-centers/tag-lines`, {
      documentType: "bill",
      documentId: id,
      lineIds: [draft.line_items[0].id],
      costCenterId: null,
    });
    expect(tag.status, tag.text).toBe(409);
    expect(tag.body.code).toBe("LEGACY_BILL_RECLASSIFY_REQUIRED");
    expect(await persisted(id)).toEqual(original);

    const { approved, vat: actualVat } = await boxes(t, id);
    // Figures captured on b7273466 using these same persisted encodings.
    expect(approved.total_amount).toBe(payable.toFixed(2));
    const journal = await h.sql<{ code: string; balance: string }>(
      `SELECT a.code, SUM(jl.debit - jl.credit)::text AS balance
        FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        JOIN accounts a ON a.id = jl.account_id WHERE je.source_id = $1
        GROUP BY a.code HAVING SUM(jl.debit - jl.credit) <> 0`,
      [id]
    );
    expect(Object.fromEntries(journal.map((row) => [row.code, row.balance]))).toEqual({
      "1050": vat.toFixed(2),
      "2010": (-payable).toFixed(2),
      "5000": net.toFixed(2),
      ...(billWide && { "2020": (-vat).toFixed(2) }),
    });
    expect(actualVat).toEqual({
      ...Object.fromEntries(VAT201_BOX_KEYS.map((key) => [key, 0])),
      ...(billWide
        ? {
            box3ReverseChargeAmount: net,
            box3ReverseChargeVat: vat,
            box8TotalAmount: net,
            box8TotalVat: vat,
            box10ReverseChargeAmount: net,
            box10ReverseChargeVat: vat,
            box12TotalDueTax: vat,
          }
        : { box9ExpensesAmount: net, box9ExpensesVat: vat, box14PayableTax: -vat }),
      box11TotalAmount: net,
      box11TotalVat: vat,
      box13RecoverableTax: vat,
    });
    const posted = await persisted(id);
    for (const payload of [{ notes: "Revision notes" }, { line_items: editorLines }]) {
      const revised = await t.as.post(`${url}/revise`, { reason: "Correct bill", ...payload });
      expect(revised.status, revised.text).toBe(409);
      expect(revised.body.code).toBe("LEGACY_BILL_RECLASSIFY_REQUIRED");
      expect(await persisted(id)).toEqual(posted);
    }
    expect(await vatBoxes(t)).toEqual(actualVat);
    const reopened = await t.as.get(url);
    expect(reopened.status, reopened.text).toBe(200);
    expect(reopened.body.total_amount).toBe(payable.toFixed(2));
  });
});

describe("PR 184 bill quantity precision", () => {
  it("rejects new excess precision and runs an already-saved fractional template", async () => {
    const t = await registeredTenant();
    const url = `/api/companies/${t.company.id}/bills`;
    const fields = { vendor_name: "Supplier", bill_date: "2026-01-15", line_items: [domestic] };
    const invalid = [{ ...domestic, quantity: 1.234 }];
    expect((await t.as.post(url, { ...fields, line_items: invalid })).status).toBe(400);
    const draft = await bill(t, {});
    const edited = await t.as.patch(`/api/bills/${draft.id}`, {
      line_items: [{ ...invalid[0], id: draft.line_items[0].id }],
    });
    expect(edited.status, edited.text).toBe(400);
    expect(edited.body.code).toBe("INVALID_BILL_QUANTITY");

    const recurringUrl = `/api/companies/${t.company.id}/recurring-bills`;
    const recurring = await t.as.post(recurringUrl, {
      name: "Previous precision",
      frequency: "monthly",
      next_run_on: fields.bill_date,
      template: fields,
    });
    expect(recurring.status, recurring.text).toBe(201);
    await h.sql(
      "UPDATE recurring_bills SET template = jsonb_set(template, '{line_items,0,quantity}', '0.004') WHERE id = $1",
      [recurring.body.id]
    );
    const run = await t.as.post(`${recurringUrl}/${recurring.body.id}/run`, {});
    expect(run.status, run.text).toBe(200);
    expect(run.body.bill).toMatchObject({ subtotal: "4.00", vat_amount: "0.20" });
    const savedUrl = `/api/bills/${run.body.bill.id}`;
    const saved = await t.as.get(savedUrl);
    expect(saved.body.line_items).toMatchObject([{ quantity: "0.00", amount: "4.00" }]);
    const unchanged = await t.as.patch(savedUrl, {
      line_items: saved.body.line_items.map(editorLine),
      notes: "Retain the recorded valuation",
    });
    expect(unchanged.status, unchanged.text).toBe(200);
    expect(unchanged.body).toMatchObject({ subtotal: "4.00", vat_amount: "0.20" });
  });
});
