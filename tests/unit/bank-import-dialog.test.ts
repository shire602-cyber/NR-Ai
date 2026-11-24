// @vitest-environment jsdom
/**
 * Step 1 / F4: the bank statement import dialog is catalog copy in both languages. In Arabic it
 * has no English outside user data and brand names (the "Supported formats" lines and the Import
 * button used to stay English), and its content is allowed to shrink to the phone width.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthHint, setAuthHint } from "../../client/src/lib/authHint";
import { isEnglishLine } from "../e2e/lib/latin-text.mjs";
import { click, pickOption } from "./helpers/form-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView ??= () => {};
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  setAuthHint();
  window.history.pushState({}, "", "/bank-reconciliation?import=1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      if (/\/api\/companies$/.test(url)) return json([{ id: "c-1", name: "شركة الواحة" }]);
      if (url.endsWith("/bank-accounts"))
        return json([
          {
            id: "b-1",
            nameEn: "الحساب التشغيلي",
            bankName: "بنك الإمارات دبي الوطني",
            accountNumber: null,
            iban: null,
            currency: "AED",
            glAccountId: null,
            isActive: true,
          },
        ]);
      return json([]);
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  clearAuthHint();
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  const { useI18n } = await import("../../client/src/lib/i18n");
  useI18n.getState().setLocale("en");
});

async function mountPage(locale: "en" | "ar") {
  const i18n = await import("../../client/src/lib/i18n");
  await act(async () => i18n.useI18n.getState().setLocale(locale));
  const { queryClient } = await import("../../client/src/lib/queryClient");
  queryClient.clear();
  const { ActiveCompanyProvider } =
    await import("../../client/src/components/ActiveCompanyProvider");
  const { Toaster } = await import("../../client/src/components/ui/toaster");
  const { default: BankReconciliation } = await import("../../client/src/pages/BankReconciliation");
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ActiveCompanyProvider, null, createElement(BankReconciliation)),
        createElement(Toaster)
      )
    );
  });
  for (let i = 0; i < 12; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const action = () =>
  dialog()!.querySelector<HTMLButtonElement>('[data-testid="button-confirm-import"]')!;
const mapper = () => dialog()!.querySelector('[data-testid="panel-statement-mapper"]');

async function chooseStatement(body: string, name = "statement.csv") {
  const input = dialog()!.querySelector<HTMLInputElement>(
    '[data-testid="input-bank-statement-file"]'
  )!;
  const file = new File([body], name, { type: "text/csv" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new TextEncoder().encode(body).buffer,
  });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

function recordStatementRequests(importResponse = json({ imported: 1 })) {
  const previews: Array<{ payload: unknown; respond: (value: Response) => void }> = [];
  const imports: unknown[] = [];
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/bank-statements/preview")) {
      return new Promise<Response>((respond) =>
        previews.push({ payload: JSON.parse(String(init?.body)), respond })
      );
    }
    if (url.endsWith("/bank-statements/import")) {
      imports.push(JSON.parse(String(init?.body)));
      return importResponse;
    }
    return original(input, init);
  });
  return { previews, imports };
}

function previewResponse(description: string, requiresChoice = false) {
  return json({
    kind: "csv",
    detectedFormat: "generic",
    decimalSeparator: ".",
    dateOrder: requiresChoice ? "DMY" : "YMD",
    headers: [],
    mapping: {},
    totalRows: 1,
    validRows: 1,
    errorRows: 0,
    firstInvalidDateRow: null,
    sampleRows: [{ rowIndex: 1, date: "2026-11-13", description, debit: 0, credit: 0, errors: [] }],
    warnings: [],
    requiresChoice,
  });
}

async function selectImportAccount() {
  await pickOption(dialog()!.querySelector('[data-testid="select-import-bank-account"]'), /الحساب/);
}

describe("bank statement import dialog", () => {
  it("in Arabic: every line is Arabic, including the supported formats and the Import button", async () => {
    await mountPage("ar");
    const d = dialog();
    expect(d).not.toBeNull();
    const lines: string[] = [];
    const walker = document.createTreeWalker(d!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text && !n.parentElement?.closest("[translate=no]")) lines.push(text);
    }
    expect(lines.filter((line) => isEnglishLine(line))).toEqual([]);
    const text = d!.textContent ?? "";
    expect(text).toContain("استيراد");
    expect(text).toContain("متطلبات ملف CSV");
    expect(text).toContain("CSV");
    expect(text).not.toMatch(/PDF|XLSX|MT940|CAMT|OFX/);
    expect(d!.querySelector('[data-testid="button-confirm-import"]')?.textContent).toContain(
      "استيراد"
    );
  });

  it("in English: the same lines come from the catalog", async () => {
    await mountPage("en");
    const text = dialog()?.textContent ?? "";
    expect(text).toContain("CSV files can use commas, semicolons, or tabs");
    expect(text).not.toMatch(/PDF|XLSX|MT940|CAMT|OFX/);
    expect(dialog()?.querySelector('[data-testid="button-confirm-import"]')?.textContent).toContain(
      "Import"
    );
  });

  it.each([
    ["en", "Choose a CSV file exported from your bank."],
    ["ar", "اختر ملف CSV صدّرته من مصرفك."],
  ] as const)("rejects a non-CSV selection without calling preview in %s", async (locale, copy) => {
    await mountPage(locale);
    const input = dialog()?.querySelector<HTMLInputElement>(
      '[data-testid="input-bank-statement-file"]'
    );
    expect(input?.getAttribute("accept")).toBe(".csv,text/csv");
    Object.defineProperty(input, "files", { value: [new File(["report"], "statement.xlsx")] });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const error = dialog()?.querySelector('[data-testid="text-statement-preview-error"]');
    expect(error?.textContent).toBe(copy);
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/bank-statements/preview"))
    ).toBe(false);
  });

  describe.each([
    [
      "en",
      "Correct the missing or invalid transaction date in CSV row 2 and preview the file again.",
    ],
    ["ar", "صحّح تاريخ الحركة المفقود أو غير الصالح في الصف 2 من ملف CSV ثم عاين الملف مجددًا."],
  ] as const)("blocked bank statement preview in %s", (locale, copy) => {
    it.each([
      ["blank", "", "100.00", "Missing date", []],
      [
        "invalid",
        "2026-02-30",
        "bad",
        "Invalid date '2026-02-30' for DD/MM/YYYY",
        ["Invalid amount 'bad'"],
      ],
    ] as const)(
      "shows CSV row 2 when the only transaction date is %s",
      async (_kind, date, amount, parserError, otherErrors) => {
        const { previews, imports } = recordStatementRequests();
        await mountPage(locale);
        await selectImportAccount();
        await chooseStatement(`Date,Description,Amount\n${date},Deposit,${amount}`);
        await vi.waitFor(() => expect(previews).toHaveLength(1));
        await act(async () =>
          previews[0].respond(
            json({
              kind: "csv",
              detectedFormat: "generic",
              decimalSeparator: ".",
              dateOrder: null,
              headerRow: 1,
              headers: ["Date", "Description", "Amount"],
              mapping: { date: 0, description: 1, amount: 2 },
              totalRows: 1,
              validRows: 0,
              errorRows: 1,
              firstInvalidDateRow: 2,
              sampleRows: [
                {
                  rowIndex: 2,
                  date: null,
                  description: "Deposit",
                  debit: 0,
                  credit: amount === "bad" ? 0 : 100,
                  errors: [...otherErrors, parserError],
                },
              ],
              warnings: [],
              requiresChoice: false,
            })
          )
        );

        expect(action().disabled).toBe(true);
        expect(
          mapper()?.querySelector('[role="alert"][data-testid="text-statement-preview-date-error"]')
            ?.textContent
        ).toBe(copy);
        expect(mapper()?.querySelector("tbody tr")?.getAttribute("title")).toBe(
          [copy, ...otherErrors].join("; ")
        );
        expect(imports).toEqual([]);
      }
    );

    it("shows CSV row 12 when the first date error is beyond the preview sample", async () => {
      const { previews, imports } = recordStatementRequests();
      const sampleRows = Array.from({ length: 10 }, (_, index) => ({
        rowIndex: index + 2,
        date: "2026-03-10",
        description: "Deposit",
        debit: 0,
        credit: 0,
        errors: ["Missing amount"],
      }));
      await mountPage(locale);
      await selectImportAccount();
      await chooseStatement(
        [
          "Date,Description,Amount",
          ...sampleRows.map((row) => `${row.date},${row.description},`),
          "2026-02-30,Deposit,100.00",
        ].join("\n")
      );
      await vi.waitFor(() => expect(previews).toHaveLength(1));
      await act(async () =>
        previews[0].respond(
          json({
            kind: "csv",
            detectedFormat: "generic",
            decimalSeparator: ".",
            dateOrder: "YMD",
            headerRow: 1,
            headers: ["Date", "Description", "Amount"],
            mapping: { date: 0, description: 1, amount: 2 },
            totalRows: 11,
            validRows: 0,
            errorRows: 11,
            firstInvalidDateRow: 12,
            sampleRows,
            warnings: [],
            requiresChoice: false,
          })
        )
      );

      expect(action().disabled).toBe(true);
      expect(
        mapper()?.querySelector('[data-testid="text-statement-preview-date-error"]')?.textContent
      ).toBe(copy.replace("2", "12"));
      expect(imports).toEqual([]);
    });
  });

  it.each(["en", "ar"] as const)(
    "only imports the bytes from the latest successful preview in %s",
    async (locale) => {
      const { previews, imports } = recordStatementRequests();
      await mountPage(locale);
      await selectImportAccount();

      await chooseStatement("first CSV");
      await chooseStatement("different CSV with the same name");
      await vi.waitFor(() => expect(previews).toHaveLength(2));
      await act(async () => previews[0].respond(previewResponse("old sample")));
      expect(action().disabled).toBe(true);
      expect(mapper()).toBeNull();

      await act(async () => previews[1].respond(previewResponse("current sample")));
      expect(action().disabled).toBe(false);
      expect(mapper()?.textContent).toContain("current sample");
      await click(action());
      expect(imports).toEqual([
        {
          ...(previews[1].payload as object),
          bankAccountId: "b-1",
          acknowledgeAmbiguity: false,
        },
      ]);
    }
  );

  it.each([
    ["en", "Correct the missing or invalid transaction date in CSV row 3"],
    ["ar", "صحّح تاريخ الحركة المفقود أو غير الصالح في الصف 3 من ملف CSV"],
  ] as const)(
    "shows the first CSV row needing a date correction in the %s toast",
    async (locale, copy) => {
      const message =
        "Import canceled. Correct the missing or invalid transaction date in CSV row 3 and try again.";
      const { previews } = recordStatementRequests(
        new Response(
          JSON.stringify({
            code: "BANK_STATEMENT_INVALID_DATE",
            message,
            details: { rowIndex: 3 },
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        )
      );
      await mountPage(locale);
      await selectImportAccount();
      await chooseStatement(
        "Date,Description,Amount\n2026-03-10,Stationery,-12.50\n2026-02-30,Deposit,100.00"
      );
      await vi.waitFor(() => expect(previews).toHaveLength(1));
      await act(async () => previews[0].respond(previewResponse("Stationery")));
      await click(action());
      await vi.waitFor(() => {
        const messages = [...document.querySelectorAll('.destructive[data-state="open"]')].map(
          (toast) => toast.textContent
        );
        expect(messages).toContainEqual(expect.stringContaining(copy));
      });
    }
  );

  it("keeps a failed newer preview blocked when an older request finishes afterwards", async () => {
    const { previews, imports } = recordStatementRequests();
    await mountPage("en");
    await selectImportAccount();
    await chooseStatement("first CSV");
    await chooseStatement("unreadable CSV");
    await vi.waitFor(() => expect(previews).toHaveLength(2));

    await act(async () =>
      previews[1].respond(
        new Response(JSON.stringify({ message: "Unreadable CSV" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        })
      )
    );
    expect(action().disabled).toBe(true);
    await act(async () => previews[0].respond(previewResponse("old sample")));
    expect(action().disabled).toBe(true);
    expect(mapper()).toBeNull();
    expect(dialog()?.querySelector('[data-testid="text-statement-preview-error"]')).toBeTruthy();
    expect(imports).toEqual([]);
  });

  it("ignores a result from the previous dialog after close and reopen", async () => {
    const { previews, imports } = recordStatementRequests();
    await mountPage("en");
    await selectImportAccount();
    await chooseStatement("first CSV");
    await vi.waitFor(() => expect(previews).toHaveLength(1));

    await click([...dialog()!.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!);
    await click(document.querySelector('[data-testid="button-import-transactions"]'));
    await chooseStatement("new CSV");
    await vi.waitFor(() => expect(previews).toHaveLength(2));

    await act(async () => previews[1].respond(previewResponse("current sample", true)));
    await act(async () => previews[0].respond(previewResponse("closed dialog sample")));
    expect(mapper()?.textContent).toContain("current sample");
    expect(action().disabled).toBe(true);
    expect(imports).toEqual([]);
  });

  it("lets the dialog content shrink to a phone (single minmax(0,1fr) column, no min-content growth)", async () => {
    await mountPage("en");
    expect(dialog()?.className).toContain("grid-cols-[minmax(0,1fr)]");
  });
});
