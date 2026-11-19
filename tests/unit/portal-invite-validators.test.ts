import { describe, expect, it } from "vitest";
import {
  PORTAL_BULK_MAX,
  PORTAL_INVITE_MESSAGE_MAX,
  portalAcceptBody,
  portalBulkInviteBody,
  portalInviteBody,
} from "../../shared/validators/portal-invitations";
import { PASSWORD_RULES, failedPasswordRules } from "../../shared/validators/password-rules";
import { passwordPolicySchema } from "../../server/auth";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("STEP5 portal invitation validators", () => {
  it("invite body: language defaults to en, email is normalised, the note is capped", () => {
    const ok = portalInviteBody.parse({ email: "  Layla@Example.TEST " });
    expect(ok.email).toBe("layla@example.test");
    expect(ok.language).toBe("en");
    expect(
      portalInviteBody.safeParse({ message: "x".repeat(PORTAL_INVITE_MESSAGE_MAX + 1) }).success
    ).toBe(false);
    expect(portalInviteBody.safeParse({ language: "fr" }).success).toBe(false);
    expect(portalInviteBody.safeParse({ email: "not-an-email" }).success).toBe(false);
  });

  it("bulk body: 1..100 contact ids, language defaults to the contact's own", () => {
    expect(portalBulkInviteBody.parse({ contactIds: [UUID] }).language).toBe("contact");
    expect(portalBulkInviteBody.safeParse({ contactIds: [] }).success).toBe(false);
    expect(
      portalBulkInviteBody.safeParse({
        contactIds: Array.from({ length: PORTAL_BULK_MAX + 1 }, () => UUID),
      }).success
    ).toBe(false);
    expect(portalBulkInviteBody.safeParse({ contactIds: ["nope"] }).success).toBe(false);
  });

  it("accept body: the terms must be accepted (true), nothing else is required", () => {
    expect(portalAcceptBody.safeParse({ acceptTerms: true }).success).toBe(true);
    expect(portalAcceptBody.safeParse({ acceptTerms: false }).success).toBe(false);
    expect(portalAcceptBody.safeParse({}).success).toBe(false);
  });

  it("the client checklist agrees with the server password policy", () => {
    const samples = [
      "",
      "short1A",
      "alllowercase1",
      "ALLUPPERCASE1",
      "NoDigitsHere",
      "Valid1Pass",
      "Portal9Strong!x",
      "password1A", // satisfies the rules but is a common password
      "a".repeat(300) + "A1",
    ];
    for (const s of samples) {
      const rulesPass = failedPasswordRules(s).length === 0;
      const server = passwordPolicySchema.safeParse(s);
      if (!rulesPass) expect(server.success, s.slice(0, 20)).toBe(false);
      if (server.success) expect(rulesPass, s.slice(0, 20)).toBe(true);
    }
    expect(PASSWORD_RULES.map((r) => r.id)).toEqual(["length", "upper", "lower", "digit"]);
  });
});
