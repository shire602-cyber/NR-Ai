#!/usr/bin/env node
// Validate UBL e-invoices against the vendored official artefacts (W4-C).
//
//   node scripts/validate-ubl.mjs <file.xml> [...]    validate given documents
//   node scripts/validate-ubl.mjs --fixtures          generate + validate the PINT AE fixtures
//   node scripts/validate-ubl.mjs --compile           rebuild the schematron SEF from the XSLT
//
// Layers (same as server/services/einvoice/validate.ts):
//   1. UBL 2.1 XSD            xmllint-wasm, server/assets/einvoice/xsd/ubl-2.1
//   2. PINT AE schematron     saxon-js, server/assets/einvoice/schematron/2026.5/*.sef.json
//                             (skipped with a notice when the files are absent)
//   3. PINT AE rule list      server/services/einvoice/pint-ae-rules.ts (via tsx)
//
// Artefact provenance (server/assets/einvoice/NOTICE): OASIS UBL 2.1 schemas
// (via phax/ph-ubl, imports restored), OpenPeppol PINT AE 2026.5 schematron
// (Apache-2.0, via phax/phive-rules), compiled to SEF with Saxonica xslt3.
// Exit code 1 when any document has an error.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const artefacts =
  process.env.EINVOICE_ARTEFACTS_DIR || path.join(root, "server", "assets", "einvoice");
const xsdDir = path.join(artefacts, "xsd", "ubl-2.1");
const schDir = path.join(artefacts, "schematron", "2026.5");
const SCH = ["PINT-UBL-validation-preprocessed", "PINT-jurisdiction-aligned-rules"];

function compile() {
  for (const name of SCH) {
    const xsl = path.join(schDir, `${name}.xslt`);
    const sef = path.join(schDir, `${name}.sef.json`);
    if (!fs.existsSync(xsl)) {
      console.error(`missing ${xsl}`);
      process.exit(1);
    }
    // xslt3 (Saxonica) is not a project dependency: fetched on demand.
    execFileSync(
      "npx",
      ["-y", "xslt3@2.7.0", `-xsl:${xsl}`, `-export:${sef}`, "-nogo", "-relocate:on"],
      {
        stdio: "inherit",
      }
    );
    console.log(`compiled ${path.relative(root, sef)}`);
  }
}

function loadXsd() {
  if (!fs.existsSync(path.join(xsdDir, "maindoc"))) return null;
  const common = path.join(xsdDir, "common");
  const preload = fs
    .readdirSync(common)
    .filter((f) => f.endsWith(".xsd"))
    .map((f) => ({ fileName: f, contents: fs.readFileSync(path.join(common, f), "utf8") }));
  const main = (n) => ({
    fileName: n,
    contents: fs
      .readFileSync(path.join(xsdDir, "maindoc", n), "utf8")
      .replace(/schemaLocation="\.\.\/common\//g, 'schemaLocation="'),
  });
  return {
    Invoice: main("UBL-Invoice-2.1.xsd"),
    CreditNote: main("UBL-CreditNote-2.1.xsd"),
    preload,
  };
}

function loadSef() {
  const files = SCH.map((n) => path.join(schDir, `${n}.sef.json`));
  if (!files.every((f) => fs.existsSync(f))) return null;
  return files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
}

function failedAsserts(svrl) {
  const out = [];
  for (const m of svrl.matchAll(/<svrl:failed-assert\b([^>]*)>([\s\S]*?)<\/svrl:failed-assert>/g)) {
    const id = /\bid="([^"]*)"/.exec(m[1])?.[1] ?? "schematron";
    const flag = /\bflag="([^"]*)"/.exec(m[1])?.[1] ?? "fatal";
    const text = /<svrl:text>([\s\S]*?)<\/svrl:text>/.exec(m[2])?.[1]?.trim() ?? "";
    out.push({ id, flag, text });
  }
  return out;
}

async function loadRules() {
  try {
    const { register } = await import("tsx/esm/api");
    register();
    const mod = await import(
      pathToFileURL(path.join(root, "server/services/einvoice/pint-ae-rules.ts")).href
    );
    return mod.runPintAeRules;
  } catch (err) {
    console.warn(`rule list unavailable (${err.message}); XSD and schematron only`);
    return null;
  }
}

async function validate(name, xml, ctx) {
  const errors = [];
  const type = /<(?:\w+:)?(Invoice|CreditNote)[\s>]/.exec(xml.replace(/<\?xml[^>]*\?>/, ""))?.[1];
  if (ctx.xsd && type) {
    const { validateXML } = await import("xmllint-wasm");
    const r = await validateXML({
      xml: [{ fileName: "document.xml", contents: xml }],
      schema: [ctx.xsd[type]],
      preload: ctx.xsd.preload,
      initialMemoryPages: 512,
      maxMemoryPages: 4096,
    });
    for (const e of r.errors) errors.push(`XSD ${e.message}`);
  } else if (!type) {
    errors.push("XSD root element is not a UBL Invoice or CreditNote");
  }
  if (ctx.sef) {
    const { default: SaxonJS } = await import("saxon-js");
    for (const sef of ctx.sef) {
      const r = SaxonJS.transform(
        { stylesheetInternal: sef, sourceText: xml, destination: "serialized" },
        "sync"
      );
      for (const f of failedAsserts(r.principalResult)) {
        if (f.flag === "warning") console.log(`  warning ${f.id}: ${f.text}`);
        else errors.push(`${f.id} ${f.text}`);
      }
    }
  }
  if (ctx.rules) {
    for (const f of ctx.rules(xml)) if (f.flag === "fatal") errors.push(`${f.id} ${f.message}`);
  }
  console.log(
    `${errors.length ? "✗" : "✓"} ${name}${errors.length ? ` — ${errors.length} error(s)` : ""}`
  );
  for (const e of errors) console.log(`  ${e}`);
  return errors.length;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--compile")) return compile();
  const ctx = { xsd: loadXsd(), sef: loadSef(), rules: await loadRules() };
  if (!ctx.xsd) console.warn(`UBL 2.1 XSD not found under ${xsdDir}: XSD layer skipped`);
  if (!ctx.sef) {
    console.warn(
      `PINT AE schematron SEF not found under ${schDir}: official schematron skipped ` +
        "(EXTERNAL: vendor the OpenPeppol PINT AE artefacts, then run --compile)"
    );
  }
  let failures = 0;
  if (args.includes("--fixtures")) {
    const fx = await import(
      pathToFileURL(path.join(root, "tests/fixtures/pint-ae/fixtures.ts")).href
    );
    const gen = await import(
      pathToFileURL(path.join(root, "server/services/einvoice.service.ts")).href
    );
    for (const f of [...fx.PINT_AE_FIXTURES, fx.debitNoteFixture]) {
      const { xml } = gen.generateEInvoiceXML(
        f.invoice,
        f.lines,
        fx.fixtureCompany,
        f.customer,
        f.opts
      );
      failures += (await validate(`fixture: ${f.name}`, xml, ctx)) ? 1 : 0;
    }
  }
  for (const file of args.filter((a) => !a.startsWith("--"))) {
    failures += (await validate(file, fs.readFileSync(file, "utf8"), ctx)) ? 1 : 0;
  }
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
