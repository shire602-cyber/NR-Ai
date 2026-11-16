/**
 * Receipt split-lines / revise and split-into-receipts dialog (R05-19b, S2).
 *
 *   mode "lines"  one receipt over several expense accounts. Unposted: PUT /api/receipts/:id
 *                 { lines }. Posted: POST /api/receipts/:id/revise { lines, reason } — the server
 *                 reverses the original journal and posts the corrected one.
 *   mode "split"  an unposted upload that holds several receipts becomes separate receipts
 *                 (POST /api/receipts/:id/split { parts }); the parts must add up to the total.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import { FormActions, FormSection, LineItem, LineItemList, lineLabelClass } from "@/components/ui/form-layout";
import { apiRequest } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import {
  buildLinesRequest,
  buildSplitRequest,
  emptyLine,
  formatFils,
  linesFromReceipt,
  linesTotals,
  toFilsInput,
  type ReceiptLineDraft,
  type ReceiptPartDraft,
  type ReceiptSplitError,
} from "@/lib/receipt-split";

export interface ReceiptForSplit {
  id: string;
  posted?: boolean | null;
  merchant?: string | null;
  category?: string | null;
  amount?: number | string | null;
  vatAmount?: number | string | null;
  accountId?: string | null;
  lines?: unknown;
}

export interface AccountOption {
  id: string;
  code?: string | null;
  nameEn?: string | null;
  name?: string | null;
  type?: string | null;
}

export interface ReceiptLinesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "lines" | "split";
  receipt: ReceiptForSplit | null;
  accounts: readonly AccountOption[];
  onSaved: (result: unknown) => void;
  /** Injected in tests; defaults to the app's CSRF-aware apiRequest. */
  request?: (method: string, url: string, body: unknown) => Promise<unknown>; // i18n-ignore: TypeScript type, not UI copy
}

const ERROR_KEY: Record<ReceiptSplitError, string> = {
  LINE_ACCOUNT_REQUIRED: "purchases.receiptLineAccountRequired",
  LINE_AMOUNT_INVALID: "purchases.receiptLineAmountInvalid",
  LINE_VAT_EXCEEDS_AMOUNT: "purchases.receiptLineVatExceeds",
  LINES_REQUIRED: "purchases.receiptLinesRequired",
  PARTS_REQUIRED: "purchases.receiptPartsRequired",
  PARTS_TOTAL_MISMATCH: "purchases.receiptPartsTotalMismatch",
  REASON_REQUIRED: "purchases.receiptReasonRequired",
};

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20";

function emptyPart(receipt: ReceiptForSplit | null): ReceiptPartDraft {
  return {
    merchant: receipt?.merchant ?? "",
    amount: "",
    vatAmount: "",
    category: receipt?.category ?? "",
  };
}

export function ReceiptLinesDialog(props: ReceiptLinesDialogProps) {
  const { open, onOpenChange, mode, receipt, accounts, onSaved } = props;
  const { t } = useTranslation();
  const request = props.request ?? apiRequest;
  const [lines, setLines] = useState<ReceiptLineDraft[]>(() =>
    receipt ? linesFromReceipt(receipt) : [emptyLine()]
  );
  const [parts, setParts] = useState<ReceiptPartDraft[]>(() => [
    emptyPart(receipt),
    emptyPart(receipt),
  ]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(receipt?.id ?? null);
  if ((receipt?.id ?? null) !== seededFor) {
    setSeededFor(receipt?.id ?? null);
    setLines(receipt ? linesFromReceipt(receipt) : [emptyLine()]);
    setParts([emptyPart(receipt), emptyPart(receipt)]);
    setReason("");
    setError(null);
  }

  const expenseAccounts = accounts.filter(
    (a) => !a.type || a.type === "expense" || a.type === "asset"
  );
  const totals = linesTotals(lines);
  const posted = !!receipt?.posted;

  const describeError = (e: { index: number; code: ReceiptSplitError }) => {
    const msg = t[ERROR_KEY[e.code]] ?? e.code;
    return e.index >= 0
      ? formatMessage(t["purchases.receiptLineError"], { n: e.index + 1, msg })
      : msg;
  };

  const save = async () => {
    if (!receipt) return;
    setError(null);
    let method: string;
    let url: string;
    let body: unknown;
    if (mode === "lines") {
      const built = buildLinesRequest(receipt, lines, reason);
      if (!built.ok) return setError(describeError(built.error));
      ({ method, url, body } = built);
    } else {
      const built = buildSplitRequest(receipt, parts);
      if (!built.ok) return setError(describeError(built.error));
      method = "POST";
      ({ url, body } = built);
    }
    setSaving(true);
    try {
      const result = await request(method, url, body);
      onSaved(result);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error)?.message || t["purchases.receiptSaveFailed"]);
    } finally {
      setSaving(false);
    }
  };

  const updateLine = (i: number, patch: Partial<ReceiptLineDraft>) =>
    setLines((prev) => prev.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const updatePart = (i: number, patch: Partial<ReceiptPartDraft>) =>
    setParts((prev) => prev.map((p, k) => (k === i ? { ...p, ...patch } : p)));

  const title =
    mode === "split"
      ? t["purchases.splitReceiptTitle"]
      : posted
        ? t["purchases.reviseReceiptTitle"]
        : t["purchases.receiptLinesTitle"];
  const hint =
    mode === "split"
      ? t["purchases.splitReceiptHint"]
      : posted
        ? t["purchases.reviseReceiptHint"]
        : t["purchases.receiptLinesHint"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="receipt-lines-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{hint}</DialogDescription>
        </DialogHeader>

        <form
          noValidate
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-danger/30 bg-danger-subtle px-4 py-3 text-small font-medium text-danger-subtle-foreground"
              data-testid="receipt-lines-error"
            >
              {error}
            </div>
          )}

          {mode === "lines" ? (
            <FormSection
              title={t["forms.section.lines"]}
              actions={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLines((prev) => [...prev, emptyLine()])}
                >
                  <Plus className="h-4 w-4" />
                  {t["purchases.addLine"]}
                </Button>
              }
            >
              <LineItemList>
                {lines.map((l, i) => (
                  <LineItem
                    key={i}
                    index={i}
                    onRemove={() => setLines((prev) => prev.filter((_, k) => k !== i))}
                    canRemove={lines.length > 1}
                    gridClassName="sm:grid-cols-[8rem_8rem_minmax(0,1fr)]"
                    main={
                      <div className="space-y-1.5" data-testid={`receipt-line-${i}`}>
                        <Label htmlFor={`rl-account-${i}`} className={lineLabelClass}>
                          {t["purchases.account"]}
                        </Label>
                        <select
                          id={`rl-account-${i}`}
                          className={selectClass}
                          value={l.accountId}
                          onChange={(e) => updateLine(i, { accountId: e.target.value })}
                        >
                          <option value="">{t["purchases.chooseAccount"]}</option>
                          {expenseAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {[a.code, a.nameEn || a.name].filter(Boolean).join(" · ")}
                            </option>
                          ))}
                        </select>
                      </div>
                    }
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor={`rl-amount-${i}`} className={lineLabelClass}>
                        {t["purchases.netAmount"]}
                      </Label>
                      <Input
                        id={`rl-amount-${i}`}
                        inputMode="decimal"
                        value={l.amount}
                        onChange={(e) => updateLine(i, { amount: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`rl-vat-${i}`} className={lineLabelClass}>
                        {t["purchases.vat"]}
                      </Label>
                      <Input
                        id={`rl-vat-${i}`}
                        inputMode="decimal"
                        value={l.vatAmount}
                        onChange={(e) => updateLine(i, { vatAmount: e.target.value })}
                      />
                    </div>
                    <div className="col-span-2 space-y-1.5 sm:col-span-1">
                      <Label htmlFor={`rl-desc-${i}`} className={lineLabelClass}>
                        {t["purchases.description"]}
                      </Label>
                      <Input
                        id={`rl-desc-${i}`}
                        dir="auto"
                        value={l.description}
                        onChange={(e) => updateLine(i, { description: e.target.value })}
                      />
                    </div>
                  </LineItem>
                ))}
              </LineItemList>
              <p
                className="text-end text-small tabular-nums text-muted-foreground"
                data-testid="receipt-lines-total"
              >
                {formatMessage(t["purchases.receiptLinesTotal"], {
                  net: formatFils(totals.netFils),
                  vat: formatFils(totals.vatFils),
                  gross: formatFils(totals.grossFils),
                })}
              </p>
              {posted && (
                <div className="space-y-1.5">
                  <Label htmlFor="rl-reason">
                    {t["purchases.reviseReason"]}
                    <span aria-hidden="true" className="ms-0.5 text-danger">
                      *
                    </span>
                  </Label>
                  <Textarea
                    id="rl-reason"
                    dir="auto"
                    value={reason}
                    aria-required
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                  />
                </div>
              )}
            </FormSection>
          ) : (
            <FormSection
              title={t["forms.receipt.parts"]}
              actions={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={parts.length >= 20}
                  onClick={() => setParts((prev) => [...prev, emptyPart(receipt)])}
                >
                  <Plus className="h-4 w-4" />
                  {t["purchases.addReceipt"]}
                </Button>
              }
            >
              <LineItemList>
                {parts.map((p, i) => (
                  <LineItem
                    key={i}
                    index={i}
                    onRemove={() => setParts((prev) => prev.filter((_, k) => k !== i))}
                    canRemove={parts.length > 2}
                    gridClassName="sm:grid-cols-[8rem_8rem_minmax(0,1fr)]"
                    main={
                      <div className="space-y-1.5" data-testid={`receipt-part-${i}`}>
                        <Label htmlFor={`rp-merchant-${i}`} className={lineLabelClass}>
                          {t["purchases.merchant"]}
                        </Label>
                        <Input
                          id={`rp-merchant-${i}`}
                          dir="auto"
                          value={p.merchant}
                          onChange={(e) => updatePart(i, { merchant: e.target.value })}
                        />
                      </div>
                    }
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor={`rp-amount-${i}`} className={lineLabelClass}>
                        {t["purchases.netAmount"]}
                      </Label>
                      <Input
                        id={`rp-amount-${i}`}
                        inputMode="decimal"
                        value={p.amount}
                        onChange={(e) => updatePart(i, { amount: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`rp-vat-${i}`} className={lineLabelClass}>
                        {t["purchases.vat"]}
                      </Label>
                      <Input
                        id={`rp-vat-${i}`}
                        inputMode="decimal"
                        value={p.vatAmount}
                        onChange={(e) => updatePart(i, { vatAmount: e.target.value })}
                      />
                    </div>
                    <div className="col-span-2 space-y-1.5 sm:col-span-1">
                      <Label htmlFor={`rp-category-${i}`} className={lineLabelClass}>
                        {t["purchases.category"]}
                      </Label>
                      <Input
                        id={`rp-category-${i}`}
                        dir="auto"
                        value={p.category}
                        onChange={(e) => updatePart(i, { category: e.target.value })}
                      />
                    </div>
                  </LineItem>
                ))}
              </LineItemList>
              <p
                className="text-end text-small tabular-nums text-muted-foreground"
                data-testid="receipt-parts-total"
              >
                {formatMessage(t["purchases.receiptPartsTotal"], {
                  parts: formatFils(parts.reduce((s, p) => s + (toFilsInput(p.amount) ?? 0), 0)),
                  total: formatFils(Math.round(Number(receipt?.amount ?? 0) * 100)),
                })}
              </p>
            </FormSection>
          )}

          <FormActions sticky>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t["purchases.cancel"]}
            </Button>
            <Button
              type="submit"
              className="sm:min-w-32"
              disabled={saving}
              data-testid="receipt-lines-save"
            >
              {mode === "split"
                ? t["purchases.splitReceiptSave"]
                : posted
                  ? t["purchases.reviseReceiptSave"]
                  : t["purchases.receiptLinesSave"]}
            </Button>
          </FormActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
