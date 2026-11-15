/**
 * Three-layer validation of a generated (or inbound) UBL e-invoice:
 *
 *   1. UBL 2.1 XSD           xmllint-wasm against the vendored OASIS schemas
 *   2. PINT AE schematron    saxon-js running the official OpenPeppol PINT AE
 *                            2026.5 rules (pre-compiled SEF)
 *   3. PINT AE rule list     server/services/einvoice/pint-ae-rules.ts
 *
 * Layers 1-2 need the vendored artefacts (tests/fixtures/pint-ae/ or
 * EINVOICE_ARTEFACTS_DIR). When they are missing the result says so —
 * `available: false` — instead of pretending the document passed.
 */
import fs from "node:fs";
import path from "node:path";
import { runPintAeRules, type RuleFinding } from "./pint-ae-rules";

export interface ValidationLayer {
  available: boolean;
  valid: boolean;
  errors: RuleFinding[];
  warnings: RuleFinding[];
}

export interface EInvoiceValidationResult {
  valid: boolean;
  documentType: "Invoice" | "CreditNote" | "unknown";
  xsd: ValidationLayer;
  schematron: ValidationLayer & { version: string | null };
  rules: ValidationLayer;
  checkedAt: string;
}

export const PINT_AE_SCHEMATRON_VERSION = "2026.5";
const SCHEMATRON_FILES = [
  "PINT-UBL-validation-preprocessed.sef.json",
  "PINT-jurisdiction-aligned-rules.sef.json",
];

export function artefactsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.EINVOICE_ARTEFACTS_DIR || path.resolve(process.cwd(), "tests", "fixtures", "pint-ae");
}

function rootName(xml: string): "Invoice" | "CreditNote" | "unknown" {
  const m = /<(?:[A-Za-z0-9_-]+:)?(Invoice|CreditNote)[\s>]/.exec(
    xml.replace(/<\?xml[^>]*\?>/, "")
  );
  return (m?.[1] as "Invoice" | "CreditNote" | undefined) ?? "unknown";
}

// ─── XSD ────────────────────────────────────────────────────────────────

interface XsdBundle {
  main: Record<"Invoice" | "CreditNote", { fileName: string; contents: string }>;
  preload: { fileName: string; contents: string }[];
}
let xsdCache: { dir: string; bundle: XsdBundle | null } | null = null;

function loadXsd(dir: string): XsdBundle | null {
  if (xsdCache && xsdCache.dir === dir) return xsdCache.bundle;
  const base = path.join(dir, "xsd", "ubl-2.1");
  let bundle: XsdBundle | null = null;
  try {
    const common = path.join(base, "common");
    const preload = fs
      .readdirSync(common)
      .filter((f) => f.endsWith(".xsd"))
      .map((f) => ({ fileName: f, contents: fs.readFileSync(path.join(common, f), "utf8") }));
    // The OASIS maindoc schemas import "../common/X.xsd"; the in-memory
    // filesystem is flat, so the relative prefix is dropped.
    const main = (name: string) => ({
      fileName: name,
      contents: fs
        .readFileSync(path.join(base, "maindoc", name), "utf8")
        .replace(/schemaLocation="\.\.\/common\//g, 'schemaLocation="'),
    });
    bundle = {
      main: { Invoice: main("UBL-Invoice-2.1.xsd"), CreditNote: main("UBL-CreditNote-2.1.xsd") },
      preload,
    };
  } catch {
    bundle = null;
  }
  xsdCache = { dir, bundle };
  return bundle;
}

export async function validateUblXsd(
  xml: string,
  dir: string = artefactsDir()
): Promise<ValidationLayer> {
  const bundle = loadXsd(dir);
  const type = rootName(xml);
  if (!bundle) return { available: false, valid: false, errors: [], warnings: [] };
  if (type === "unknown") {
    const e: RuleFinding = {
      id: "XSD",
      flag: "fatal",
      message: "Root element is not a UBL Invoice or CreditNote",
    };
    return { available: true, valid: false, errors: [e], warnings: [] };
  }
  const { validateXML } = await import("xmllint-wasm");
  const result = await validateXML({
    xml: [{ fileName: "document.xml", contents: xml }],
    schema: [bundle.main[type]],
    preload: bundle.preload,
    initialMemoryPages: 512,
    maxMemoryPages: 4096,
  });
  const errors: RuleFinding[] = result.errors.map((e) => ({
    id: "XSD",
    flag: "fatal",
    message: e.message,
    location: e.loc ? `line ${e.loc.lineNumber}` : undefined,
  }));
  return { available: true, valid: result.valid, errors, warnings: [] };
}

// ─── Schematron ─────────────────────────────────────────────────────────

let sefCache: { dir: string; sefs: unknown[] | null } | null = null;

function loadSchematron(dir: string): unknown[] | null {
  if (sefCache && sefCache.dir === dir) return sefCache.sefs;
  let sefs: unknown[] | null = null;
  try {
    const base = path.join(dir, "schematron", PINT_AE_SCHEMATRON_VERSION);
    sefs = SCHEMATRON_FILES.map((f) => JSON.parse(fs.readFileSync(path.join(base, f), "utf8")));
  } catch {
    sefs = null;
  }
  sefCache = { dir, sefs };
  return sefs;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Parse SVRL output into failed assertions. */
export function parseSvrl(svrl: string): RuleFinding[] {
  const out: RuleFinding[] = [];
  const re = /<svrl:failed-assert\b([^>]*)>([\s\S]*?)<\/svrl:failed-assert>/g;
  for (const m of svrl.matchAll(re)) {
    const attrs = m[1];
    const get = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;
    const textMatch = /<svrl:text>([\s\S]*?)<\/svrl:text>/.exec(m[2]);
    const flag = (get("flag") ?? "fatal").toLowerCase();
    out.push({
      id: get("id") ?? "schematron",
      flag: flag === "warning" || flag === "information" ? "warning" : "fatal",
      message: decodeEntities((textMatch?.[1] ?? "").trim()),
      location: get("location") ? decodeEntities(get("location") as string) : undefined,
    });
  }
  return out;
}

export async function runPintAeSchematron(
  xml: string,
  dir: string = artefactsDir()
): Promise<ValidationLayer & { version: string | null }> {
  const sefs = loadSchematron(dir);
  if (!sefs) return { available: false, valid: false, errors: [], warnings: [], version: null };
  const { default: SaxonJS } = await import("saxon-js");
  const findings: RuleFinding[] = [];
  for (const sef of sefs) {
    const result = SaxonJS.transform(
      { stylesheetInternal: sef, sourceText: xml, destination: "serialized" },
      "sync"
    );
    findings.push(...parseSvrl(result.principalResult));
  }
  const errors = findings.filter((f) => f.flag === "fatal");
  const warnings = findings.filter((f) => f.flag === "warning");
  return {
    available: true,
    valid: errors.length === 0,
    errors,
    warnings,
    version: PINT_AE_SCHEMATRON_VERSION,
  };
}

/** Which official artefacts are present in this deployment. */
export function artefactStatus(dir: string = artefactsDir()) {
  return {
    xsd: loadXsd(dir) !== null,
    schematron: loadSchematron(dir) !== null,
    schematronVersion: PINT_AE_SCHEMATRON_VERSION,
  };
}

// ─── Combined ───────────────────────────────────────────────────────────

export function validateWithRules(xml: string): ValidationLayer {
  const findings = runPintAeRules(xml);
  const errors = findings.filter((f) => f.flag === "fatal");
  return {
    available: true,
    valid: errors.length === 0,
    errors,
    warnings: findings.filter((f) => f.flag === "warning"),
  };
}

/**
 * Full validation. `valid` requires every available layer to pass; a layer
 * whose artefacts are missing does not count as a pass — it is reported as
 * unavailable so the UI can say "schematron not run".
 */
export async function validateEInvoiceXml(
  xml: string,
  opts: { dir?: string; now?: Date } = {}
): Promise<EInvoiceValidationResult> {
  const dir = opts.dir ?? artefactsDir();
  const rules = validateWithRules(xml);
  const wellFormed = !rules.errors.some((e) => e.id === "XML-WELLFORMED");
  const [xsd, schematron] = wellFormed
    ? await Promise.all([validateUblXsd(xml, dir), runPintAeSchematron(xml, dir)])
    : [
        { available: false, valid: false, errors: [], warnings: [] },
        { available: false, valid: false, errors: [], warnings: [], version: null },
      ];
  const valid =
    rules.valid && (!xsd.available || xsd.valid) && (!schematron.available || schematron.valid);
  return {
    valid,
    documentType: rootName(xml),
    xsd,
    schematron,
    rules,
    checkedAt: (opts.now ?? new Date()).toISOString(),
  };
}

/** Compact summary for storage/UI (first findings only). */
export function summariseValidation(r: EInvoiceValidationResult) {
  const pick = (l: ValidationLayer) => ({
    available: l.available,
    valid: l.valid,
    errorCount: l.errors.length,
    warningCount: l.warnings.length,
    errors: l.errors.slice(0, 25),
    warnings: l.warnings.slice(0, 25),
  });
  return {
    valid: r.valid,
    documentType: r.documentType,
    checkedAt: r.checkedAt,
    xsd: pick(r.xsd),
    schematron: { ...pick(r.schematron), version: r.schematron.version },
    rules: pick(r.rules),
  };
}
export type EInvoiceValidationSummary = ReturnType<typeof summariseValidation>;
