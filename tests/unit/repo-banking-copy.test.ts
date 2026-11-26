// Source inspection covers archived Markdown, comments and operator messages outside the browser.
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { findPublicBankingMention } from "../e2e/lib/public-banking-copy.mjs";
import { pdfToText } from "./pdf-test-helpers";

const ignoredDirectories = new Set(["node_modules", "dist", "coverage", "uploads"]);
const adapterFile = "server/services/bank-feeds/index.ts";
const appSectionsFile = "client/src/components/layout/app-sections.ts";
const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
// These original 0097 fixtures reproduce already-applied ledgers. The exception covers only their pinned bytes.
const historicalSqlDigests: Record<string, string> = {
  "scripts/rehearsal/historical/0097_w3c_banking.sql":
    "fc545f83c7470e6624251c1d4492a9f6f6a842d2fd20b4afb94fb28e0fbdc7be",
  "scripts/rehearsal/historical/1c266ae5/0097_w3c_banking.sql":
    "5902597f9645c0775888786f117bab5f9ddd06207a77c260fe20642a6e52a065",
  "scripts/rehearsal/historical/29e9a1fa/0097_w3c_banking.sql":
    "13dd818bd6d2597e9898873d00120dbb67971f1a60447d5caab63cf05f56af6f",
  "scripts/rehearsal/historical/48b878ba/0097_w3c_banking.sql":
    "9e106a48744cf0e52fa1bf9dbc7c68df6b293a72d771c86de52cf8e399eec0af",
};

function filesIn(dir: string, extension: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isFile()) return path.endsWith(extension) ? [path] : [];
    if (entry.isDirectory() && !entry.name.startsWith(".") && !ignoredDirectories.has(entry.name)) {
      return filesIn(path, extension);
    }
    return [];
  });
}

const archivedBankImportMentions = [
  /\byodlee\s*\+\s*wio\b/i,
  /\b(?:bank[-\s]+data\s+access|(?:access\s+(?:to\s+)?bank[-\s]+data|bank[-\s]+data)\s+(?:through|via|from)\s+[^.\n]{0,45}\baggregators?)\b/i,
  /\breachable\s+through\s+any\s+aggregator\b/i,
  /\bbank\s+connections\b/i,
];

function findProseMention(copy: string): string | undefined {
  // The historical adapter filename is a literal technical reference in the archive.
  const text = copy.replaceAll("`open-banking.service.ts`", "").replace(/\*/g, "");
  return (
    findPublicBankingMention(text) ??
    archivedBankImportMentions.map((pattern) => text.match(pattern)?.[0]).find(Boolean)
  );
}

function findJsonProseMention(copy: string): string | undefined {
  let mention: string | undefined;
  JSON.parse(copy, (_key, value: unknown) => {
    if (!mention && typeof value === "string") mention = findProseMention(value);
    return value;
  });
  return mention;
}

function findSqlCommentMention(copy: string): string | undefined {
  for (const [comment] of copy.matchAll(/--[^\r\n]*(?:\r?\n[ \t]*--[^\r\n]*)*|\/\*[\s\S]*?\*\//g)) {
    const match = findPublicBankingMention(comment.replace(/^[ \t]*--[ \t]*/gm, ""));
    if (match) return match;
  }
}

function operatorCopyViolations(path: string, source: string): string[] {
  if (!findProseMention(source)) return [];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const seenComments = new Set<number>();
  function reportMatch(pos: number, match: string | undefined) {
    if (!match) return;
    const line = file.getLineAndCharacterOfPosition(pos).line + 1;
    violations.push(`${path}:${line}: ${match}`);
  }
  function inspectComment(range: ts.CommentRange) {
    if (seenComments.has(range.pos)) return;
    seenComments.add(range.pos);
    reportMatch(range.pos, findProseMention(source.slice(range.pos, range.end)));
  }
  function inspect(node: ts.Node) {
    ts.getLeadingCommentRanges(source, node.getFullStart())?.forEach(inspectComment);
    ts.getTrailingCommentRanges(source, node.getEnd())?.forEach(inspectComment);
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) {
      const isAdapterLogCategory =
        path === adapterFile &&
        node.text === "bank-feeds" &&
        ts.isCallExpression(node.parent) &&
        ts.isIdentifier(node.parent.expression) &&
        node.parent.expression.text === "createLogger";
      const isLegacyRouteSegment =
        path === appSectionsFile &&
        node.text === "bank-feeds" &&
        ts.isArrayLiteralExpression(node.parent) &&
        ts.isNewExpression(node.parent.parent) &&
        ts.isIdentifier(node.parent.parent.expression) &&
        node.parent.parent.expression.text === "Set";
      if (!isAdapterLogCategory && !isLegacyRouteSegment) {
        reportMatch(node.getStart(file), findPublicBankingMention(node.text));
      }
    }
    ts.forEachChild(node, inspect);
  }
  inspect(file);
  return violations;
}

function docxToText(data: Buffer): string {
  return Object.entries(unzipSync(data))
    .filter(([path]) =>
      /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(path)
    )
    .flatMap(([, xml]) => {
      const document = new DOMParser().parseFromString(strFromU8(xml), "application/xml");
      return Array.from(document.getElementsByTagNameNS(wordNamespace, "p"), (para) =>
        Array.from(para.getElementsByTagNameNS(wordNamespace, "t"), (run) => run.textContent).join(
          ""
        )
      );
    })
    .join("\n");
}

describe("CSV banking wording in the repository", () => {
  it.each([
    [
      ["Only 7 of 267 UAE banks are ", "reachable through ", "any aggregator", "."],
      ["reachable through ", "any aggregator"],
    ],
    [
      ["Bank transaction imports | ", "Yodlee", " + ", "Wio", " |"],
      ["Yodlee", " + ", "Wio"],
    ],
    [
      ["Historical banking plan: ", "bank-data", " access", " through aggregators."],
      ["bank-data", " access"],
    ],
    [
      ["Access ", "bank data ", "via regional ", "aggregators."],
      ["Access ", "bank data ", "via regional ", "aggregators"],
    ],
    [
      ["| Settings / Connections | ", "Bank", " connections", ", team management |"],
      ["Bank", " connections"],
    ],
  ])("rejects archived banking descriptions %j", (parts, expected) => {
    expect(findProseMention(parts.join(""))).toBe(expected.join(""));
  });

  it("checks comment prose without rejecting route names and event IDs", () => {
    const route = "/api/bank-connections/:id/sync";
    const label = ["Bank", "Syncing"].join(" ");
    const shortLabel = ["bank", "sync"].join(" ");
    const inArabic = ["مزامنة", "البنك"].join(" ");
    const source = [
      `/** ${label} is ready. */`,
      `const route = "${route}"; // ${inArabic}`,
      "// Legacy /bank-feeds/callback and bank.sync_failed remain internal identifiers.",
      `// Scheduled ${shortLabel} here.`,
    ].join("\n");
    expect(operatorCopyViolations(adapterFile, source)).toEqual([
      `${adapterFile}:1: ${label}`,
      `${adapterFile}:2: ${inArabic}`,
      `${adapterFile}:4: ${shortLabel}`,
    ]);
  });

  it("allows literal compatibility references and catches nearby prose and operator messages", () => {
    const references =
      "`/bank-feeds/callback`, `/api/bank-connections/:id/sync`, `bank_feed_lean`, and `open-banking.service.ts`.";
    const label = ["bank", "feeds"].join(" ");
    const lineWrappedLabel = ["Bank", "feeds"].join("\n");
    const legacyConnection = ["الخدمات", "المصرفية", "المفتوحة"].join(" ");
    const legacyImport = ["automatically", "import", "bank", "transactions"].join(" ");
    const oldChecklist = ["Connect", "invoice", "and", "bank", "refreshes"].join(" ");
    const oldArabicChecklist = ["ارْبِط", "تَحديثات", "الفواتير", "والبنْك"].join(" ");
    const legacyTitle = ["bank", "feed", "sync", "failed"].join(" ");
    const liveLabel = ["live", "feeds"].join(" ");
    expect(findProseMention(references)).toBeUndefined();
    const formattedLabel = ["bank", "**feeds**"].join(" ");
    expect(findProseMention(`${references}\nWe do not offer ${formattedLabel}.`)).toBe(label);
    expect(findJsonProseMention(JSON.stringify({ bodyText: lineWrappedLabel }))).toBe(
      lineWrappedLabel
    );
    expect(findProseMention(`تقرير مقارن عن ${legacyConnection}.`)).toBe(legacyConnection);
    expect(findProseMention(`QuickBooks can ${legacyImport}.`)).toBe(legacyImport);
    expect(findJsonProseMention(JSON.stringify({ bodyText: `${oldChecklist}.` }))).toBe(
      oldChecklist
    );
    expect(findProseMention(`${oldArabicChecklist}.`)).toBe(
      ["اربط", "تحديثات", "الفواتير", "والبنك"].join(" ")
    );
    expect(findProseMention("Review invoices and upload a CSV bank statement")).toBeUndefined();
    expect(findProseMention("راجع الفواتير وارفع كشف حساب بنكي بصيغة CSV")).toBeUndefined();

    const technicalCode = `createLogger("bank-feeds"); /^${legacyTitle}$/i.test(legacyTitle);`;
    expect(operatorCopyViolations(adapterFile, technicalCode)).toEqual([]);
    const oldCopy = `log.warn("Scheduled ${legacyTitle}");`;
    expect(operatorCopyViolations(adapterFile, `${technicalCode}\n${oldCopy}`)).toEqual([
      `${adapterFile}:2: ${["bank", "feed"].join(" ")}`,
    ]);
    const hyphenatedLabel = ["bank", "feeds"].join("-");
    expect(operatorCopyViolations(adapterFile, `const label = "${hyphenatedLabel}";`)).toEqual([
      `${adapterFile}:1: ${hyphenatedLabel}`,
    ]);
    expect(
      operatorCopyViolations(appSectionsFile, 'const sections = new Set(["bank-feeds"]);')
    ).toEqual([]);
    expect(operatorCopyViolations("client/src/Example.tsx", `<p>No ${liveLabel}.</p>`)).toEqual([
      `client/src/Example.tsx:1: ${liveLabel}`,
    ]);
  });

  it("checks SQL comments and preserves exact historical rehearsal fixtures", () => {
    const legacyLabel = ["bank", "feed"].join("-");
    expect(findSqlCommentMention(`-- OAuth state for ${legacyLabel} connect`)).toBe(legacyLabel);
    const legacyWrappedLabel = ["bank", "feeds"].join("\n");
    expect(findSqlCommentMention(`-- Check ${legacyWrappedLabel.replace("\n", "\n-- ")}`)).toBe(
      legacyWrappedLabel
    );
    const legacyLog = ["Bank", "connection", "deleted"].join(" ");
    expect(findSqlCommentMention(`/* ${legacyLog} */`)).toBe(legacyLog);
    expect(findSqlCommentMention("-- OAuth state table bank_feed_oauth_states")).toBeUndefined();

    for (const [path, digest] of Object.entries(historicalSqlDigests)) {
      const hash = createHash("sha256")
        .update(gunzipSync(readFileSync(path + ".gz")))
        .digest("hex");
      expect(hash, path).toBe(digest);
    }
    const violations = filesIn(".", ".sql").flatMap((path) => {
      if (Object.hasOwn(historicalSqlDigests, path)) return [];
      const match = findSqlCommentMention(readFileSync(path, "utf8"));
      return match ? [`${path}: ${match}`] : [];
    });
    expect(violations).toEqual([]);
  });

  it("keeps repository prose, translation catalogs and operator copy aligned", () => {
    const prosePaths = [
      // The marketing rebuild brief and audit quote the banned phrases in order to forbid them.
      ...filesIn(".", ".md").filter(
        (file) => !file.replaceAll("\\", "/").startsWith("docs/site-rebuild/")
      ),
      ...readdirSync(".", { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".txt"))
        .map((entry) => entry.name),
      ...filesIn("client/src/locales", ".json"),
      ...filesIn("docs/qa", ".json"),
      ".env.example",
    ];
    const proseViolations = prosePaths.flatMap((path) => {
      const copy = readFileSync(path, "utf8");
      const match = path.endsWith(".json") ? findJsonProseMention(copy) : findProseMention(copy);
      return match ? [`${path}: ${match}`] : [];
    });
    const operatorViolations = [
      ...filesIn("server", ".ts"),
      ...filesIn("shared", ".ts"),
      ...filesIn("client/src", ".ts"),
      ...filesIn("client/src", ".tsx"),
      "tests/e2e/benchmark-audit.mjs",
      "docs/archive/teardown-evidence/harness.mjs",
    ].flatMap((path) => operatorCopyViolations(path, readFileSync(path, "utf8")));
    expect([...proseViolations, ...operatorViolations]).toEqual([]);
  });

  it("keeps readable PDF and DOCX text aligned with the CSV workflow", async () => {
    const files = [...filesIn(".", ".pdf"), ...filesIn(".", ".docx")];
    const copies = await Promise.all(
      files.map((path) => {
        const data = readFileSync(path);
        return path.endsWith(".pdf") ? pdfToText(data) : docxToText(data);
      })
    );
    const violations = files.flatMap((path, i) => {
      expect(copies[i].trim(), `${path} must expose text for the guard`).not.toBe("");
      const match = findProseMention(copies[i]);
      return match ? [`${path}: ${match}`] : [];
    });
    expect(violations).toEqual([]);
  });
});
