// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PricingPage } from "../../client/src/components/marketing/phase/pages/PricingPage";
import { SignupPlanStep } from "../../client/src/components/auth/SignupPlanStep";
import { formatMoneyText } from "../../client/src/lib/format-money";
import { loadNamespaces, t, useI18n } from "../../client/src/lib/i18n";
import { BANK_RECONCILIATION_COPY } from "../../shared/bank-reconciliation-copy";
import { PAID_PLAN_IDS, PLAN_CURRENCY, TOP_PLAN_ID, planPrice } from "../../shared/plans";
import { TRIAL_DAYS } from "../../shared/trial";
import { findBankFeedMention } from "../e2e/lib/bank-feed-claims.mjs";

const repoRoot = resolve(__dirname, "../..");
const locales = ["en", "ar"] as const;
const removedPlatform = /\b(?:zatca|fatoora)\b|زاتكا|هيئة الزكاة/iu;
const saudi = /\b(?:saudi|ksa|sar|riyadh)\b|السعودي|الرياض/iu;
const bank =
  /\b(?:plaid|wio|(?:live|automatic|direct)[\s-]+(?:bank(?:[\s-]+account)?[\s-]+(?:sync\w*|connections?)|transaction[\s-]+imports?)|(?:connect|link|sync)\s+(?:(?:a|the|your)\s+)?bank accounts?)\b|بلايد|ويو(?!\p{L})|البنوك المفتوحة|(?:اتصال|ربط) مباشر بالبنك/iu;
const provider =
  /\b(?:a[\s\p{Pd}._]*cube|bee[\s\p{Pd}._]*aura|complyance|avalara|pagero|tradeshift|sovos|comarch|peppyrus|storecove|edicom|cleartax|unimaze)\b|كيوب|كو?مبل[اآ]?ي?[اآ]?ن[سز]|بي[\s\p{Pd}]*[اأإآ]?ورا|بيئورا|أفالارا|باغيرو|تريدشفت|سوفوس|كومارك|بيبيروس|ستوركوف/iu;

// Owner-approved Company Settings and Admin options. Exempt only these catalog entries,
// and only while they are unused by public code.
const countryAndCurrencyOptions = new Map<string, readonly string[]>([
  ["client/src/locales/en/adminConsole.json", ["adminConsole.curSAR"]],
  ["client/src/locales/ar/adminConsole.json", ["adminConsole.curSAR"]],
  ...locales.map(
    (locale) =>
      [
        `client/src/locales/${locale}/pageLabels.json`,
        [
          "pageLabels.sARSaudiRiyal",
          "pageLabels.companySettings.currency.SAR",
          "pageLabels.companySettings.country.SA",
        ],
      ] as const
  ),
]);

// Provider names are permitted in the private Settings cards and their catalogs, and in
// server implementation. Public catalog references into Settings are still checked.
const providerSettingsFiles = new Set([
  "client/src/components/einvoice/AcubeConnectCard.tsx",
  "client/src/components/einvoice/ComplyanceConnectCard.tsx",
  "client/src/components/einvoice/EInvoicePartnerCard.tsx",
  "client/src/components/einvoice/EInvoiceProviderCard.tsx",
  "client/src/components/einvoice/EInvoicingPartnerCard.tsx",
  "client/src/components/einvoice/ProviderCardParts.tsx",
  "client/src/locales/en/einvoicing.json",
  "client/src/locales/ar/einvoicing.json",
]);

const publicPages =
  /(?:pricing|compar(?:e|ison)|landing|register|login|sign(?:up|in)\w*|customeronboarding|forgotpassword|resetpassword|services|trustsecurity|helpcenter|migrationguides|demoworkspace|privacypolicy|termsofservice|cookiepolicy|publicnotfound)\.tsx?$/i;
const publicCatalogs =
  /^client\/src\/locales\/(en|ar)\/(?:marketing[^/]*|pricing|compare|landing|register|login|signup|onboarding|pages)\.json$/;

function* filesIn(directory: string): Generator<string> {
  for (const entry of readdirSync(join(repoRoot, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) yield* filesIn(path);
    if (entry.isFile()) yield path;
  }
}

type Copy = { file: string; location: string; value: string; public: boolean };

function* catalogStrings(value: unknown, key = ""): Generator<[string, string]> {
  if (typeof value === "string") {
    yield [key, value];
  } else if (value && typeof value === "object") {
    for (const [child, entry] of Object.entries(value)) {
      yield* catalogStrings(entry, key ? `${key}.${child}` : child);
    }
  }
}

function sourceCopy(file: string, text: string, isPublic: boolean): Copy[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
  const entries: Copy[] = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateLiteralToken(node)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      entries.push({ file, location: String(line), value: node.text, public: isPublic });
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return entries;
}

// Shipped HTML metadata (title and every meta content) is customer-visible in search results
// and link previews, so it is scanned like any other public copy. DOMParser comes from jsdom.
function htmlCopy(file: string, html: string): Copy[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const entries: Copy[] = [];
  const title = doc.querySelector("title")?.textContent;
  if (title) entries.push({ file, location: "title", value: title, public: true });
  for (const meta of Array.from(doc.querySelectorAll("meta[content]"))) {
    const name = meta.getAttribute("name") ?? meta.getAttribute("property") ?? "meta";
    entries.push({
      file,
      location: `meta[${name}]`,
      value: meta.getAttribute("content") ?? "",
      public: true,
    });
  }
  return entries;
}

// Public code can reach a catalog entry with a computed key, e.g.
// t[`pageLabels.companySettings.currency.${code}`] or prefix + code. Local consts are resolved
// in their lexical scope. Templates/concatenations in public files become patterns (parts only known at run
// time match anything) and each catalog location it could match counts as publicly used. Only
// expressions that start with a static dotted prefix count; conditionals and imports are not followed.
type KeyPart = string | null; // null = a value only known at run time

function keyParts(node: ts.Node, checker: ts.TypeChecker, seen = new Set<ts.Node>()): KeyPart[] {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return keyParts(node.expression, checker, seen);
  }
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isIdentifier(node)) {
    const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      declaration.parent.flags & ts.NodeFlags.Const &&
      !seen.has(declaration)
    ) {
      seen.add(declaration);
      const parts = keyParts(declaration.initializer, checker, seen);
      seen.delete(declaration);
      return parts;
    }
  }
  if (ts.isTemplateExpression(node)) {
    return [
      node.head.text,
      ...node.templateSpans.flatMap((span) => [
        ...keyParts(span.expression, checker, seen),
        span.literal.text,
      ]),
    ];
  }
  if (isPlus(node)) {
    return [...keyParts(node.left, checker, seen), ...keyParts(node.right, checker, seen)];
  }
  return [null];
}

const isPlus = (node: ts.Node): node is ts.BinaryExpression =>
  ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken;

function computedKeyPatterns(file: string, text: string): RegExp[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [] };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => (name === file ? source : undefined);
  const checker = ts.createProgram([file], options, host).getTypeChecker();
  const bodies = new Set<string>();

  function visit(node: ts.Node) {
    // Outermost expression only: a nested part would give a looser prefix pattern.
    if ((ts.isTemplateExpression(node) || isPlus(node)) && !isPlus(node.parent)) {
      const parts = keyParts(node, checker);
      const wildcard = parts.indexOf(null);
      const prefix = (wildcard < 0 ? parts : parts.slice(0, wildcard)).join("");
      if (prefix.length >= 6 && prefix.includes(".")) {
        bodies.add(
          parts
            .map((part) => (part === null ? ".*" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
            .join("")
        );
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return [...bodies].map((body) => new RegExp(`^${body}$`, "su"));
}

function markPublic(copy: Copy[], publicKeys: ReadonlySet<string>, patterns: readonly RegExp[]) {
  for (const entry of copy) {
    entry.public ||=
      publicKeys.has(entry.location) || patterns.some((pattern) => pattern.test(entry.location));
  }
}

function readCopy(): Copy[] {
  const source: Copy[] = [];
  const catalogs: Copy[] = [];
  const patterns: RegExp[] = [];
  const html = htmlCopy(
    "client/index.html",
    readFileSync(join(repoRoot, "client/index.html"), "utf8")
  );
  for (const directory of ["client/src", "shared", "server"]) {
    for (const file of filesIn(directory)) {
      if (/\.(?:test|spec)\.[^.]+$/.test(file)) continue;
      if (file.endsWith(".json")) {
        const data: unknown = JSON.parse(readFileSync(join(repoRoot, file), "utf8"));
        for (const [location, value] of catalogStrings(data)) {
          catalogs.push({ file, location, value, public: publicCatalogs.test(file) });
        }
      } else if (/\.[cm]?[jt]sx?$/.test(file)) {
        const isPublic =
          /^client\/src\/(?:components\/(?:marketing|auth)|pages\/legal)\//.test(file) ||
          (file.startsWith("client/src/pages/") && publicPages.test(file.split("/").at(-1)!)) ||
          file === "client/src/PublicApp.tsx" ||
          /^shared\/marketing-[^/]+\.ts$/.test(file);
        const text = readFileSync(join(repoRoot, file), "utf8");
        // Non-public code only needs the removed-platform scan. Skip parsing unrelated files.
        if (isPublic || removedPlatform.test(normalized(text)) || /\\[ux]/.test(text)) {
          source.push(...sourceCopy(file, text, isPublic));
        }
        if (isPublic) patterns.push(...computedKeyPatterns(file, text));
      }
    }
  }

  const publicKeys = new Set(source.filter((copy) => copy.public).map((copy) => copy.value));
  markPublic(catalogs, publicKeys, patterns);
  return [...html, ...source, ...catalogs];
}

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\u0640|[\u064b-\u065f]|\u0670|[\u00ad\u200b-\u200d\u2060]/gu, "")
    .trim();
}

function saudiViolation(value: string, { public: isPublic, file, location }: Copy): boolean {
  const isOption = countryAndCurrencyOptions.get(file)?.includes(location);
  return (isPublic || (countryAndCurrencyOptions.has(file) && !isOption)) && saudi.test(value);
}

// Bank statement import is CSV only. Include adjacent clauses that continue the format claim,
// while keeping unrelated subjects such as Document Vault report packs out of the scan.
const competingBankFormat =
  /\b(?:excel|xlsx?|ofx|qif|mt940|camt\.?\d*|pdf)\b|\.xlsx?\b|[إا]كس[يـ]?ل/iu;
const formatSubject = /^(?:also[,،]?\s+|و|كما\s+)?(?:ملفات |صيغة )?\.?$/iu;
const formatSupport =
  /^\s*(?:(?:files?|formats?)\s+)?(?:is |are |can be )?(?:also )?(?:accepted|supported|allowed|imported|uploaded)(?: too| as well| here| for this import)?$|^\s*(?:[اأ]يضا\s+)?(?:مقبول[ة]?|مدعوم[ة]?|متاح[ة]?)(?:\s+[اأ]يضا)?$/iu;
const supportAction =
  /^(?:(?:we |you |it )?(?:can )?(?:also )?(?:accept|support|allow|upload|import)\w*\s+(?:also\s+)?|(?:و|كما\s+)?(?:نقبل|ندعم|يقبل|يدعم|يمكنك (?:رفع|استيراد)|تقبل|تدعم|يتم قبول)\s+(?:[اأ]يضا\s+)?(?:ملفات |صيغة )?)$/iu;
const formatObject = /^(?: (?:files?|formats?))?(?: too| as well| [اأ]يضا)?$/iu;
const uploadWithFormat =
  /^(?:we |you |it )?(?:can )?(?:also )?(?:upload|import) (?:them|it) (?:as|in) $/i;
const csvFormat = /\bcsv\b/i;
const bankMention = /\bbank|بنك|مصرف/iu;
const statementMention = /\bstatements?\b|كشف/iu;
const importAction =
  /\b(?:upload\w*|import\w*|load\w*|export\w*|reconcil\w*|match\w*)\b|ارفع|رفع|استيراد|استورد|تحميل|يحمل|مصدر|طابق|مطابق|تسوية/iu;

function clauses(value: string): string[] {
  return normalized(value)
    .split(/[.;:!?؟]+(?=\s|$)|\n+/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

/** Generic public scan: a bank import clause may not name a competing format. */
function competingBankFormats(
  value: string,
  isBankImport = (clause: string) =>
    (bankMention.test(clause) || (statementMention.test(clause) && csvFormat.test(clause))) &&
    importAction.test(clause)
): string[] {
  let inBankImport = false;
  return clauses(value).filter((clause) => {
    const format = competingBankFormat.exec(clause);
    const before = format ? clause.slice(0, format.index) : "";
    const after = format ? clause.slice(format.index + format[0].length) : "";
    const continuesFormatClaim =
      ((supportAction.test(before) || uploadWithFormat.test(before)) && formatObject.test(after)) ||
      (formatSubject.test(before) && formatSupport.test(after));
    inBankImport =
      isBankImport(clause) || (inBankImport && format !== null && continuesFormatClaim);
    return inBankImport && format !== null;
  });
}

/** Known bank-import copy: must say CSV about the bank statement and nothing else. */
function bankImportProblems(value: string): string[] {
  const aboutBankStatement = (clause: string) =>
    bankMention.test(clause) || statementMention.test(clause);
  const about = clauses(value).filter(aboutBankStatement);
  const problems: string[] = [];
  if (!about.length) problems.push("no clause about the bank statement");
  else if (!about.some((clause) => csvFormat.test(clause))) problems.push("bank clause lacks CSV");
  for (const clause of competingBankFormats(value, aboutBankStatement)) {
    problems.push(`competing format: ${clause}`);
  }
  return problems;
}

// Every public bank-import surface, in both locales. Inline public copy is covered by the generic
// competing-format scan over all public entries below.
const bankImportKeys = {
  "client/src/locales/%/marketing.json": [
    "marketing.bankBody",
    "marketing.faq3A",
    "marketing.helpGuide4Body",
    "marketing.prEveryBankBody",
    "marketing.demoCheck4",
    "marketing.demoBankTitle",
    "marketing.migrationFilesBody",
  ],
  "client/src/locales/%/marketingHome.json": [
    "marketing.hxShowBankLead",
    "marketing.hxShowBankB1",
    "marketing.hxTourBlurb3",
  ],
} as const;

describe("launch copy rules", () => {
  let copy: Copy[];
  beforeAll(() => {
    // Inspect shipped strings as well as rendered copy so dormant catalog entries, metadata,
    // and copy behind interactive states or API calls are covered.
    copy = readCopy();
  }, 120_000);

  it("omits retired invoicing platforms from client, shared, and server copy", () => {
    expect(matches(copy, (value) => removedPlatform.test(value))).toEqual([]);
  });

  it("scans the shipped HTML metadata", () => {
    const html = copy.filter((entry) => entry.file === "client/index.html");
    expect(html.map((entry) => entry.location)).toEqual(
      expect.arrayContaining(["title", "meta[description]", "meta[og:title]"])
    );
    expect(html.every((entry) => entry.value.trim() !== "")).toBe(true);
  });

  it("keeps public marketing focused on the UAE", () => {
    expect(matches(copy, saudiViolation)).toEqual([]);
  });

  it("describes banking using CSV import terminology", () => {
    expect(
      matches(
        copy,
        (value, entry) => entry.public && (bank.test(value) || !!findBankFeedMention(value))
      )
    ).toEqual([]);
  });

  it("names CSV as the only bank statement format on public surfaces", () => {
    expect(
      matches(copy, (value, entry) => entry.public && competingBankFormats(value).length > 0)
    ).toEqual([]);
    for (const locale of locales) {
      const surfaces = Object.entries(bankImportKeys).flatMap(([pattern, keys]) =>
        keys.map((key) => ({ file: pattern.replace("%", locale), key }))
      );
      for (const { file, key } of surfaces) {
        const entry = copy.find((item) => item.file === file && item.location === key);
        expect(entry, `${file} ${key} is missing`).toBeDefined();
        expect(bankImportProblems(entry?.value ?? ""), `${file} ${key}`).toEqual([]);
      }
      expect(bankImportProblems(BANK_RECONCILIATION_COPY[locale]), locale).toEqual([]);
      expect(competingBankFormats(BANK_RECONCILIATION_COPY[locale]), locale).toEqual([]);
    }
  });

  it("keeps provider brands off public pages", () => {
    expect(
      matches(copy, (value, { public: isPublic, file }) => {
        const privateProviderCopy = file.startsWith("server/") || providerSettingsFiles.has(file);
        return (
          (isPublic || (!privateProviderCopy && file.startsWith("client/src/locales/"))) &&
          provider.test(value)
        );
      })
    ).toEqual([]);
  });
});

describe("launch copy guard regressions", () => {
  it("scans title and meta content in shipped HTML", () => {
    const entries = htmlCopy(
      "x.html",
      `<html><head><title>Zatca ready books</title>
       <meta name="description" content="Connect your bank account today" />
       <meta property="og:title" content="Accounting for Riyadh" /></head></html>`
    );
    expect(matches(entries, (value) => removedPlatform.test(value))).toHaveLength(1);
    expect(matches(entries, saudiViolation)).toHaveLength(1);
    expect(matches(entries, (value) => bank.test(value))).toHaveLength(1);
  });

  it("finds catalog entries reached through computed keys", () => {
    const entry = (location: string): Copy => ({
      file: "client/src/locales/en/pageLabels.json",
      location,
      value: "SAR Saudi Riyal",
      public: false,
    });
    const sources: [string, string][] = [
      ["template.tsx", "const x = t[`pageLabels.companySettings.${kind}.${code}`];"],
      ["concat.tsx", 'const x = t[("pageLabels.companySettings.currency." + code) as K];'],
      ["alias.tsx", 'const key = "pageLabels.companySettings." + "currency." + code; t[key];'],
      ["prefix.tsx", 'const prefix = "pageLabels.companySettings.currency."; t[prefix + code];'],
      [
        "template-prefix.tsx",
        'const prefix = "pageLabels.companySettings."; const base = prefix; t[`${base}currency.${code}`];',
      ],
      ["static.tsx", 't["pageLabels.companySettings." + "currency.SAR"];'],
    ];
    for (const [file, text] of sources) {
      const copy = [
        entry("pageLabels.companySettings.currency.SAR"),
        entry("pageLabels.companySettings.country.SA"),
        entry("pageLabels.other.thing"),
      ];
      markPublic(copy, new Set(), computedKeyPatterns(file, text));
      const flagged = matches(copy, saudiViolation).map((line) => line.split(" ")[0]);
      expect(flagged, file).toContain(
        "client/src/locales/en/pageLabels.json:pageLabels.companySettings.currency.SAR"
      );
      expect(copy[1].public, file).toBe(file === "template.tsx");
      expect(copy[2].public, file).toBe(false);
    }
    // Wholly dynamic keys carry no information, so they must not mark everything public.
    expect(computedKeyPatterns("f.tsx", "const x = t[`${a}${b}`]; f(a + b);")).toEqual([]);
    expect(
      computedKeyPatterns(
        "shadowed.tsx",
        'const prefix = "pageLabels.companySettings.currency."; function label(prefix: string) { return t[prefix + code]; }'
      )
    ).toEqual([]);
    // Private use of the allow-listed entry stays allowed.
    const privateCopy = [entry("pageLabels.companySettings.currency.SAR")];
    markPublic(
      privateCopy,
      new Set(),
      computedKeyPatterns("g.tsx", "const x = t[`ledger.${code}`];")
    );
    expect(matches(privateCopy, saudiViolation)).toEqual([]);
  });

  it("requires CSV, and no other format, in the bank statement sentence", () => {
    const good = [
      BANK_RECONCILIATION_COPY.en,
      BANK_RECONCILIATION_COPY.ar,
      "CSV statement import",
      // Excel appears in a different sentence about the Document Vault.
      "Bank reconciliation supports CSV formats from Emirates NBD. Report packs from Excel go in Document Vault.",
      "وتدعم التسوية البنكية صيغ CSV من بنك الإمارات. أما حزم التقارير من Excel فتحفظ في خزنة المستندات.",
      "Upload bank statements as CSV. Excel is also accepted in Document Vault.",
      "Upload bank statements as CSV. You can also upload report packs as Excel in Document Vault.",
    ];
    for (const value of good) {
      expect(bankImportProblems(value), value).toEqual([]);
      expect(competingBankFormats(value), value).toEqual([]);
    }
    const bad = [
      "Upload an Excel statement exported from your bank.",
      "Upload a CSV or Excel statement exported from your bank.",
      "Upload your bank statement as .xlsx",
      "Reconcile a bank statement PDF.",
      "ارفع كشف حساب بنكي بصيغة Excel",
      "ارفع كشف حساب بنكي بصيغة CSV أو إكسل",
      "Upload bank statements as CSV. Excel is also accepted.",
      "Upload bank statements as CSV. Excel is accepted for this import.",
      "Upload bank statements as CSV. We also accept Excel files.",
      "Upload bank statements as CSV. You can also upload them as Excel.",
      "CSV statement import. Excel files are supported too.",
      "ارفع كشف حساب بنكي بصيغة CSV. ملفات إكسل مقبولة أيضًا.",
      "ارفع كشف حساب بنكي بصيغة CSV. كما نقبل ملفات Excel.",
    ];
    for (const value of bad) {
      expect(bankImportProblems(value), value).not.toEqual([]);
      expect(competingBankFormats(value), value).not.toEqual([]);
    }
    expect(bankImportProblems("Upload a statement exported from your bank.")).toEqual([
      "bank clause lacks CSV",
    ]);
  });

  it("accepts only the affirmative 14-day Enterprise no-card offer", () => {
    const accepted: [string, (typeof locales)[number]][] = [
      ["Every new account starts on Enterprise free for 14 days. No card.", "en"],
      ["No. Start a 14-day free trial of the Enterprise plan without entering card details.", "en"],
      ["Yes, 14 days of Enterprise, no card", "en"],
      ["Get 14 days of every feature, free, with an Enterprise trial. No card needed.", "en"],
      ["كل حساب جديد يبدأ بباقة المؤسسات مجانًا لمدة 14 يومًا، دون بطاقة.", "ar"],
      ["لا. ابدأ تجربة مجانية لباقة المؤسسات لمدة 14 يومًا دون إدخال بيانات البطاقة.", "ar"],
      ["نعم، 14 يومًا من باقة المؤسسات دون بطاقة", "ar"],
    ];
    for (const [value, locale] of accepted) {
      expect(trialViolations(value, locale), value).toEqual([]);
    }
    const rejected: [string, (typeof locales)[number]][] = [
      ["The 14-day Enterprise trial is no longer available without a card.", "en"],
      ["The 14-day Enterprise trial is not available without a card.", "en"],
      ["Start a 14-day Enterprise trial. A card is required.", "en"],
      ["Start your Enterprise trial without a card.", "en"],
      ["Start a 14-day Enterprise trial. Pay by card. No.", "en"],
      ["Start using Enterprise for AED 229 every 14 days. No card needed.", "en"],
      [
        "Start using Enterprise for AED 229 every 14 days and get free support. No card needed.",
        "en",
      ],
      ["Start a 14-day Enterprise trial. No card needed. A card is required to activate it.", "en"],
      ["Start a 14-day Enterprise trial without a card, but you must enter card details.", "en"],
      ["لم تعد تجربة باقة المؤسسات لمدة 14 يومًا متاحة دون بطاقة.", "ar"],
      ["تجربة مجانية لباقة المؤسسات لمدة 14 يومًا دون بطاقة.", "ar"],
      ["ابدأ تجربة لمدة 14 يومًا دون بطاقة.", "ar"],
      ["ابدأ استخدام باقة المؤسسات مقابل 229 درهمًا كل 14 يومًا دون بطاقة.", "ar"],
      ["ابدأ تجربة باقة المؤسسات لمدة 14 يومًا دون بطاقة. يلزم إدخال بطاقة لتفعيلها.", "ar"],
      ["ابدأ تجربة باقة المؤسسات لمدة 14 يومًا دون بطاقة. بطاقة الدفع مطلوبة للتفعيل.", "ar"],
    ];
    for (const [value, locale] of rejected) {
      expect(trialViolations(value, locale), value).not.toEqual([]);
    }
    expect(
      trialViolations(
        "Start a 14-day Enterprise trial. No card needed. To activate it, you must enter your card details.",
        "en"
      )
    ).toEqual(["requires a card"]);
  });
});

function matches(copy: Copy[], violates: (value: string, entry: Copy) => boolean): string[] {
  return copy
    .filter((entry) => violates(normalized(entry.value), entry))
    .map(({ file, location, value }) => `${file}:${location} ${value.trim()}`);
}

const monthlyPrices = { starter: 59, professional: 119, enterprise: 229 } as const;
const planIds = Object.keys(monthlyPrices) as (keyof typeof monthlyPrices)[];
const wording = {
  en: {
    money: (price: number) => `AED${price}per month`,
    perMonth: "a month",
    badge: /^e[-\s]invoicing included$/i,
    feature: /^e[-\s]invoicing\b/i,
    included: /^included$/i,
    plan: /\benterprise\b/i,
    days: /\b14[-\s]+days?\b/i,
    card: /\b(?:no (?:credit |payment )?card|without (?:(?:needing|entering|using|providing) )?(?:an? )?(?:credit |payment )?card(?: details)?)\b/i,
    cardOnly: /^no (?:credit |payment )?card(?: (?:is )?(?:needed|required))?$/i,
    bare: /^no$/i,
    offer: /\b(?:start(?:s|ed)?|get|gets|try|begin|yes)\b/i,
    trial: /\btrial\b|\b(?:free|at no cost) for 14 days\b|\b14 days (?:free|at no cost)\b/i,
    comparisonOffer: /^yes,?\s+14 days of enterprise(?:,|$)/i,
    cardRequired:
      /\b(?:cards?(?: details)? (?:is |are )?(?:required|needed|mandatory)|(?:require[sd]?|needing|needs?|must (?:have|enter|add|provide|use)|pay (?:by|with)) (?:(?:an?|the|your) )?(?:(?:credit|debit|payment) )?cards?)\b/i,
    negation:
      /\b(?:no longer|not (?:be )?(?:available|offered|included|possible)|unavailable|isn'?t|aren'?t|cannot|can'?t|ended|expired|discontinued|withdrawn)\b/i,
  },
  ar: {
    money: (price: number) => `${price}د.إشهريًا`,
    perMonth: "شهريًا",
    badge: /^الفوترة الالكترونية مشمولة$/u,
    feature: /^الفوترة الالكترونية/u,
    included: /^مشمول$/u,
    plan: /باقة المؤسسات/u,
    days: /(?<!\p{Nd})(?:14|١٤) يوما/u,
    card: /(?:دون|بدون) (?:(?:الحاجة الى|ادخال|استخدام|استعمال)(?: بيانات)? )?(?:ال)?بطاقة/u,
    cardOnly: /^(?:دون|بدون) (?:ال)?بطاقة$/u,
    bare: /^لا$/u,
    offer: /(?<!\p{L})(?:ابدا|يبدا|جرب|نعم|احصل)/u,
    trial: /تجربة|(?:مجانا|بلا تكلفة) لمدة (?:14|١٤) يوما|(?:14|١٤) يوما (?:مجانا|بلا تكلفة)/u,
    comparisonOffer: /^نعم[،,]?\s+(?:14|١٤) يوما من باقة المؤسسات(?:[،,]|\s+دون |$)/u,
    cardRequired:
      /(?:يلزم|يجب|يتطلب|تتطلب|مطلوب)\s+(?:(?:عليك|توفر|وجود|ادخال|اضافة|تقديم|استخدام|بيانات)\s+)*(?:ال)?بطاقة|(?:ال)?بطاقة(?: (?:الدفع|ائتمان|الائتمان))? (?:مطلوبة|الزامية|ضرورية)|ادفع (?:ببطاقة|بالبطاقة)/u,
    negation:
      /(?<!\p{L})(?:لم (?:يعد|تعد)|لا (?:يتوفر|تتوفر|يمكن|تتاح|يتاح)|غير (?:متاح|متوفر)|لن |ليس|انتهت|منتهي|ملغ|متوقف)/u,
  },
};

/**
 * Require an affirmative trial, free period, or explicit comparison answer. Keep the no-card
 * wording with the offer and check every clause for contradictory requirements.
 */
function trialViolations(
  value: string | null | undefined,
  locale: (typeof locales)[number]
): string[] {
  const rules = wording[locale];
  const sentences = clauses((value ?? "").normalize("NFKC").replace(/[إأ]/gu, "ا")).filter(
    (sentence) => !rules.bare.test(sentence)
  );
  const at = sentences.findIndex(
    (s) =>
      rules.offer.test(s) &&
      rules.plan.test(s) &&
      rules.days.test(s) &&
      (rules.trial.test(s) || rules.comparisonOffer.test(s))
  );
  if (at < 0) return ["no sentence offers a 14-day Enterprise trial"];
  const problems: string[] = [];
  if (!rules.card.test(sentences[at]) && !rules.cardOnly.test(sentences[at + 1] ?? "")) {
    problems.push("no-card wording is not part of the offer");
  }
  if (sentences.some((s) => rules.negation.test(s))) problems.push("negates the offer");
  const noCard = new RegExp(rules.card.source, `${rules.card.flags}g`);
  if (sentences.some((s) => rules.cardRequired.test(s.replace(noCard, "")))) {
    problems.push("requires a card");
  }
  return problems;
}

function assertTrialCopy(value: string | null | undefined, locale: (typeof locales)[number]) {
  expect(trialViolations(value, locale), value ?? "").toEqual([]);
}

describe("the public pricing and signup offer", () => {
  it("pins the owner-approved currency, monthly prices, and Enterprise trial", () => {
    expect(PLAN_CURRENCY).toBe("AED");
    expect(PAID_PLAN_IDS).toEqual(planIds);
    expect(Object.fromEntries(planIds.map((id) => [id, planPrice(id, "monthly")]))).toEqual(
      monthlyPrices
    );
    expect(TOP_PLAN_ID).toBe("enterprise");
    expect(TRIAL_DAYS).toBe(14);
  });

  it.each(locales)(
    "renders monthly AED prices and the full offer in %s",
    async (locale) => {
      await loadNamespaces(locale, ["marketing", "marketingHome", "marketingMeta"]);
      await import("../../client/src/components/marketing/phase/MonthlyPlans");
      useI18n.setState({ locale });
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const container = document.createElement("div");
      const root = createRoot(container);
      const expected = wording[locale];
      try {
        await act(async () => {
          root.render(
            createElement(PricingPage, {
              base: `/${locale}`,
              locale,
              tr: (pair) => pair[locale === "en" ? 0 : 1],
            })
          );
        });
        await vi.waitFor(
          async () => {
            await act(async () => {});
            expect(container.querySelectorAll('[data-testid^="card-plan-"]')).toHaveLength(
              planIds.length
            );
          },
          { timeout: 5_000 }
        );
        for (const id of planIds) {
          const price = planPrice(id, "monthly");
          const card = container.querySelector(`[data-testid="card-plan-${id}"] .mk-tier__price`);
          expect(card?.textContent, id).toBe(expected.money(price));
          const column = container.querySelector(
            `[data-testid="plan-matrix"] th[data-plan="${id}"] small`
          );
          // Independent of the locale template: the formatted amount plus the pinned suffix.
          const label = `${formatMoneyText(price, "AED", locale, { fractionDigits: 0 })} ${expected.perMonth}`;
          const squash = (value: string) => normalized(value).replace(/\s+/gu, " ");
          expect(squash(column?.textContent ?? ""), id).toBe(squash(label));
          const badge = container.querySelector(`[data-testid="badge-einvoicing-${id}"]`);
          expect(normalized(badge?.textContent ?? "").replace(/[إأ]/gu, "ا"), id).toMatch(
            expected.badge
          );
        }
        const row = container.querySelector('[data-row="marketing.prEveryEinvoiceTitle"]');
        expect(
          normalized(row?.querySelector("th")?.textContent ?? "").replace(/[إأ]/gu, "ا")
        ).toMatch(expected.feature);
        const cells = Array.from(row?.querySelectorAll("td .sr-only") ?? []);
        expect(cells).toHaveLength(planIds.length);
        for (const cell of cells)
          expect(normalized(cell.textContent ?? "")).toMatch(expected.included);
        assertTrialCopy(
          container.querySelector('[data-testid="price-trial-note"]')?.textContent,
          locale
        );

        await act(async () => {
          root.render(
            createElement(SignupPlanStep, {
              planId: "starter",
              cycle: "monthly",
              onPlanChange: vi.fn(),
              onCycleChange: vi.fn(),
              onContinue: vi.fn(),
            })
          );
        });
        assertTrialCopy(
          container.querySelector('[data-testid="signup-plan-step"] header > p:last-child')
            ?.textContent,
          locale
        );
        for (const key of ["signupTrialOffer", "hxCmpTrialMuhasib", "hxFaqCardA"]) {
          assertTrialCopy(t[locale][`marketing.${key}`], locale);
        }
      } finally {
        act(() => root.unmount());
        vi.unstubAllGlobals();
      }
    },
    30_000
  );
});
