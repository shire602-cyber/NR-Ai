#!/usr/bin/env -S npx tsx
// ASP sandbox dry run (docs/release/asp-sandbox-runbook.md): build ONE sample PINT AE invoice,
// validate it locally (UBL 2.1 XSD + PINT AE schematron + rule list), then submit it to the
// SANDBOX of each accredited ASP (A-Cube, Complyance) whose credentials are present.
//
// - No credentials for a provider: it is SKIPPED (exit 0 when nothing ran). Nothing is asked for.
// - A production setting (ACUBE_ENV / COMPLYANCE_ENV other than "sandbox") is REFUSED: this
//   script only ever talks to a sandbox.
// - Secrets are read from the environment only and never printed; output lists outcome fields.
// - No database is touched; the Complyance invoice source is named on the command line or env.
//
// Usage:
//   npx tsx scripts/ops/asp-sandbox-dryrun.ts                       # both, whichever are configured
//   npx tsx scripts/ops/asp-sandbox-dryrun.ts --provider acube      # one provider
//   npx tsx scripts/ops/asp-sandbox-dryrun.ts --validate-only       # local validation, no network
//   npx tsx scripts/ops/asp-sandbox-dryrun.ts --status              # also poll status once
//
// Non-secret inputs (optional): ASP_DRYRUN_SELLER_TRN (the TRN of the legal entity linked in the
// sandbox; defaults to the fixture TRN, which a sandbox will usually not route),
// ASP_DRYRUN_BUYER_TRN, COMPLYANCE_DRYRUN_SOURCE (the sandbox invoice source name),
// COMPLYANCE_SOURCE_VERSION (default v1).
import { randomUUID } from "node:crypto";

type ProviderName = "acube" | "complyance";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const value = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};

const only = value("--provider");
if (only && only !== "acube" && only !== "complyance") {
  console.error("--provider must be acube or complyance");
  process.exit(2);
}
const validateOnly = flag("--validate-only");
const pollStatus = flag("--status");

/** Required (secret) credentials and the environment switch for each ASP. Names only. */
export const ASP_REQUIREMENTS: Record<
  ProviderName,
  { credentials: string[]; envVar: string; label: string }
> = {
  acube: { credentials: ["ACUBE_EMAIL", "ACUBE_PASSWORD"], envVar: "ACUBE_ENV", label: "A-Cube" },
  complyance: {
    credentials: ["COMPLYANCE_API_KEY"],
    envVar: "COMPLYANCE_ENV",
    label: "Complyance",
  },
};

const TRN_RE = /^1\d{12}03$/;

async function sampleDocument() {
  const { PINT_AE_FIXTURES, fixtureCompany, uaeBuyer } =
    await import("../../tests/fixtures/pint-ae/fixtures");
  const { generateEInvoiceXML, validateForEInvoicing } =
    await import("../../server/services/einvoice.service");
  const { summariseValidation, validateEInvoiceXml } =
    await import("../../server/services/einvoice/validate");
  const sellerTrn = process.env.ASP_DRYRUN_SELLER_TRN?.trim() || fixtureCompany.trnVatNumber;
  const buyerTrn = process.env.ASP_DRYRUN_BUYER_TRN?.trim() || uaeBuyer.trn;
  for (const [name, trn] of [
    ["ASP_DRYRUN_SELLER_TRN", sellerTrn],
    ["ASP_DRYRUN_BUYER_TRN", buyerTrn],
  ] as const) {
    if (!trn || !TRN_RE.test(trn)) {
      console.error(`${name} must be a 15-digit UAE TRN (starts with 1, ends with 03)`);
      process.exit(2);
    }
  }
  const f = PINT_AE_FIXTURES[0];
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const invoice = {
    ...f.invoice,
    number: `DRYRUN-${stamp}`,
    date: new Date(`${today}T00:00:00Z`),
    dueDate: new Date(`${due}T00:00:00Z`),
    customerTrn: buyerTrn,
  };
  const company = { ...fixtureCompany, trnVatNumber: sellerTrn };
  // EndpointIDs are derived from the TRNs (scheme 0235 + 10-digit TIN), as in production.
  const customer = { ...uaeBuyer, trn: buyerTrn, endpointId: null, endpointScheme: null };
  const issues = validateForEInvoicing(invoice, f.lines, company, { customer });
  if (issues.length > 0) {
    console.error("sample invoice fails the data checks:", JSON.stringify(issues, null, 2));
    process.exit(1);
  }
  const uuid = randomUUID();
  const built = generateEInvoiceXML(invoice, f.lines, company, customer, { ...f.opts, uuid });
  const validation = summariseValidation(await validateEInvoiceXml(built.xml));
  return { invoice, company, xml: built.xml, uuid, validation };
}

function printValidation(v: Awaited<ReturnType<typeof sampleDocument>>["validation"]) {
  const layer = (name: string, l: { available: boolean; valid: boolean; errorCount: number }) =>
    `${name}=${l.available ? (l.valid ? "pass" : `FAIL(${l.errorCount})`) : "not-run"}`;
  console.log(
    `local validation: ${v.valid ? "VALID" : "INVALID"} (${layer("xsd", v.xsd)}, ${layer(
      "schematron",
      v.schematron
    )}, ${layer("rules", v.rules)})`
  );
  for (const e of [...v.xsd.errors, ...v.schematron.errors, ...v.rules.errors].slice(0, 20)) {
    console.log(`  - ${e.id}: ${e.message}${e.location ? ` @ ${e.location}` : ""}`);
  }
}

async function runProvider(
  name: ProviderName,
  doc: Awaited<ReturnType<typeof sampleDocument>>
): Promise<"skipped" | "refused" | "ok" | "failed"> {
  const req = ASP_REQUIREMENTS[name];
  const missing = req.credentials.filter((k) => !process.env[k]?.trim());
  if (missing.length > 0) {
    console.log(`SKIP ${req.label}: not configured (missing ${missing.join(", ")})`);
    return "skipped";
  }
  const envSetting = process.env[req.envVar]?.trim();
  if (envSetting && envSetting !== "sandbox") {
    console.error(
      `REFUSED ${req.label}: ${req.envVar}=${envSetting}; this dry run only uses sandbox`
    );
    return "refused";
  }
  const env = { ...process.env, EINVOICE_PROVIDER: name, [req.envVar]: "sandbox" };
  const submission = {
    invoiceId: randomUUID(),
    invoiceNumber: doc.invoice.number,
    uuid: doc.uuid,
    xml: doc.xml,
    documentType: "380",
    companyId: doc.company.id,
  };
  let provider;
  if (name === "acube") {
    const { AcubeEInvoiceProvider } =
      await import("../../server/services/einvoice/providers/acube");
    provider = new AcubeEInvoiceProvider(env);
  } else {
    const { ComplyanceEInvoiceProvider } =
      await import("../../server/services/einvoice/providers/complyance");
    const prefix = process.env.COMPLYANCE_SOURCE_PREFIX?.trim() || "muhasib";
    const source = {
      name: process.env.COMPLYANCE_DRYRUN_SOURCE?.trim() || `${prefix}-dryrun`,
      version: process.env.COMPLYANCE_SOURCE_VERSION?.trim() || "v1",
    };
    console.log(`${req.label}: invoice source ${source.name}:${source.version}`);
    provider = new ComplyanceEInvoiceProvider(env, { sourceFor: async () => source });
  }
  console.log(`${req.label}: submitting ${doc.invoice.number} (uuid ${doc.uuid}) to the sandbox`);
  const res = await provider.submit(submission);
  const summary = {
    provider: name,
    environment: provider.environment,
    status: res.status,
    delivery: res.delivery ?? null,
    reporting: res.reporting ?? null,
    providerMessageId: res.providerMessageId || null,
    providerStatus: res.providerStatus ?? null,
    errorCode: res.errorCode ?? null,
    reasons: res.reasons ?? [],
  };
  console.log(JSON.stringify(summary, null, 2));
  if (pollStatus && res.providerMessageId) {
    const s = await provider.getStatus(res.providerMessageId, {
      uuid: doc.uuid,
      documentType: "380",
    } as never);
    console.log(
      `${req.label} status: ${JSON.stringify({ status: s.status, delivery: s.delivery ?? null, reporting: s.reporting ?? null, errorCode: s.errorCode ?? null })}`
    );
  }
  return res.status === "failed" || res.status === "rejected" ? "failed" : "ok";
}

const doc = await sampleDocument();
printValidation(doc.validation);
if (!doc.validation.valid) {
  console.error("the sample document is not valid PINT AE; nothing was submitted");
  process.exit(1);
}
if (validateOnly) {
  console.log("--validate-only: no submission");
  process.exit(0);
}
const names: ProviderName[] = only ? [only as ProviderName] : ["acube", "complyance"];
const results: string[] = [];
for (const n of names) results.push(await runProvider(n, doc));
if (results.every((r) => r === "skipped")) {
  console.log("no ASP sandbox credentials present: nothing was submitted (this is not an error)");
  process.exit(0);
}
process.exit(
  results.some((r) => r === "refused") ? 2 : results.some((r) => r === "failed") ? 1 : 0
);
