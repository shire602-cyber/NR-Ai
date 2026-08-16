import { describe, it, expect } from "vitest";
import { mapProviderStatus, HttpEInvoiceProvider } from "../../server/services/einvoice-provider-http";
import { getEInvoiceProvider } from "../../server/services/einvoice-provider";

describe("ASP status mapping", () => {
  it("maps the common 'in flight' vocabularies to submitted", () => {
    for (const s of ["submitted", "queued", "pending", "processing", "in progress", "SENT"]) {
      expect(mapProviderStatus(s), s).toBe("submitted");
    }
  });

  it("maps clearance vocabularies to accepted", () => {
    for (const s of ["accepted", "cleared", "delivered", "SUCCESS", "completed"]) {
      expect(mapProviderStatus(s), s).toBe("accepted");
    }
  });

  it("maps business rejections to rejected", () => {
    for (const s of ["rejected", "invalid", "validation_failed", "validation-failed"]) {
      expect(mapProviderStatus(s), s).toBe("rejected");
    }
  });

  it("maps transport problems to failed", () => {
    for (const s of ["failed", "error", "timeout"]) {
      expect(mapProviderStatus(s), s).toBe("failed");
    }
  });

  // The important one. An unrecognised status must never be optimistically
  // treated as cleared: the business would believe it had transmitted and is
  // fined AED 100 per untransmitted invoice.
  it("never treats an unknown status as accepted", () => {
    for (const s of ["", "banana", undefined, null, 42, "weird_provider_state"]) {
      expect(mapProviderStatus(s as unknown), String(s)).toBe("failed");
    }
  });
});

describe("HTTP provider configuration", () => {
  it("refuses to construct without credentials", () => {
    expect(() => new HttpEInvoiceProvider({} as NodeJS.ProcessEnv)).toThrow(
      /EINVOICE_API_BASE_URL and EINVOICE_API_KEY/
    );
  });

  it("constructs when credentials are supplied", () => {
    const p = new HttpEInvoiceProvider({
      EINVOICE_API_BASE_URL: "https://api.example-asp.ae/v1",
      EINVOICE_API_KEY: "k",
    } as unknown as NodeJS.ProcessEnv);
    expect(p.name).toBe("http");
  });

  it("parses a webhook into a normalised status", () => {
    const p = new HttpEInvoiceProvider({
      EINVOICE_API_BASE_URL: "https://api.example-asp.ae/v1",
      EINVOICE_API_KEY: "k",
    } as unknown as NodeJS.ProcessEnv);
    expect(p.parseWebhook({ id: "doc-1", status: "cleared" })).toEqual({
      providerMessageId: "doc-1",
      status: "accepted",
      detail: null,
    });
    expect(p.parseWebhook({ nothing: true })).toBeNull();
  });
});

describe("provider selection safety", () => {
  it("refuses the fabricating mock provider in production", () => {
    expect(() =>
      getEInvoiceProvider({ NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/mock provider cannot be used in production/i);
  });

  it("allows the mock outside production", () => {
    const p = getEInvoiceProvider({ NODE_ENV: "test" } as unknown as NodeJS.ProcessEnv);
    expect(p.name).toBe("mock");
  });

  it("selects the HTTP adapter when configured", () => {
    const p = getEInvoiceProvider({
      NODE_ENV: "production",
      EINVOICE_PROVIDER: "http",
      EINVOICE_API_BASE_URL: "https://api.example-asp.ae/v1",
      EINVOICE_API_KEY: "k",
    } as unknown as NodeJS.ProcessEnv);
    expect(p.name).toBe("http");
  });
});
