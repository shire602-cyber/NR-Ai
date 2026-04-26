// FTA-mandated retention period for financial records (5 years).
export const RETENTION_YEARS = 5;

export class RetentionViolationError extends Error {
  readonly status = 409;
  readonly code = 'RETENTION_NOT_EXPIRED';
  readonly retentionExpiresAt: Date;

  constructor(retentionExpiresAt: Date, recordType: string) {
    super(
      `${recordType} cannot be deleted before ${retentionExpiresAt.toISOString().slice(0, 10)} ` +
      `(UAE FTA requires ${RETENTION_YEARS}-year retention of financial records).`,
    );
    this.name = 'RetentionViolationError';
    this.retentionExpiresAt = retentionExpiresAt;
  }
}

function computeExpiry(createdAt: Date | string): Date {
  const d = new Date(createdAt);
  d.setFullYear(d.getFullYear() + RETENTION_YEARS);
  return d;
}

export function isWithinRetention(record: {
  createdAt: Date | string;
  retentionExpiresAt?: Date | string | null;
}): boolean {
  const expiry = record.retentionExpiresAt
    ? new Date(record.retentionExpiresAt)
    : computeExpiry(record.createdAt);
  return new Date() < expiry;
}

// Throws RetentionViolationError if the record is still within its retention
// window. Call from any DELETE handler before performing the delete.
export function assertRetentionExpired(
  record: { createdAt: Date | string; retentionExpiresAt?: Date | string | null },
  recordType: string,
): void {
  const expiry = record.retentionExpiresAt
    ? new Date(record.retentionExpiresAt)
    : computeExpiry(record.createdAt);
  if (new Date() < expiry) {
    throw new RetentionViolationError(expiry, recordType);
  }
}

// For UI flows that need a softer signal — "archiving an old record" should
// warn but not block. Returns a warning string when the record is older than
// half the retention window, so users see a heads-up before they hit the wall.
export function retentionWarning(record: {
  createdAt: Date | string;
  retentionExpiresAt?: Date | string | null;
}): string | null {
  const expiry = record.retentionExpiresAt
    ? new Date(record.retentionExpiresAt)
    : computeExpiry(record.createdAt);
  const now = new Date();
  if (now >= expiry) return null;
  const daysRemaining = Math.ceil((expiry.getTime() - now.getTime()) / 86400000);
  return `Retention period: ${daysRemaining} days remaining (until ${expiry.toISOString().slice(0, 10)}).`;
}
