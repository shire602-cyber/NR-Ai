// @vitest-environment jsdom
/**
 * Firm audit defect 16: a staffer in a client workspace (company role "bookkeeper") does not
 * trigger requests their role cannot make: the dashboard strip skips the payroll-runs list and
 * the e-invoicing partner card skips the approver links (both answer 403 to this role).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_ID,
  apiCalls,
  flush,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale } from "../../client/src/lib/i18n";

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACCESS_PATH = `/api/companies/${COMPANY_ID}/team/me`;
const BOOKKEEPER = {
  role: "bookkeeper",
  permissions: ["reports.read", "documents.write", "ledger.post"],
  grantableRoles: [],
  viaFirmAccess: true,
};
const OWNER = {
  role: "owner",
  permissions: ["reports.read", "payroll.manage", "payroll.approve", "settings.company"],
  grantableRoles: [],
  viaFirmAccess: false,
};

beforeAll(async () => {
  await loadLocale("en");
});
beforeEach(() => {
  resetHarness();
  window.localStorage.clear();
});
afterEach(unmountPage);

const urls = () => apiCalls("GET").map((c) => c.url);

describe("role-gated queries", () => {
  it("the dashboard strip does not request payroll runs for a bookkeeper", async () => {
    setFixtures({ [ACCESS_PATH]: BOOKKEEPER });
    const { NeedsYouStrip } = await import("../../client/src/pages/dashboard/NeedsYouStrip");
    await renderPage(NeedsYouStrip, { companyId: COMPANY_ID, invoices: [], compliance: null });
    await flush(20);
    expect(urls().some((u) => u.includes("/payroll-runs"))).toBe(false);
  });

  it("the dashboard strip still requests payroll runs for an owner", async () => {
    setFixtures({ [ACCESS_PATH]: OWNER });
    const { NeedsYouStrip } = await import("../../client/src/pages/dashboard/NeedsYouStrip");
    await renderPage(NeedsYouStrip, { companyId: COMPANY_ID, invoices: [], compliance: null });
    await flush(20);
    expect(urls().some((u) => u.includes("/payroll-runs"))).toBe(true);
  });

  it("the partner card does not request approver links for a bookkeeper", async () => {
    setFixtures({
      [ACCESS_PATH]: BOOKKEEPER,
      [`/api/companies/${COMPANY_ID}/einvoicing/identity`]: { missing: [] },
      [`/api/companies/${COMPANY_ID}/einvoicing/partner`]: {
        partners: [],
        chosen: null,
        appointment: { state: "not_started" },
      },
    });
    const mod = await import("../../client/src/components/einvoice/EInvoicePartnerCard");
    const Card = Object.values(mod).find((v) => typeof v === "function") as never;
    await renderPage(Card, { companyId: COMPANY_ID });
    await flush(20);
    expect(urls().some((u) => u.includes("/approver-links"))).toBe(false);
  });
});
