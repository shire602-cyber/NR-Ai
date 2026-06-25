import type { Express, Request, Response } from "express";
import { authMiddleware, adminMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { hasEmailProvider, hasResendConfig, hasSmtpConfig } from "../services/email.service";
import { isOpenBankingConfigured } from "../services/open-banking.service";
import { isEmailIntakeEnabled, isEmailIntakeConfigured } from "../services/email-intake-provider";
import { isObjectStorageConfigured, objectStorageBackend } from "../services/fileStorage";

/**
 * The "what do I paste where" surface: each integration with its live
 * configured state and the exact environment variables that switch it on.
 * Set the variables on the Railway service and redeploy — no code changes.
 */
export function registerIntegrationStatusRoutes(app: Express) {
  app.get(
    "/api/admin/integration-status",
    authMiddleware,
    adminMiddleware,
    asyncHandler(async (_req: Request, res: Response) => {
      const integrations = [
        {
          key: "email",
          name: "Email delivery",
          configured: hasEmailProvider(),
          detail: hasResendConfig() ? "Resend" : hasSmtpConfig() ? "SMTP" : null,
          requiredEnv: [
            "RESEND_API_KEY (simplest) — or SMTP_HOST + SMTP_USER + SMTP_PASS (+ SMTP_PORT, SMTP_FROM)",
          ],
          unlocks: "Password resets, invoice sending, payment chasing emails",
        },
        {
          key: "object_storage",
          name: "Receipt image storage",
          configured: isObjectStorageConfigured(),
          detail:
            objectStorageBackend() === "vercel-blob"
              ? "Vercel Blob"
              : objectStorageBackend() === "s3"
                ? "S3-compatible bucket"
                : "local disk (ephemeral — lost on redeploy)",
          requiredEnv: [
            "BLOB_READ_WRITE_TOKEN (Vercel Blob) — or S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY (+ S3_ENDPOINT/S3_REGION for R2/S3)",
          ],
          unlocks: "Durable receipt images that survive redeploys (required on Vercel)",
        },
        {
          key: "email_intake",
          name: "Email document intake (firm pilot)",
          configured: isEmailIntakeEnabled() && isEmailIntakeConfigured(),
          detail: !isEmailIntakeEnabled()
            ? "feature flag off"
            : isEmailIntakeConfigured()
              ? "mailbox connected"
              : "flag on, no mailbox",
          requiredEnv: [
            "EMAIL_INTAKE_ENABLED=true — and EMAIL_INTAKE_PROVIDER=gmail|imap|inbound (+ that provider's mailbox credentials)",
          ],
          unlocks: "Clients email documents → OCR → draft entries → VAT 201 (NRA clients only)",
        },
        {
          key: "stripe",
          name: "Billing (Stripe)",
          configured: !!process.env.STRIPE_SECRET_KEY,
          detail:
            process.env.BILLING_ENFORCEMENT === "true"
              ? "enforcement ON"
              : "enforcement off (gates fail open)",
          requiredEnv: [
            "STRIPE_SECRET_KEY",
            "STRIPE_WEBHOOK_SECRET",
            "STRIPE_PRICE_STARTER_MONTHLY",
            "STRIPE_PRICE_STARTER_YEARLY",
            "STRIPE_PRICE_PROFESSIONAL_MONTHLY",
            "STRIPE_PRICE_PROFESSIONAL_YEARLY",
            "STRIPE_PRICE_ENTERPRISE_MONTHLY",
            "STRIPE_PRICE_ENTERPRISE_YEARLY",
            "BILLING_ENFORCEMENT=true (flip last, once checkout works)",
          ],
          unlocks: "Subscriptions, checkout, plan upgrades, tier enforcement",
        },
        {
          key: "openBanking",
          name: "Live bank feeds",
          configured: isOpenBankingConfigured(),
          detail: null,
          requiredEnv: [
            "Provider credentials per docs/EXTERNAL_DEPENDENCIES.md (Tarabut / Dapi / Salt Edge candidates)",
          ],
          unlocks: "Automatic bank transaction sync (CSV/OFX import works today)",
        },
        {
          key: "push",
          name: "Push notifications",
          configured: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
          detail: null,
          requiredEnv: [
            "VAPID_PUBLIC_KEY",
            "VAPID_PRIVATE_KEY",
            "VAPID_SUBJECT (mailto:...)",
            "Generate a pair with: npx web-push generate-vapid-keys",
          ],
          unlocks: "Browser push for reminders and deadline alerts",
        },
        {
          key: "tokenEncryption",
          name: "Secret encryption at rest",
          configured: true,
          detail: process.env.TOKEN_ENCRYPTION_KEY
            ? "dedicated key"
            : "derived from SESSION_SECRET",
          requiredEnv: ["TOKEN_ENCRYPTION_KEY (optional dedicated 32+ char key)"],
          unlocks: "Always on",
        },
        {
          key: "webhooks",
          name: "Outbound webhooks",
          configured: true,
          detail: "per-endpoint secrets, no global config needed",
          requiredEnv: [],
          unlocks: "Event delivery to customer systems (configure in Developer Settings)",
        },
        {
          key: "apiKeys",
          name: "Public API keys",
          configured: true,
          detail: "no global config needed",
          requiredEnv: [],
          unlocks: "Scoped API access (manage in Developer Settings)",
        },
      ];
      res.json({ integrations });
    })
  );
}
