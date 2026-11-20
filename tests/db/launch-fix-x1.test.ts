/**
 * X1 launch fixes (J2/J3/J4): honest email-delivery messages without a provider, company role in
 * the company list (owner-only onboarding), and the supplier TRN rule for VAT-registered
 * companies issuing tax invoices.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

describe("X1 J2 no email provider: neutral reset/registration messages", () => {
  it("forgot-password never claims a link was sent and answers identically for any address", async () => {
    const t = await h.createTenant({ name: "NoMail" });
    const known = await h.anon.post("/api/auth/forgot-password", { email: t.email });
    const unknown = await h.anon.post("/api/auth/forgot-password", {
      email: `nobody-${randomBytes(4).toString("hex")}@example.test`,
    });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.emailDelivery).toBe("unavailable");
    expect(known.body.message).toBe(unknown.body.message);
    expect(known.body.message).not.toMatch(/has been sent/i);
    expect(known.body.message).toMatch(/once email delivery is set up/i);
    expect(known.body.message).toContain("support@muhasib.ai");
  });

  it("registration says the account is ready and does not ask to check email", async () => {
    const email = `reg-${randomBytes(4).toString("hex")}@example.test`;
    const first = await h.anon.post("/api/auth/register", {
      name: "Reg User",
      email,
      password: `Reg${randomBytes(4).toString("hex")}A1!x`,
    });
    expect(first.status, first.text).toBe(200);
    expect(first.body.emailDelivery).toBe("unavailable");
    expect(first.body.verificationRequired).toBe(false);
    expect(first.body.message).toMatch(/sign in now/i);
    expect(first.body.message).not.toMatch(/check your email/i);
  });
});

describe("X1 J4 /api/companies exposes the caller's role", () => {
  it("owner sees owner; an invited viewer sees viewer on the owner's company", async () => {
    const owner = await h.createTenant({ name: "RoleOwner" });
    const member = await h.createTenant({ name: "RoleMember" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
      owner.company.id,
      member.user.id,
    ]);
    const mine = await owner.as.get("/api/companies");
    expect(mine.status).toBe(200);
    expect(mine.body.find((c: { id: string }) => c.id === owner.company.id).myRole).toBe("owner");

    const theirs = await member.as.get("/api/companies");
    const shared = theirs.body.find((c: { id: string }) => c.id === owner.company.id);
    expect(shared.myRole).toBe("viewer");
    const own = theirs.body.find((c: { id: string }) => c.id === member.company.id);
    expect(own.myRole).toBe("owner");
  });
});

describe("X1 J2 supplier TRN on tax invoices", () => {
  async function draft(t: Awaited<ReturnType<typeof h.createTenant>>) {
    const co = t.company.id;
    const c = await t.as.post(`/api/companies/${co}/customer-contacts`, {
      name: "TRN Customer",
      email: "ap@trn.example",
    });
    expect(c.status, c.text).toBeLessThan(300);
    const inv = await t.as.post(`/api/companies/${co}/invoices`, {
      contactId: c.body.id,
      date: new Date().toISOString().slice(0, 10),
      lines: [{ description: "Service", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    expect(inv.status, inv.text).toBe(200);
    return inv.body.id as string;
  }

  it("a VAT-registered company without a TRN cannot issue a 5% tax invoice, and can once it has one", async () => {
    const t = await h.createTenant({ name: "TrnRule" });
    await h.sql(
      `UPDATE companies SET vat_filing_frequency = 'Quarterly', trn_vat_number = NULL WHERE id = $1`,
      [t.company.id]
    );
    const id = await draft(t);
    const blocked = await t.as.patch(`/api/invoices/${id}/status`, { status: "sent" });
    expect(blocked.status, blocked.text).toBe(422);
    expect(blocked.body.code).toBe("SUPPLIER_TRN_REQUIRED");
    expect(blocked.body.details?.settingsPath ?? blocked.body.settingsPath).toBe(
      "/company-profile"
    );
    const [still] = await h.sql(`SELECT status FROM invoices WHERE id = $1`, [id]);
    expect(still.status).toBe("draft");

    await h.sql(`UPDATE companies SET trn_vat_number = '100123456700003' WHERE id = $1`, [
      t.company.id,
    ]);
    const ok = await t.as.patch(`/api/invoices/${id}/status`, { status: "sent" });
    expect(ok.status, ok.text).toBe(200);
  });

  // X6a (council REQUIRED 2) replaces the X1 rule "no filing frequency = unaffected": a company
  // without a TRN is not VAT registered and may not charge VAT whatever its filing frequency.
  it("a company without a TRN and no filing frequency cannot charge VAT either", async () => {
    const t = await h.createTenant({ name: "NoVatReg" });
    await h.sql(
      `UPDATE companies SET vat_filing_frequency = NULL, trn_vat_number = NULL WHERE id = $1`,
      [t.company.id]
    );
    const id = await draft(t);
    const blocked = await t.as.patch(`/api/invoices/${id}/status`, { status: "sent" });
    expect(blocked.status, blocked.text).toBe(422);
    expect(blocked.body.code).toBe("SUPPLIER_TRN_REQUIRED");
  });
});
