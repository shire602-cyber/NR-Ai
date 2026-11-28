/**
 * STEP5 security fixes that are pure functions: the invitation note
 * neutraliser and the sender name constraint (S5-SEC-4), and the message DTO (S5-SEC-6).
 */
import { describe, expect, it } from "vitest";
import {
  neutraliseInviteNote,
  renderPortalInviteEmail,
} from "../../server/services/portal-invite-email";
import { inviteSenderName } from "../../server/services/portal-invitations.service";
import { portalMessageDto } from "../../server/routes/client-portal.routes";

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
