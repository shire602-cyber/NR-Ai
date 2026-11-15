/**
 * W2-D accounts + companies sweep: R02-05, R02-10, R02-16c, R17-03, R14-07, R14-08, R14-09,
 * R14-13, R14-20, R17-05, R17-09.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, postJournalEntry, useHarness } from "./harness";

const h = useHarness();

describe("W2-D accounts", () => {
  it("[R02-05] account type 'banana' and unknown sub types are rejected", async () => {
    const a = await h.createTenant();
    const url = `/api/companies/${a.company.id}/accounts`;
    const bad = await a.as.post(url, { code: "9901", nameEn: "Bad", type: "banana" });
    expect(bad.status).toBe(400);
    const badSub = await a.as.post(url, {
      code: "9902",
      nameEn: "Bad sub",
      type: "asset",
      subType: "operating_expense",
    });
    expect(badSub.status).toBe(400);
    const ok = await a.as.post(url, {
      code: "9903",
      nameEn: "Petty",
      type: "asset",
      subType: "cash",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.isSystemAccount).toBe(false);
    const rows = await h.sql(
      "SELECT 1 FROM accounts WHERE company_id = $1 AND code IN ('9901','9902')",
      [a.company.id]
    );
    expect(rows).toHaveLength(0);
  });

  it("[R17-03] PUT with another companyId / isSystemAccount flip is rejected and the account stays", async () => {
    const a = await h.createTenant();
    const b = await h.createSecondTenant();
    const created = await a.as.post(`/api/companies/${a.company.id}/accounts`, {
      code: "9910",
      nameEn: "Mine",
      type: "expense",
    });
    const id = created.body.id as string;
    const move = await a.as.put(`/api/accounts/${id}`, { companyId: b.company.id });
    expect(move.status).toBe(400);
    const flip = await a.as.put(`/api/accounts/${id}`, { isSystemAccount: true });
    expect(flip.status).toBe(400);
    const unknown = await a.as.put(`/api/accounts/${id}`, { bogus: 1 });
    expect(unknown.status).toBe(400);
    const row = await h.sql("SELECT company_id, is_system_account FROM accounts WHERE id = $1", [
      id,
    ]);
    expect(row[0].company_id).toBe(a.company.id);
    expect(row[0].is_system_account).toBe(false);
    const rename = await a.as.put(`/api/accounts/${id}`, { nameEn: "Renamed" });
    expect(rename.status).toBe(200);
    expect(rename.body.nameEn).toBe("Renamed");
  });

  it("[R02-10] archive, unarchive and delete are audited", async () => {
    const a = await h.createTenant();
    const created = await a.as.post(`/api/companies/${a.company.id}/accounts`, {
      code: "9920",
      nameEn: "Audited",
      type: "expense",
    });
    const id = created.body.id as string;
    expect((await a.as.post(`/api/accounts/${id}/archive`, {})).status).toBe(200);
    expect((await a.as.post(`/api/accounts/${id}/unarchive`, {})).status).toBe(200);
    expect((await a.as.delete(`/api/accounts/${id}`)).status).toBe(200);
    const actions = await h.sql<{ action: string }>(
      `SELECT action FROM audit_logs WHERE resource_id = $1 ORDER BY created_at`,
      [id]
    );
    expect(actions.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        "account.create",
        "account.archive",
        "account.unarchive",
        "account.delete",
      ])
    );
  });

  it("[R02-16c] hierarchy: parent_id with cycle and cross-type checks; seeds carry sub types, COGS and Other Current Assets", async () => {
    const a = await h.createTenant();
    const url = `/api/companies/${a.company.id}/accounts`;
    const parent = await a.as.post(url, { code: "6000", nameEn: "Parent", type: "expense" });
    const child = await a.as.post(url, {
      code: "6001",
      nameEn: "Child",
      type: "expense",
      parentId: parent.body.id,
    });
    expect(child.status).toBe(200);
    expect(child.body.parentId).toBe(parent.body.id);
    // cycle: parent -> child
    const cycle = await a.as.put(`/api/accounts/${parent.body.id}`, { parentId: child.body.id });
    expect(cycle.status).toBe(400);
    expect(cycle.body.code).toBe("ACCOUNT_PARENT_CYCLE");
    const self = await a.as.put(`/api/accounts/${parent.body.id}`, { parentId: parent.body.id });
    expect(self.status).toBe(400);
    // parent of a different type
    const cash = await accountByCode(a, "1010");
    const wrongType = await a.as.post(url, {
      code: "6002",
      nameEn: "Wrong",
      type: "expense",
      parentId: cash.id,
    });
    expect(wrongType.status).toBe(400);
    // parent with children cannot be deleted
    const del = await a.as.delete(`/api/accounts/${parent.body.id}`);
    expect(del.status).toBe(409);

    const seeded = await h.sql<{ code: string; sub_type: string | null }>(
      "SELECT code, sub_type FROM accounts WHERE company_id = $1 AND is_system_account OR company_id = $1",
      [a.company.id]
    );
    const bySub = Object.fromEntries(seeded.map((r) => [r.code, r.sub_type]));
    expect(bySub["5005"]).toBe("cost_of_sales");
    expect(bySub["1080"]).toBe("other_current_asset");
    expect(bySub["5000"]).toBe("operating_expense");
    expect(bySub["1010"]).toBe("cash");
    expect(bySub["1020"]).toBe("bank");
    expect(bySub["1040"]).toBe("receivable");
    expect(bySub["2010"]).toBe("payable");
    const missing = seeded.filter((r) => !r.sub_type && !["6000", "6001"].includes(r.code));
    expect(missing).toEqual([]);
  });
});

describe("W2-D companies", () => {
  const TRN_ERR = 400;

  it("[R14-07][R14-20] TRN must be exactly 15 digits on POST, PUT, PATCH and /preferences", async () => {
    const a = await h.createTenant();
    const id = a.company.id;
    const create = await a.as.post("/api/companies", { name: "Trn Test Co", trnVatNumber: "12" });
    expect(create.status).toBe(TRN_ERR);
    expect((await a.as.put(`/api/companies/${id}`, { trnVatNumber: "12" })).status).toBe(TRN_ERR);
    expect((await a.as.patch(`/api/companies/${id}`, { trnVatNumber: "12" })).status).toBe(TRN_ERR);
    expect(
      (await a.as.patch(`/api/companies/${id}/preferences`, { trnVatNumber: "12" })).status
    ).toBe(TRN_ERR);
    expect(
      (await a.as.patch(`/api/companies/${id}`, { trnVatNumber: "100123456700003" })).status
    ).toBe(200);
    expect((await a.as.patch(`/api/companies/${id}`, { fiscalYearStartMonth: 13 })).status).toBe(
      400
    );
    expect((await a.as.put(`/api/companies/${id}`, { fiscalYearStartMonth: 4 })).status).toBe(200);
    expect((await a.as.patch(`/api/companies/${id}`, { baseCurrency: "XXX" })).status).toBe(400);
    const row = await h.sql(
      "SELECT trn_vat_number, fiscal_year_start_month FROM companies WHERE id = $1",
      [id]
    );
    expect(row[0].trn_vat_number).toBe("100123456700003");
    expect(row[0].fiscal_year_start_month).toBe(4);
  });

  it("[R17-05] PUT/PATCH companyType 'nra' by a customer is 403 and the type is unchanged", async () => {
    const a = await h.createTenant();
    const put = await a.as.put(`/api/companies/${a.company.id}`, { companyType: "nra" });
    expect(put.status).toBe(403);
    const patch = await a.as.patch(`/api/companies/${a.company.id}`, { companyType: "client" });
    expect(patch.status).toBe(403);
    const create = await a.as.post("/api/companies", {
      name: "Escalator Co",
      companyType: "client",
    });
    expect(create.status).toBe(403);
    const row = await h.sql("SELECT company_type FROM companies WHERE id = $1", [a.company.id]);
    expect(row[0].company_type).toBe("customer");
    // re-sending the current value is harmless
    expect(
      (await a.as.put(`/api/companies/${a.company.id}`, { companyType: "customer", locale: "ar" }))
        .status
    ).toBe(200);
  });

  it("[R14-08] base currency cannot change once a posted journal entry exists", async () => {
    const a = await h.createTenant();
    // before any posting a change is allowed
    expect(
      (await a.as.patch(`/api/companies/${a.company.id}`, { baseCurrency: "USD" })).status
    ).toBe(200);
    expect(
      (await a.as.patch(`/api/companies/${a.company.id}`, { baseCurrency: "AED" })).status
    ).toBe(200);
    await postJournalEntry(a, {
      date: "2026-01-15",
      lines: [
        { code: "1020", debit: 10 },
        { code: "3010", credit: 10 },
      ],
    });
    const r = await a.as.patch(`/api/companies/${a.company.id}`, { baseCurrency: "USD" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("BASE_CURRENCY_LOCKED");
    const same = await a.as.patch(`/api/companies/${a.company.id}`, { baseCurrency: "AED" });
    expect(same.status).toBe(200);
  });

  it("[R14-09] two tenants may share a company name; the same owner may not (case-insensitive)", async () => {
    const a = await h.createTenant();
    const b = await h.createSecondTenant();
    const first = await a.as.post("/api/companies", { name: "Shared Name Trading" });
    expect(first.status).toBe(200);
    const other = await b.as.post("/api/companies", { name: "shared name trading" });
    expect(other.status).toBe(200);
    const dup = await a.as.post("/api/companies", { name: "SHARED NAME TRADING" });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("COMPANY_NAME_TAKEN");
  });

  it("[R14-13][R17-09] logoUrl rejects javascript:/http:/svg and oversize data URLs; names are sanitised", async () => {
    const a = await h.createTenant();
    const url = `/api/companies/${a.company.id}`;
    for (const logoUrl of [
      "javascript:alert(1)",
      "http://example.com/x.png",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:text/html;base64,PGgxPg==",
      `data:image/png;base64,${"A".repeat(1_010_000)}`,
    ]) {
      expect((await a.as.patch(url, { logoUrl })).status, logoUrl.slice(0, 30)).toBe(400);
    }
    expect((await a.as.patch(url, { logoUrl: "https://cdn.example.com/logo.png" })).status).toBe(
      200
    );
    const xss = await a.as.patch(url, { name: "<script>alert(1)</script>Acme Trading" });
    expect(xss.status).toBe(200);
    expect(xss.body.name).toBe("alert(1)Acme Trading");
    const preferred = await a.as.post(`/api/companies/${a.company.id}/logo`, {
      imageData: "not-an-image",
    });
    expect([400, 415, 422]).toContain(preferred.status);
  });
});
