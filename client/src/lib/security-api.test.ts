import { describe, expect, it } from "vitest";
import {
  describeUserAgent,
  formatRecoveryCode,
  formatSecret,
  isRecoveryCode,
  isTotpCode,
  loginStepErrorKind,
  normaliseRecoveryCode,
  normaliseTotpCode,
  passwordChecks,
  recoveryCodesFileText,
  sortSessions,
  type SessionView,
} from "./security-api";

describe("totp code helpers", () => {
  it("keeps digits only and caps at six", () => {
    expect(normaliseTotpCode("123 456")).toBe("123456");
    expect(normaliseTotpCode("12a3-4567890")).toBe("123456");
  });
  it("accepts exactly six digits", () => {
    expect(isTotpCode("123456")).toBe(true);
    expect(isTotpCode("12345")).toBe(false);
    expect(isTotpCode("12345a")).toBe(false);
  });
});

describe("recovery codes", () => {
  it("normalises spaces, dashes and case", () => {
    expect(normaliseRecoveryCode("abcde-23456")).toBe("ABCDE23456");
    expect(isRecoveryCode("abcde 23456")).toBe(true);
  });
  it("rejects characters outside base32 and wrong lengths", () => {
    expect(isRecoveryCode("ABCDE1ABCD")).toBe(false); // 1 is not base32
    expect(isRecoveryCode("ABCDE")).toBe(false);
  });
  it("formats in two groups of five", () => {
    expect(formatRecoveryCode("ABCDE23456")).toBe("ABCDE-23456");
  });
  it("builds a text file with the title and one code per line", () => {
    const text = recoveryCodesFileText(["ABCDE23456", "FGHIJ23456"], "Muhasib recovery codes");
    expect(text.split("\n")).toEqual(["Muhasib recovery codes", "", "ABCDE-23456", "FGHIJ-23456", ""]);
  });
});

describe("secret formatting", () => {
  it("groups in fours", () => {
    expect(formatSecret("ABCDEFGHIJKLMNOP")).toBe("ABCD EFGH IJKL MNOP");
  });
});

describe("loginStepErrorKind", () => {
  it("maps server codes", () => {
    expect(loginStepErrorKind("TOTP_INVALID", 401)).toBe("invalid");
    expect(loginStepErrorKind("TOTP_REPLAYED", 401)).toBe("replayed");
    expect(loginStepErrorKind("CHALLENGE_EXPIRED", 401)).toBe("expired");
    expect(loginStepErrorKind("RECOVERY_CODE_INVALID", 401)).toBe("recoveryInvalid");
    expect(loginStepErrorKind("X", 429)).toBe("rateLimited");
    expect(loginStepErrorKind("X", 500)).toBe("unknown");
  });
});

describe("describeUserAgent", () => {
  it("recognises common browsers and systems", () => {
    expect(
      describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")
    ).toEqual({ browser: "Chrome", os: "macOS" });
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1")).toEqual({
      browser: "Safari",
      os: "iOS",
    });
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/120.0")).toEqual({ browser: "Edge", os: "Windows" });
  });
  it("returns blanks for missing or unknown agents", () => {
    expect(describeUserAgent(null)).toEqual({ browser: "", os: "" });
    expect(describeUserAgent("curl/8.0")).toEqual({ browser: "", os: "" });
  });
});

describe("sortSessions", () => {
  const base = (id: string, lastUsedAt: string | null, current = false): SessionView => ({
    id,
    userAgent: null,
    ipAddress: null,
    createdAt: "2026-01-01T00:00:00Z",
    lastUsedAt,
    current,
  });
  it("puts the current session first, then newest, without mutating the input", () => {
    const input = [base("a", "2026-02-01T00:00:00Z"), base("b", "2026-03-01T00:00:00Z"), base("c", "2026-01-15T00:00:00Z", true)];
    const sorted = sortSessions(input);
    expect(sorted.map((s) => s.id)).toEqual(["c", "b", "a"]);
    expect(input.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});

describe("passwordChecks", () => {
  it("reports each rule", () => {
    expect(passwordChecks("abc")).toEqual({ length: false, upper: false, lower: true, digit: false });
    expect(passwordChecks("Password123")).toEqual({ length: true, upper: true, lower: true, digit: true });
  });
});
