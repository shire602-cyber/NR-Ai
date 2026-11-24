// Source scan on purpose: public marketing copy lives in many components and catalogs, and the
// owner rule is that no e-invoicing provider name may ship there. Logged-in screens are excluded.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const BANNED = /a[-\s]?cube|complyance|أكيوب|اي كيوب|ايه كيوب|كومبلاينس|كومبلاينز|كمبلاينس/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = [
  ...walk(join(ROOT, "client/src/components/marketing")),
  ...["en", "ar"].flatMap((l) =>
    readdirSync(join(ROOT, "client/src/locales", l))
      .filter((f) => /^marketing.*\.json$/.test(f))
      .map((f) => join(ROOT, "client/src/locales", l, f))
  ),
  join(ROOT, "client/src/pages/TrustSecurity.tsx"),
].filter((f) => /\.(tsx?|json|css)$/.test(f));

describe("public site names no e-invoicing provider", () => {
  it("scans a non-trivial file set", () => {
    expect(files.length).toBeGreaterThan(5);
  });
  it.each(files.map((f) => [f.slice(ROOT.length + 1), f]))("%s", (_n, f) => {
    expect(readFileSync(f, "utf8")).not.toMatch(BANNED);
  });
});
