#!/usr/bin/env -S npx tsx
// ASP sandbox dry run (docs/release/asp-sandbox-runbook.md): build ONE sample PINT AE invoice,
// validate it locally (UBL 2.1 XSD + PINT AE schematron + rule list), then submit it to the
// SANDBOX of each accredited ASP (A-Cube, Complyance) whose credentials are present.
//
// - No credentials for a provider: it is SKIPPED. --status fails if nothing can be verified.
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
import type { EInvoiceDocumentRef } from "../../server/services/einvoice-provider";
import { tinFromTrn } from "../../server/services/einvoice/pint-ae-codes";

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
if (validateOnly && pollStatus) {
  console.error("Choose either --validate-only or --status.");
  process.exit(2);
}

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

async function sampleDocument() {
  const { buildSampleDocument } = await import("./asp-sample-document");
  try {
    return await buildSampleDocument();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(err instanceof Error && /must be a 15-digit/.test(err.message) ? 2 : 1);
  }
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
  const statusRef: EInvoiceDocumentRef = { documentType: submission.documentType };
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
    statusRef.outboundIdentity = {
      documentNumber: submission.invoiceNumber,
      supplierTin: tinFromTrn(doc.company.trnVatNumber),
      supplierTrn: doc.company.trnVatNumber ?? null,
      legalEntityId: null,
      sourceName: source.name,
    };
    // This is the ID from a fresh submission using the very same credentials and source.
    statusRef.knownCredentialScope = true;
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
  if (pollStatus) {
    if (!res.providerMessageId) {
      console.error(`${req.label} status: submission did not return a document ID to verify.`);
      return "failed";
    }
    const s = await provider.getStatus(res.providerMessageId, statusRef);
    console.log(
      `${req.label} status: ${JSON.stringify({ status: s.status, delivery: s.delivery ?? null, reporting: s.reporting ?? null, providerStatus: s.providerStatus ?? null, errorCode: s.errorCode ?? null })}`
    );
    if (s.status === "failed" || s.status === "rejected" || s.errorCode || !s.providerStatus)
      return "failed";
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
  if (pollStatus) {
    console.error("No ASP status could be verified because sandbox credentials are missing.");
    process.exit(1);
  }
  console.log("no ASP sandbox credentials present: nothing was submitted (this is not an error)");
  process.exit(0);
}
process.exit(
  results.some((r) => r === "refused") ? 2 : results.some((r) => r === "failed") ? 1 : 0
);
