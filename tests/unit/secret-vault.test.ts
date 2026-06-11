import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetSecretVaultForTests,
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from "../../server/services/secret-vault";

describe("secret vault", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "unit_test_session_secret_that_is_long_enough";
    delete process.env.TOKEN_ENCRYPTION_KEY;
    __resetSecretVaultForTests();
  });

  it("round-trips secrets through AES-256-GCM", () => {
    const stored = encryptSecret("lean-access-token-abc123");
    expect(stored).not.toContain("lean-access-token");
    expect(isEncryptedSecret(stored)).toBe(true);
    expect(decryptSecret(stored)).toBe("lean-access-token-abc123");
  });

  it("passes legacy plaintext rows through unchanged", () => {
    expect(decryptSecret("legacy-plaintext-token")).toBe("legacy-plaintext-token");
    expect(isEncryptedSecret("legacy-plaintext-token")).toBe(false);
  });

  it("handles null/empty and never double-encrypts", () => {
    expect(encryptSecret(null)).toBeNull();
    expect(encryptSecret("")).toBe("");
    const once = encryptSecret("tok")!;
    expect(encryptSecret(once)).toBe(once);
  });

  it("rejects tampered ciphertext", () => {
    const stored = encryptSecret("sensitive")!;
    const tampered = stored.slice(0, -4) + "AAAA";
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("prefers TOKEN_ENCRYPTION_KEY over SESSION_SECRET", () => {
    const viaSession = encryptSecret("tok")!;
    process.env.TOKEN_ENCRYPTION_KEY = "dedicated_token_key_that_is_long_enough_123";
    __resetSecretVaultForTests();
    expect(decryptSecret(encryptSecret("tok")!)).toBe("tok");
    // Ciphertext from the session-derived key no longer decrypts — expected
    // on key rotation; bank connections are simply re-linked.
    expect(() => decryptSecret(viaSession)).toThrow();
  });
});
