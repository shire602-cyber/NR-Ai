import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { generatePayslipPDF } from "../../server/services/pdf-payslip.service";
import * as F from "../fixtures/pdf-arabic-fixtures";
import { extractPdfText } from "../fixtures/pdf-extract";

const base = {
  company: F.company,
  employee: { fullName: "Slip Person", fullNameAr: "أحمد خان", employeeNumber: "EMP-1", designation: "Clerk", iban: "AE070331234567890129876" },
  periodMonth: 8,
  periodYear: 2026,
  payDate: "2026-08-31T00:00:00Z",
  item: { basicSalary: 6000, housingAllowance: 0, transportAllowance: 0, otherAllowance: 0, overtime: 0, deductions: 0, pensionEmployee: 0, pensionEmployer: 0, gratuityAccrual: 100, netSalary: 6000 },
};

function streams(buf: Buffer): string[] {
  const text = buf.toString("latin1");
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf("endstream", start);
    try {
      out.push(inflateSync(buf.subarray(start, end)).toString("latin1"));
    } catch {
      /* not flate */
    }
  }
  return out;
}

describe("payslip draft banner", () => {
  it("a draft slip says so, in English", async () => {
    const text = await extractPdfText(await generatePayslipPDF({ ...base, draft: true } as any));
    expect(text).toContain("DRAFT");
    expect(text).toContain("not yet approved");
  });
  it("an issued slip carries no draft mark", async () => {
    const text = await extractPdfText(await generatePayslipPDF(base as any));
    expect(text).not.toContain("DRAFT");
  });
  it("the Arabic is marked with its real text (ActualText) so search and copy work", async () => {
    const buf = await generatePayslipPDF({ ...base, draft: true } as any);
    const content = streams(buf).join("\n");
    expect(content).toContain("/ActualText");
    expect(content).toContain("EMC");
  });
});
