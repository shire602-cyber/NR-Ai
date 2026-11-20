/**
 * WP-E2: anomaly descriptions and categoriser reasons come as message key + params next to the
 * English text, and the client renders them from the catalogs (Arabic mode shows Arabic).
 */
import { describe, expect, it } from "vitest";
import enComponents from "../../client/src/locales/en/components.json";
import arComponents from "../../client/src/locales/ar/components.json";
import enFirm from "../../client/src/locales/en/firmOps.json";
import arFirm from "../../client/src/locales/ar/firmOps.json";
import {
  anomalyCopy,
  categorisationReasonCopy,
  describeAnomalyText,
  describeCategorisationReason,
  describeValueOpsText,
} from "../../shared/server-copy";
import {
  anomalyMessage,
  categorisationReason,
  valueOpsMessage,
} from "../../client/src/lib/server-message";
import { reasonLanguage } from "../../server/services/autonomous-gl.service";

const en = { ...enComponents, ...enFirm } as Record<string, string>;
const ar = { ...arComponents, ...arFirm } as Record<string, string>;
const LATIN_WORD = /[A-Za-z]{3,}/;

describe("anomaly copy", () => {
  it("keeps the English sentence and adds the key + params", () => {
    const { text, message } = anomalyCopy("anomaly.weekendSaturday", {
      number: "JE-1",
      date: "2026-11-14",
      amount: "2,000.00",
    });
    expect(text).toBe(
      "Journal entry JE-1 dated Saturday 2026-11-14 for AED 2,000.00. UAE businesses typically don't transact on weekends."
    );
    expect(message).toEqual({
      key: "anomaly.weekendSaturday",
      params: { number: "JE-1", date: "2026-11-14", amount: "2,000.00" },
    });
    // A row stored before keys existed maps back to the same key.
    expect(describeAnomalyText(text)).toEqual(message);
  });

  it("renders in Arabic with a localised date and no English words", () => {
    const { text, message } = anomalyCopy("anomaly.duplicateReceipts", {
      n: 2,
      amount: "105.00",
      date: "2026-11-14",
      merchants: "Careem, Careem",
    });
    const rendered = anomalyMessage({ description: text, message }, ar, "ar");
    expect(rendered).toContain("14 نوفمبر 2026");
    expect(rendered.replace(/Careem/g, "")).not.toMatch(LATIN_WORD);
    // English mode renders from the same key (date formatted, not ISO).
    expect(anomalyMessage({ description: text, message }, en, "en")).toContain("14 Nov 2026");
  });

  it("parses a stored description when the API sent no message", () => {
    const { text } = anomalyCopy("anomaly.vatMismatchReceipt", {
      merchant: "Careem",
      vat: "5.00",
      net: "105.00",
    });
    const rendered = anomalyMessage({ description: text }, ar, "ar");
    expect(rendered).toContain("ضريبة القيمة المضافة");
    expect(rendered.replace(/Careem/g, "")).not.toMatch(LATIN_WORD);
  });

  it("shows an unknown merchant in the reader's language", () => {
    const { text, message } = anomalyCopy("anomaly.roundReceipt", {
      merchant: "Unknown",
      amount: "5,000.00",
    });
    expect(anomalyMessage({ description: text, message }, ar, "ar")).not.toMatch(LATIN_WORD);
  });
});

describe("categoriser reasons", () => {
  it("maps the rule-matched reason to a key and renders it in Arabic", () => {
    const { text, message } = categorisationReasonCopy("categorise.matchedRule", {
      pattern: "DEWA",
      applied: 4,
      accepted: 3,
    });
    expect(text).toBe("Matched rule: DEWA (applied 4 times, 3 accepted)");
    expect(describeCategorisationReason(text)).toEqual(message);
    const rendered = categorisationReason(
      { ai_reason: text, ai_reason_message: message },
      ar,
      "ar"
    );
    expect(rendered).toContain("DEWA");
    expect(rendered?.replace("DEWA", "")).not.toMatch(LATIN_WORD);
  });

  it("never shows operator notes, and shows the model's own text as written", () => {
    const off = categorisationReasonCopy("categorise.operator.notConfigured");
    expect(
      categorisationReason({ ai_reason: off.text, ai_reason_message: off.message }, en, "en")
    ).toBeNull();
    // Rows stored before the message existed are recognised by their wording.
    expect(categorisationReason({ ai_reason: off.text }, en, "en")).toBeNull();
    expect(categorisationReason({ ai_reason: "اسم التاجر يدل على فاتورة كهرباء" }, ar, "ar")).toBe(
      "اسم التاجر يدل على فاتورة كهرباء"
    );
  });

  it("asks the model for the company language", () => {
    expect(reasonLanguage("ar")).toBe("written in Arabic");
    expect(reasonLanguage("en")).toBe("written in English");
    expect(reasonLanguage(null)).toBe("written in English");
  });
});

describe("value programme sentences", () => {
  it("renders action and audit-pack sentences in Arabic", () => {
    for (const sentence of [
      "Recover overdue receivables",
      "2 collection or document messages ready",
      "1 bank items, 2 receipts need review",
      "Confirm suggested bank match",
      "VAT return is draft; due 2026-12-28.",
      "Bank statement support",
    ]) {
      expect(describeValueOpsText(sentence), sentence).not.toBeNull();
      const out = valueOpsMessage(sentence, ar, "ar", (v) => (v === "draft" ? "مسودة" : v));
      expect(out, sentence).not.toMatch(LATIN_WORD);
    }
  });
});
