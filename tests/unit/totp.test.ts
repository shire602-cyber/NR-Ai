import { describe, it, expect } from "vitest";
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  totpCodeAt,
  verifyTotp,
  buildOtpauthUrl,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  hashRecoveryCode,
} from "../../server/services/totp";

// RFC 6238 Appendix B, SHA-1, secret "12345678901234567890", truncated to 6 digits.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));
const VECTORS: Array<[number, string]> = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
];

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });
  it("matches the RFC 4648 vector", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });
  it("decodes lowercase and padded input", () => {
    expect(base32Decode("mzxw6ytboi======").toString()).toBe("foobar");
  });
  it("rejects invalid characters", () => {
    expect(() => base32Decode("MZXW1")).toThrow();
  });
});

describe("totp", () => {
  it.each(VECTORS)("RFC 6238 vector at t=%i", (t, code) => {
    expect(totpCodeAt(RFC_SECRET, Math.floor(t / 30))).toBe(code);
  });

  it("generates a 160-bit secret", () => {
    const s = generateTotpSecret();
    expect(base32Decode(s).length).toBe(20);
  });

  it("verifies within +-1 step and returns the matched step", () => {
    const step = 1000;
    const code = totpCodeAt(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, step)).toBe(step);
    expect(verifyTotp(RFC_SECRET, code, step + 1)).toBe(step);
    expect(verifyTotp(RFC_SECRET, code, step - 1)).toBe(step);
    expect(verifyTotp(RFC_SECRET, code, step + 2)).toBeNull();
  });

  it("rejects malformed codes", () => {
    expect(verifyTotp(RFC_SECRET, "12345", 1)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef", 1)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "1234567", 1)).toBeNull();
  });

  it("builds an otpauth URL", () => {
    const url = buildOtpauthUrl({ secret: "ABC", account: "a@b.com", issuer: "Muhasib" });
    expect(url).toBe(
      "otpauth://totp/Muhasib:a%40b.com?secret=ABC&issuer=Muhasib&algorithm=SHA1&digits=6&period=30"
    );
  });
});

describe("recovery codes", () => {
  it("makes 10 unique codes of 10 base32 chars", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{10}$/);
  });
  it("normalises spacing, dashes and case before hashing", () => {
    expect(normalizeRecoveryCode("abcde-fghij")).toBe("ABCDEFGHIJ");
    expect(hashRecoveryCode("abcde fghij")).toBe(hashRecoveryCode("ABCDEFGHIJ"));
    expect(hashRecoveryCode("ABCDEFGHIJ")).not.toBe(hashRecoveryCode("ABCDEFGHIK"));
  });
});
