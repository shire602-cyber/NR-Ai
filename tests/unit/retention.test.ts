import { describe, it, expect } from 'vitest';
import {
  isWithinRetention,
  assertRetentionExpired,
  retentionWarning,
  RetentionViolationError,
  RETENTION_YEARS,
} from '../../server/services/retention.service';

describe('retention service', () => {
  it('is within retention for a record created today', () => {
    expect(isWithinRetention({ createdAt: new Date() })).toBe(true);
  });

  it('is past retention for a record older than 5 years', () => {
    const oldDate = new Date();
    oldDate.setFullYear(oldDate.getFullYear() - RETENTION_YEARS - 1);
    expect(isWithinRetention({ createdAt: oldDate })).toBe(false);
  });

  it('uses retention_expires_at when present', () => {
    const past = new Date('2000-01-01');
    expect(isWithinRetention({ createdAt: new Date(), retentionExpiresAt: past })).toBe(false);
  });

  it('assertRetentionExpired throws for fresh records', () => {
    expect(() => assertRetentionExpired({ createdAt: new Date() }, 'Invoice'))
      .toThrowError(RetentionViolationError);
  });

  it('assertRetentionExpired permits old records', () => {
    const oldDate = new Date();
    oldDate.setFullYear(oldDate.getFullYear() - RETENTION_YEARS - 1);
    expect(() => assertRetentionExpired({ createdAt: oldDate }, 'Invoice')).not.toThrow();
  });

  it('warning is null once retention has expired', () => {
    const oldDate = new Date();
    oldDate.setFullYear(oldDate.getFullYear() - RETENTION_YEARS - 1);
    expect(retentionWarning({ createdAt: oldDate })).toBe(null);
  });

  it('warning includes a remaining-days hint while in retention', () => {
    const warning = retentionWarning({ createdAt: new Date() });
    expect(warning).toMatch(/days remaining/);
  });
});
