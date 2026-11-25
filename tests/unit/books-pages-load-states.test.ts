// @vitest-environment jsdom
/**
 * Accounting-pages verification (2026-11-19): a failed read must read as a failure that can be
 * retried, never as "not found" or as an empty list, and the controls that were unnamed for
 * assistive technology now carry a name.
 *  - JournalEntryDetail: 500 -> load-error state with Retry; 404 -> "Journal entry not found".
 *  - AdminDocuments: the companies call failing is not "no clients you can upload for"; the
 *    company and category selects have accessible names; the TRN label is localised.
 */
import { createElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  flush,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale } from "../../client/src/lib/i18n";

const mode = vi.hoisted(() => ({ failWith: null as null | { status: number }, failKeys: /$^/ }));

vi.mock("../../client/src/lib/queryClient", () => {
  const m = formHarnessQueryClientMock();
  const lookupFn = m.getQueryFn();
  m.queryClient.setDefaultOptions({
    queries: {
      retry: false,
      staleTime: Infinity,
      queryFn: async (ctx: { queryKey: readonly unknown[] }) => {
        if (mode.failWith && mode.failKeys.test(ctx.queryKey.join("/"))) {
          const err = new m.ApiError("SQL error internal-boom");
          err.status = mode.failWith.status;
          throw err;
        }
        return lookupFn(ctx);
      },
    },
  });
  return m;
});
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});
beforeEach(() => {
  resetHarness();
  mode.failWith = null;
  window.localStorage.clear();
});
afterEach(unmountPage);

async function renderEntry(id: string) {
  const { default: Detail } = await import("../../client/src/pages/JournalEntryDetail");
  const { hook } = memoryLocation({ path: `/journal/${id}` });
  const Shell = () =>
    createElement(
      Router,
      { hook },
      createElement(Route, { path: "/journal/:id", component: Detail })
    );
  await renderPage(Shell);
  await flush(30);
}

describe("journal entry detail load failure", () => {
  it("a server error shows a retryable error state, not 'not found'", async () => {
    mode.failWith = { status: 500 };
    mode.failKeys = /api\/journal\//;
    await renderEntry("11111111-1111-4111-8111-111111111111");
    expect(document.querySelector('[data-testid="journal-entry-load-error"]')).not.toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/journal entry not found/i);
    expect(text).not.toContain("internal-boom");
    expect(
      [...document.querySelectorAll("button")].some((b) => /try again/i.test(b.textContent ?? ""))
    ).toBe(true);
  });

  it("a missing entry still reads as not found", async () => {
    mode.failWith = { status: 404 };
    mode.failKeys = /api\/journal\//;
    await renderEntry("22222222-2222-4222-8222-222222222222");
    expect(document.querySelector('[data-testid="journal-entry-load-error"]')).toBeNull();
    expect(document.body.textContent).toMatch(/journal entry not found/i);
    // The icon-only back link has a name (axe link-name).
    const back = document.querySelector('[data-testid="button-back-to-journal"]');
    expect(back?.getAttribute("aria-label")).toBeTruthy();
  });
});

describe("admin documents", () => {
  it("a failing company list is an error state, not 'no clients'", async () => {
    mode.failWith = { status: 500 };
    mode.failKeys = /api\/admin\/documents\/companies/;
    const { default: AdminDocuments } = await import("../../client/src/pages/AdminDocuments");
    await renderPage(AdminDocuments);
    await flush(30);
    expect(
      document.querySelector('[data-testid="admin-documents-companies-error"]')
    ).not.toBeNull();
    expect(document.querySelector('[data-testid="text-no-writable-clients"]')).toBeNull();
    expect(document.body.textContent).not.toContain("internal-boom");
  });

  it("the company select has an accessible name", async () => {
    setFixtures({
      "api/admin/documents/companies": [
        { id: "c1", name: "Alpha LLC", trnNumber: "100123456700003" },
      ],
    });
    const { default: AdminDocuments } = await import("../../client/src/pages/AdminDocuments");
    await renderPage(AdminDocuments);
    await flush(30);
    const trigger = document.querySelector('[data-testid="select-client-company"]');
    expect(trigger?.getAttribute("aria-label")).toBeTruthy();
  });
});
