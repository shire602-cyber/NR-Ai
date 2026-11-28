/**
 * Password rules shown as a live checklist (client) and enforced by the server's
 * `passwordPolicySchema` (server/auth.ts, which adds the common-password check). One list, so the
 * checklist text and the server cannot drift. Pure and client-safe.
 */
export interface PasswordRule {
  id: "length" | "upper" | "lower" | "digit";
  test: (password: string) => boolean;
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: "length", test: (p) => p.length >= PASSWORD_MIN_LENGTH && p.length <= PASSWORD_MAX_LENGTH },
  { id: "upper", test: (p) => /[A-Z]/.test(p) },
  { id: "lower", test: (p) => /[a-z]/.test(p) },
  { id: "digit", test: (p) => /[0-9]/.test(p) },
];

/** Rule ids the password does not yet satisfy. */
export function failedPasswordRules(password: string): PasswordRule["id"][] {
  return PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.id);
}
