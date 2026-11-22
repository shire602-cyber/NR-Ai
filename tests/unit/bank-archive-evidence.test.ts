// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { findBankLaunchClaim } from "../e2e/lib/bank-launch-wording.mjs";
import { pdfToText } from "./pdf-test-helpers";

const roadmap = "docs/archive/root/Muhasib-Netmara-Audit-and-Competitive-Roadmap";
const valueOpsScreenshot =
  "docs/qa/2026-06-21-benchmark-audit/screenshots/route-firm-value-ops.png";
const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function readWordArchive(file: string): string {
  const archive = unzipSync(readFileSync(file));
  expect(archive["word/document.xml"], file).toBeDefined();
  const parser = new DOMParser();

  return Object.entries(archive)
    .filter(([name]) =>
      /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/u.test(name)
    )
    .flatMap(([name, contents]) => {
      const document = parser.parseFromString(strFromU8(contents), "application/xml");
      expect(document.getElementsByTagName("parsererror"), `${file}: ${name}`).toHaveLength(0);
      return Array.from(document.getElementsByTagNameNS(wordNamespace, "p"), (paragraph) =>
        Array.from(paragraph.getElementsByTagNameNS(wordNamespace, "*"), (node) => {
          if (node.localName === "t" || node.localName === "delText") return node.textContent;
          if (node.localName === "br" || node.localName === "tab") return "\n";
          return "";
        }).join("")
      );
    })
    .join("\n");
}

describe("Archived CSV-only banking evidence", () => {
  it.each([
    [`${roadmap}.docx`, async (file: string) => readWordArchive(file)],
    [`${roadmap}.pdf`, async (file: string) => pdfToText(readFileSync(file))],
  ])("extracts visible roadmap text without retired banking claims from %s", async (file, read) => {
    const text = await read(file);
    expect(text, file).toMatch(/Technical Audit\s*&\s*Competitive Roadmap/iu);
    expect(findBankLaunchClaim(text), file).toBeUndefined();
  });

  it("keeps the captured Value Ops roadmap label covered by the documented redaction", async () => {
    const screenshot = sharp(valueOpsScreenshot);
    expect(await screenshot.metadata()).toMatchObject({ width: 1440, height: 900, format: "png" });

    // The unchanged screenshot has its retired label at this specific location. Verify the
    // precise, opaque mask and a visible strip immediately beside it, without relying on OCR.
    const mask = { left: 538, top: 423, width: 111, height: 39 };
    const maskPixels = await screenshot
      .clone()
      .flatten({ background: "white" })
      .extract(mask)
      .raw()
      .toBuffer();
    expect(maskPixels).toHaveLength(mask.width * mask.height * 3);
    expect(maskPixels.every((component) => component === 0)).toBe(true);

    const adjacentPixels = await screenshot
      .removeAlpha()
      .extract({ ...mask, left: mask.left - 1, width: 1 })
      .raw()
      .toBuffer();
    expect(adjacentPixels.some((component) => component !== 0)).toBe(true);
  });
});
