import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { expect, it } from "vitest";
import { BANK_RECONCILIATION_COPY } from "../../shared/bank-reconciliation-copy";
import { pdfToText } from "./pdf-test-helpers";

const roadmap = "docs/archive/root/Muhasib-Netmara-Audit-and-Competitive-Roadmap";
const retiredCopy =
  /\bbank[\s–—-]+feeds?\b|\blive\s+(?:bank\s+)?feeds?\b|\bopen[\s-]+banking\b|bank connect\/sync|\bdirect\s+bank\s+connections?\b|\breal[\s-]+time\s+transaction\s+import\b|الربط (?:البنكي|المصرفي) المباشر/i;

it.each(["pdf", "docx"] as const)(
  "keeps approved banking wording in the archived %s",
  async (extension) => {
    const file = readFileSync(`${roadmap}.${extension}`);
    const text =
      extension === "pdf"
        ? await pdfToText(file)
        : strFromU8(unzipSync(file)["word/document.xml"]).replace(/<[^>]+>/g, " ");
    const normalized = text.replace(/\s+/g, " ");
    expect(normalized).not.toMatch(retiredCopy);
    expect(normalized).toContain(BANK_RECONCILIATION_COPY.en);
  }
);

it("keeps the archived competitive audit aligned with CSV statement uploads", () => {
  const audit = readFileSync("docs/archive/root/COMPETITIVE_AUDIT_2026.md", "utf8");
  expect(audit).not.toMatch(retiredCopy);
  expect(audit).toContain("Muhasib uses CSV statement uploads for bank reconciliation.");
});

it("keeps the environment example free of retired banking wording", () => {
  expect(readFileSync(".env.example", "utf8")).not.toMatch(retiredCopy);
});
