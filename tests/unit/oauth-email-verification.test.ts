import { describe, it, expect } from 'vitest';
import { deriveOAuthEmail, OAuthIdentityError } from '../../server/services/oauth.service';

// C1: an OAuth email must only be treated as verified when it comes from the
// dedicated `email` claim AND the provider asserts email_verified. Microsoft's
// preferred_username/upn are NOT proof of email ownership and must yield
// emailVerified=false (so the caller refuses to auto-link to an existing account).
describe('deriveOAuthEmail', () => {
  it('Google with verified email → verified', () => {
    const r = deriveOAuthEmail('google', { email: 'User@Example.com', email_verified: true });
    expect(r.email).toBe('user@example.com');
    expect(r.emailVerified).toBe(true);
  });

  it('Google with unverified email → throws', () => {
    expect(() => deriveOAuthEmail('google', { email: 'u@example.com', email_verified: false }))
      .toThrow(OAuthIdentityError);
  });

  it('Microsoft with verified email claim → verified', () => {
    const r = deriveOAuthEmail('microsoft', { email: 'u@example.com', email_verified: true });
    expect(r.emailVerified).toBe(true);
  });

  it('Microsoft with only preferred_username (no email claim) → NOT verified', () => {
    const r = deriveOAuthEmail('microsoft', { preferred_username: 'victim@example.com' });
    expect(r.email).toBe('victim@example.com');
    expect(r.emailVerified).toBe(false);
  });

  it('Microsoft with email claim but no email_verified → NOT verified', () => {
    const r = deriveOAuthEmail('microsoft', { email: 'u@example.com' });
    expect(r.emailVerified).toBe(false);
  });

  it('Microsoft falling back to upn → NOT verified', () => {
    const r = deriveOAuthEmail('microsoft', { upn: 'u@corp.com' });
    expect(r.email).toBe('u@corp.com');
    expect(r.emailVerified).toBe(false);
  });

  it('no usable email → throws', () => {
    expect(() => deriveOAuthEmail('microsoft', { name: 'No Email' })).toThrow(OAuthIdentityError);
  });
});
