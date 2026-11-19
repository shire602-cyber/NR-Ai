import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format-date";
import { formatMessage, useTranslation } from "@/lib/i18n";

export interface PortalSummaryEntry {
  active: number;
  state: "active" | "invited" | "expired" | "revoked";
  expiresAt: string | null;
}

const TONE: Record<PortalSummaryEntry["state"], StatusTone> = {
  active: "success",
  invited: "info",
  expired: "warning",
  revoked: "neutral",
};

/** The contact row's portal state (text, never colour alone). Nothing for a contact never invited. */
export function PortalStatusChip({
  entry,
  contactId,
}: {
  entry: PortalSummaryEntry | undefined;
  contactId: string;
}) {
  const { t, locale } = useTranslation();
  if (!entry) return null;
  const label =
    entry.state === "invited" && entry.expiresAt
      ? formatMessage(t["portal.chip.invitedUntil"], { date: formatDate(entry.expiresAt, locale) })
      : t[`portal.chip.${entry.state}`];
  return (
    <StatusBadge
      tone={TONE[entry.state]}
      className="shrink-0 whitespace-nowrap"
      data-testid={`portal-chip-${contactId}`}
      data-state={entry.state}
    >
      {label}
    </StatusBadge>
  );
}
