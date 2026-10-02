import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { BankAccount, RevaluationPreview } from "@/lib/banking-api-types";
import { RevalueDialog } from "@/components/banking/RevalueDialog";
import { messages } from "./RevaluationChecklistRow.i18n";

function OneAction({
  companyId,
  account,
  periodEnd,
  onOpen,
}: {
  companyId: string;
  account: BankAccount;
  periodEnd: string;
  onOpen: (a: BankAccount) => void;
}) {
  const tr = messages.useT();
  const { data } = useQuery<RevaluationPreview>({
    queryKey: [
      "/api/companies",
      companyId,
      `bank-accounts/${account.id}/revaluation?asOf=${periodEnd}`,
    ],
    retry: false,
  });
  // an account whose rate is missing still needs the action: the dialog asks for the rate
  const open = !data || (!data.alreadyPosted && Math.abs(data.adjustmentAed) >= 0.01);
  if (!open) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive hover:text-destructive"
      onClick={() => onOpen(account)}
      data-testid={`button-revalue-checklist-${account.id}`}
    >
      {tr("revalue", { name: account.nameEn })}
    </Button>
  );
}

/** The action on the month-end "foreign-currency bank balances revalued" item: open the revaluation of each account still open. */
export function RevalueActions({ companyId, periodEnd }: { companyId: string; periodEnd: string }) {
  const { data: banks = [] } = useQuery<BankAccount[]>({
    queryKey: ["/api/companies", companyId, "bank-accounts"],
    enabled: !!companyId,
  });
  const [account, setAccount] = useState<BankAccount | null>(null);
  const foreign = banks.filter((b) => b.isActive && (b.currency || "AED").toUpperCase() !== "AED");
  if (foreign.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return null;
  return (
    <div className="flex flex-col items-end gap-1" data-testid="revalue-actions">
      {foreign.map((b) => (
        <OneAction
          key={b.id}
          companyId={companyId}
          account={b}
          periodEnd={periodEnd}
          onOpen={setAccount}
        />
      ))}
      <RevalueDialog
        open={!!account}
        onOpenChange={(o) => !o && setAccount(null)}
        companyId={companyId}
        account={account}
        initialAsOf={periodEnd}
      />
    </div>
  );
}
