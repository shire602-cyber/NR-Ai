import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { apiRequest } from "@/lib/queryClient";

interface BankConnection {
  id: string;
  provider: string;
  status: string;
  hasToken: boolean;
  bankAccountId: string | null;
  bankName: string | null;
  accountName: string | null;
  accountNumberLast4: string | null;
}

export function BankConnectionRecovery() {
  const { companyId } = useDefaultCompany();
  const { known, can } = useCompanyPermission();
  const { t } = useTranslation(["banking"]);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canRetry = !!companyId && known && can("documents.write");
  const { data: providers } = useQuery<{ providers: string[] }>({
    queryKey: ["/api/bank/providers"],
    enabled: canRetry,
  });
  const { data: connections } = useQuery<BankConnection[]>({
    queryKey: ["/api/companies", companyId, "bank-connections"],
    enabled: canRetry && !!providers?.providers.length,
  });
  const retry = useMutation({
    mutationFn: ({ id }: { id: string; companyId: string }) =>
      apiRequest("POST", `/api/bank-connections/${id}/sync`, {}),
    onSuccess: async (_result, connection) => {
      const prefix = ["/api/companies", connection.companyId];
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...prefix, "bank-connections"] }),
        queryClient.invalidateQueries({ queryKey: [...prefix, "bank-statements"] }),
      ]);
      toast({ title: t["banking.recovery.success"] });
    },
    onError: () => toast({ variant: "destructive", title: t["banking.recovery.failed"] }),
  });

  if (!companyId || !canRetry || !providers) return null;
  const failedConnections = (connections ?? []).filter(
    (connection) =>
      connection.status === "error" &&
      connection.hasToken &&
      connection.bankAccountId &&
      providers.providers.includes(connection.provider)
  );
  if (failedConnections.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t["banking.recovery.title"]}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {failedConnections.map((connection) => (
            <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3">
              <span id={`bank-recovery-${connection.id}`} dir="auto" translate="no">
                {connection.accountName || connection.bankName || t["banking.recovery.account"]}
                {connection.accountNumberLast4 && ` •••• ${connection.accountNumberLast4}`}
              </span>
              <Button
                variant="outline"
                aria-describedby={`bank-recovery-${connection.id}`}
                disabled={retry.isPending}
                onClick={() => retry.mutate({ id: connection.id, companyId })}
              >
                {retry.isPending && retry.variables?.id === connection.id
                  ? t["banking.recovery.retrying"]
                  : t["banking.recovery.retry"]}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
