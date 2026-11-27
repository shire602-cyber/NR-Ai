import { formatActivityCount } from "@/lib/activity-log-labels";
import { formatMessage } from "@/lib/i18n";
import { securityFetch } from "@/lib/securityApi";

interface AuditChainStatus {
  ok: boolean;
  checked: number;
  firstBroken: { seq: number; reason: string } | null;
}

export interface AuditChainResult {
  ok: boolean;
  format(t: Record<string, string>, locale: string): string;
}

export async function verifyAuditChain(): Promise<AuditChainResult> {
  const { ok, checked, firstBroken } = await securityFetch<AuditChainStatus>(
    "GET",
    "/api/admin/audit-log/verify"
  );
  return {
    ok,
    format(t: Record<string, string>, locale: string) {
      if (ok) {
        return formatActivityCount(t["activityLogs.chainVerified"], checked, locale);
      }
      const numberLocale = locale === "ar" ? "ar-u-nu-arab" : locale;
      const reasonKey = `activityLogs.chainReason.${firstBroken?.reason}`;
      const reason = t[reasonKey];
      return formatMessage(t["security.auditBroken"], {
        seq: firstBroken?.seq.toLocaleString(numberLocale) ?? "?",
        reason:
          (reason === reasonKey ? undefined : reason) ?? t["activityLogs.chainReason.unknown"],
      });
    },
  };
}
