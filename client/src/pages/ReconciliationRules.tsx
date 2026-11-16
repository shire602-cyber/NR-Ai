import { T } from "@/components/layout/T";
import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
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
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Trash2, Edit, Zap, Loader2 } from "lucide-react";

interface ReconciliationRule {
  id: string;
  companyId: string;
  name: string;
  priority: number | null;
  matchField: string;
  matchType: string;
  matchValue: string;
  accountId: string | null;
  vatTreatment: string;
  requireReview: boolean;
  direction: string;
  category: string | null;
  memo: string | null;
  isActive: boolean | null;
  timesApplied: number | null;
  createdAt: string;
}

interface AutoMatchResult {
  matched: number;
  posted: number;
  pendingReview: number;
  totalUnreconciled: number;
  rulesEvaluated: number;
  errors: Array<{ bankTransactionId: string; message: string }>;
}

interface RuleSuggestion {
  matchValue: string;
  accountId: string;
  accountCode: string | null;
  accountName: string | null;
  occurrences: number;
  direction: "inflow" | "outflow";
}

interface RuleAccountOption {
  id: string;
  code: string;
  nameEn: string;
  type: string;
  subType: string | null;
  isActive: boolean;
}

const ruleFormSchema = z.object({
  name: z.string().min(1, "Rule name is required"),
  priority: z.coerce.number().int().min(0).default(0),
  matchField: z.enum(["description", "reference", "amount"]),
  matchType: z.enum(["contains", "exact", "starts_with", "regex"]),
  matchValue: z.string().min(1, "Match value is required"),
  accountId: z.string().guid("Choose the GL account this rule posts to"),
  vatTreatment: z.enum(["none", "standard", "zero_rated", "exempt"]),
  requireReview: z.boolean().default(false),
  direction: z.enum(["any", "inflow", "outflow"]).default("any"),
  category: z.string().optional(),
  memo: z.string().optional(),
  isActive: z.boolean().default(true),
});

type RuleFormData = z.infer<typeof ruleFormSchema>;

const matchFieldLabels: Record<string, string> = {
  description: "Description",
  reference: "Reference",
  amount: "Amount",
};

const matchTypeLabels: Record<string, string> = {
  contains: "Contains",
  exact: "Exact Match",
  starts_with: "Starts With",
  regex: "Regex",
};

export default function ReconciliationRules() {
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
  const { data: ruleAccounts } = useQuery<RuleAccountOption[]>({
    queryKey: ["/api/companies", selectedCompanyId, "accounts"],
    enabled: !!selectedCompanyId,
  });
  const { data: ruleSuggestions } = useQuery<RuleSuggestion[]>({
    queryKey: ["/api/companies", selectedCompanyId, "reconciliation-rules", "suggestions"],
    enabled: !!selectedCompanyId,
  });
  const postableAccounts = (ruleAccounts ?? []).filter(
    (a) => a.isActive && !(a.type === "asset" && a.subType === "bank")
  );

  const form = useForm<RuleFormData>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: {
      name: "",
      priority: 0,
      matchField: "description",
      matchType: "contains",
      matchValue: "",
      accountId: "",
      vatTreatment: "none",
      requireReview: false,
      direction: "any",
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
        title: "Rule created",
        description: "Reconciliation rule has been created successfully.",
      });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
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
        title: "Rule updated",
        description: "Reconciliation rule has been updated successfully.",
      });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
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
      toast({ title: "Rule deleted", description: "Reconciliation rule has been deleted." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
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
      toast({ title: "Error", description: error?.message, variant: "destructive" });
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
        queryKey: ["/api/companies", selectedCompanyId, "bank-statements"],
      });
      toast({
        title: t["banking.rules.ranTitle"],
        description: formatMessage(t["banking.rules.ranResult"], {
          posted: result.posted,
          review: result.pendingReview,
          total: result.totalUnreconciled,
          errors: result.errors?.length ?? 0,
        }),
      });
    },
    onError: (error: Error) => {
      toast({ title: "Auto-match failed", description: error?.message, variant: "destructive" });
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
      accountId: "",
      vatTreatment: "none",
      requireReview: false,
      direction: "any",
      category: "",
      memo: "",
      isActive: true,
    });
    setDialogOpen(true);
  }

  function openFromSuggestion(sg: RuleSuggestion) {
    setEditingRule(null);
    form.reset({
      name: sg.matchValue.toUpperCase(),
      priority: 0,
      matchField: "description",
      matchType: "contains",
      matchValue: sg.matchValue,
      accountId: sg.accountId,
      vatTreatment: "none",
      requireReview: false,
      direction: sg.direction,
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
      accountId: rule.accountId ?? "",
      vatTreatment: (rule.vatTreatment ?? "none") as RuleFormData["vatTreatment"],
      requireReview: rule.requireReview ?? false,
      direction: (rule.direction ?? "any") as RuleFormData["direction"],
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
            <p className="text-muted-foreground">
              <T k="pageLabels.pleaseSelectACompanyToManage" />
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        eyebrow="Accounting"
        title="Reconciliation Rules"
        description="Define rules to automatically match and categorize bank transactions."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => autoMatchMutation.mutate()}
              disabled={autoMatchMutation.isPending}
            >
              {autoMatchMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-2 h-4 w-4" />
              )}
              Run Auto-Match
            </Button>
            <Button onClick={openCreateDialog}>
              <Plus className="mr-2 h-4 w-4" />
              <T k="pageLabels.addRule" />
            </Button>
          </>
        }
      />

      {ruleSuggestions && ruleSuggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t["banking.rules.suggestionsTitle"]}</CardTitle>
            <CardDescription>{t["banking.rules.suggestionsHint"]}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {ruleSuggestions.map((sg) => (
              <div
                key={`${sg.matchValue}-${sg.accountId}-${sg.direction}`}
                className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
              >
                <span>
                  <span className="font-mono">{sg.matchValue}</span> → {sg.accountCode}{" "}
                  {sg.accountName} ({sg.occurrences})
                </span>
                <Button size="sm" variant="outline" onClick={() => openFromSuggestion(sg)}>
                  {t["banking.rules.useSuggestion"]}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <T k="reportCenter.rules" />
          </CardTitle>
          <CardDescription>
            Rules are evaluated in priority order (lowest number first). The first matching rule
            wins.
          </CardDescription>
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
              <T k="pageLabels.noReconciliationRulesYetCreateOne" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">
                    <T k="pages.priority" />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>
                    <T k="pages.matchField" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.matchType" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.matchValue" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.category" />
                  </TableHead>
                  <TableHead className="text-center">
                    <T k="pageLabels.applied" />
                  </TableHead>
                  <TableHead className="text-center">
                    <T k="pages.active" />
                  </TableHead>
                  <TableHead className="text-right">
                    <T k="pages.actions" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-mono text-sm">{rule.priority ?? 0}</TableCell>
                    <TableCell className="font-medium">{rule.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {matchFieldLabels[rule.matchField] || rule.matchField}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {matchTypeLabels[rule.matchType] || rule.matchType}
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
                    <TableCell className="text-right">
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
            <DialogTitle>{editingRule ? "Edit Rule" : "Create Rule"}</DialogTitle>
            <DialogDescription>
              {editingRule
                ? "Update this reconciliation rule."
                : "Define a new rule to automatically match bank transactions."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <T k="pageLabels.ruleName" />
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Office Rent Payment" {...field} />
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
                    <FormLabel>
                      <T k="pages.priority" />
                    </FormLabel>
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
                      <FormLabel>
                        <T k="pages.matchField" />
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select field" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="description">
                            <T k="pages.description" />
                          </SelectItem>
                          <SelectItem value="reference">
                            <T k="pages.reference" />
                          </SelectItem>
                          <SelectItem value="amount">
                            <T k="pages.amount" />
                          </SelectItem>
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
                      <FormLabel>
                        <T k="pages.matchType" />
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="contains">
                            <T k="pageLabels.contains" />
                          </SelectItem>
                          <SelectItem value="exact">
                            <T k="pageLabels.exactMatch" />
                          </SelectItem>
                          <SelectItem value="starts_with">
                            <T k="pageLabels.startsWith" />
                          </SelectItem>
                          <SelectItem value="regex">
                            <T k="pageLabels.regex" />
                          </SelectItem>
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
                    <FormLabel>
                      <T k="pages.matchValue" />
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. RENT or ^SALARY.*" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="accountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t["banking.rules.account"]}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-rule-account">
                          <SelectValue placeholder={t["banking.rules.account"]} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {postableAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.code} {a.nameEn}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="vatTreatment"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t["banking.line.vatTreatment"]}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {(["none", "standard", "zero_rated", "exempt"] as const).map((v) => (
                            <SelectItem key={v} value={v}>
                              {t[`banking.line.vat.${v}`]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="direction"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t["banking.rules.direction"]}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {(["any", "inflow", "outflow"] as const).map((v) => (
                            <SelectItem key={v} value={v}>
                              {t[`banking.rules.direction.${v}`]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="requireReview"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <FormLabel className="text-base">
                        {t["banking.rules.requireReview"]}
                      </FormLabel>
                      <p className="text-sm text-muted-foreground">
                        {t["banking.rules.requireReviewHint"]}
                      </p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Rent, Salary, Utilities" {...field} />
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
                    <FormLabel>Memo (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Internal note for this rule" {...field} />
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
                      <FormLabel className="text-base">
                        <T k="pages.active" />
                      </FormLabel>
                      <p className="text-sm text-muted-foreground">
                        <T k="pageLabels.enableThisRuleForAutoMatching" />
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
                  <T k="pages.cancel" />
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {editingRule ? "Update Rule" : "Create Rule"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
