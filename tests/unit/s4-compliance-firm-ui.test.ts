// @vitest-environment jsdom
/**
 * S4 (final sweep): CompliancePulse maps on auditReadiness.checks[].key with
 * translated explanations; firm UI access via /api/firms/me keeps NR-only
 * links hidden from other firms; maker-checker side of each VAT workpaper
 * request; compliance refresh observer path table; portal/statement helpers.
 */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FixItRow } from "../../client/src/pages/dashboard/CompliancePulse";
import {
  CHECK_ACTIONS,
  auditCheckExplanation,
  openAuditChecks,
  type AuditReadinessCheck,
} from "../../client/src/pages/dashboard/auditChecks";
import { loadLocale, t as catalogs, useI18n } from "../../client/src/lib/i18n";
import {
  NR_ONLY_FIRM_PATHS,
  firmPathAllowed,
  resolveFirmAccess,
} from "../../client/src/components/FirmRouteAccess";
import { statusSide, workpaperRequestSide } from "../../server/routes/firm-vat-workspace.routes";
import { isObligationInputWrite } from "../../server/routes/compliance-obligation-refresh";
import { statementUrl } from "../../client/src/pages/reports/partyStatementUrl";
import { openRequests } from "../../client/src/pages/portal/firmRelationshipApi";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vatCheck: AuditReadinessCheck = {
  key: "vat_returns",
  label: "VAT returns filed for every due period",
  weight: 25,
  score: 0,
  status: "fail",
  explanation: "0 of 4 VAT returns that were due are filed.",
  explanationKey: "vat_returns.ratio",
  explanationParams: { done: 0, total: 4 },
};

// S5 code-splits the namespace catalogs; load both locales before reading them.
beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

describe("S4 CompliancePulse maps on check keys (W4-A follow-up)", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    act(() => useI18n.getState().setLocale("en"));
  });

  it("[S4-compliance-pulse] every server check key has an action and en/ar explanation templates", () => {
    const keys = [
      "bank_reconciliation",
      "vat_returns",
      "period_locks",
      "unposted_documents",
      "corporate_tax_returns",
    ];
    const variants: Record<string, string[]> = {
      bank_reconciliation: ["none", "ratio"],
      vat_returns: ["none", "ratio"],
      period_locks: ["locked", "open"],
      unposted_documents: ["none", "ratio"],
      corporate_tax_returns: ["none", "ratio"],
    };
    for (const key of keys) {
      const action = CHECK_ACTIONS[key]({ ...vatCheck, key });
      expect(action.href.startsWith("/")).toBe(true);
      for (const loc of ["en", "ar"] as const) {
        const cat = catalogs[loc] as unknown as Record<string, string>;
        expect(cat[action.ctaKey], `${loc} ${action.ctaKey}`).toBeTruthy();
        for (const v of variants[key]) {
          expect(cat[`dashboard.auditCheck.${key}.${v}`], `${loc} ${key}.${v}`).toBeTruthy();
        }
      }
    }
    // Unposted documents routes to the screen that holds most of the backlog.
    expect(
      CHECK_ACTIONS.unposted_documents({
        ...vatCheck,
        key: "unposted_documents",
        explanationParams: { invoices: 0, receipts: 3, journals: 0 },
      }).href
    ).toBe("/receipts");
  });

  it("[S4-compliance-pulse] explanations are translated with params, never matched on English text", () => {
    const ar = catalogs.ar as unknown as Record<string, string>;
    const text = auditCheckExplanation(vatCheck, ar);
    expect(text).toContain("0");
    expect(text).toContain("4");
    expect(text).not.toBe(vatCheck.explanation);
    // Unknown key: fall back to the server's English text.
    expect(auditCheckExplanation({ ...vatCheck, explanationKey: "nope.ratio" }, ar)).toBe(
      vatCheck.explanation
    );
    expect(
      openAuditChecks({
        checks: [vatCheck, { ...vatCheck, key: "period_locks", status: "pass" }],
      }).map((c) => c.key)
    ).toEqual(["vat_returns"]);
  });

  it("[S4-compliance-pulse] FixItRow renders the Arabic explanation and links to VAT filing", () => {
    act(() => useI18n.getState().setLocale("ar"));
    const qc = new QueryClient();
    act(() =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(FixItRow, { check: vatCheck })
        )
      )
    );
    const ar = catalogs.ar as unknown as Record<string, string>;
    expect(container.textContent).toContain(ar["dashboard.actionFileVat"]);
    expect(container.textContent).not.toContain("VAT returns that were due are filed");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/vat-filing");
  });
});

describe("firm UI access is NR-internal", () => {
  it("[CL-B-firm-nr-only] every /firm/* path is NR-only; only NR staff and platform admins get access", () => {
    expect(NR_ONLY_FIRM_PATHS).toEqual(["/firm"]);
    const customer = resolveFirmAccess({ isAdmin: false, firmRole: null });
    expect(customer).toMatchObject({ canAccessFirm: false, isNr: false });
    expect(resolveFirmAccess(null).canAccessFirm).toBe(false);
    const nr = resolveFirmAccess({ firmRole: "reviewer" });
    expect(nr).toMatchObject({ canAccessFirm: true, isNr: true });
    expect(resolveFirmAccess({ isAdmin: true }).isNr).toBe(true);
    for (const p of [
      "/firm",
      "/firm/practice",
      "/firm/clients/abc",
      "/firm/pipeline",
      "/firm/analytics",
      "/firm/bulk",
      "/firm/comms",
      "/firm/document-chasing",
      "/firm/email-intake",
      "/firm/value-ops?x=1",
    ]) {
      expect(firmPathAllowed(customer, p), p).toBe(false);
      expect(firmPathAllowed(nr, p), p).toBe(true);
    }
    // Non-firm paths are never gated by this helper.
    expect(firmPathAllowed(customer, "/firm-relationship")).toBe(true);
    expect(firmPathAllowed(customer, "/dashboard")).toBe(true);
  });
});

describe("S4 VAT workpaper maker-checker sides (W5-D follow-up)", () => {
  it("[S4-vat-maker-checker] building is the maker side, generating/review/file/lock the checker side", () => {
    expect(workpaperRequestSide("GET", "/abc")).toBeNull();
    expect(workpaperRequestSide("POST", "/")).toBe("prepare");
    expect(workpaperRequestSide("POST", "/abc/rows")).toBe("prepare");
    expect(workpaperRequestSide("PATCH", "/abc/rows/r1")).toBe("prepare");
    expect(workpaperRequestSide("POST", "/abc/pull-from-books")).toBe("prepare");
    expect(workpaperRequestSide("POST", "/abc/generate-return")).toBe("review");
    expect(workpaperRequestSide("PATCH", "/abc/status")).toBeNull();
    expect(statusSide("draft", "prepared")).toBe("prepare");
    expect(statusSide("prepared", "draft")).toBe("prepare");
    expect(statusSide("in_review", "draft")).toBe("prepare");
    expect(statusSide("prepared", "reviewed")).toBe("review");
    expect(statusSide("reviewed", "prepared")).toBe("review");
    expect(statusSide("reviewed", "filed")).toBe("review");
    expect(statusSide("filed", "locked")).toBe("review");
  });
});

describe("S4 compliance refresh observer paths", () => {
  it("[S4-compliance-get] only writes that change obligation inputs trigger a refresh", () => {
    const id = "00000000-0000-4000-8000-0000000000aa";
    expect(isObligationInputWrite("POST", "/companies")).toBe(true);
    expect(isObligationInputWrite("PATCH", `/companies/${id}`)).toBe(true);
    expect(isObligationInputWrite("PATCH", `/companies/${id}/preferences`)).toBe(true);
    expect(isObligationInputWrite("PUT", `/companies/${id}/corporate-tax/profile`)).toBe(true);
    expect(isObligationInputWrite("POST", `/corporate-tax/returns/${id}/transition`)).toBe(true);
    expect(isObligationInputWrite("POST", `/vat-returns/${id}/submit`)).toBe(true);
    expect(isObligationInputWrite("POST", `/payroll-runs/${id}/pay`)).toBe(true);
    expect(isObligationInputWrite("POST", `/companies/${id}/employees`)).toBe(true);
    expect(isObligationInputWrite("GET", `/companies/${id}`)).toBe(false);
    expect(isObligationInputWrite("GET", `/companies/${id}/compliance-calendar`)).toBe(false);
    expect(isObligationInputWrite("POST", `/companies/${id}/invoices`)).toBe(false);
  });
});

describe("S4 portal and statement helpers", () => {
  it("[S4-portal] only requested or sent-back items can be uploaded", () => {
    const base = {
      firmName: "F",
      listName: "General",
      title: "Bank statement",
      description: null,
      dueDate: null,
      reviewNote: null,
    };
    const rows = (["requested", "uploaded", "accepted", "rejected", "cancelled"] as const).map(
      (status, i) => ({ ...base, id: String(i), status })
    );
    expect(openRequests(rows).map((r) => r.status)).toEqual(["requested", "rejected"]);
  });

  it("[S4-statements] Report Center statement links hit the W4-D statement endpoints", () => {
    expect(statementUrl("c1", "customer", "p1", { asOf: "2026-06-30" }, "pdf")).toBe(
      "/api/companies/c1/customer-statements/p1?asOf=2026-06-30&format=pdf"
    );
    expect(statementUrl("c1", "supplier", "v1", { from: "2026-01-01" })).toBe(
      "/api/companies/c1/supplier-statements/v1?from=2026-01-01"
    );
  });
});
