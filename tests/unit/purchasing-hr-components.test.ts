/**
 * Phase 8 D2 components rendered on the server (no DOM): the approval badge in both languages, the vendor picker's
 * closed state, and the approval toast copy.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useI18n } from "../../client/src/lib/i18n";
import { ApprovalStatusBadge } from "../../client/src/components/approvals/ApprovalStatusBadge";
import { VendorPicker } from "../../client/src/components/purchases/VendorPicker";
import { messages as pickerMessages } from "../../client/src/components/purchases/VendorPicker.i18n";
import { messages as badgeMessages } from "../../client/src/components/approvals/ApprovalStatusBadge.i18n";
import { approvalFeedback } from "../../client/src/lib/approval-feedback";
import { ApiError } from "../../client/src/lib/queryClient";

const setLocale = (locale: "en" | "ar") => useI18n.setState({ locale });
beforeEach(() => setLocale("en"));

describe("ApprovalStatusBadge", () => {
  it("shows steps done of required for a multi-step approval", () => {
    const html = renderToStaticMarkup(createElement(ApprovalStatusBadge, { status: "pending_approval", completedSteps: 1, requiredSteps: 2 }));
    expect(html).toContain("Pending approval 1/2");
    expect(html).toContain('data-testid="badge-approval-pending_approval"');
  });

  it("shows plain 'Pending approval' for a single step, and the final states", () => {
    expect(renderToStaticMarkup(createElement(ApprovalStatusBadge, { status: "pending_approval", requiredSteps: 1 }))).toContain("Pending approval<");
    expect(renderToStaticMarkup(createElement(ApprovalStatusBadge, { status: "approved" }))).toContain("Approved");
    expect(renderToStaticMarkup(createElement(ApprovalStatusBadge, { status: "rejected" }))).toContain("Rejected");
  });

  it("has Arabic for every state it can show (server rendering always reads the initial English store)", () => {
    setLocale("ar");
    expect(badgeMessages.t("pendingApprovalSteps", { done: 1, total: 2 })).toBe("بانتظار الموافقة 1/2");
    expect(badgeMessages.t("rejected")).toBe("مرفوض");
  });
});

describe("VendorPicker", () => {
  const render = (props: Partial<Parameters<typeof VendorPicker>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(VendorPicker, { companyId: "c1", vendorId: null, onSelect: () => {}, ...props })
      )
    );

  it("shows the placeholder when no vendor is chosen", () => {
    const html = render();
    expect(html).toContain("Choose a vendor");
    expect(html).toContain('role="combobox"');
  });

  it("shows the name of a legacy document that has no linked vendor yet", () => {
    expect(render({ fallbackName: "Acme Supplies" })).toContain("Acme Supplies");
  });

  it("is disabled when asked (a credit note linked to a bill keeps the bill's vendor)", () => {
    expect(render({ disabled: true })).toContain("disabled");
  });

  it("has Arabic copy for the placeholder and the inline create action", () => {
    setLocale("ar");
    expect(pickerMessages.t("placeholder")).toBe("اختر مورداً");
    expect(pickerMessages.t("create", { name: "Acme" })).toContain("Acme");
  });
});

describe("approvalFeedback", () => {
  it("names the role a step needs", () => {
    const error = new ApiError("x", 403, "APPROVAL_REQUIRED", { step: 2, requiredSteps: 2, requiredRole: "owner" });
    const feedback = approvalFeedback(error);
    expect(feedback?.description).toBe("Step 2 of 2 needs approval from the owner role or higher.");
  });

  it("translates the role in Arabic", () => {
    setLocale("ar");
    const error = new ApiError("x", 403, "APPROVAL_REQUIRED", { step: 1, requiredSteps: 2, requiredRole: "accountant" });
    expect(approvalFeedback(error)?.description).toContain("المحاسب");
  });

  it("explains the other refusals and ignores everything else", () => {
    expect(approvalFeedback(new ApiError("x", 403, "APPROVER_ALREADY_SIGNED"))?.description).toMatch(/already signed/);
    expect(approvalFeedback(new ApiError("x", 403, "SELF_APPROVAL"))?.description).toMatch(/cannot approve/);
    expect(approvalFeedback(new ApiError("x", 409, "APPROVAL_IN_PROGRESS"))?.description).toMatch(/waiting for approval/);
    expect(approvalFeedback(new ApiError("x", 500, "OTHER"))).toBeNull();
    expect(approvalFeedback(new Error("plain"))).toBeNull();
  });
});
