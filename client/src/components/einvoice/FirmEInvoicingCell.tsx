/**
 * WQ5: the NR firm console's e-invoicing column. One pill per client, from
 * GET /api/firm/command-center/clients/health (`einvoicing`). "Connected" only appears when the
 * deployment's configured partner reports the client's legal entity as active.
 */
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { formatMessage, useTranslation } from "@/lib/i18n";

export type FirmEInvoicingState =
  | "connected"
  | "self_confirmed"
  | "awaiting_approval"
  | "appoint_partner"
  | "partner_not_chosen"
  | "identity_missing";

export interface FirmEInvoicingValue {
  state: FirmEInvoicingState;
  missing: number;
  partner: string | null;
}

const TONE: Record<FirmEInvoicingState, StatusTone> = {
  connected: "success",
  self_confirmed: "warning",
  awaiting_approval: "info",
  appoint_partner: "accent",
  partner_not_chosen: "neutral",
  identity_missing: "danger",
};

export function FirmEInvoicingCell({ value }: { value: FirmEInvoicingValue | null | undefined }) {
  const { t } = useTranslation();
  if (!value) return <span className="text-muted-foreground">—</span>;
  const label =
    value.state === "identity_missing"
      ? formatMessage(t["einvoicing.firmState.identity_missing"], { count: value.missing })
      : t[`einvoicing.firmState.${value.state}`];
  return (
    <StatusBadge tone={TONE[value.state]} data-testid={`firm-einvoicing-${value.state}`}>
      {label}
    </StatusBadge>
  );
}
