import { describe, expect, it } from "vitest";

import { isCredentialAuthPath } from "../../server/middleware/security";

describe("auth rate-limit scoping", () => {
  it("counts credential-bearing attempts", () => {
    expect(isCredentialAuthPath("/login")).toBe(true);
    expect(isCredentialAuthPath("/register")).toBe(true);
    expect(isCredentialAuthPath("/forgot-password")).toBe(true);
    expect(isCredentialAuthPath("/reset-password")).toBe(true);
    expect(isCredentialAuthPath("/reset-password/abc123")).toBe(true);
  });

  it("exempts session reads that fire on every page load", () => {
    // Counting these used to exhaust the 5/min budget before the user even
    // submitted the login form, locking the whole app behind 429s.
    expect(isCredentialAuthPath("/me")).toBe(false);
    expect(isCredentialAuthPath("/refresh")).toBe(false);
    expect(isCredentialAuthPath("/refresh-token")).toBe(false);
    expect(isCredentialAuthPath("/logout")).toBe(false);
    expect(isCredentialAuthPath("/oauth/providers")).toBe(false);
    expect(isCredentialAuthPath("/oauth/google")).toBe(false);
  });

  it("does not treat lookalike prefixes as credential paths", () => {
    expect(isCredentialAuthPath("/login-history")).toBe(false);
    expect(isCredentialAuthPath("/registerable")).toBe(false);
  });
});
