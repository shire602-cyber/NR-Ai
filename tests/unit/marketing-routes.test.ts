import { randomUUID } from "node:crypto";
import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerMarketingRoutes } from "../../server/routes/marketing.routes";
import { sendEmail } from "../../server/services/email.service";

vi.mock("../../server/services/email.service", () => ({
  hasEmailProvider: () => true,
  sendEmail: vi.fn(async () => ({ sent: true })),
}));

async function requestCallback(phone: string) {
  const app = express();
  app.use(express.json());
  registerMarketingRoutes(app);
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/marketing/demo-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Layla",
        email: "layla@example.com",
        phone,
        requestId: randomUUID(),
      }),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("Demo callback phone numbers", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["+٩٧١ ٥٠ ١٢٣ ٤٥٦٧", "+۹۷۱ ۵۰ ۱۲۳ ۴۵۶۷", "+971 50 123 4567"])(
    "sends normalized ASCII digits for %s",
    async (phone) => {
      expect(await requestCallback(phone)).toMatchObject({ status: 202 });
      expect(sendEmail).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.stringContaining("Phone: +971 50 123 4567"),
        expect.any(Object)
      );
    }
  );

  it("rejects a phone number with too few digits", async () => {
    expect(await requestCallback("+٩٧١ ٥٠")).toMatchObject({
      status: 400,
      body: { field: "phone" },
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
