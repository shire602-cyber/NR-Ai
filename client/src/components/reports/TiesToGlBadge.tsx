/**
 * X6d: "Ties to GL" proof badges. They show the reconciliation figures the server already
 * computes (VAT 201 vs the VAT control accounts; AR/AP aging vs GL 1040 / 2010) and are green
 * only when the difference is exactly zero. Any difference is shown, never hidden.
 */
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Money } from "@/components/ui/money";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { apiRequest } from "@/lib/queryClient";
import { tiesState, type TiesState } from "@/lib/ties-to-gl";

const TONE: Record<TiesState, StatusTone> = {
  ties: "success",
  explained: "info",
  differs: "danger",
  none: "neutral",
};

export function TiesToGlProof({
  state,
  differenceAed,
  explainedAed,
  detail,
  testId,
}: {
  state: TiesState;
  /** Unexplained difference in AED (major units); shown whenever it is not zero. */
  differenceAed: number;
  explainedAed?: number;
  /** e.g. "GL 1040 Accounts Receivable". */
  detail?: string | null;
  testId?: string;
}) {
  const { t } = useTranslation();
  const Icon = state === "ties" ? CheckCircle2 : state === "differs" ? AlertTriangle : Info;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"
      data-testid={testId}
      data-ties-state={state}
    >
      <StatusBadge tone={TONE[state]} className="gap-1">
        <Icon aria-hidden className="h-3 w-3" />
        {state === "ties" && t["launchProof.ties"]}
        {state === "explained" && t["launchProof.tiesExplained"]}
        {state === "differs" && t["launchProof.differs"]}
        {state === "none" && t["launchProof.notComparable"]}
      </StatusBadge>
      {state !== "none" && (
        <span className="text-caption text-muted-foreground">
          {t["launchProof.difference"]}: <Money amount={differenceAed} />
          {state === "explained" && explainedAed !== undefined && (
            <>
              {" "}
              ·{" "}
              {formatMessage(t["launchProof.explainedItems"], {
                amount: explainedAed.toFixed(2),
              })}
            </>
          )}
          {detail ? <> · {detail}</> : null}
        </span>
      )}
    </span>
  );
}

interface VatRecon {
  hasVatAccounts: boolean;
  outputDifferenceFils: number;
  inputDifferenceFils: number;
  unexplainedOutputFils: number;
  unexplainedInputFils: number;
  explainedOutputFils: number;
  explainedInputFils: number;
}

/** Badge for a VAT 201 (preview or generated) from `/vat/compute`'s reconciliation block. */
export function VatTiesToGl({ reconciliation }: { reconciliation: VatRecon | null | undefined }) {
  if (!reconciliation) return null;
  const unexplained =
    Math.abs(reconciliation.unexplainedOutputFils) + Math.abs(reconciliation.unexplainedInputFils);
  const explained =
    Math.abs(reconciliation.explainedOutputFils) + Math.abs(reconciliation.explainedInputFils);
  const state = tiesState({
    differenceFils: unexplained,
    explainedFils: explained,
    comparable: reconciliation.hasVatAccounts,
  });
  return (
    <TiesToGlProof
      state={state}
      differenceAed={unexplained / 100}
      explainedAed={explained / 100}
      testId="vat-ties-to-gl"
    />
  );
}

interface AgingResponse {
  asOf: string;
  reconciliation: {
    controlAccountCode: string | null;
    controlAccountName: string | null;
    glBalance: number;
    agingTotal: number;
    difference: number;
    isReconciled: boolean;
  };
}

/** Badge for the A/R or A/P aging report from the canonical aged-* endpoint. */
export function AgingTiesToGl({
  companyId,
  kind,
}: {
  companyId: string | undefined;
  kind: "receivables" | "payables";
}) {
  const { t } = useTranslation();
  const { data, isError } = useQuery<AgingResponse>({
    queryKey: ["/api/companies", companyId, "reports", `aged-${kind}`, "ties"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/reports/aged-${kind}`),
    enabled: !!companyId,
    retry: false,
  });
  if (isError || !data?.reconciliation) return null;
  const r = data.reconciliation;
  const state = tiesState({
    differenceFils: Math.round(Math.abs(r.difference) * 100),
    comparable: r.controlAccountCode !== null,
  });
  const detail = r.controlAccountCode
    ? formatMessage(t["launchProof.controlAccount"], {
        code: r.controlAccountCode,
        balance: r.glBalance.toFixed(2),
      })
    : null;
  return (
    <TiesToGlProof
      state={state}
      differenceAed={r.difference}
      detail={detail}
      testId={`aging-ties-to-gl-${kind}`}
    />
  );
}
