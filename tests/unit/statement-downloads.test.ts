// @vitest-environment jsdom
/**
 * Step 1 / E3: the statement PDF is offered in Arabic and English, the reader's language first,
 * and every download link carries the language (`lang`), so a file never silently follows the
 * company's document language when the reader asked for another.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  pdfLanguageOptions,
  statementDownloadPath,
  statementLang,
} from "../../client/src/pages/reports/model/statementDownloads";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => undefined))
  );
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("statement download helpers", () => {
  it("lists the reader's language first", () => {
    expect(pdfLanguageOptions("ar").map((o) => o.lang)).toEqual(["ar", "en"]);
    expect(pdfLanguageOptions("en").map((o) => o.lang)).toEqual(["en", "ar"]);
    expect(statementLang("ar")).toBe("ar");
    expect(statementLang("en")).toBe("en");
    expect(statementLang("anything")).toBe("en");
  });

  it("builds the download path with format, language and range", () => {
    expect(statementDownloadPath("/api/x/statements/profit-loss", "pdf", "ar")).toBe(
      "/api/x/statements/profit-loss?format=pdf&lang=ar"
    );
    expect(
      statementDownloadPath(
        "/api/x/statements/profit-loss",
        "xlsx",
        "en",
        "&from=2026-01-01&to=2026-03-31"
      )
    ).toBe("/api/x/statements/profit-loss?format=xlsx&lang=en&from=2026-01-01&to=2026-03-31");
  });
});

describe("StatementDownloads links", () => {
  const render = async (locale: "en" | "ar", compact = false) => {
    const { useI18n } = await import("../../client/src/lib/i18n");
    useI18n.setState({ locale });
    const { StatementDownloads } = await import("../../client/src/pages/reports/StatementParts");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        createElement(StatementDownloads, {
          companyId: "c1",
          kind: "profit-loss",
          from: "2026-01-01",
          to: "2026-03-31",
          compact,
        })
      )
    );
    const links = [...container.querySelectorAll("a")].map((a) => ({
      href: a.getAttribute("href") ?? "",
      text: a.textContent?.trim() ?? "",
    }));
    act(() => root.unmount());
    return links;
  };

  it("an Arabic reader sees PDF (العربية) first, then the English PDF, then Excel in Arabic", async () => {
    const links = await render("ar");
    expect(links.map((l) => l.text)).toEqual(["PDF (العربية)", "PDF (الإنجليزية)", "ملف Excel"]);
    expect(links.map((l) => /lang=(\w+)/.exec(l.href)?.[1])).toEqual(["ar", "en", "ar"]);
    expect(links[0].href).toContain("/reports/statements/profit-loss?format=pdf&lang=ar");
    expect(links[0].href).toContain("from=2026-01-01");
  });

  it("an English reader sees PDF (English) first and can still get the Arabic PDF", async () => {
    const links = await render("en");
    expect(links.map((l) => l.text)).toEqual(["PDF (English)", "PDF (العربية)", "Excel"]);
    expect(links.map((l) => /lang=(\w+)/.exec(l.href)?.[1])).toEqual(["en", "ar", "en"]);
  });

  it("dense lists keep one PDF in the reader's language", async () => {
    const links = await render("ar", true);
    expect(links).toHaveLength(2);
    expect(links[0].href).toContain("format=pdf&lang=ar");
  });
});
