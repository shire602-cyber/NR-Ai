import type { Express } from "express";
import { buildLimiter, clientIp } from "../middleware/rateLimit";
import { z } from "zod";
import { supportEmail } from "../../shared/marketing-brand";
import { asyncHandler } from "../middleware/errorHandler";
import { hasEmailProvider, sendEmail } from "../services/email.service";

const callbackRequest = z.object({
  requestId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ().-]{7,32}$/)
    .refine((phone) => phone.replace(/\D/g, "").length >= 7),
  availability: z.string().trim().max(160).optional(),
});

export function registerMarketingRoutes(app: Express) {
  app.post(
    "/api/marketing/demo-request",
    buildLimiter({
      windowMs: 15 * 60 * 1000,
      max: 5,
      message: "Try again later",
      keyGenerator: clientIp,
    }),
    asyncHandler(async (req, res) => {
      const parsed = callbackRequest.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid callback request" });
      if (!hasEmailProvider())
        return res.status(503).json({ message: "Callback requests unavailable" });
      const { name, email, phone, availability, requestId } = parsed.data;
      const result = await sendEmail(
        supportEmail,
        "Website demo callback request",
        [
          `Name: ${name}`,
          `Email: ${email}`,
          `Phone: ${phone}`,
          `Availability (Dubai time): ${availability || "Any"}`,
        ].join("\n"),
        {
          replyTo: email,
          category: "marketing-demo",
          sensitive: true,
          idempotencyKey: `marketing-demo:${requestId}`,
        }
      );
      if (
        !result.sent &&
        !(result.queued && ["queued", "sending", "retrying"].includes(result.status))
      ) {
        return res.status(503).json({ message: "Callback requests unavailable" });
      }
      return res.status(202).json({ accepted: true });
    })
  );
}
