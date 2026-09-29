// One human-readable list of optional capabilities that are switched off, so the
// startup log can carry a single, clear WARN instead of scattered silence.

export interface CapabilityFlags {
  email: boolean;
  errorTracking: boolean;
  durableStorage: boolean;
  billing: boolean;
}

export function describeDisabledCapabilities(flags: CapabilityFlags): string[] {
  const off: string[] = [];
  if (!flags.email) {
    off.push(
      "email (set RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASS): password reset, invoice emailing, payment reminders and firm client emails will not be delivered"
    );
  }
  if (!flags.errorTracking) {
    off.push("error tracking (set SENTRY_DSN): errors are written to the log only");
  }
  if (!flags.durableStorage) {
    off.push(
      "durable file storage (set BLOB_READ_WRITE_TOKEN or S3_BUCKET, or attach a volume and set UPLOADS_PERSISTENT=true): in production uploads are refused with STORAGE_NOT_DURABLE"
    );
  }
  if (!flags.billing) {
    off.push("billing (set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET): checkout and subscription webhooks are unavailable");
  }
  return off;
}
