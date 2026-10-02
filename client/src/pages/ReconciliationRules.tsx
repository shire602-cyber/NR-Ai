import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Edit, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { BankAccount, LedgerAccount, ReconciliationRule } from "@/lib/banking-api-types";
import { messages as common } from "@/components/banking/BankingCommon.i18n";
import { bankingErrorText } from "@/components/banking/banking-common";
import { RuleDialog } from "@/components/banking/RuleDialog";
import { RulesApplyPanel } from "@/components/banking/RulesApplyPanel";
import { ruleAccountOptions } from "@/components/banking/rule-split";
import { messages as pageMessages } from "./ReconciliationRules.i18n";

export default function ReconciliationRules() {
  const tr = pageMessages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const { canAccess, getRequiredTier } = useSubscription();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ReconciliationRule | null>(null);
  const [toDelete, setToDelete] = useState<ReconciliationRule | null>(null);

  const rulesKey = ["/api/companies", companyId, "reconciliation-rules"];
  const { data: rules, isLoading, isError } = useQuery<ReconciliationRule[]>({ queryKey: rulesKey, enabled: !!companyId });
  const { data: accounts = [] } = useQuery<LedgerAccount[]>({ queryKey: ["/api/companies", companyId, "accounts"], enabled: !!companyId });
  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({ queryKey: ["/api/companies", companyId, "bank-accounts"], enabled: !!companyId });
  const options = useMemo(() => ruleAccountOptions(accounts, bankAccounts), [accounts, bankAccounts]);

  const fail = (title: string) => (err: unknown) => toast({ variant: "destructive", title, description: bankingErrorText(trc, err, locale) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: rulesKey });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/reconciliation-rules/${id}`),
    onSuccess: () => {
      refresh();
      setToDelete(null);
      toast({ title: tr("deleted") });
    },
    onError: fail(tr("error")),
  });
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiRequest("PUT", `/api/reconciliation-rules/${id}`, { isActive }),
    onSuccess: refresh,
    onError: fail(tr("toggleFailed")),
  });

  const fieldText = (f: string) => (f === "reference" ? tr("fieldReference") : f === "amount" ? tr("fieldAmount") : tr("fieldDescription"));
  const typeText = (t: string) => (t === "equals" || t === "exact" ? tr("typeEquals") : t === "starts_with" ? tr("typeStartsWith") : t === "regex" ? tr("typeRegex") : tr("typeContains"));
  const dirText = (d: string) => (d === "inflow" ? tr("dirInflow") : d === "outflow" ? tr("dirOutflow") : tr("dirAny"));

  if (!canAccess("bankImport")) return <UpgradePrompt feature="bankImport" requiredTier={getRequiredTier("bankImport")} />;
  if (!companyId) {
    return (
      <Card>
        <CardContent className="p-6 text-muted-foreground">{tr("selectCompany")}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="rules-page">
      <PageHeader
        eyebrow={tr("accounting")}
        title={tr("title")}
        description={tr("description")}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            data-testid="button-add-rule"
          >
            <Plus className="me-2 h-4 w-4" />
            {tr("addRule")}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{tr("rules")}</CardTitle>
          <CardDescription>{tr("rulesHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <p className="text-sm text-destructive">{tr("loadFailed")}</p>
          ) : !rules || rules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="rules-empty">
              {tr("empty")}
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">{tr("colPriority")}</TableHead>
                    <TableHead>{tr("colName")}</TableHead>
                    <TableHead>{tr("colMatch")}</TableHead>
                    <TableHead>{tr("colSplit")}</TableHead>
                    <TableHead>{tr("colDirection")}</TableHead>
                    <TableHead>{tr("colVat")}</TableHead>
                    <TableHead className="text-center">{tr("colApplied")}</TableHead>
                    <TableHead className="text-center">{tr("colActive")}</TableHead>
                    <TableHead className="text-end">{tr("colActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((r) => (
                    <TableRow key={r.id} data-testid={`rule-row-${r.id}`}>
                      <TableCell className="font-mono text-sm">{r.priority ?? 0}</TableCell>
                      <TableCell className="font-medium" dir="auto">
                        {r.name}
                      </TableCell>
                      <TableCell className="text-sm max-w-[16rem] truncate" dir="auto" title={r.matchValue}>
                        {tr("matchLine", { field: fieldText(r.matchField), type: typeText(r.matchType), value: r.matchValue })}
                      </TableCell>
                      <TableCell className="text-sm">
                        <Badge variant="outline">{tr("splitSummary", { count: Array.isArray(r.splitLines) ? r.splitLines.length : 0 })}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{dirText(r.direction ?? "any")}</TableCell>
                      <TableCell>
                        <Badge variant={Number(r.vatRate ?? 0) > 0 ? "secondary" : "outline"}>{Number(r.vatRate ?? 0) > 0 ? tr("vatYes") : tr("vatNo")}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{r.timesApplied ?? 0}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch checked={r.isActive ?? true} onCheckedChange={(checked) => toggle.mutate({ id: r.id, isActive: checked })} aria-label={tr("colActive")} />
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={tr("edit")}
                            onClick={() => {
                              setEditing(r);
                              setDialogOpen(true);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label={tr("delete")} onClick={() => setToDelete(r)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <RulesApplyPanel companyId={companyId} bankAccounts={bankAccounts} />

      <RuleDialog open={dialogOpen} onOpenChange={setDialogOpen} companyId={companyId} rule={editing} accounts={options} bankAccounts={bankAccounts} />

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tr("deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove.mutate(toDelete.id)}>{tr("deleteConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
