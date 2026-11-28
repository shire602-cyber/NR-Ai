// @vitest-environment jsdom
/**
 * INTEGRATE-F: the ledger kernel's refusals (B1 control accounts / sub-ledger entries, B2
 * amended VAT settlement) reach every restyled entry point (bank-line create entry, document
 * editors, journal reverse / void) through apiRequest. The message the UI shows is the
 * catalog sentence in the active language with the sub-ledger path, never the raw code or the
 * server's endpoint text.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { apiRequest, ApiError } from "../../client/src/lib/queryClient";

const ARABIC = /[؀-ۿ]/;

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const controlRefusal = {
  code: "CONTROL_ACCOUNT_MANUAL_POSTING",
  message:
    "1040 Accounts Receivable is a control account kept by invoices, credit notes and customer payments.",
  details: {
    accounts: [{ accountId: "a1", code: "1040", ledger: "receivables" }],
    paths: [
      {
        ledger: "receivables",
        action: "Match the bank line",
        endpoint: "POST /api/companies/:companyId/bank-statements/:id/match",
      },
    ],
  },
};

async function failWith(status: number, body: unknown): Promise<ApiError> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("csrf-token") ? respond(200, { csrfToken: "t" }) : respond(status, body)
    )
  );
  try {
    await apiRequest("POST", "/api/companies/c1/bank-statements/t1/create-entry", {
      accountId: "a1",
    });
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("expected the request to fail");
}

beforeAll(async () => {
  await loadLocale("en");
  await loadLocale("ar");
});

afterEach(() => {
  vi.unstubAllGlobals();
  useI18n.setState({ locale: "en" });
});

describe("ledger guard errors", () => {
  it("control-account 422 names the account and the sub-ledger path (en)", async () => {
    const err = await failWith(422, controlRefusal);
    expect(err.status).toBe(422);
    expect(err.message).toContain("control account");
    expect(err.message).toContain("1040");
    expect(err.message).toContain("customer's invoice");
    expect(err.message).not.toContain("CONTROL_ACCOUNT_MANUAL_POSTING");
    expect(err.message).not.toContain("/api/");
  });

  it("control-account 422 is Arabic in Arabic mode", async () => {
    useI18n.setState({ locale: "ar" });
    const err = await failWith(422, {
      ...controlRefusal,
      details: { ...controlRefusal.details, paths: [{ ledger: "vat" }] },
    });
    expect(err.message).toMatch(ARABIC);
    expect(err.message.replace(/1040/g, "")).not.toMatch(/[A-Za-z]/);
  });

  it("409 SUBLEDGER_ENTRY names the document's own correction flow in both languages", async () => {
    const body = {
      code: "SUBLEDGER_ENTRY",
      message: "This journal entry was posted by a invoice and is undone from there.",
      details: { entryId: "e1", source: "invoice", document: "invoice", documentId: "i1" },
    };
    const en = await failWith(409, body);
    expect(en.message).toContain("credit note");
    useI18n.setState({ locale: "ar" });
    const ar = await failWith(409, body);
    expect(ar.message).toMatch(ARABIC);
    expect(ar.message).not.toMatch(/[A-Za-z]/);
    // An unknown document falls back to the generic sentence, still localised.
    const other = await failWith(409, { ...body, details: { document: "something_new" } });
    expect(other.message).toMatch(ARABIC);
  });

  it("B1 disposal-invoice void and B2 amended-settlement refusals are localised", async () => {
    useI18n.setState({ locale: "ar" });
    for (const code of ["INVOICE_BILLS_ASSET_DISPOSAL", "VAT_AMENDMENT_NOTHING_TO_SETTLE"]) {
      const err = await failWith(code === "INVOICE_BILLS_ASSET_DISPOSAL" ? 409 : 422, {
        code,
        message: "English server text",
      });
      expect(err.message).toMatch(ARABIC);
      expect(err.message).not.toMatch(/[A-Za-z]/);
    }
  });

  it("other codes keep the server text in English", async () => {
    const err = await failWith(422, { code: "SOMETHING_ELSE", message: "Server sentence" });
    expect(err.message).toBe("Server sentence");
  });
});
