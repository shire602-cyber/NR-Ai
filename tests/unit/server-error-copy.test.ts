/**
 * G3: every error code a customer-reachable server path can return has a stable code and specific
 * English and Arabic copy, and the common customer 4xx responses carry a code.
 *
 * Source-inspection note: the set of codes the API can return is not enumerable at runtime (they
 * are spread over ~100 route/service modules and only fire on specific business states), so the
 * codes are collected from the source text the same way `localizeApiError` is later fed them.
 * The behaviour of the lookup itself is tested below with real catalogs.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadLocale, t, useI18n } from "../../client/src/lib/i18n";
import {
  fieldLabel,
  localizeApiError,
  serverErrorCopy,
} from "../../client/src/lib/validation-messages";

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) walk(file, out);
    else if (file.endsWith(".ts")) out.push(file);
  }
  return out;
}

/** Files whose errors never reach a customer's screen: admin/firm consoles, webhooks, providers. */
const INTERNAL_FILE =
  /(admin|firm|platform|internal|webhook|cron|scheduler|outbox|public-api|ecommerce|stripe|integrations|ocr|ai\/|ai\.|backup|migration-import|socket|telemetry|health|jobs|einvoice-provider|acube|complyance)/i;

/** Codes in customer files that only machines see (inbound webhooks, provider callbacks, feeds). */
const MACHINE_ONLY = new Set([
  "ASP", // e-invoicing provider diagnostic label, not an HTTP error
  "EINVOICE_INBOUND_BAD_SIGNATURE", // inbound provider webhook
  "EINVOICE_INBOUND_DISABLED",
  "EINVOICE_INBOUND_INVALID",
  "EINVOICE_INBOUND_NO_OWNER",
  "EINVOICE_INBOUND_UNPARSEABLE",
  "EINVOICE_INBOUND_UNSUPPORTED_MEDIA",
  "EINVOICE_INBOUND_WRONG_RECIPIENT",
  "FX_RATE_FEED_NOT_CONFIGURED", // platform-operator env configuration
  "FX_RATE_FEED_URL_MISSING",
  "INVALID_SIGNATURE", // signed callbacks (payment provider, outbox)
]);

function collectCodes(): Map<string, string[]> {
  const codes = new Map<string, string[]>();
  const add = (code: string, file: string) => {
    const list = codes.get(code) ?? [];
    list.push(path.relative(ROOT, file));
    codes.set(code, list);
  };
  for (const file of [...walk(path.join(ROOT, "server")), ...walk(path.join(ROOT, "shared"))]) {
    const rel = path.relative(ROOT, file);
    if (INTERNAL_FILE.test(rel)) continue;
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/\bcode:\s*["'`]([A-Z][A-Z0-9_]{2,})["'`]/g)) add(m[1], file);
    for (const m of src.matchAll(
      /new \w*Error\(\s*(?:\d{3}\s*,\s*)?["'`]([A-Z][A-Z0-9_]{2,})["'`]/g
    )) {
      add(m[1], file);
    }
  }
  return codes;
}

function readCatalog(locale: "en" | "ar", ns: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, `client/src/locales/${locale}/${ns}.json`), "utf8")
  );
}

function copyFor(locale: "en" | "ar", code: string): string | undefined {
  const forms = readCatalog(locale, "forms");
  const server = readCatalog(locale, "serverErrors");
  return forms[`forms.serverErrors.${code}`] ?? server[`serverErrors.${code}`];
}

describe("[G3] every customer-reachable error code has English and Arabic copy", () => {
  const codes = collectCodes();

  it("finds the codes (guards the scanner itself)", () => {
    expect(codes.size).toBeGreaterThan(500);
    expect(codes.has("ALREADY_MEMBER")).toBe(true);
    expect(codes.has("COST_CENTER_NOT_FOUND")).toBe(true);
  });

  it("each code has specific en and ar copy", () => {
    const missing: string[] = [];
    for (const [code, files] of codes) {
      if (MACHINE_ONLY.has(code)) continue;
      const en = copyFor("en", code);
      const ar = copyFor("ar", code);
      if (!en || !ar) missing.push(`${code} (${[...new Set(files)][0]})`);
    }
    expect(missing).toEqual([]);
  });

  it("Arabic copy is Arabic, English copy is not, and placeholders match", () => {
    const en = readCatalog("en", "serverErrors");
    const ar = readCatalog("ar", "serverErrors");
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    const bad: string[] = [];
    for (const [key, text] of Object.entries(ar)) {
      if (key.startsWith("serverErrors.field.")) continue;
      if (!/[؀-ۿ]/.test(text)) bad.push(`${key}: Arabic copy has no Arabic`);
      if ((en[key].match(/\{\w+\}/g) ?? []).join() !== (text.match(/\{\w+\}/g) ?? []).join()) {
        bad.push(`${key}: placeholders differ`);
      }
    }
    for (const [key, text] of Object.entries(en)) {
      if (/[؀-ۿ]/.test(text)) bad.push(`${key}: English copy contains Arabic`);
    }
    expect(bad).toEqual([]);
  });
});

describe("[G3] common customer 4xx responses carry a code", () => {
  /** Route modules of the areas the owner named; a raw `{ message }` 4xx here must carry a code. */
  const CUSTOMER_ROUTES = [
    "contacts",
    "team",
    "cost-centers",
    "receipts",
    "bank-statements",
    "bank",
    "vat",
    "vat-autopilot",
    "payroll",
    "invoices",
    "bill-pay",
    "journal",
    "companies",
    "accounts",
    "credit-notes",
    "quotes",
    "recurring-invoices",
    "invoice-templates",
    "reminders",
    "reports",
    "report-delivery",
    "purchase-orders",
    "expense-claims",
    "fixed-assets",
    "inventory",
    "budgets",
    "month-end",
    "corporate-tax",
    "sales-receipts",
    "exchange-rates",
    "onboarding",
    "referrals",
    "notifications",
    "billing",
  ].map((n) => path.join(ROOT, `server/routes/${n}.routes.ts`));

  /** `.status(4xx).json({ ... })` bodies without a `code:` key. */
  function uncoded(file: string): string[] {
    const src = fs.readFileSync(file, "utf8");
    const re = /\.status\(\s*(4\d\d)\s*\)\s*\.json\(\s*\{/g;
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      let depth = 1;
      let i = re.lastIndex;
      while (i < src.length && depth > 0) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        i++;
      }
      const body = src.slice(re.lastIndex, i - 1);
      if (/\bcode\s*:/.test(body)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      out.push(`${path.basename(file)}:${line} ${body.replace(/\s+/g, " ").slice(0, 80)}`);
    }
    return out;
  }

  it("no raw uncoded 4xx response in the customer routes", () => {
    const found = CUSTOMER_ROUTES.filter((f) => fs.existsSync(f)).flatMap(uncoded);
    expect(found).toEqual([]);
  });
});

describe("[G3] the lookup", () => {
  beforeAll(async () => {
    await loadLocale("en");
    await loadLocale("ar");
  });

  it("names the duplicate contact email and already-a-member errors in Arabic", () => {
    useI18n.setState({ locale: "ar" });
    const dup = localizeApiError({
      code: "CONTACT_EMAIL_EXISTS",
      message: "A contact with this email already exists",
    })!;
    expect(dup).toMatch(/[؀-ۿ]/);
    expect(dup).not.toMatch(/[A-Za-z]/);
    const member = localizeApiError({
      code: "ALREADY_MEMBER",
      message: "User is already a team member",
    })!;
    expect(member).toMatch(/[؀-ۿ]/);
    expect(member).not.toMatch(/[A-Za-z]/);
    expect(member).not.toBe(dup);
    expect(serverErrorCopy("ar", "ALREADY_MEMBER")).toBe(member);
  });

  it("picks the document-specific sub-ledger sentence in Arabic without the English catalog", () => {
    const key = "forms.serverErrors.SUBLEDGER_ENTRY.inventory";
    const saved = (t.en as Record<string, string>)[key];
    delete (t.en as Record<string, string>)[key]; // an Arabic session never loads the English catalog
    try {
      useI18n.setState({ locale: "ar" });
      const text = localizeApiError({
        code: "SUBLEDGER_ENTRY",
        message: "x",
        details: { document: "inventory" },
      })!;
      expect(text).toContain("حركة مخزون");
    } finally {
      (t.en as Record<string, string>)[key] = saved;
      useI18n.setState({ locale: "en" });
    }
  });

  it("uses the catalog sentence in English only when the server sent the generic words of the code", () => {
    useI18n.setState({ locale: "en" });
    expect(
      localizeApiError({ code: "COST_CENTER_INACTIVE", message: "Cost center inactive" })
    ).toBe(serverErrorCopy("en", "COST_CENTER_INACTIVE"));
    expect(
      localizeApiError({
        code: "CONTACT_EMAIL_EXISTS",
        message: "A contact with this email already exists",
      })
    ).toBeUndefined();
  });

  it("maps validation field ids to form labels in both languages and never prints a raw id", () => {
    const body = {
      code: "VALIDATION_ERROR",
      message: "Validation error",
      fields: {
        trn: ["TRN must be exactly 15 digits"],
        "lines.2.unitPrice": ["Required"],
        zzzUnknownField: ["Required"],
      },
    };
    useI18n.setState({ locale: "en" });
    const en = localizeApiError(body)!;
    expect(en).toContain("TRN: TRN must be exactly 15 digits");
    expect(en).toContain("Lines - #3 - Unit price: Required");
    useI18n.setState({ locale: "ar" });
    const ar = localizeApiError(body)!;
    expect(ar).toContain("الرقم الضريبي");
    expect(ar).toContain("سعر الوحدة");
    expect(ar).not.toMatch(/zzzUnknownField|unitPrice|trn:/);
    expect(fieldLabel("zzzUnknownField")).toBe("حقل");
    // A company-settings TRN failure (server field id + server reason) reads in Arabic.
    const trn = localizeApiError({
      code: "VALIDATION_ERROR",
      message: "Validation error",
      fields: { trnVatNumber: ["TRN must start with 100"] },
    })!;
    expect(trn).toContain("الرقم الضريبي / رقم ضريبة القيمة المضافة");
    expect(trn).toContain("الإماراتي بـ 100");
    expect(trn).not.toMatch(/[A-Za-z]/);
    useI18n.setState({ locale: "en" });
  });
});
