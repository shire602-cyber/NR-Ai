import { accountDisplayName } from "@/lib/account-name";
import { withoutControlAccounts } from "@/lib/control-account-options";
import { T } from "@/components/layout/T";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useRef, useState, useSyncExternalStore } from "react";
import { onlineManager, useQuery, useMutation } from "@tanstack/react-query";
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
  FormDescription,
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
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Trash2, Edit, Zap, Loader2, Search, WifiOff, Clock } from "lucide-react";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { matchesRuleSearch } from "@/lib/reconciliation-rule-search";

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
  parentId?: string | null;
  isVatAccount?: boolean | null;
  vatType?: string | null;
}

const ruleFormSchema = z.object({
  name: z.string().min(1, "forms.errors.ruleNameRequired"),
  priority: z.coerce.number().int().min(0).default(0),
  matchField: z.enum(["description", "reference", "amount"]),
  matchType: z.enum(["contains", "exact", "starts_with", "regex"]),
  matchValue: z.string().min(1, "forms.errors.matchValueRequired"),
  accountId: z.string().guid("forms.errors.ruleAccountRequired"),
  vatTreatment: z.enum(["none", "standard", "zero_rated", "exempt"]),
  requireReview: z.boolean().default(false),
  direction: z.enum(["any", "inflow", "outflow"]).default("any"),
  category: z.string().optional(),
  memo: z.string().optional(),
  isActive: z.boolean().default(true),
});

type RuleFormData = z.infer<typeof ruleFormSchema>;

// Module-level so useSyncExternalStore sees stable functions; the wrappers keep `this` bound.
const subscribeOnline = (onChange: () => void) => onlineManager.subscribe(onChange);
const isOnlineNow = () => onlineManager.isOnline();

/**
 * Bank reconciliation → Rules (spec 3.9; the former /reconciliation-rules page).
 */
export function ReconciliationRulesPanel() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const { canAccess, getRequiredTier } = useSubscription();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ReconciliationRule | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const {
    data: rules,
    isPaused,
    isFetching,
    isLoadingError,
    isRefetchError,
    error: rulesError,
    refetch: refetchRules,
  } = useQuery<ReconciliationRule[]>({
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
  // C1 (RL1): a rule never codes bank lines to a control account (the server refuses it).
  const postableAccounts = withoutControlAccounts(ruleAccounts ?? []).filter(
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
        title: translateNow("toasts.ruleCreated"),
        description: translateNow("toasts.reconciliationRuleHasBeenCreatedSuccessfully"),
      });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
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
        title: translateNow("toasts.ruleUpdated"),
        description: translateNow("toasts.reconciliationRuleHasBeenUpdatedSuccessfully"),
      });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
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
      toast({
        title: translateNow("toasts.ruleDeleted"),
        description: translateNow("toasts.reconciliationRuleHasBeenDeleted"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
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
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
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
      toast({
        title: translateNow("toasts.autoMatchFailed"),
        description: error?.message,
        variant: "destructive",
      });
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

  const allRules = rules ?? [];
  const visibleRules = allRules.filter((rule) =>
    matchesRuleSearch(rule, searchTerm, {
      field: t[`banking.rulesField.${rule.matchField}`] ?? rule.matchField,
      type: t[`banking.rulesType.${rule.matchType}`] ?? rule.matchType,
    })
  );
  const hasSearch = searchTerm.trim().length > 0;
  const hasNoMatches = hasSearch && allRules.length > 0 && visibleRules.length === 0;
  // Paused before any response: nothing is known about the rules, so no empty state or Add.
  const pausedFirstLoad = rules === undefined && isPaused;
  // A query also pauses while online (a retry waits until the tab is focused again).
  const online = useSyncExternalStore(subscribeOnline, isOnlineNow);
  const pausedTitle = online ? t["banking.rules.waitingTitle"] : t["common.errorHeading.offline"];
  const pausedBody = online ? t["banking.rules.waitingBody"] : t["banking.rules.offlineBody"];

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
    <div className="space-y-6">
      {/* Rules are a tab of Bank reconciliation (spec 3.9): a toolbar, not a page header. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-small text-muted-foreground">
          {t["banking.rulesEvaluationOrder"]}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => autoMatchMutation.mutate()}
            disabled={autoMatchMutation.isPending}
          >
            {autoMatchMutation.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Zap aria-hidden />
            )}
            {t["banking.rulesRunAutoMatch"]}
          </Button>
          {!pausedFirstLoad && (
            <Button size="sm" onClick={openCreateDialog} data-testid="button-add-rule">
              <Plus aria-hidden />
              <T k="pageLabels.addRule" />
            </Button>
          )}
        </div>
      </div>

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

      <div role="status" aria-atomic="true" className="sr-only">
        {hasNoMatches ? t["banking.rules.noMatchTitle"] : ""}
      </div>

      {(allRules.length > 0 || hasSearch) && (
        <div className="flex w-full max-w-md items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            ref={searchInputRef}
            type="search"
            dir="auto"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t["banking.rules.searchPlaceholder"]}
            aria-label={t["banking.rules.searchLabel"]}
            className="min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            data-testid="input-search-rules"
          />
        </div>
      )}

      {/* A stale cache can pause before any error, so pause alone warns too. */}
      {rules !== undefined && (isPaused || isRefetchError) && (
        <Alert
          tone="warning"
          title={isPaused ? pausedTitle : t["hr.refreshFailed"]}
          data-testid="rules-refresh-warning"
          action={
            // A paused retry is already queued and resumes by itself.
            isPaused ? undefined : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refetchRules()}
                disabled={isFetching}
              >
                {t["firm.retry"]}
              </Button>
            )
          }
        >
          {isPaused ? pausedBody : null}
        </Alert>
      )}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {pausedFirstLoad ? (
            <EmptyState
              size="md"
              icon={online ? Clock : WifiOff}
              title={pausedTitle}
              description={pausedBody}
              testId={online ? "rules-waiting" : "rules-offline"}
            />
          ) : isLoadingError ? (
            <LoadErrorState
              error={rulesError}
              onRetry={() => refetchRules()}
              title={t["banking.rules.loadErrorTitle"]}
              description={t["banking.rules.loadErrorBody"]}
              testId="rules-load-error"
            />
          ) : rules === undefined ? (
            <div className="space-y-3 p-4" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : hasNoMatches ? (
            <EmptyState
              size="md"
              icon={Search}
              title={t["banking.rules.noMatchTitle"]}
              description={t["banking.rules.noMatchBody"]}
              action={{
                label: t["banking.rules.clearSearch"],
                onClick: () => {
                  setSearchTerm("");
                  searchInputRef.current?.focus();
                },
              }}
            />
          ) : allRules.length === 0 ? (
            <EmptyState
              size="md"
              title={t["banking.rulesEmptyTitle"]}
              description={t["banking.rulesEmptyBody"]}
              action={{ label: t["pageLabels.addRule"], onClick: openCreateDialog }}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-px text-end">
                    <T k="pages.priority" />
                  </TableHead>
                  <TableHead>{t["banking.rulesColRule"]}</TableHead>
                  <TableHead>
                    <T k="pages.category" />
                  </TableHead>
                  <TableHead className="text-end">
                    <T k="pageLabels.applied" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.active" />
                  </TableHead>
                  <TableHead className="w-px">
                    <span className="sr-only">
                      <T k="pages.actions" />
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="text-end tabular-nums">{rule.priority ?? 0}</TableCell>
                    <TableCell>
                      <div dir="auto" className="font-medium text-foreground">
                        {rule.name}
                      </div>
                      <div className="text-caption text-muted-foreground">
                        {t[`banking.rulesField.${rule.matchField}`] ?? rule.matchField}{" "}
                        {t[`banking.rulesType.${rule.matchType}`] ?? rule.matchType}{" "}
                        <span dir="ltr" className="font-mono [unicode-bidi:isolate]">
                          {rule.matchValue}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell dir="auto">{rule.category || "—"}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {rule.timesApplied ?? 0}
                    </TableCell>
                    <TableCell>
                      <Switch
                        touchTarget
                        checked={rule.isActive ?? true}
                        aria-label={t["pages.active"]}
                        onCheckedChange={(checked) =>
                          toggleActiveMutation.mutate({ id: rule.id, isActive: checked })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <RowActions
                        maxInline={1}
                        menu={
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => deleteMutation.mutate(rule.id)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 aria-hidden />
                            {t["banking.rulesDelete"]}
                          </DropdownMenuItem>
                        }
                      >
                        <RowActionButton
                          icon={Edit}
                          label={t["banking.rulesEditRule"]}
                          onClick={() => openEditDialog(rule)}
                        />
                      </RowActions>
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
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>
              {editingRule ? t["banking.rulesEditRule"] : t["banking.rulesCreateRule"]}
            </DialogTitle>
            <DialogDescription>
              {editingRule ? t["banking.rulesEditDesc"] : t["banking.rulesCreateDesc"]}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <T k="pageLabels.ruleName" />
                    </FormLabel>
                    <FormControl>
                      <Input placeholder={t["banking.rulesNamePlaceholder"]} {...field} />
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

              <div className="contents">
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
                            <SelectValue placeholder={t["banking.rulesSelectField"]} />
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
                            <SelectValue placeholder={t["screens.inv2SelectType"]} />
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
                  <FormItem className="sm:col-span-2">
                    <FormLabel>
                      <T k="pages.matchValue" />
                    </FormLabel>
                    <FormControl>
                      <Input
                        dir="ltr"
                        placeholder={t["banking.rules.matchValuePlaceholder"]}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="accountId"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
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
                            {a.code} {accountDisplayName(a, locale)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>{t["forms.controlAccountsHidden"]}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="contents">
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
                  <FormItem className="sm:col-span-2 flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <FormLabel className="text-base">
                        {t["banking.rules.requireReview"]}
                      </FormLabel>
                      <p className="text-sm text-muted-foreground">
                        {t["banking.rules.requireReviewHint"]}
                      </p>
                    </div>
                    <FormControl>
                      <Switch touchTarget checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>{t["banking.rules.category"]}</FormLabel>
                    <FormControl>
                      <Input placeholder={t["banking.rules.categoryPlaceholder"]} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="memo"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>{t["banking.rules.memo"]}</FormLabel>
                    <FormControl>
                      <Input placeholder={t["banking.rulesNotePlaceholder"]} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2 flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <FormLabel className="text-base">
                        <T k="pages.active" />
                      </FormLabel>
                      <p className="text-sm text-muted-foreground">
                        <T k="pageLabels.enableThisRuleForAutoMatching" />
                      </p>
                    </div>
                    <FormControl>
                      <Switch touchTarget checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
                <Button type="button" variant="outline" onClick={closeDialog}>
                  <T k="pages.cancel" />
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  )}
                  {editingRule ? t["banking.rulesUpdateRule"] : t["banking.rulesCreateRule"]}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
