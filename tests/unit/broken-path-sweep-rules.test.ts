// Pins the text rules of the broken-path sweep (tests/e2e/lib/sweep-checks.mjs): a raw i18n key,
// a {placeholder}, a UUID or "undefined" in visible text fails a page; ordinary copy, e-mails,
// URLs and document numbers do not. Pure functions, so this is a behaviour test of the rules.
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs module without type declarations
import { NAMESPACES, englishWords, textProblems } from "../e2e/lib/sweep-checks.mjs";

describe("broken-path sweep text rules", () => {
  it("knows the i18n namespaces from the English catalog", () => {
    expect(NAMESPACES).toContain("forms");
    expect(NAMESPACES).toContain("shell");
  });

  it("flags raw keys, placeholders, UUIDs and junk values", () => {
    expect(textProblems("forms.serverErrors.VAT_RATE_NOT_FOR_COUNTRY")).toContain("raw-key");
    expect(textProblems("Due {date}")).toContain("placeholder");
    expect(textProblems("Hello {{name}}")).toContain("placeholder");
    expect(textProblems("Invoice 3f2b8c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f")).toContain("uuid");
    expect(textProblems("Total undefined")).toContain("junk-value");
    expect(textProblems("AED NaN")).toContain("junk-value");
  });

  it("passes ordinary copy, e-mails, hosts and document numbers", () => {
    for (const line of [
      "Invoices",
      "owner@company.ae",
      "Visit muhasib.ai/help",
      "INV-0001",
      "Total AED 1,050.00",
    ]) {
      expect(textProblems(line)).toEqual([]);
    }
  });

  it("finds English words left in an Arabic line after allow-listing", () => {
    expect(englishWords("الفواتير AED 100")).toEqual([]);
    expect(englishWords("الفواتير Save")).toEqual(["save"]);
  });
});

describe("sweep: bank import notification names the format, not its id", () => {
  it("maps generic to CSV and bank ids to their names", async () => {
    const { importFormatLabel } =
      await import("../../server/services/bank-statement-parser.service");
    expect(importFormatLabel("generic")).toBe("CSV");
    expect(importFormatLabel("emiratesnbd")).toBe("Emirates NBD");
    expect(importFormatLabel("camt053")).toBe("CAMT.053");
  });
});

describe("sweep: anomaly text never shows raw record ids", () => {
  const id = "77cbac02-5803-4557-9627-220e944bf43c";
  it("server: AI text names the invoice by its number", async () => {
    const { replaceRecordIds } = await import("../../server/routes/ai/anomalies");
    const refs = new Map([[id, "INV-2026-00007"]]);
    expect(replaceRecordIds(`Invoice with ID '${id}' has a round amount.`, refs)).toBe(
      "Invoice INV-2026-00007 has a round amount."
    );
    expect(
      replaceRecordIds(`Receipt ${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)} is odd`, refs)
    ).toBe("Receipt is odd");
  });
  it("client: AI-written English in the Arabic UI is marked as English", async () => {
    const { writtenLanguageProps } = await import("../../client/src/lib/server-message");
    expect(writtenLanguageProps("Bank service fee, categorised as bank charges.", "ar")).toEqual({
      lang: "en",
      dir: "ltr",
    });
    expect(writtenLanguageProps("رسوم بنكية", "ar")).toEqual({});
    expect(writtenLanguageProps("Bank service fee", "en")).toEqual({});
  });
  it("client: stored text drops the id", async () => {
    const { withoutRecordIds } = await import("../../client/src/lib/server-message");
    expect(withoutRecordIds(`Invoice with ID '${id}' has a round amount.`)).toBe(
      "Invoice has a round amount."
    );
  });
});

describe("sweep: Evidence Center localises month-end checks", () => {
  it("renders 'Control accounts reconciled' and its detail from the Arabic catalog", async () => {
    const { localizeEvidenceText } = await import("../../shared/server-copy");
    const ar = (await import("../../client/src/locales/ar/components.json")).default as Record<
      string,
      string
    >;
    expect(localizeEvidenceText("Control accounts reconciled", ar)).toMatch(/[؀-ۿ]/);
    const detail = localizeEvidenceText(
      "2 control account(s) differ from their sub-ledger: 1070 (45000.00)",
      ar
    );
    expect(detail).toMatch(/[؀-ۿ]/);
    expect(detail).toContain("1070 (45000.00)");
  });
});

describe("sweep: CSP lets the file previews frame blob: URLs", () => {
  it("allows blob: frames in the enforced and the report-only policy", async () => {
    const { buildCspDirectives, buildCspReportOnlyDirectives } =
      await import("../../server/middleware/csp");
    expect(buildCspDirectives().directives.frameSrc).toContain("blob:");
    expect(buildCspReportOnlyDirectives().directives.frameSrc).toContain("blob:");
    // Nothing else may frame the app.
    expect(buildCspDirectives().directives.frameAncestors).toEqual(["'none'"]);
  });
});
