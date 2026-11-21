// Source inspection covers archived Markdown and operator messages that the browser cannot render.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { publicBankFeedMentions } from "../e2e/lib/public-banking-copy.mjs";

const ignoredDirectories = new Set(["node_modules", "dist", "coverage", "uploads"]);
const adapterFile = "server/services/bank-feeds/index.ts";
const appSectionsFile = "client/src/components/layout/app-sections.ts";

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

function findBankingMention(copy: string): string | undefined {
  return publicBankFeedMentions.map((pattern) => copy.match(pattern)?.[0]).find(Boolean);
}

function findProseMention(copy: string): string | undefined {
  // The historical adapter filename is a literal technical reference in the archive.
  return findBankingMention(copy.replaceAll("`open-banking.service.ts`", "").replace(/\*/g, ""));
}

function operatorCopyViolations(path: string, source: string): string[] {
  if (!findBankingMention(source)) return [];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  function inspect(node: ts.Node) {
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
        const match = findBankingMention(node.text);
        if (match) {
          const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
          violations.push(`${path}:${line}: ${match}`);
        }
      }
    }
    ts.forEachChild(node, inspect);
  }
  inspect(file);
  return violations;
}

describe("CSV banking wording in the repository", () => {
  it("allows literal compatibility references and catches nearby prose and operator messages", () => {
    const references = "`/bank-feeds/callback`, `bank_feed_lean`, and `open-banking.service.ts`.";
    expect(findProseMention(references)).toBeUndefined();
    expect(findProseMention(`${references}\nWe do not offer bank **feeds**.`)).toBe("bank feeds");
    expect(findProseMention("تقرير مقارن عن الخدمات المصرفية المفتوحة.")).toBe(
      "الخدمات المصرفية المفتوحة"
    );
    expect(
      findProseMention("QuickBooks can automatically import bank transactions.")
    ).toBeUndefined();

    const technicalCode =
      'createLogger("bank-feeds"); /^bank feed sync failed$/i.test(legacyTitle);';
    expect(operatorCopyViolations(adapterFile, technicalCode)).toEqual([]);
    const oldCopy = 'log.warn("Scheduled bank feed sync failed");';
    expect(operatorCopyViolations(adapterFile, `${technicalCode}\n${oldCopy}`)).toEqual([
      `${adapterFile}:2: bank feed`,
    ]);
    expect(operatorCopyViolations(adapterFile, 'const label = "bank-feeds";')).toEqual([
      `${adapterFile}:1: bank-feeds`,
    ]);
    expect(
      operatorCopyViolations(appSectionsFile, 'const sections = new Set(["bank-feeds"]);')
    ).toEqual([]);
    expect(operatorCopyViolations("client/src/Example.tsx", "<p>No live feeds.</p>")).toEqual([
      "client/src/Example.tsx:1: live feeds",
    ]);
  });

  it("keeps repository prose, translation catalogs and operator copy aligned", () => {
    const prosePaths = [
      ...filesIn(".", ".md"),
      ...readdirSync(".", { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".txt"))
        .map((entry) => entry.name),
      ...filesIn("client/src/locales", ".json"),
      ".env.example",
    ];
    const proseViolations = prosePaths.flatMap((path) => {
      const match = findProseMention(readFileSync(path, "utf8"));
      return match ? [`${path}: ${match}`] : [];
    });
    const operatorViolations = [
      ...filesIn("server", ".ts"),
      ...filesIn("shared", ".ts"),
      ...filesIn("client/src", ".ts"),
      ...filesIn("client/src", ".tsx"),
    ].flatMap((path) => operatorCopyViolations(path, readFileSync(path, "utf8")));
    expect([...proseViolations, ...operatorViolations]).toEqual([]);
  });
});
