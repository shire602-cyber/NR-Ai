/**
 * R17-25: assurance documents exist and stay truthful — no certification, completed
 * pen-test or compliance claims; external actions are listed as such.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("R17-25 security assurance documents", () => {
  it("[R17-25] the data map, PDPL draft, incident outline and pen-test scope exist", () => {
    const dataMap = read("docs/security/data-map.md");
    expect(dataMap).toMatch(/AI providers/);
    expect(dataMap).toMatch(/Storage locations/);
    expect(read("docs/security/pdpl-data-residency.md")).toMatch(/DRAFT/);
    expect(read("docs/security/incident-response.md")).toMatch(/PDPL/);
    expect(read("docs/security/pentest-scope.md")).toMatch(
      /no independent penetration test has been performed/i
    );
  });

  it("[R17-25] trust copy never claims certification or a completed audit", () => {
    const sources = [
      read("docs/TRUST.md"),
      read("client/src/pages/TrustSecurity.tsx"),
      read("docs/security/pdpl-data-residency.md"),
    ].join("\n");
    expect(sources).not.toMatch(/\b(SOC 2|ISO 27001)\s+(certified|compliant)\b/i);
    expect(sources).not.toMatch(/\bpen(etration)?[- ]tested\b/i);
    expect(sources).not.toMatch(/\bPDPL[- ]compliant\b/i);
    expect(read("docs/TRUST.md")).toMatch(/No SOC 2 \/ ISO 27001 certification/);
  });
});
