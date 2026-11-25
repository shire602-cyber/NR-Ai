import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { formatMessage, translateNow, useTranslation } from "@/lib/i18n";
import { isolateLtrText } from "@/lib/format-bidi";
import { ApiError, ApiRequestQueuedError, apiRequest, queryClient } from "@/lib/queryClient";

/*
 * Settings › Numbering (WQ7, 12.8): prefix, zero padding, yearly reset and the next number for
 * each numbered document. The server allocator stays the only writer of the sequence, so numbers
 * stay gap-free and unique (FTA): a prefix change only changes how the next number is written,
 * and the next number can only move forward, never below the highest number already issued.
 */

interface NumberingRow {
  docType: "invoice" | "cash_sale" | "credit_note" | "debit_note" | "quote";
  prefix: string;
  padding: number;
  yearlyReset: boolean;
  nextNumber: number;
  nextFormatted: string;
  lastIssued: number;
}

/** Same rule as the server: the year is part of the number only with yearly reset. */
function preview(prefix: string, padding: number, yearlyReset: boolean, n: number): string {
  const digits = String(Math.max(1, n)).padStart(padding, "0");
  const year = new Date().getUTCFullYear();
  return yearlyReset ? `${prefix || "—"}-${year}-${digits}` : `${prefix || "—"}-${digits}`;
}

function NumberingCard({
  row,
  companyId,
  disabled,
}: {
  row: NumberingRow;
  companyId: string;
  disabled: boolean;
}) {
  const { locale, t } = useTranslation();
  const { toast } = useToast();
  const [prefix, setPrefix] = useState(row.prefix);
  const [padding, setPadding] = useState(row.padding);
  const [yearlyReset, setYearlyReset] = useState(row.yearlyReset);
  const [next, setNext] = useState(String(row.nextNumber));
  const [error, setError] = useState<string | null>(null);
  // Queued (handed to the offline queue) and a save error are mutually exclusive.
  const [queued, setQueued] = useState(false);

  const nextNum = Number(next);
  const nextFormatted = preview(prefix.trim().toUpperCase(), padding, yearlyReset, nextNum || 1);
  const nextTooLow = Number.isFinite(nextNum) && nextNum <= row.lastIssued;

  const save = useMutation({
    mutationFn: () =>
      apiRequest("PUT", `/api/companies/${companyId}/numbering/${row.docType}`, {
        prefix: prefix.trim(),
        padding,
        yearlyReset,
        ...(nextNum !== row.nextNumber ? { nextNumber: nextNum } : {}),
      }),
    onMutate: () => {
      setError(null);
      setQueued(false);
    },
    onSuccess: () => {
      setError(null);
      setQueued(false);
      toast({ title: translateNow("settingsPages.numberingSaved") });
      void queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "numbering"] });
    },
    onError: (e: unknown) => {
      if (e instanceof ApiRequestQueuedError) {
        setError(null);
        setQueued(true);
        return;
      }
      setQueued(false);
      // Only a server-sent 4xx (validation / conflict) message is shown; raw network, CSRF,
      // queue and 5xx failures get the generic localized text.
      setError(
        e instanceof ApiError && e.status >= 400 && e.status < 500 && e.message
          ? e.message
          : t["settingsPages.numberingSaveFailed"]
      );
    },
  });

  const id = (f: string) => `numbering-${row.docType}-${f}`;
  return (
    <Card data-testid={`numbering-${row.docType}`}>
      <CardHeader>
        <CardTitle className="text-h4">{t[`settingsPages.numberingDoc_${row.docType}`]}</CardTitle>
        <CardDescription>
          {formatMessage(t["settingsPages.numberingNextIs"], {
            number: locale === "ar" ? isolateLtrText(nextFormatted) : nextFormatted,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (nextTooLow) {
              setQueued(false);
              setError(
                formatMessage(t["settingsPages.numberingBelowIssued"], { last: row.lastIssued })
              );
              return;
            }
            save.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={id("prefix")}>{t["settingsPages.numberingPrefix"]}</Label>
            <Input
              id={id("prefix")}
              dir="ltr"
              maxLength={12}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.replace(/[^A-Za-z0-9\-/]/g, ""))}
              disabled={disabled}
              data-testid={`numbering-prefix-${row.docType}`}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("padding")}>{t["settingsPages.numberingPadding"]}</Label>
            <Select
              value={String(padding)}
              onValueChange={(v) => setPadding(Number(v))}
              disabled={disabled}
            >
              <SelectTrigger id={id("padding")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[3, 4, 5, 6, 7, 8].map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    {formatMessage(t["settingsPages.numberingDigits"], { count: p })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("next")}>{t["settingsPages.numberingNext"]}</Label>
            <Input
              id={id("next")}
              inputMode="numeric"
              dir="ltr"
              className="text-end tabular-nums"
              value={next}
              onChange={(e) => setNext(e.target.value.replace(/[^0-9]/g, ""))}
              aria-invalid={nextTooLow}
              aria-describedby={id("next-help")}
              disabled={disabled}
              data-testid={`numbering-next-${row.docType}`}
            />
            <p id={id("next-help")} className="text-caption text-muted-foreground">
              {row.lastIssued > 0
                ? formatMessage(t["settingsPages.numberingLastIssued"], { last: row.lastIssued })
                : t["settingsPages.numberingNoneIssued"]}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 sm:col-span-2 lg:col-span-1 lg:flex-col lg:items-start">
            <Label htmlFor={id("reset")}>{t["settingsPages.numberingYearlyReset"]}</Label>
            <Switch
              id={id("reset")}
              checked={yearlyReset}
              onCheckedChange={setYearlyReset}
              disabled={disabled}
              data-testid={`numbering-reset-${row.docType}`}
            />
          </div>
          {error ? (
            <p role="alert" className="text-small text-danger sm:col-span-2 lg:col-span-4">
              {error}
            </p>
          ) : null}
          {queued || save.isPaused ? (
            <p
              role="status"
              className="text-small text-muted-foreground sm:col-span-2 lg:col-span-4"
              data-testid={`numbering-queued-${row.docType}`}
            >
              {t["settingsPages.numberingQueued"]}
            </p>
          ) : null}
          <div className="sm:col-span-2 lg:col-span-4">
            <Button
              type="submit"
              disabled={disabled || save.isPending || !prefix.trim()}
              data-testid={`numbering-save-${row.docType}`}
            >
              {save.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />}
              {t["settingsPages.numberingSave"]}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function NumberingSettings() {
  const { t } = useTranslation();
  const { companyId } = useDefaultCompany();
  const { can } = useCompanyPermission();
  const canManage = can("settings.company");
  const data = useQuery<{ numbering: NumberingRow[] }>({
    queryKey: ["/api/companies", companyId, "numbering"],
    enabled: !!companyId,
  });

  return (
    <SettingsLayout>
      <div className="space-y-6">
        <PageHeader
          eyebrow={t["pages.companyProfileEyebrow"]}
          title={t["settingsPages.numberingTitle"]}
          description={t["settingsPages.numberingDescription"]}
        />
        {!canManage ? (
          <p className="text-small text-muted-foreground">{t["settingsPages.numberingReadOnly"]}</p>
        ) : null}
        {data.isLoading ? (
          <div
            className="flex justify-center py-12"
            role="status"
            aria-label={t["common.loading"]}
            data-testid="numbering-loading"
          >
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : null}
        {data.fetchStatus === "paused" ? (
          <p
            role="status"
            className="text-small text-muted-foreground"
            data-testid="numbering-waiting"
          >
            {t["settingsPages.numberingWaiting"]}
          </p>
        ) : null}
        {(data.isLoadingError || data.isRefetchError) && data.fetchStatus === "idle" ? (
          <div
            role="alert"
            className="space-y-2"
            data-testid={data.isLoadingError ? "numbering-load-error" : "numbering-refresh-error"}
          >
            <p className="text-small text-danger">
              {data.isLoadingError
                ? t["settingsPages.numberingLoadFailed"]
                : t["settingsPages.numberingRefreshFailed"]}
            </p>
            <Button variant="outline" size="sm" onClick={() => void data.refetch()}>
              {t["settingsPages.numberingRetry"]}
            </Button>
          </div>
        ) : null}
        {data.isSuccess && data.fetchStatus === "idle" && data.data.numbering.length === 0 ? (
          <p className="text-small text-muted-foreground" data-testid="numbering-empty">
            {t["settingsPages.numberingEmpty"]}
          </p>
        ) : null}
        {companyId
          ? (data.data?.numbering ?? []).map((row) => (
              <NumberingCard
                key={`${row.docType}-${row.prefix}-${row.padding}-${row.yearlyReset}-${row.nextNumber}`}
                row={row}
                companyId={companyId}
                disabled={!canManage}
              />
            ))
          : null}
        <p className="text-caption text-muted-foreground">{t["settingsPages.numberingFtaNote"]}</p>
      </div>
    </SettingsLayout>
  );
}
