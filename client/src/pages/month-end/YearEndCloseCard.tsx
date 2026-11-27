import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { AskNajmaButton } from "@/components/firm/AskNajmaButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiFieldErrors, type FieldMessages } from "@/lib/api-field-errors";
import { errorHeading } from "@/lib/error-heading";
import { lastEndedFiscalYear } from "@/lib/fiscal-year";
import { formatMessage, loadNamespaces, useTranslation, type Locale } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { YearEndFailure } from "@/pages/month-end/YearEndFailure";

const NAMESPACES = ["yearEndClose", "monthEnd", "launchProof"] as const;

/** Permission-gated year-end close (R11-14); the page lazy-loads it for users who can lock. */
export default function YearEndCloseCard({
  companyId,
  fyStartMonth,
  postYearEndClosingEntry,
}: {
  companyId: string;
  fyStartMonth: number | null | undefined;
  postYearEndClosingEntry: boolean;
}) {
  const { t, locale } = useTranslation(NAMESPACES);
  const { toast } = useToast();
  // Observe the catalog load for the active locale; a failure for a locale the user has since
  // left is stale and ignored (failedLocale must equal the current locale to count).
  const [failedLocale, setFailedLocale] = useState<Locale | null>(null);
  useEffect(() => {
    let stale = false;
    loadNamespaces(locale, NAMESPACES).catch(() => {
      if (!stale) setFailedLocale(locale);
    });
    return () => {
      stale = true;
    };
  }, [locale]);
  // E2 (J3-r2): the default is the company's last ended fiscal year (31 Oct for Nov-Oct), not
  // 31 Dec of last year; a date the user picks wins.
  const [fiscalYearEndPicked, setFiscalYearEnd] = useState<string | null>(null);
  const fiscalYearEnd = fiscalYearEndPicked ?? lastEndedFiscalYear(fyStartMonth, new Date()).end;
  const [hardClose, setHardClose] = useState(false);
  const [yearEndOverride, setYearEndOverride] = useState(false);
  const [yearEndReason, setYearEndReason] = useState("");
  const [yearEndFieldErrors, setYearEndFieldErrors] = useState<FieldMessages>({});

  const invalidateClose = () => {
    for (const key of ["history", "settings"]) {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/month-end/${key}`] });
    }
  };

  const reasonLength = yearEndReason.trim().length;
  const yearEndReasonTooShort = reasonLength > 0 && reasonLength < 3;
  const yearEndReasonError =
    yearEndFieldErrors.reason ?? (yearEndReasonTooShort ? t["monthEnd.reasonMin3"] : undefined);

  const yearEndMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/companies/${companyId}/month-end/year-end-close`, {
        fiscalYearEnd,
        hardClose,
        ...(yearEndOverride ? { overrideChecklist: true } : {}),
        ...(yearEndReason.trim() ? { reason: yearEndReason.trim() } : {}),
      }),
    onSuccess: () => {
      toast({ title: t["yearEndClose.closed"] });
      setYearEndReason("");
      setYearEndFieldErrors({});
      invalidateClose();
    },
    onError: (error: Error) => {
      // X4 (J3): show the rejected field (e.g. reason too short) next to the input.
      setYearEndFieldErrors(apiFieldErrors(error));
      toast({ title: errorHeading(error), description: error?.message, variant: "destructive" });
    },
  });

  const settingsMutation = useMutation({
    mutationFn: async (value: boolean) =>
      apiRequest("PUT", `/api/companies/${companyId}/month-end/settings`, {
        postYearEndClosingEntry: value,
      }),
    onSuccess: () => invalidateClose(),
    onError: (error: Error) => {
      toast({ title: errorHeading(error), description: error?.message, variant: "destructive" });
    },
  });

  // The yearEndClose/launchProof catalogs lazy-load; until the active locale's copy has landed
  // the fallback view can show the other language or raw keys, so show a skeleton instead.
  // (hasOwnProperty reaches the real catalog through the fallback proxy.)
  const copyReady = ["yearEndClose.title", "launchProof.askYearEndHint", "monthEnd.reason"].every(
    (key) => Object.prototype.hasOwnProperty.call(t, key)
  );
  // A rejected catalog load never lands, so show a localized failure with a real reload
  // (a failed module fetch can stay cached, so a remount alone would not retry it).
  if (!copyReady && failedLocale === locale) return <YearEndFailure locale={locale} />;
  if (!copyReady) {
    return (
      <Card data-testid="year-end-close-skeleton" aria-busy="true">
        <CardHeader className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-full max-w-md" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t["yearEndClose.title"]}</CardTitle>
        <CardDescription>{t["yearEndClose.body"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="space-y-1">
            <Label htmlFor="fiscal-year-end">{t["yearEndClose.fiscalYearEnd"]}</Label>
            <DatePicker
              id="fiscal-year-end"
              value={fiscalYearEnd}
              onChange={(value) => setFiscalYearEnd(value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="year-end-reason">{t["monthEnd.reason"]}</Label>
            <Input
              id="year-end-reason"
              value={yearEndReason}
              onChange={(e) => {
                setYearEndReason(e.target.value);
                setYearEndFieldErrors({});
              }}
              placeholder={t["monthEnd.reasonPlaceholder"]}
              aria-invalid={yearEndReasonError ? true : undefined}
              aria-describedby={yearEndReasonError ? "year-end-reason-error" : undefined}
            />
            {yearEndReasonError && (
              <p id="year-end-reason-error" className="text-xs text-danger" role="alert">
                {yearEndReasonError}
              </p>
            )}
          </div>
          <Button
            onClick={() => yearEndMutation.mutate()}
            disabled={
              yearEndMutation.isPending ||
              (yearEndOverride && reasonLength < 3) ||
              yearEndReasonTooShort
            }
          >
            <Lock className="h-4 w-4 me-2" />
            {t["yearEndClose.closeYear"]}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AskNajmaButton
            companyId={companyId}
            topic="year_end_close"
            period={formatMessage(t["yearEndClose.askPeriod"], { date: fiscalYearEnd })}
            testId="button-ask-najma-year-end"
          />
          <span className="text-caption text-muted-foreground">
            {t["launchProof.askYearEndHint"]}
          </span>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hardClose}
            onChange={(e) => setHardClose(e.target.checked)}
          />
          {t["yearEndClose.hardClose"]}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={yearEndOverride}
            onChange={(e) => setYearEndOverride(e.target.checked)}
          />
          {t["monthEnd.overrideChecklist"]}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={postYearEndClosingEntry}
            onChange={(e) => settingsMutation.mutate(e.target.checked)}
            data-testid="checkbox-post-year-end-entry"
          />
          {t["yearEndClose.postClosingEntry"]}
        </label>
      </CardContent>
    </Card>
  );
}
