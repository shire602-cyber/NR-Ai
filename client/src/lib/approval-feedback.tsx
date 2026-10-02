import { ApiError } from "@/lib/queryClient";
import { approvalErrorKind } from "@/lib/purchasing-hr";
import { messages } from "./approval-feedback.i18n";

export interface ApprovalFeedback {
  title: string;
  description: string;
}

const roleName = (role: unknown): string => {
  switch (role) {
    case "accountant":
      return messages.t("roleAccountant");
    case "cfo":
      return messages.t("roleCfo");
    case "owner":
      return messages.t("roleOwner");
    default:
      return messages.t("roleApprover");
  }
};

/**
 * A toast for the approval refusals (403 APPROVAL_REQUIRED naming the role, a second signature by the same person,
 * self approval, a document that is waiting for approval). Null for any other error: the caller shows its own.
 */
export function approvalFeedback(error: unknown): ApprovalFeedback | null {
  if (!(error instanceof ApiError)) return null;
  const kind = approvalErrorKind(error.code);
  if (!kind) return null;
  if (kind === "required") {
    const d = (error.details ?? {}) as { step?: number; requiredSteps?: number; requiredRole?: string };
    return {
      title: messages.t("requiredTitle"),
      description: messages.t("requiredBody", {
        role: roleName(d.requiredRole),
        step: d.step ?? 1,
        total: d.requiredSteps ?? 1,
      }),
    };
  }
  const bodies = { alreadySigned: "alreadySignedBody", self: "selfBody", inProgress: "inProgressBody" } as const;
  return { title: messages.t("blockedTitle"), description: messages.t(bodies[kind]) };
}

/** Message and variant for a failed action: the approval feedback when it is one, else the server's message. */
export function failureToast(error: unknown, fallbackTitle: string): { variant: "destructive"; title: string; description?: string } {
  const feedback = approvalFeedback(error);
  if (feedback) return { variant: "destructive", ...feedback };
  return { variant: "destructive", title: fallbackTitle, description: (error as { message?: string })?.message };
}
