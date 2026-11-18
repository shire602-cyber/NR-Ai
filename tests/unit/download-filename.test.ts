/**
 * DF3 / Fable P-f: generated download names. An Arabic-named customer's statement was
 * `statement-_-2026-11-18.pdf` and a receipt was `receipt-8e671e03.pdf`.
 */
import { describe, expect, it } from "vitest";
import {
  attachmentDisposition,
  downloadFileName,
  fileNamePart,
} from "../../server/utils/download-filename";

describe("download file names", () => {
  it("keeps Arabic names readable and never falls back to underscores", () => {
    const name = downloadFileName("statement", ["مؤسسة النور", "2026-11-18"], "pdf");
    expect(name).toBe("statement-مؤسسة-النور-2026-11-18.pdf");
    expect(name).not.toContain("_");
    const header = attachmentDisposition(name);
    expect(header).toContain('filename="statement-2026-11-18.pdf"');
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent(name)}`);
  });

  it("slugs Latin names and drops empty parts", () => {
    expect(downloadFileName("statement", ["Blue Palm Services LLC", "2026-11-18"], "pdf")).toBe(
      "statement-Blue-Palm-Services-LLC-2026-11-18.pdf"
    );
    expect(downloadFileName("receipt", ["JE-2026-0042"], "pdf")).toBe("receipt-JE-2026-0042.pdf");
    expect(downloadFileName("receipt", [null, "  ", "2026-11-12"], "pdf")).toBe(
      "receipt-2026-11-12.pdf"
    );
    expect(fileNamePart('a/b\\c"d')).toBe("a-b-c-d");
  });
});
