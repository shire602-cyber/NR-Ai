/**
 * STEP5 security fixes that are pure functions: the URL redactor (S5-SEC-1), the invitation note
 * neutraliser and the sender name constraint (S5-SEC-4), and the message DTO (S5-SEC-6).
 */
import { describe, expect, it } from "vitest";
import { redactUrl, looksLikeToken } from "../../server/http/redact-url";
import {
  neutraliseInviteNote,
  renderPortalInviteEmail,
} from "../../server/services/portal-invite-email";
import { inviteSenderName } from "../../server/services/portal-invitations.service";
import { portalMessageDto } from "../../server/routes/client-portal.routes";

const HEX = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const B64 = "Zm9vYmFyLXRva2VuX1NlY3JldDEyMzQ1Njc4OTBhYmNkZWZnaGlqa2xtbm9w";
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("S5-SEC-1 redactUrl", () => {
  it("redacts long hex and base64url tokens in any path position", () => {
    expect(redactUrl(`/api/portal-invitations/${HEX}`)).toBe("/api/portal-invitations/:token");
    expect(redactUrl(`/api/portal-invitations/${HEX}/accept`)).toBe(
      "/api/portal-invitations/:token/accept"
    );
    expect(redactUrl(`/api/portal/${HEX}/invoices/${UUID}/pdf`)).toBe(
      `/api/portal/:token/invoices/${UUID}/pdf`
    );
    expect(redactUrl(`/api/public/${B64}/summary`)).toBe("/api/public/:token/summary");
  });

  it("redacts secret query parameters and token-looking values, keeps the rest", () => {
    expect(redactUrl("/api/auth/reset?token=abc&page=2")).toBe(
      "/api/auth/reset?token=[REDACTED]&page=2"
    );
    expect(redactUrl("/api/auth/oauth/google/callback?state=s1&code=c1")).toBe(
      "/api/auth/oauth/google/callback?state=[REDACTED]&code=[REDACTED]"
    );
    expect(redactUrl(`/api/x?ref=${HEX}&limit=10`)).toBe(`/api/x?ref=[REDACTED]&limit=10`);
    expect(redactUrl(`/api/x?q=hello&limit=10`)).toBe(`/api/x?q=hello&limit=10`);
  });

  it("drops fragments and leaves ordinary ids and words alone", () => {
    expect(redactUrl(`/page#t=${HEX}`)).not.toContain(HEX);
    expect(redactUrl(`/api/companies/${UUID}/invoices`)).toBe(`/api/companies/${UUID}/invoices`);
    expect(redactUrl("/api/companies/x/portal-invitations/bulk")).toBe(
      "/api/companies/x/portal-invitations/bulk"
    );
    expect(redactUrl("/api/some-really-long-descriptive-route-name-without-digits")).toBe(
      "/api/some-really-long-descriptive-route-name-without-digits"
    );
    expect(redactUrl(undefined)).toBe("");
  });

  it("looksLikeToken needs length, letters and digits and rejects UUIDs", () => {
    expect(looksLikeToken(HEX)).toBe(true);
    expect(looksLikeToken(B64)).toBe(true);
    expect(looksLikeToken(UUID)).toBe(false);
    expect(looksLikeToken("short1")).toBe(false);
  });
});

describe("S5-SEC-4 invitation note and sender", () => {
  it("removes URLs, addresses and bare domains from the note", () => {
    const note = neutraliseInviteNote(
      "Pay at https://evil.test/login or www.evil.test, mail ceo@bank.test, see evil.test/x. Thanks"
    );
    expect(note).not.toMatch(/evil|bank\.test|https?:/i);
    expect(note).toContain("Thanks");
    expect(neutraliseInviteNote("javascript:alert(1) and mailto:a@b.co")).not.toMatch(
      /javascript|mailto/
    );
    expect(neutraliseInviteNote("Plain note, no links.")).toBe("Plain note, no links.");
  });

  it("the rendered email carries only the invite link, as text", () => {
    const mail = renderPortalInviteEmail({
      company: { name: "Acme", trnVatNumber: null, businessAddress: null, contactEmail: null },
      contact: { name: "Cust", nameAr: null },
      invitation: {
        language: "en",
        name: "Cust",
        message: "Confirm at http://phish.test/now and login.phish.test",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      url: "https://app.example.test/portal/join#t=abc",
      onlinePayment: false,
    });
    expect(mail.html).not.toContain("phish");
    expect(mail.text).not.toContain("phish");
    expect(mail.text).toContain("[link removed]");
  });

  it("the sender name is the registered name, stripped of addresses, links and controls", () => {
    expect(inviteSenderName({ name: "Acme Trading", legalName: "Acme Trading LLC" })).toBe(
      "Acme Trading LLC"
    );
    expect(inviteSenderName({ name: "Acme", legalName: null })).toBe("Acme");
    const spoof = inviteSenderName({
      name: 'Bank <security@bank.test> https://bank.test/verify "Support"\r\nBcc: x',
      legalName: null,
    });
    expect(spoof).not.toMatch(/[<>@"\r\n:]|https?/);
    expect(spoof.length).toBeLessThanOrEqual(60);
    expect(inviteSenderName({ name: "<>@:", legalName: null })).toBe("Muhasib.ai");
  });
});

describe("S5-SEC-6 message DTO", () => {
  it("returns no sender, recipient, company or contact ids", () => {
    const dto = portalMessageDto(
      {
        id: "m1",
        threadId: null,
        subject: "Hi",
        content: "Hello",
        senderId: "u1",
        isRead: false,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        // extra columns of the row must not leak
        ...({ recipientId: "u2", companyId: "c1", contactId: "k1" } as object),
      },
      "u1"
    );
    expect(Object.keys(dto).sort()).toEqual(
      ["content", "createdAt", "fromMe", "id", "isRead", "subject", "threadId"].sort()
    );
    expect(dto.fromMe).toBe(true);
  });
});
