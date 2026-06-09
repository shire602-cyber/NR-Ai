import { describe, it, expect, beforeEach, vi } from 'vitest';

// The audit found password-reset / email-verification tokens were generated but
// never emailed (only logged), and the reset link was built from a non-existent
// env var (env.APP_URL) so it was host-less. These tests pin the new helpers:
// they must deliver the ABSOLUTE link via the configured provider.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db';
  process.env.SESSION_SECRET = 'a'.repeat(32);
  process.env.JWT_SECRET = 'b'.repeat(32);
  process.env.NODE_ENV = 'test';
  process.env.RESEND_API_KEY = 're_test_key';
  return { sendSpy: vi.fn(async () => ({ id: 'mock-id' })) };
});

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: h.sendSpy };
  },
}));

import { sendPasswordResetEmail, sendVerificationEmail } from '../../server/services/email.service';

describe('auth transactional emails', () => {
  beforeEach(() => {
    h.sendSpy.mockClear();
  });

  it('sendPasswordResetEmail delivers the absolute reset URL via the provider', async () => {
    const url = 'https://app.muhasib.test/reset-password?token=abc123';
    const result = await sendPasswordResetEmail('user@example.com', url);

    expect(result.sent).toBe(true);
    expect(h.sendSpy).toHaveBeenCalledOnce();
    const arg = h.sendSpy.mock.calls[0][0] as any;
    expect(arg.to).toBe('user@example.com');
    expect(arg.subject).toMatch(/reset/i);
    expect(arg.html).toContain('reset-password?token=abc123');
    expect(arg.html).toContain('https://app.muhasib.test');
    expect(arg.text).toContain(url);
  });

  it('sendVerificationEmail delivers the absolute verify URL via the provider', async () => {
    const url = 'https://app.muhasib.test/verify-email/tok789';
    const result = await sendVerificationEmail('user@example.com', url);

    expect(result.sent).toBe(true);
    const arg = h.sendSpy.mock.calls[0][0] as any;
    expect(arg.subject).toMatch(/verif/i);
    expect(arg.html).toContain('verify-email/tok789');
    expect(arg.text).toContain(url);
  });

  it('no-ops gracefully (no throw) when no email provider is configured', async () => {
    vi.resetModules();
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    const mod = await import('../../server/services/email.service');
    const result = await mod.sendPasswordResetEmail('user@example.com', 'https://x/reset-password?token=z');
    expect(result.sent).toBe(false);
    expect(h.sendSpy).not.toHaveBeenCalled();
    process.env.RESEND_API_KEY = 're_test_key';
  });
});
