/**
 * Every e-invoice status and every A-Cube error code the adapter can surface has an English and
 * an Arabic string in the einvoicing catalog, and the signed-in e-invoicing copy carries no
 * ZATCA/Saudi wording.
 *
 * The code list is read from the adapter's own source on purpose: the adapter has no exported list
 * of error codes (they are string literals in AcubeApiError / errorCode fields), and a code added
 * there without a catalog string is exactly what this must catch. A behaviour test cannot
 * enumerate codes it does not know about.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { errorKey } from "../../client/src/components/einvoice/einvoice-meta";
import { DELIVERY_STATUSES, REPORTING_STATUSES } from "../../server/services/einvoice/tracks";

const root = path.join(__dirname, "..", "..");
const catalog = (lang: "en" | "ar") =>
  JSON.parse(
    fs.readFileSync(path.join(root, "client/src/locales", lang, "einvoicing.json"), "utf8")
  ) as Record<string, string>;
const en = catalog("en");
const ar = catalog("ar");
const ENV_NAME =
  /^ACUBE_(BASE_URL|LOGIN_URL|EMAIL|PASSWORD|ENV|TIMEOUT_MS|[A-Z_]*SUBMIT_PATH|SIGNATURE_PUBLIC_KEY|WEBHOOK_[A-Z_]+)$/;
const ARABIC = /[\u0600-\u06FF]/;

/** Codes the A-Cube adapter, onboarding and status mapping can put in `errorCode`. */
function acubeCodes(): string[] {
  const files = [
    "server/services/einvoice/providers/acube.ts",
    "server/services/einvoice/providers/acube-onboarding.ts",
    "server/services/einvoice/tracks.ts",
  ];
  const codes = new Set<string>(["TRANSPORT_ERROR"]);
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const m of source.matchAll(/"(ACUBE_[A-Z_]+)"/g)) {
      // Quoted ACUBE_* literals also name environment variables; those are not error codes.
      if (!ENV_NAME.test(m[1])) codes.add(m[1]);
    }
  }
  return [...codes].sort();
}

function expectBoth(key: string) {
  expect(en[key], `en missing ${key}`).toBeTruthy();
  expect(ar[key], `ar missing ${key}`).toBeTruthy();
  expect(ARABIC.test(ar[key]), `ar ${key} has no Arabic text`).toBe(true);
}

describe("e-invoice submission status strings (EN + AR)", () => {
  it.each(DELIVERY_STATUSES)("delivery status %s", (status) => {
    expectBoth(`einvoicing.delivery_${status}`);
  });
  it.each(REPORTING_STATUSES)("reporting status %s", (status) => {
    expectBoth(`einvoicing.reporting_${status}`);
  });
  it.each([
    "einvoicing.submissionQueued", // in flight / queued
    "einvoicing.delivery_sending", // in flight
    "einvoicing.recipientReceived", // delivered (receipt)
    "einvoicing.recipientAccepted", // accepted (final)
    "einvoicing.retryScheduled", // retrying
    "einvoicing.delivery_needs_link", // reconcile needed
    "einvoicing.needsLinkTitle",
    "einvoicing.needsLinkBody",
    "einvoicing.delivery_delivery_failed",
    "einvoicing.delivery_rejected",
    "einvoicing.reporting_reported",
    "einvoicing.reporting_report_failed",
  ])("state wording %s", expectBoth);
});

describe("A-Cube error code strings (EN + AR)", () => {
  const codes = acubeCodes();
  it("finds the codes the adapter can surface", () => {
    expect(codes).toEqual(
      expect.arrayContaining([
        "ACUBE_VALIDATION",
        "ACUBE_BAD_REQUEST",
        "ACUBE_LEGAL_ENTITY_NOT_FOUND",
        "ACUBE_AUTH_FAILED",
        "ACUBE_RATE_LIMITED",
        "ACUBE_UNAVAILABLE",
        "TRANSPORT_ERROR",
      ])
    );
  });
  it.each(codes)("%s is known to the UI and has EN and AR text", (code) => {
    const key = errorKey(code);
    expect(key, `${code} is missing from KNOWN_ERRORS in einvoice-meta.ts`).not.toBeNull();
    expectBoth(key!);
  });
});

describe("e-invoicing copy scope", () => {
  it("never mentions ZATCA or Saudi Arabia", () => {
    for (const [lang, strings] of [
      ["en", en],
      ["ar", ar],
    ] as const) {
      for (const [key, value] of Object.entries(strings)) {
        expect(value, `${lang} ${key}`).not.toMatch(/zatca|saudi|fatoora|السعود|زاتكا/i);
      }
    }
  });
});
