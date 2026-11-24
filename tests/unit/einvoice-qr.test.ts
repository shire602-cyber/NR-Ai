import QRCode from "qrcode";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInvoiceShareQrPng } from "../../server/services/einvoice-qr.service";

describe("public invoice share QR", () => {
  const shared = { shareToken: "shared-invoice", shareTokenExpiresAt: null, status: "sent" };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("renders a PNG with the same URL as the public invoice link", async () => {
    vi.stubEnv("FRONTEND_URL", "https://invoices.example.test/");
    const encode = vi.spyOn(QRCode, "toBuffer");
    const png = await renderInvoiceShareQrPng(shared);
    expect(encode).toHaveBeenCalledWith(
      "https://invoices.example.test/view/invoice/shared-invoice",
      expect.objectContaining({ type: "png", margin: 4 })
    );
    expect(png?.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it.each([
    { shareToken: null },
    { shareTokenExpiresAt: new Date(0) },
    { status: "draft" },
    { status: "cancelled" },
  ])("omits QR for an unavailable public share (%j)", async (overrides) => {
    expect(await renderInvoiceShareQrPng({ ...shared, ...overrides })).toBeNull();
  });
});
