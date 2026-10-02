import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  dayOnly,
  FILED_ELSEWHERE_AUDIT_HREF,
  FILED_ELSEWHERE_REFERENCE_MAX,
  filedElsewhereBody,
  filingDateOk,
} from "@/lib/vat-filed-elsewhere";
import { formatDate, CALENDAR_DATE_SHORT_FORMAT } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { dubaiToday } from "@/lib/report-presets";
import { messages as pageMessages } from "./FiledElsewhereDialog.i18n";

interface Props {
  companyId: string;
  periodStart: string;
  periodEnd: string;
  testIdSuffix?: string;
}

const ERROR_KEYS: Record<
  string,
  "errAlreadyFiled" | "errNotEnded" | "errInvalidPeriod" | "errFilingDate"
> = {
  PERIOD_ALREADY_FILED: "errAlreadyFiled",
  PERIOD_NOT_ENDED: "errNotEnded",
  INVALID_PERIOD: "errInvalidPeriod",
  INVALID_FILING_DATE: "errFilingDate",
};

/** "Filed outside Muhasib": records a historical VAT period as filed elsewhere. Posts nothing. */
export function FiledElsewhereDialog({ companyId, periodStart, periodEnd, testIdSuffix }: Props) {
  const tr = pageMessages.useT();
  const { toast } = useToast();
  const locale = useI18n((s) => s.locale);
  const [open, setOpen] = useState(false);
  const [filingDate, setFilingDate] = useState(() => dubaiToday());
  const [reference, setReference] = useState("");
  const today = dubaiToday();
  const suffix = testIdSuffix ?? dayOnly(periodStart);
  const period = `${formatDate(`${dayOnly(periodStart)}T00:00:00Z`, locale, CALENDAR_DATE_SHORT_FORMAT)} – ${formatDate(`${dayOnly(periodEnd)}T00:00:00Z`, locale, CALENDAR_DATE_SHORT_FORMAT)}`;
  const dateOk = filingDateOk(filingDate, periodEnd, today);

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest(
        "POST",
        `/api/companies/${companyId}/vat-returns/filed-elsewhere`,
        filedElsewhereBody(periodStart, periodEnd, filingDate, reference)
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "vat-returns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vat/autopilot"] });
      setOpen(false);
      toast({ title: tr("doneTitle"), description: tr("doneDescription", { period }) });
    },
    onError: (error: Error) => {
      const key = error instanceof ApiError && error.code ? ERROR_KEYS[error.code] : undefined;
      toast({
        variant: "destructive",
        title: tr("failedTitle"),
        description: key ? tr(key) : error.message,
      });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setFilingDate(dubaiToday());
          setReference("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid={`button-filed-elsewhere-${suffix}`}
        >
          <CheckCircle2 className="me-2 h-4 w-4" />
          {tr("action")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader className="pe-6">
          <DialogTitle>
            <bdi dir="ltr">{tr("title", { period })}</bdi>
          </DialogTitle>
          <DialogDescription>{tr("explained")}</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          <div className="space-y-1">
            <Label htmlFor={`filed-date-${suffix}`}>{tr("filingDateLabel")}</Label>
            <Input
              id={`filed-date-${suffix}`}
              type="date"
              value={filingDate}
              min={dayOnly(periodEnd)}
              max={today}
              onChange={(e) => setFilingDate(e.target.value)}
              aria-invalid={!dateOk}
              data-testid="input-filed-elsewhere-date"
            />
            {!dateOk ? (
              <p className="text-xs text-muted-foreground">{tr("filingDateRule")}</p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor={`filed-ref-${suffix}`}>{tr("referenceLabel")}</Label>
            <Input
              id={`filed-ref-${suffix}`}
              value={reference}
              maxLength={FILED_ELSEWHERE_REFERENCE_MAX}
              onChange={(e) => setReference(e.target.value)}
              placeholder={tr("referencePlaceholder")}
              data-testid="input-filed-elsewhere-reference"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {tr("auditNote")}{" "}
            <Link href={FILED_ELSEWHERE_AUDIT_HREF} className="underline">
              {tr("auditLink")}
            </Link>
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tr("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!dateOk || mutation.isPending}
            data-testid="button-confirm-filed-elsewhere"
          >
            {mutation.isPending ? tr("saving") : tr("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
