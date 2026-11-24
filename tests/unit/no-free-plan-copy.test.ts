// There is no free plan (shared/plans.ts: three paid plans, a 14-day trial). The catalogs must not
// carry free-plan names or sentences, in English or Arabic. A free TRIAL is fine.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = (loc: string) => join(process.cwd(), "client", "src", "locales", loc);

function entries(loc: "en" | "ar"): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const f of readdirSync(dir(loc)).filter((n) => n.endsWith(".json"))) {
    const json = JSON.parse(readFileSync(join(dir(loc), f), "utf8")) as Record<string, string>;
    for (const [k, v] of Object.entries(json)) if (typeof v === "string") out.push([k, v]);
  }
  return out;
}

const FREE_KEY = /(plan_?free|planfree|inheritsfree|subscriptionfree|norenewal)/i;
const FREE_EN = /\bfree (plan|tier)\b|\b(in|for) free\b|\bfree (and|or) starter\b|\bfree users?\b/i;
const FREE_AR = /(الخطة|الباقة|الخطتين) المجاني|المجانية والمبتدئة|خطة مجانية|باقة مجانية/;

describe("no free plan copy in the catalogs", () => {
  for (const loc of ["en", "ar"] as const) {
    it(`${loc}: no free-plan keys or sentences`, () => {
      const bad = entries(loc).filter(
        ([k, v]) => FREE_KEY.test(k) || (loc === "en" ? FREE_EN.test(v) : FREE_AR.test(v)),
      );
      expect(bad.map(([k]) => k)).toEqual([]);
    });
  }
});
