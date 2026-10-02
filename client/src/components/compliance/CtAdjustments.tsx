import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format";
import { useTranslation } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  CT_CATEGORIES,
  MAX_ADJUSTMENTS,
  adjustmentsAreValid,
  adjustmentsToRows,
  bridgeAdjustmentCategory,
  categoryDirection,
  categoryLabel,
  emptyRow,
  reliefOutcome,
  rowAmount,
  rowProblem,
  rowsToAdjustments,
  suggestionAlreadyAdded,
  suggestionToRow,
  type AdjustmentRow,
  type CtAdjustmentCategory,
  type CtBridgeAdjustment,
  type CtComputationResult,
  type CtSbrUnavailableReason,
  type ReliefOffer,
  type Suggestion,
} from "@/lib/ct-form";
import { messages as pageMessages } from "./CtAdjustments.i18n";

type Tr = ReturnType<typeof pageMessages.useT>;

// ---------------------------------------------------------------------------------------------------------------
// Small Business Relief
// ---------------------------------------------------------------------------------------------------------------

function reasonText(
  tr: Tr,
  reason: CtSbrUnavailableReason | null | undefined,
  revenue: string
): string {
  switch (reason) {
    case "revenue_cap":
      return tr("reasonRevenueCap", { revenue });
    case "prior_period_breach":
      return tr("reasonPriorBreach");
    case "period_after_sunset":
      return tr("reasonSunset");
    default:
      return tr("reliefNotAvailable");
  }
}

interface ReliefSwitchProps {
  offer: ReliefOffer | undefined;
  elected: boolean;
  onChange: (next: boolean) => void;
  revenue: number;
  disabled?: boolean;
  /** True while the offer is being fetched from the server. */
  checking?: boolean;
  /** The offer was worked out locally (before the draft exists): the server will check earlier periods on save. */
  localOffer?: boolean;
}

/** The election switch: on only when the offer says the relief is available, with the reason when it is not. */
export function CtReliefSwitch({
  offer,
  elected,
  onChange,
  revenue,
  disabled,
  checking,
  localOffer,
}: ReliefSwitchProps) {
  const tr = pageMessages.useT();
  const { locale } = useTranslation();
  const revenueText = formatCurrency(revenue, "AED", locale);
  const canElect = Boolean(offer?.available) && !disabled;
  return (
    <section
      className="space-y-2 rounded-lg border p-4"
      aria-labelledby="ct-relief-title"
      data-testid="ct-relief"
    >
      <h3 id="ct-relief-title" className="text-sm font-semibold">
        {tr("reliefTitle")}
      </h3>
      <div className="flex items-start gap-3">
        <Switch
          id="ct-relief-switch"
          checked={elected && Boolean(offer?.available)}
          onCheckedChange={onChange}
          disabled={!canElect}
          aria-describedby="ct-relief-status"
          data-testid="switch-sbr"
        />
        <Label htmlFor="ct-relief-switch" className="cursor-pointer space-y-1 font-normal">
          <span className="block font-medium">{tr("reliefSwitch")}</span>
          <span className="block text-xs text-muted-foreground">{tr("reliefHint")}</span>
        </Label>
      </div>
      <p id="ct-relief-status" className="text-xs" data-testid="ct-relief-status">
        {checking || !offer ? (
          <span className="text-muted-foreground">{tr("reliefChecking")}</span>
        ) : offer.available ? (
          <span className="text-success">{tr("reliefAvailable", { revenue: revenueText })}</span>
        ) : (
          <span className="text-destructive">
            {tr("reliefNotAvailable")}: {reasonText(tr, offer.reason, revenueText)}
          </span>
        )}
        {localOffer && offer?.available ? (
          <span className="ms-1 text-muted-foreground">{tr("reliefServerChecks")}</span>
        ) : null}
      </p>
    </section>
  );
}

/** "Elected and applied" / "elected, refused: reason" / "not elected", from a computation. */
export function ReliefOutcomeLine({
  computation,
}: {
  computation: Pick<CtComputationResult, "smallBusinessRelief"> | null | undefined;
}) {
  const tr = pageMessages.useT();
  const outcome = reliefOutcome(computation);
  if (outcome.kind === "not_elected")
    return <span data-testid="ct-relief-outcome">{tr("outcomeNotElected")}</span>;
  if (outcome.kind === "applied") {
    return (
      <span className="text-success" data-testid="ct-relief-outcome">
        {tr("outcomeApplied")}
      </span>
    );
  }
  const reason =
    outcome.reason === "revenue_cap"
      ? tr("refusedRevenueCap")
      : outcome.reason === "prior_period_breach"
        ? tr("refusedPriorBreach")
        : tr("refusedSunset");
  return (
    <span className="text-destructive" data-testid="ct-relief-outcome">
      {tr("outcomeRefused", { reason })}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Add-backs and deductions
// ---------------------------------------------------------------------------------------------------------------

interface EditorProps {
  rows: AdjustmentRow[];
  onChange: (rows: AdjustmentRow[]) => void;
  suggestions?: Suggestion[];
  suggestionsState?: "idle" | "loading" | "error" | "ready";
  readOnly?: boolean;
}

export function CtAdjustmentsEditor({
  rows,
  onChange,
  suggestions = [],
  suggestionsState = "idle",
  readOnly,
}: EditorProps) {
  const tr = pageMessages.useT();
  const { locale } = useTranslation();
  const patch = (id: string, changes: Partial<AdjustmentRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...changes } : r)));
  const totals = useMemo(() => {
    let add = 0;
    let deduct = 0;
    for (const r of rows) {
      if (rowProblem(r) !== null) continue;
      if (categoryDirection(r.category) === "add") add += rowAmount(r);
      else deduct += rowAmount(r);
    }
    return { add: Math.round(add * 100) / 100, deduct: Math.round(deduct * 100) / 100 };
  }, [rows]);

  return (
    <section
      className="space-y-3"
      aria-labelledby="ct-adjustments-title"
      data-testid="ct-adjustments"
    >
      <div>
        <h3 id="ct-adjustments-title" className="text-sm font-semibold">
          {tr("adjustmentsTitle")}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{tr("adjustmentsHint")}</p>
      </div>

      {suggestionsState !== "idle" && !readOnly ? (
        <div className="space-y-2 rounded-lg border border-dashed p-3" data-testid="ct-suggestions">
          <div className="text-sm font-medium">{tr("suggestionsTitle")}</div>
          <p className="text-xs text-muted-foreground">{tr("suggestionsHint")}</p>
          {suggestionsState === "loading" ? (
            <p className="text-xs text-muted-foreground">{tr("suggestionsLoading")}</p>
          ) : null}
          {suggestionsState === "error" ? (
            <p className="text-xs text-destructive">{tr("suggestionsFailed")}</p>
          ) : null}
          {suggestionsState === "ready" && suggestions.length === 0 ? (
            <p className="text-xs text-muted-foreground">{tr("noSuggestions")}</p>
          ) : null}
          {suggestions.map((s) => {
            const added = suggestionAlreadyAdded(rows, s);
            return (
              <div
                key={s.category}
                className="flex flex-wrap items-center justify-between gap-2"
                data-testid={`ct-suggestion-${s.category}`}
              >
                <p className="max-w-xl text-sm">
                  {tr.plural("suggestionEntertainment", s.documents, {
                    base: formatCurrency(s.baseAmount, "AED", locale),
                    amount: formatCurrency(s.amount, "AED", locale),
                  })}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={added}
                  onClick={() =>
                    onChange([
                      ...rows.filter((r) => !(isBlank(r) && r.category === s.category)),
                      suggestionToRow(s),
                    ])
                  }
                  data-testid={`button-add-suggestion-${s.category}`}
                >
                  {added ? (
                    <>
                      <Check className="me-1 h-4 w-4" />
                      {tr("suggestionAdded")}
                    </>
                  ) : (
                    tr("addSuggestion")
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}

      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{tr("noLines")}</p> : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[16rem]">{tr("colCategory")}</TableHead>
                <TableHead className="min-w-[9rem] text-end">{tr("colAmount")}</TableHead>
                <TableHead className="min-w-[14rem]">{tr("colReason")}</TableHead>
                <TableHead className="min-w-[10rem] text-end">{tr("colEffect")}</TableHead>
                {readOnly ? null : <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const problem = rowProblem(row);
                const direction = categoryDirection(row.category);
                const isEntertainment = row.category === "entertainment_50";
                const rowId = `ct-adj-${row.id}`;
                return (
                  <TableRow key={row.id} data-testid="ct-adjustment-row">
                    <TableCell>
                      {readOnly ? (
                        categoryLabel(row.category, locale)
                      ) : (
                        <Select
                          value={row.category}
                          onValueChange={(v) =>
                            patch(row.id, { category: v as CtAdjustmentCategory })
                          }
                        >
                          <SelectTrigger
                            aria-label={tr("colCategory")}
                            data-testid="select-adjustment-category"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CT_CATEGORIES.map((c) => (
                              <SelectItem key={c} value={c}>
                                {categoryLabel(c, locale)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell className="text-end align-top">
                      {readOnly ? (
                        <span dir="ltr" className="tabular-nums">
                          {row.amountText}
                        </span>
                      ) : (
                        <>
                          <Input
                            id={`${rowId}-amount`}
                            inputMode="decimal"
                            dir="ltr"
                            className="text-end"
                            aria-label={
                              isEntertainment ? tr("entertainmentExpense") : tr("colAmount")
                            }
                            aria-invalid={problem === "amount"}
                            placeholder={isEntertainment ? tr("entertainmentExpense") : "0.00"}
                            value={row.amountText}
                            onChange={(e) => patch(row.id, { amountText: e.target.value })}
                            data-testid="input-adjustment-amount"
                          />
                          {isEntertainment &&
                          rowProblem(row) === null &&
                          row.amountText.trim() !== "" ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {tr("entertainmentHalf", {
                                amount: formatCurrency(rowAmount(row), "AED", locale),
                              })}
                            </p>
                          ) : null}
                          {problem === "amount" ? (
                            <p role="alert" className="mt-1 text-xs text-destructive">
                              {tr("amountInvalid")}
                            </p>
                          ) : null}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      {readOnly ? (
                        row.notes
                      ) : (
                        <>
                          <Input
                            aria-label={tr("colReason")}
                            aria-invalid={problem === "reason"}
                            placeholder={tr("reasonPlaceholder")}
                            maxLength={500}
                            value={row.notes}
                            onChange={(e) => patch(row.id, { notes: e.target.value })}
                            data-testid="input-adjustment-reason"
                          />
                          {problem === "reason" ? (
                            <p role="alert" className="mt-1 text-xs text-destructive">
                              {tr("reasonRequired")}
                            </p>
                          ) : null}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-end align-top">
                      {problem === null && row.amountText.trim() !== "" ? (
                        <Badge
                          variant={direction === "add" ? "warning" : "info"}
                          className="whitespace-nowrap"
                        >
                          <span dir="ltr">
                            {direction === "add"
                              ? tr("effectAdd", {
                                  amount: formatCurrency(rowAmount(row), "AED", locale),
                                })
                              : tr("effectDeduct", {
                                  amount: formatCurrency(rowAmount(row), "AED", locale),
                                })}
                          </span>
                        </Badge>
                      ) : null}
                    </TableCell>
                    {readOnly ? null : (
                      <TableCell className="align-top">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={tr("removeRow")}
                          onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                          data-testid="button-remove-adjustment"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {readOnly ? (
          <span />
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={rows.length >= MAX_ADJUSTMENTS}
            onClick={() => onChange([...rows, emptyRow()])}
            data-testid="button-add-adjustment"
          >
            <Plus className="me-1 h-4 w-4" />
            {tr("addRow")}
          </Button>
        )}
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{tr("totalAddBacks")}</dt>
            <dd dir="ltr" className="font-medium tabular-nums" data-testid="ct-total-addbacks">
              {formatCurrency(totals.add, "AED", locale)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{tr("totalDeductions")}</dt>
            <dd dir="ltr" className="font-medium tabular-nums" data-testid="ct-total-deductions">
              {formatCurrency(totals.deduct, "AED", locale)}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

const isBlank = (r: AdjustmentRow) => r.amountText.trim() === "" && r.notes.trim() === "";

// ---------------------------------------------------------------------------------------------------------------
// The computation, line by line
// ---------------------------------------------------------------------------------------------------------------

function bridgeLabel(
  tr: Tr,
  key: string,
  fallback: string,
  locale: string,
  adjustments: CtBridgeAdjustment[]
): string {
  const fixed: Record<string, string> = {
    revenue: tr("bridgeRevenue"),
    expenses: tr("bridgeExpenses"),
    accounting_profit: tr("bridgeProfit"),
    legacy_deductions: tr("bridgeLegacyDeductions"),
    adjusted_taxable_income: tr("bridgeAdjusted"),
    small_business_relief: tr("bridgeRelief"),
    loss_relief: tr("bridgeLoss"),
    taxable_income: tr("bridgeTaxable"),
    zero_band: tr("bridgeZeroBand"),
    taxable_amount: tr("bridgeTaxedAt9"),
    tax_payable: tr("bridgePayable"),
  };
  if (fixed[key]) return fixed[key];
  const category = bridgeAdjustmentCategory(key);
  if (category) {
    const adj = adjustments.find((a) => key === `adj_${a.category}_${a.id}`);
    if (category === "entertainment_50" && adj?.baseAmount !== undefined && !adj.label) {
      return tr("bridgeEntertainment", { base: formatCurrency(adj.baseAmount, "AED", locale) });
    }
    return adj?.label || categoryLabel(category, locale);
  }
  return fallback;
}

export function CtComputationSummary({
  computation,
  adjustments = [],
}: {
  computation: Pick<CtComputationResult, "bridge" | "smallBusinessRelief"> &
    Partial<CtComputationResult>;
  adjustments?: CtBridgeAdjustment[];
}) {
  const tr = pageMessages.useT();
  const { locale } = useTranslation();
  return (
    <section
      className="space-y-2"
      aria-labelledby="ct-computation-title"
      data-testid="ct-computation"
    >
      <h3 id="ct-computation-title" className="text-sm font-semibold">
        {tr("computationTitle")}
      </h3>
      <p className="text-sm">
        <ReliefOutcomeLine computation={computation} />
      </p>
      <dl className="divide-y rounded-md border text-sm">
        {computation.bridge.map((line) => {
          const strong = ["accounting_profit", "taxable_income", "tax_payable"].includes(line.key);
          return (
            <div
              key={line.key}
              className={`flex justify-between gap-3 px-3 py-1.5 ${strong ? "bg-muted/40 font-semibold" : ""}`}
            >
              <dt>{bridgeLabel(tr, line.key, line.label, locale, adjustments)}</dt>
              <dd dir="ltr" className="shrink-0 tabular-nums">
                {formatCurrency(line.amount || 0, "AED", locale)}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// A saved draft: change the lines and the election, recompute on the server
// ---------------------------------------------------------------------------------------------------------------

interface ReliefResponse {
  available: boolean;
  reason: CtSbrUnavailableReason | null;
  elected: boolean;
  applied: boolean;
  revenue: number;
}

interface DraftEditorProps {
  returnId: string;
  isDraft: boolean;
  totalRevenue: number;
  storedAdjustments: CtBridgeAdjustment[] | undefined;
  storedElected: boolean;
  /** Keys to refresh after a recompute (the returns list). */
  invalidateKeys: unknown[][];
}

export function CtDraftEditor({
  returnId,
  isDraft,
  totalRevenue,
  storedAdjustments,
  storedElected,
  invalidateKeys,
}: DraftEditorProps) {
  const tr = pageMessages.useT();
  const { toast } = useToast();
  const [rows, setRows] = useState<AdjustmentRow[]>(() => adjustmentsToRows(storedAdjustments));
  const [elected, setElected] = useState(storedElected);

  useEffect(() => {
    setRows(adjustmentsToRows(storedAdjustments));
    setElected(storedElected);
    // Start again from what is stored whenever another return is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnId]);

  const relief = useQuery<ReliefResponse>({
    queryKey: [`/api/corporate-tax/returns/${returnId}/small-business-relief`],
    enabled: isDraft,
    staleTime: 0,
  });
  const suggestions = useQuery<{ suggestions: Suggestion[] }>({
    queryKey: [`/api/corporate-tax/returns/${returnId}/suggested-adjustments`],
    enabled: isDraft,
    staleTime: 0,
  });

  const save = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/corporate-tax/returns/${returnId}/compute`, {
        adjustments: rowsToAdjustments(rows),
        smallBusinessReliefElected: elected,
      }),
    onSuccess: () => {
      for (const key of invalidateKeys) void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({
        queryKey: [`/api/corporate-tax/returns/${returnId}/small-business-relief`],
      });
      toast({ title: tr("recomputed"), description: tr("recomputedDescription") });
    },
    onError: (error: any) =>
      toast({ variant: "destructive", title: tr("recomputeFailed"), description: error?.message }),
  });

  if (!isDraft) return <p className="text-xs text-muted-foreground">{tr("lockedNote")}</p>;

  const offer: ReliefOffer | undefined = relief.data
    ? { available: relief.data.available, reason: relief.data.reason ?? undefined }
    : undefined;
  const state = suggestions.isLoading
    ? "loading"
    : suggestions.isError
      ? "error"
      : suggestions.data
        ? "ready"
        : "idle";

  return (
    <div className="space-y-4 border-t pt-4" data-testid="ct-draft-editor">
      <h3 className="text-sm font-semibold">{tr("editTitle")}</h3>
      <CtReliefSwitch
        offer={offer}
        elected={elected}
        onChange={setElected}
        revenue={relief.data?.revenue ?? totalRevenue}
        checking={relief.isLoading}
      />
      <CtAdjustmentsEditor
        rows={rows}
        onChange={setRows}
        suggestions={suggestions.data?.suggestions ?? []}
        suggestionsState={state}
      />
      <Button
        onClick={() => save.mutate()}
        disabled={save.isPending || !adjustmentsAreValid(rows)}
        data-testid="button-ct-recompute"
      >
        {save.isPending ? (
          <>
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
            {tr("saving")}
          </>
        ) : (
          tr("saveRecompute")
        )}
      </Button>
    </div>
  );
}
