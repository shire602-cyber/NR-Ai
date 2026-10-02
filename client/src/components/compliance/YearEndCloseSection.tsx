import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarRange, Loader2, Lock, LockOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { formatCalendarDate } from "@/lib/calendar-date";
import { useComplianceText } from "@/lib/i18n-compliance";

interface YearRow {
  yearStart: string;
  yearEnd: string;
  ended: boolean;
  status: "open" | "closed";
  closedAt: string | null;
  netIncome: number;
  blockers: Array<{ code: string; message: string }>;
}


/** "Year-end close" section of the Month-End Close page: close a financial year, or reopen it with a reason. */
export default function YearEndCloseSection({ companyId }: { companyId: string }) {
  const { c, f, locale } = useComplianceText();
  const { toast } = useToast();
  const key = ["/api/companies", companyId, "year-end"];
  const { data, isLoading } = useQuery<{ years: YearRow[] }>({
    queryKey: key,
    enabled: !!companyId,
  });
  const [closing, setClosing] = useState<YearRow | null>(null);
  const [reopening, setReopening] = useState<YearRow | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({
      queryKey: ["/api/companies", companyId, "month-end", "history"],
    });
  };

  const closeMutation = useMutation({
    mutationFn: (row: YearRow) =>
      apiRequest("POST", `/api/companies/${companyId}/year-end/close`, {
        yearStart: row.yearStart,
      }),
    onSuccess: () => {
      refresh();
      toast({ title: c.yeCloseDone });
      setClosing(null);
    },
    onError: (err: any) => setError(errorText(err)),
  });

  const reopenMutation = useMutation({
    mutationFn: (row: YearRow) =>
      apiRequest("POST", `/api/companies/${companyId}/year-end/reopen`, {
        yearStart: row.yearStart,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      refresh();
      toast({ title: c.yeReopenDone });
      setReopening(null);
      setReason("");
    },
    onError: (err: any) => setError(errorText(err)),
  });

  const years = data?.years ?? [];

  // The server writes its refusals in English; known ones are shown in the reader's language.
  const blockerText = (b: { code: string; message: string }): string => {
    if (b.code === "YEAR_NOT_ENDED") return c.yeBlockNotEnded;
    if (b.code === "DRAFT_ENTRIES_EXIST") {
      const count = /^(\d+)/.exec(b.message)?.[1];
      return count ? f("yeBlockDrafts", { count }) : b.message;
    }
    return b.message;
  };
  const errorText = (err: any): string =>
    err?.code === "YEAR_NOT_ENDED" ? c.yeBlockNotEnded : err?.message || c.yeFailed;

  return (
    <Card data-testid="section-year-end">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CalendarRange className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">{c.yeTitle}</CardTitle>
        </div>
        <CardDescription>{c.yeDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : years.length === 0 ? (
          <p className="text-sm text-muted-foreground">{c.yeNone}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{c.yeYear}</TableHead>
                  <TableHead className="text-end">{c.yeNetResult}</TableHead>
                  <TableHead>{c.yeStatus}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {years.map((row) => (
                  <TableRow key={row.yearStart} data-testid={`row-year-${row.yearStart}`}>
                    <TableCell className="font-medium">
                      {formatCalendarDate(row.yearStart, locale, "short")} – {formatCalendarDate(row.yearEnd, locale, "short")}
                    </TableCell>
                    <TableCell className="text-end font-mono">
                      {formatCurrency(row.netIncome, "AED", locale)}
                    </TableCell>
                    <TableCell>
                      {row.status === "closed" ? (
                        <Badge variant="secondary" className="gap-1">
                          <Lock className="h-3 w-3" />
                          {c.yeClosed}
                          {row.closedAt ? ` · ${formatCalendarDate(row.closedAt.slice(0, 10), locale, "short")}` : ""}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <LockOpen className="h-3 w-3" />
                          {c.yeOpen}
                        </Badge>
                      )}
                      {row.blockers.map((b) => (
                        <p key={b.code} className="mt-1 text-xs text-muted-foreground">
                          {blockerText(b)}
                        </p>
                      ))}
                    </TableCell>
                    <TableCell className="text-end">
                      {row.status === "open" ? (
                        <Button
                          size="sm"
                          disabled={row.blockers.length > 0}
                          onClick={() => {
                            setError(null);
                            setClosing(row);
                          }}
                          data-testid={`button-close-year-${row.yearStart}`}
                        >
                          {c.yeCloseYear}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setError(null);
                            setReason("");
                            setReopening(row);
                          }}
                          data-testid={`button-reopen-year-${row.yearStart}`}
                        >
                          {c.yeReopen}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          {c.yeNoticeOpening}{" "}
          <Link href="/opening-balances" className="underline">
            {c.yeOpeningLink}
          </Link>
        </p>
      </CardContent>

      <Dialog open={!!closing} onOpenChange={(open) => !open && setClosing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {closing
                ? f("yeConfirmTitle", {
                    year: `${closing.yearStart.slice(0, 4)}${closing.yearStart.slice(0, 4) === closing.yearEnd.slice(0, 4) ? "" : `/${closing.yearEnd.slice(0, 4)}`}`,
                  })
                : ""}
            </DialogTitle>
            <DialogDescription>
              {closing
                ? f("yeConfirmBody", {
                    date: formatCalendarDate(closing.yearEnd, locale, "short"),
                    amount: formatCurrency(closing.netIncome, "AED", locale),
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setClosing(null)}
              disabled={closeMutation.isPending}
            >
              {c.cancel}
            </Button>
            <Button
              onClick={() => closing && closeMutation.mutate(closing)}
              disabled={closeMutation.isPending}
              data-testid="button-confirm-close-year"
            >
              {closeMutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {c.yeCloseYear}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reopening} onOpenChange={(open) => !open && setReopening(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reopening ? f("yeReopenTitle", { year: reopening.yearStart.slice(0, 4) }) : ""}
            </DialogTitle>
            <DialogDescription>{c.yeReopenBody}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="reopen-reason" className="text-sm">
              {c.yeReason}
            </label>
            <Textarea
              id="reopen-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              data-testid="input-reopen-reason"
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setReopening(null)}
              disabled={reopenMutation.isPending}
            >
              {c.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={reopenMutation.isPending}
              onClick={() => {
                if (reason.trim().length < 10) return setError(c.yeReasonShort);
                setError(null);
                if (reopening) reopenMutation.mutate(reopening);
              }}
              data-testid="button-confirm-reopen-year"
            >
              {reopenMutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {c.yeReopen}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
