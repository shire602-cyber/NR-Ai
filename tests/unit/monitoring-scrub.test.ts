import { describe, it, expect } from "vitest";
import { scrubForMonitoring, scrubString } from "../../server/services/monitoring-scrub";

// Built at runtime so no token-shaped literal sits in the repository.
const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const JWT = [
  b64url({ alg: "HS256", typ: "JWT" }),
  b64url({ sub: "fixture-user", note: "not a credential" }),
  Buffer.from("fixture-signature-not-a-real-mac-0000").toString("base64url"),
].join(".");

describe("scrubForMonitoring", () => {
  it("redacts sensitive keys case-insensitively at any depth", () => {
    const out = scrubForMonitoring({
      Password: "hunter2",
      user: { AccessToken: "abc", nested: { client_secret: "s", api_key: "k", apiKey: "k2" } },
      headers: { Authorization: "Bearer x", Cookie: "sid=1" },
      companyTrn: "100123456700003",
      bankIBAN: "AE070331234567890123456",
      ok: "visible",
    }) as any;
    expect(out.Password).toBe("[REDACTED]");
    expect(out.user.AccessToken).toBe("[REDACTED]");
    expect(out.user.nested.client_secret).toBe("[REDACTED]");
    expect(out.user.nested.api_key).toBe("[REDACTED]");
    expect(out.user.nested.apiKey).toBe("[REDACTED]");
    expect(out.headers.Authorization).toBe("[REDACTED]");
    expect(out.headers.Cookie).toBe("[REDACTED]");
    expect(out.companyTrn).toBe("[REDACTED]");
    expect(out.bankIBAN).toBe("[REDACTED]");
    expect(out.ok).toBe("visible");
  });

  it("walks arrays", () => {
    const out = scrubForMonitoring([{ token: "t" }, { keep: 1 }, "Bearer abc.def.ghi"]) as any[];
    expect(out[0].token).toBe("[REDACTED]");
    expect(out[1].keep).toBe(1);
    expect(out[2]).not.toContain("abc.def.ghi");
  });

  it("redacts request bodies wholesale", () => {
    const out = scrubForMonitoring({ body: { anything: "x" }, requestBody: "y", method: "POST" }) as any;
    expect(out.body).toBe("[REDACTED]");
    expect(out.requestBody).toBe("[REDACTED]");
    expect(out.method).toBe("POST");
  });

  it("redacts JWT-looking and bearer-looking string values", () => {
    const out = scrubForMonitoring({
      note: `failed with ${JWT} in header`,
      hdr: "Bearer abcdef1234567890",
    }) as any;
    expect(out.note).not.toContain("eyJ");
    expect(out.note).toContain("[REDACTED_JWT]");
    expect(out.hdr).toBe("Bearer [REDACTED]");
  });

  it("redacts email addresses, TRNs and IBANs inside free text", () => {
    const s = scrubString(
      "user jane.doe+x@example.com TRN 100123456700003 iban AE070331234567890123456 done"
    );
    expect(s).not.toContain("jane.doe");
    expect(s).not.toContain("100123456700003");
    expect(s).not.toContain("AE0703");
    expect(s).toContain("[REDACTED_EMAIL]");
  });

  it("strips SQL parameters from driver error messages", () => {
    const s = scrubString('Failed query: insert into "users" ("email") values ($1) params: a@b.com,secret');
    expect(s).not.toContain("secret");
    expect(s).toContain("params: [REDACTED]");
  });

  it("serialises Error objects with scrubbed message and stack", () => {
    const err = new Error(`bad token ${JWT}`);
    const out = scrubForMonitoring({ err }) as any;
    expect(out.err.name).toBe("Error");
    expect(out.err.message).not.toContain("eyJ");
    expect(String(out.err.stack)).not.toContain("eyJ");
  });

  it("does not mutate its input", () => {
    const input = { password: "p", nested: { token: "t" } };
    scrubForMonitoring(input);
    expect(input).toEqual({ password: "p", nested: { token: "t" } });
  });

  it("survives circular references and deep nesting", () => {
    const a: any = { name: "a" };
    a.self = a;
    expect(() => scrubForMonitoring(a)).not.toThrow();
    let deep: any = { v: 1 };
    for (let i = 0; i < 50; i++) deep = { child: deep };
    expect(() => scrubForMonitoring(deep)).not.toThrow();
  });

  it("passes through primitives and null", () => {
    expect(scrubForMonitoring(5)).toBe(5);
    expect(scrubForMonitoring(null)).toBeNull();
    expect(scrubForMonitoring(undefined)).toBeUndefined();
    expect(scrubForMonitoring(true)).toBe(true);
  });
});
