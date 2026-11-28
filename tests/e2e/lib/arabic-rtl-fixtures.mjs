import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { apiClient, PASSWORD } from "./sweep-personas.mjs";
import { dubaiIso } from "../../helpers/dates.mjs";

const exec = promisify(execFile);

export async function makeFixtures(base, cache) {
  const api = apiClient(base);
  const checked = async (token, method, route, data) => {
    const { status, body } = await api(token, method, route, data);
    assert.ok(status < 300, `Fixture ${method} ${route.split("?")[0]} returned ${status}`);
    return body;
  };
  const login = (email) => checked("", "POST", "/api/auth/login", { email, password: PASSWORD });
  if (process.env.RTL_REUSE === "true") {
    const saved = JSON.parse(await readFile(cache, "utf8"));
    assert.equal(saved.base, base, "The cached fixture belongs to a different local app");
    await login(saved.owner);
    await login(saved.portal);
    return saved;
  }

  const run = randomUUID().slice(0, 8);
  const owner = `rtl-sme+${run}@example.test`;
  const portal = `rtl-portal+${run}@example.test`;
  const onboarding = `rtl-onboarding+${run}@example.test`;
  // Reuse the API-driven reporting fixture so populated tables and editors are checked too.
  const fixture = fileURLToPath(new URL("../report-audit-fixture.mjs", import.meta.url));
  await exec(process.execPath, [fixture], {
    env: {
      ...process.env,
      BASE_URL: base,
      REPORT_AUDIT_EMAIL: owner,
      REPORT_AUDIT_PASSWORD: PASSWORD,
      REPORT_AUDIT_ARABIC: "true",
      REPORT_AUDIT_REUSE: "false",
    },
    maxBuffer: 4 * 1024 * 1024,
  }).catch((error) => {
    throw new Error(`Arabic report fixture failed:\n${String(error.stderr).slice(-1800)}`);
  });

  const { token } = await login(owner);
  const [company] = await checked(token, "GET", "/api/companies");
  const root = `/api/companies/${company.id}`;
  const queryRows = async (resource) => {
    const reply = await checked(token, "GET", `${root}/${resource}`);
    return Array.isArray(reply) ? reply : (reply.items ?? reply.data ?? []);
  };
  const [accounts, journal, invoices, quotes, orders, bills] = await Promise.all(
    ["accounts", "journal", "invoices", "quotes", "purchase-orders", "bills"].map(queryRows)
  );
  const contactName = "شركة الوردة الصحراوية للتجارة والخدمات الاستشارية ذ.م.م";
  const contact = await checked(token, "POST", `${root}/customer-contacts`, {
    name: contactName,
    email: portal,
    trnNumber: "100123456700003",
  });
  const invoice = await checked(token, "POST", `${root}/invoices`, {
    contactId: contact.id,
    customerName: contactName,
    date: "2026-11-10",
    dueDate: "2026-11-30",
    lines: [{ description: "خدمات استشارية", quantity: 1, unitPrice: 1234.56, vatRate: 5 }],
  });
  await checked(token, "PATCH", `/api/invoices/${invoice.id}/status`, { status: "sent" });
  const share = await checked(token, "POST", `/api/invoices/${invoice.id}/share`, {});
  const publicPortal = await checked(token, "POST", "/api/portal/generate-access", {
    contactId: contact.id,
  });
  const recurring = await checked(token, "POST", `${root}/recurring-invoices`, {
    contactId: contact.id,
    customerName: contactName,
    startDate: dubaiIso(new Date(Date.now() + 90 * 86_400_000)),
    frequency: "monthly",
    lines: [{ description: "خدمات شهرية", quantity: 1, unitPrice: 150, vatRate: 0.05 }],
  });
  const invite = async (email) => {
    const { inviteUrl } = await checked(
      token,
      "POST",
      `${root}/customer-contacts/${contact.id}/portal-invitations`,
      { email, language: "ar" }
    );
    const inviteToken = new URLSearchParams(new URL(inviteUrl).hash.slice(1)).get("t");
    assert.ok(inviteToken, "Missing portal invitation token");
    return inviteToken;
  };
  const inviteToken = await invite(portal);
  const accept = await apiClient(base)(
    "",
    "POST",
    `/api/portal-invitations/${inviteToken}/accept`,
    {
      name: "ليلى أحمد",
      password: PASSWORD,
      acceptTerms: true,
    }
  );
  assert.ok(accept.status < 300, `Portal invitation acceptance returned ${accept.status}`);
  const pendingInvite = await invite(`rtl-pending+${run}@example.test`);
  const partners = await checked(token, "GET", `${root}/einvoicing/partner`);
  await checked(token, "PUT", `${root}/einvoicing/partner`, { partner: partners.partners[0].id });
  const approver = await checked(token, "POST", `${root}/einvoicing/approver-links`, {
    approverName: "مُعتمِد التجربة",
  });
  await checked("", "POST", "/api/auth/register", {
    email: onboarding,
    password: PASSWORD,
    name: "سارة أحمد",
    companyName: "شركة الواحة",
  });
  const fixtureData = {
    base,
    owner,
    portal,
    onboarding,
    accountId: accounts[0]?.id,
    journalId: journal[0]?.id,
    draftInvoiceId: invoices.find(({ status }) => status === "draft")?.id,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    quoteId: (quotes.find(({ status }) => status === "draft") ?? quotes[0])?.id,
    orderId: (orders.find(({ status }) => status === "draft") ?? orders[0])?.id,
    billId: (bills.find(({ status }) => status === "draft") ?? bills[0])?.id,
    recurringId: recurring.id,
    shareToken: share.token,
    publicPortalToken: publicPortal.token ?? publicPortal.url?.split("/portal/")[1],
    pendingInvite,
    approverToken: new URL(approver.url).pathname.split("/").at(-1),
  };
  await writeFile(cache, JSON.stringify(fixtureData, null, 2), { mode: 0o600 });
  return fixtureData;
}
