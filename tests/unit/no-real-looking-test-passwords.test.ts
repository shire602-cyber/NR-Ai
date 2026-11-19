/**
 * Secret hygiene for test and script fixtures.
 *
 * GitGuardian flagged a fixture password on PR #67 (incident 40231730, "Generic Password":
 * `typeInto("input-password", "<literal>")` in tests/unit/e3-register-language-switch.test.ts).
 * It was a fake value typed into a mocked form, but it looked like a real one. This check stops
 * new ones: every password literal in tests/, scripts/ and tools/ must declare itself fake by
 * carrying a marker word, or come from tests/fixtures/credentials/fake-credentials.ts.
 *
 * Why source inspection and not a behaviour test: the property is about what is committed to
 * the repository (what a secret scanner reads), not about runtime behaviour, so the only way to
 * check it is to read the files.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const SCAN_DIRS = ["tests", "scripts", "tools"];
const EXT = /\.(ts|tsx|js|mjs|cjs)$/;
const SKIP_DIRS = new Set(["node_modules", ".artifacts", "dist"]);
// `password: "..."`, `PASSWORD = '...'`, `("input-password", "...")`, `ACUBE_PASSWORD: "..."`.
// Same line only, so string lists ("ACUBE_PASSWORD", "ACUBE_ENV") and paths are not matched.
const PASSWORD_LITERAL =
  /(?:(?:password|passwd|pwd)["']?[ \t]*[:=]|input-password["'][ \t]*,)[ \t]*["'`]([^"'`$\n]{6,})["'`]/gi;
// A fixture names itself as fake.
const FAKE_MARKER =
  /fake|test|password|passw0rd|secret|wrong|bad|sandbox|example|dummy|placeholder|invalid/i;

function* files(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (EXT.test(entry.name)) yield full;
  }
}

export function findRealLookingPasswords(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(PASSWORD_LITERAL)) {
    // A literal typed into the password input is always flagged, marker or not: scanners
    // (GitGuardian) still read "Fake-" + a strong-looking value as a Generic Password, so form
    // tests must type FAKE_PASSWORD from the fixture instead.
    const typedIntoInput = /input-password/i.test(m[0]);
    if (typedIntoInput || !FAKE_MARKER.test(m[1])) out.push(m[1]);
  }
  return out;
}

describe("secret hygiene: fixture passwords declare themselves fake", () => {
  it("the matcher flags a real-looking literal and accepts marked fakes", () => {
    // Built at runtime so this file does not itself carry a scanner-visible literal.
    const flagged = ["Str0ng", "pass", "123"].join("-");
    const other = ["Hunter", "2xyz!"].join("");
    expect(findRealLookingPasswords(`typeInto("input-password", "${flagged}");`)).toEqual([
      flagged,
    ]);
    expect(findRealLookingPasswords(`{ password: "${other}" }`)).toEqual([other]);
    // Even a self-declared fake is flagged when typed into the form: use FAKE_PASSWORD.
    const marked = ["Fake", "Password", "123"].join("-");
    expect(findRealLookingPasswords(`typeInto("input-password", "${marked}");`)).toEqual([marked]);
    expect(
      findRealLookingPasswords(
        `{ password: "Password123!" }; ACUBE_PASSWORD: "s3cret-sandbox-password"; pwd = "Fake-Password-123"`
      )
    ).toEqual([]);
  });

  it("no file in tests/, scripts/ or tools/ carries a real-looking password literal", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      const abs = path.join(ROOT, dir);
      if (!fs.existsSync(abs)) continue;
      for (const file of files(abs)) {
        const rel = path.relative(ROOT, file);
        if (rel === path.join("tests", "unit", "no-real-looking-test-passwords.test.ts")) continue;
        for (const value of findRealLookingPasswords(fs.readFileSync(file, "utf8"))) {
          // Report the file and the length only: never echo a value that might be real.
          offenders.push(
            `${rel} (password literal of ${value.length} chars without a fake marker)`
          );
        }
      }
    }
    expect(
      offenders,
      "use FAKE_PASSWORD from tests/fixtures/credentials/fake-credentials.ts or a value that says it is fake"
    ).toEqual([]);
  });
});
