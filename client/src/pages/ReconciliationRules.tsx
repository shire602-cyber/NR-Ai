import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Trash2, Edit, Zap, Loader2 } from "lucide-react";
import { messages as pageMessages } from "./ReconciliationRules.i18n";

interface ReconciliationRule {
  id: string;
  companyId: string;
  name: string;
  priority: number | null;
  matchField: string;
  matchType: string;
  matchValue: string;
  targetAccountId: string | null;
  category: string | null;
  memo: string | null;
  isActive: boolean | null;
  timesApplied: number | null;
  createdAt: string;
}

interface AutoMatchResult {
  matched: number;
  totalUnreconciled: number;
  rulesEvaluated: number;
}

const ruleFormSchema = z.object({
  name: z.string().min(1, pageMessages.marker("ruleNameIsRequired")),
  priority: z.coerce.number().int().min(0).default(0),
  matchField: z.enum(["description", "reference", "amount"]),
  matchType: z.enum(["contains", "exact", "starts_with", "regex"]),
  matchValue: z.string().min(1, pageMessages.marker("matchValueIsRequired")),
  category: z.string().optional(),
  memo: z.string().optional(),
  isActive: z.boolean().default(true),
});

type RuleFormData = z.infer<typeof ruleFormSchema>;

const getMatchFieldLabels = (): Record<string, string> => ({
  description: pageMessages.t("description"),
  reference: pageMessages.t("reference"),
  amount: pageMessages.t("amount"),
});

const getMatchTypeLabels = (): Record<string, string> => ({
  contains: pageMessages.t("contains"),
  exact: pageMessages.t("exactMatch"),
  starts_with: pageMessages.t("startsWith"),
  regex: pageMessages.t("regex"),
});

export default function ReconciliationRules() {
  const tr = pageMessages.useT();

  const { t } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const { canAccess, getRequiredTier } = useSubscription();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ReconciliationRule | null>(null);

  const { data: rules, isLoading } = useQuery<ReconciliationRule[]>({
    queryKey: ["/api/companies", selectedCompanyId, "reconciliation-rules"],
    enabled: !!selectedCompanyId,
  });

  const form = useForm<RuleFormData>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: {
      name: "",
      priority: 0,
      matchField: "description",
      matchType: "contains",
      matchValue: "",
      category: "",
      memo: "",
      isActive: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: RuleFormData) => {
      return await apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/reconciliation-rules`,
        data
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "reconciliation-rules"],
      });
      toast({
        title: tr("ruleCreated"),
        description: tr("reconciliationRuleHasBeenCreatedSuccessfully"),
      });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<RuleFormData> }) => {
      return await apiRequest("PUT", `/api/reconciliation-rules/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "reconciliation-rules"],
      });
      toast({
        title: tr("ruleUpdated"),
        description: tr("reconciliationRuleHasBeenUpdatedSuccessfully"),
      });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/reconciliation-rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "reconciliation-rules"],
      });
      toast({ title: tr("ruleDeleted"), description: tr("reconciliationRuleHasBeenDeleted") });
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return await apiRequest("PUT", `/api/reconciliation-rules/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "reconciliation-rules"],
      });
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const autoMatchMutation = useMutation({
    mutationFn: async () => {
      return (await apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/reconciliation-rules/auto-match`
      )) as AutoMatchResult;
    },
    onSuccess: (result: AutoMatchResult) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "reconciliation-rules"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "bank-transactions"],
      });
      toast({
        title: tr("autoMatchCompleted"),
        description: tr("matchedOfUnreconciledTransactionsUsingRules", {
          matched: result.matched,
          totalUnreconciled: result.totalUnreconciled,
          rulesEvaluated: result.rulesEvaluated,
        }),
      });
    },
    onError: (error: Error) => {
      toast({ title: tr("autoMatchFailed"), description: error?.message, variant: "destructive" });
    },
  });

  function openCreateDialog() {
    setEditingRule(null);
    form.reset({
      name: "",
      priority: 0,
      matchField: "description",
      matchType: "contains",
      matchValue: "",
      category: "",
      memo: "",
      isActive: true,
    });
    setDialogOpen(true);
  }

  function openEditDialog(rule: ReconciliationRule) {
    setEditingRule(rule);
    form.reset({
      name: rule.name,
      priority: rule.priority ?? 0,
      matchField: rule.matchField as "description" | "reference" | "amount",
      matchType: rule.matchType as "contains" | "exact" | "starts_with" | "regex",
      matchValue: rule.matchValue,
      category: rule.category ?? "",
      memo: rule.memo ?? "",
      isActive: rule.isActive ?? true,
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingRule(null);
    form.reset();
  }

  function onSubmit(data: RuleFormData) {
    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  if (!canAccess("bankImport")) {
    return <UpgradePrompt feature="bankImport" requiredTier={getRequiredTier("bankImport")} />;
  }

  if (!selectedCompanyId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">{tr("pleaseSelectACompanyToManage")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        eyebrow={tr("accounting")}
        title={tr("reconciliationRules")}
        description={tr("defineRulesToAutomaticallyMatchAnd")}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => autoMatchMutation.mutate()}
              disabled={autoMatchMutation.isPending}
            >
              {autoMatchMutation.isPending ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="me-2 h-4 w-4" />
              )}
              {tr("runAutoMatch")}
            </Button>
            <Button onClick={openCreateDialog}>
              <Plus className="me-2 h-4 w-4" />
              {tr("addRule")}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{tr("rules")}</CardTitle>
          <CardDescription>{tr("rulesAreEvaluatedInPriorityOrder")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !rules || rules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {tr("noReconciliationRulesYetCreateOne")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">{tr("priority")}</TableHead>
                  <TableHead>{tr("name")}</TableHead>
                  <TableHead>{tr("matchField")}</TableHead>
                  <TableHead>{tr("matchType")}</TableHead>
                  <TableHead>{tr("matchValue")}</TableHead>
                  <TableHead>{tr("category")}</TableHead>
                  <TableHead className="text-center">{tr("applied")}</TableHead>
                  <TableHead className="text-center">{tr("active")}</TableHead>
                  <TableHead className="text-end">{tr("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-mono text-sm">{rule.priority ?? 0}</TableCell>
                    <TableCell className="font-medium">{rule.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {getMatchFieldLabels()[rule.matchField] || rule.matchField}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {getMatchTypeLabels()[rule.matchType] || rule.matchType}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate font-mono text-sm">
                      {rule.matchValue}
                    </TableCell>
                    <TableCell>{rule.category || "-"}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{rule.timesApplied ?? 0}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={rule.isActive ?? true}
                        onCheckedChange={(checked) =>
                          toggleActiveMutation.mutate({ id: rule.id, isActive: checked })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(rule)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(rule.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingRule ? tr("editRule") : tr("createRule")}</DialogTitle>
            <DialogDescription>
              {editingRule
                ? tr("updateThisReconciliationRule")
                : tr("defineANewRuleToAutomatically")}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("ruleName")}</FormLabel>
                    <FormControl>
                      <Input placeholder={tr("eGOfficeRentPayment")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("priority")}</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} placeholder="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="matchField"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("matchField")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={tr("selectField")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="description">{tr("description")}</SelectItem>
                          <SelectItem value="reference">{tr("reference")}</SelectItem>
                          <SelectItem value="amount">{tr("amount")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="matchType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("matchType")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={tr("selectType")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="contains">{tr("contains")}</SelectItem>
                          <SelectItem value="exact">{tr("exactMatch")}</SelectItem>
                          <SelectItem value="starts_with">{tr("startsWith")}</SelectItem>
                          <SelectItem value="regex">{tr("regex")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="matchValue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("matchValue")}</FormLabel>
                    <FormControl>
                      <Input placeholder={tr("eGRentOrSalary")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("categoryOptional")}</FormLabel>
                    <FormControl>
                      <Input placeholder={tr("eGRentSalaryUtilities")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="memo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("memoOptional")}</FormLabel>
                    <FormControl>
                      <Input placeholder={tr("internalNoteForThisRule")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <FormLabel className="text-base">{tr("active")}</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        {tr("enableThisRuleForAutoMatching")}
                      </p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={closeDialog}>
                  {tr("cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  )}
                  {editingRule ? tr("updateRule") : tr("createRule")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
