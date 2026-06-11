import { describe, expect, it } from "vitest";

import {
  buildWhatsAppWebDraftUrl,
  cleanBridgeJobMetadata,
  createBridgeJobSchema,
  normalizeWhatsAppBridgePhone,
} from "../../server/services/whatsapp-bridge.service";

describe("whatsapp bridge service", () => {
  it("normalizes UAE mobile numbers for WhatsApp Web", () => {
    expect(normalizeWhatsAppBridgePhone("050 123 4567")).toBe("971501234567");
    expect(normalizeWhatsAppBridgePhone("+971 50 123 4567")).toBe("971501234567");
    expect(normalizeWhatsAppBridgePhone("00971501234567")).toBe("971501234567");
  });

  it("rejects unusable phone numbers", () => {
    expect(normalizeWhatsAppBridgePhone("123")).toBe("");
    expect(normalizeWhatsAppBridgePhone("")).toBe("");
  });

  it("builds a WhatsApp Web draft URL without auto-send semantics", () => {
    const url = buildWhatsAppWebDraftUrl("+971 50 123 4567", "Hello & review this");
    expect(url).toBe(
      "https://web.whatsapp.com/send?phone=971501234567&text=Hello%20%26%20review%20this&app_absent=0"
    );
  });

  it("validates bridge job input and stores delivery-truth metadata", () => {
    const input = createBridgeJobSchema.parse({
      to: "+971501234567",
      message: "Please send docs",
      kind: "document_request",
      sourceType: "vat_workpaper",
      metadata: { priority: "high" },
    });

    expect(input.kind).toBe("document_request");
    expect(cleanBridgeJobMetadata(input)).toMatchObject({
      priority: "high",
      sourceType: "vat_workpaper",
      provider: "whatsapp_web_extension",
      deliveryTruth: "human_confirmed_in_whatsapp_web",
    });
  });
});
