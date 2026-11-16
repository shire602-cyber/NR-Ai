#!/usr/bin/env node
// i18n ratchet (R18-02): fails when the number of hard-coded English JSX
// strings under client/src/pages and client/src/components grows past the committed baseline,
// or when user-visible string properties (label/title/description/placeholder/message ...)
// in client/src/lib and client/src/hooks grow past theirs (F7; baseline 0).
//
//   node scripts/check-i18n-ratchet.mjs            # gate (exit 1 on regression)
//   node scripts/check-i18n-ratchet.mjs --update   # lower the baseline after real progress
//
// The count comes from the same scanner as `npm run audit:i18n`
// (scripts/i18n-scan.mjs). The baseline can only move down: --update refuses
// to raise it. Intentional English strings (brand names, code samples) carry an
// `i18n-ignore: <reason>` comment and are reported separately.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  repoRoot,
  scanPages,
  scanComponents,
  scanLibHooks,
  scanZodMessages,
  scanBlindSpots,
} from "./i18n-scan.mjs";

const baselinePath = join(repoRoot, "scripts", "guard-baselines", "i18n.json");
const update = process.argv.includes("--update");

const pageScan = scanPages();
const componentScan = scanComponents();
const { pages, translated } = pageScan;
const libHookScan = scanLibHooks();
const blindSpots = scanBlindSpots();
const hardcoded = pageScan.hardcoded + componentScan.hardcoded;
const justified = pageScan.justified + componentScan.justified;

let baseline = null;
try {
  baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
} catch {
  baseline = null;
}

function writeBaseline() {
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        description:
          "Hard-coded English JSX strings under client/src/pages and client/src/components, plus user-visible string properties in client/src/lib and client/src/hooks (scripts/i18n-scan.mjs). Ratchet: may only decrease.",
        maxHardcoded: hardcoded,
        justified,
        pagesHardcoded: pageScan.hardcoded,
        componentsHardcoded: componentScan.hardcoded,
        pagesImportingTranslation: translated,
        pages,
        libHooksHardcoded: libHookScan.hardcoded,
        libHooksJustified: libHookScan.justified,
        blindSpotHardcoded: blindSpots.hardcoded,
      },
      null,
      2
    ) + "\n"
  );
}

const libHookBaseline = baseline?.libHooksHardcoded ?? 0;
console.log(
  `i18n ratchet: ${hardcoded} hard-coded (baseline ${baseline?.maxHardcoded ?? "none"}), ` +
    `${justified} justified, ${translated}/${pages} pages import translation; ` +
    `lib/hooks ${libHookScan.hardcoded} hard-coded (baseline ${libHookBaseline}), ` +
    `${libHookScan.justified} justified`
);

// F11: zod/form validation messages must be catalog keys (baseline 0, never raised).
const zodScan = scanZodMessages();
if (zodScan.hardcoded > 0) {
  console.error(
    `✗ ${zodScan.hardcoded} English literal(s) used as zod validation messages in client/src. ` +
      `Use a catalog key ("forms.errors.*" / "components.validation.*") so the message follows the UI language.\n  ` +
      zodScan.samples.join("\n  ")
  );
  process.exit(1);
}

if (update) {
  if (baseline && blindSpots.hardcoded > (baseline.blindSpotHardcoded ?? Infinity)) {
    console.error(`✗ refusing to raise the blind-spot baseline to ${blindSpots.hardcoded}`);
    process.exit(1);
  }
  if (baseline && libHookScan.hardcoded > libHookBaseline) {
    console.error(
      `✗ refusing to raise the lib/hooks baseline from ${libHookBaseline} to ${libHookScan.hardcoded}`
    );
    process.exit(1);
  }
  if (baseline && hardcoded > baseline.maxHardcoded) {
    console.error(
      `✗ refusing to raise the baseline from ${baseline.maxHardcoded} to ${hardcoded}; translate the new strings instead`
    );
    process.exit(1);
  }
  writeBaseline();
  console.log(`✓ baseline written to scripts/guard-baselines/i18n.json (${hardcoded})`);
  process.exit(0);
}

if (!baseline) {
  console.error("✗ scripts/guard-baselines/i18n.json is missing; run with --update to create it");
  process.exit(1);
}

if (blindSpots.hardcoded > (baseline.blindSpotHardcoded ?? Infinity)) {
  console.error(
    `✗ multi-line / ternary / attribute English in JSX rose to ${blindSpots.hardcoded} ` +
      `(baseline ${baseline.blindSpotHardcoded}). Use catalog keys (client/src/locales/{en,ar}).`
  );
  process.exit(1);
}

if (libHookScan.hardcoded > libHookBaseline) {
  console.error(
    `✗ user-visible string literals in client/src/lib or client/src/hooks rose to ${libHookScan.hardcoded} ` +
      `(baseline ${libHookBaseline}). Store a translation key and put the copy in client/src/locales/{en,ar}/<namespace>.json, ` +
      `or justify non-UI text with i18n-ignore / i18n-ignore-file.\n  ` +
      libHookScan.samples.join("\n  ")
  );
  process.exit(1);
}

if (hardcoded > baseline.maxHardcoded) {
  console.error(
    `✗ hard-coded string count rose to ${hardcoded} (baseline ${baseline.maxHardcoded}). ` +
      `Move the new strings into client/src/locales/{en,ar}/<namespace>.json, or justify intentional English with an i18n-ignore comment.`
  );
  process.exit(1);
}

if (hardcoded < baseline.maxHardcoded) {
  console.log(
    `ℹ count is below the baseline; run \`node scripts/check-i18n-ratchet.mjs --update\` to lock in the improvement.`
  );
}
process.exit(0);
