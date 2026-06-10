import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { formatCurrency } from '@/lib/format';
import {
  Calculator, AlertTriangle, CheckCircle2, Clock, FileText, RefreshCw, Send, Loader2, XCircle,
} from 'lucide-react';

// ─── Types matching the server's VAT autopilot service ───────────────────────

type VatPeriodStatus = 'draft' | 'ready' | 'submitted' | 'accepted';

interface DeadlineStatus {
  daysUntilDue: number;
  level: 'ok' | 'warning' | 'critical' | 'overdue';
  isOverdue: boolean;
}

interface VatPeriodSummary {
  id: string | null;
  companyId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  frequency: 'monthly' | 'quarterly';
  status: VatPeriodStatus;
  outputVat: number;
  inputVat: number;
  netVatPayable: number;
  calculatedAt: string | null;
  deadline: DeadlineStatus;
}

interface DueDateView {
  companyId: string;
  companyName: string;
  trnVatNumber: string | null;
  periodEnd: string;
  dueDate: string;
  status: VatPeriodStatus;
  daysUntilDue: number;
  level: 'ok' | 'warning' | 'critical' | 'overdue';
}

interface CalculationResult {
  companyId: string;
  periodId: string | null;
  period: { start: string; end: string; dueDate: string; frequency: 'monthly' | 'quarterly' };
  boxes: {
    standardRatedSales: number;
    standardRatedVat: number;
    zeroRatedSales: number;
    exemptSales: number;
    reverseChargeAmount: number;
    reverseChargeVat: number;
    totalOutputVat: number;
    totalExpenses: number;
    inputVatGross: number;
    inputVatRecoverable: number;
    inputVatIrrecoverable: number;
    reverseChargeVatRecoverable: number;
    totalInputVat: number;
    netVatPayable: number;
  };
  reconciliation: {
    outputVatLedger: number;
    outputVatCalculated: number;
    outputVatDelta: number;
    inputVatLedger: number;
    inputVatCalculated: number;
    inputVatDelta: number;
    hasDiscrepancy: boolean;
  };
  invoicesProcessed: number;
  receiptsProcessed: number;
  partialExemption: { exemptSupplyRatio: number; recoverableRatio: number };
  vat201: Record<string, number>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<VatPeriodStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline',
  ready: 'default',
  submitted: 'secondary',
  accepted: 'secondary',
};

const LEVEL_BADGE: Record<DeadlineStatus['level'], { label: string; className: string }> = {
  ok: { label: 'On track', className: 'bg-emerald-100 text-emerald-800' },
  warning: { label: 'Due soon', className: 'bg-amber-100 text-amber-800' },
  critical: { label: 'Critical', className: 'bg-orange-100 text-orange-800' },
  overdue: { label: 'Overdue', className: 'bg-red-100 text-red-800' },
};

function formatDate(iso: string): string {
  return format(new Date(iso), 'dd MMM yyyy');
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function VATAutopilot() {
  const { companyId, isLoading: companyLoading } = useDefaultCompany();
  const { toast } = useToast();
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustmentBox, setAdjustmentBox] = useState('');
  const [adjustmentAmount, setAdjustmentAmount] = useState('0');
  const [adjustmentReason, setAdjustmentReason] = useState('');

  const periodsQuery = useQuery<VatPeriodSummary[]>({
    queryKey: ['/api/vat/autopilot/periods', companyId],
    enabled: !!companyId,
    queryFn: () => apiRequest('GET', `/api/vat/autopilot/periods/${companyId}`),
  });

  const dueDatesQuery = useQuery<DueDateView[]>({
    queryKey: ['/api/vat/autopilot/due-dates'],
    queryFn: () => apiRequest('GET', '/api/vat/autopilot/due-dates'),
  });

  const calcMutation = useMutation<CalculationResult, Error, void>({
    mutationFn: () => apiRequest('GET', `/api/vat/autopilot/calculate/${companyId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/vat/autopilot/periods', companyId] });
      queryClient.invalidateQueries({ queryKey: ['/api/vat/autopilot/due-dates'] });
      toast({ title: 'VAT return recalculated', description: 'All boxes updated from latest data.' });
    },
    onError: (err: any) => {
      toast({
        title: 'Calculation failed',
        description: err?.message || 'Could not auto-calculate VAT return',
        variant: 'destructive',
      });
    },
  });

  const lastCalc = calcMutation.data;
  const currentPeriodId = lastCalc?.periodId ?? periodsQuery.data?.[0]?.id ?? null;
  const currentPeriodStatus: VatPeriodStatus | null = useMemo(() => {
    if (!periodsQuery.data) return null;
    if (currentPeriodId) {
      const byId = periodsQuery.data.find(p => p.id === currentPeriodId);
      if (byId) return byId.status;
    }
    if (lastCalc) {
      const byPeriod = periodsQuery.data.find(
        p => p.periodStart === lastCalc.period.start && p.periodEnd === lastCalc.period.end,
      );
      if (byPeriod) return byPeriod.status;
    }
    return periodsQuery.data[0]?.status ?? null;
  }, [periodsQuery.data, currentPeriodId, lastCalc]);

  const parsedAdjustmentAmount = Number(adjustmentAmount);
  const adjustmentAmountValid =
    adjustmentAmount.trim() !== '' &&
    Number.isFinite(parsedAdjustmentAmount) &&
    parsedAdjustmentAmount !== 0;

  const adjustmentMutation = useMutation({
    mutationFn: () =>
      apiRequest('POST', '/api/vat/autopilot/adjustments', {
        companyId,
        periodId: currentPeriodId,
        box: adjustmentBox,
        amount: parsedAdjustmentAmount,
        reason: adjustmentReason,
      }),
    onSuccess: () => {
      toast({ title: 'Adjustment saved', description: 'It will appear in the audit trail.' });
      setAdjustmentOpen(false);
      setAdjustmentReason('');
      setAdjustmentAmount('0');
      setAdjustmentBox('');
      queryClient.invalidateQueries({ queryKey: ['/api/vat/autopilot/periods', companyId] });
    },
    onError: (err: any) => {
      toast({ title: 'Could not save adjustment', description: err?.message, variant: 'destructive' });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ periodId, status }: { periodId: string; status: VatPeriodStatus }) =>
      apiRequest('PATCH', `/api/vat/autopilot/periods/${periodId}/status`, { status, companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/vat/autopilot/periods', companyId] });
      queryClient.invalidateQueries({ queryKey: ['/api/vat/autopilot/due-dates'] });
      toast({ title: 'Status updated' });
    },
    onError: (err: any) => {
      toast({ title: 'Status update failed', description: err?.message, variant: 'destructive' });
    },
  });

  const upcoming = useMemo(() => {
    return (dueDatesQuery.data || []).slice(0, 5);
  }, [dueDatesQuery.data]);

  if (companyLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (!companyId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">VAT Autopilot</h1>
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            Set up a company before using VAT autopilot.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Calculator className="h-6 w-6" />
            VAT Autopilot
          </h1>
          <p className="text-muted-foreground text-sm">
            Auto-calculated UAE FTA VAT 201 return. Review, adjust, and submit when ready.
          </p>
        </div>
        <Button
          onClick={() => calcMutation.mutate()}
          disabled={calcMutation.isPending}
          data-testid="button-calculate-now"
        >
          {calcMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Calculate now
        </Button>
      </div>

      {/* Reconciliation alert */}
      {lastCalc?.reconciliation.hasDiscrepancy && (
        <Card className="border-amber-300">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Ledger reconciliation mismatch</p>
              <p className="text-muted-foreground">
                Calculated output VAT differs from the ledger by {formatCurrency(lastCalc.reconciliation.outputVatDelta)};
                input VAT differs by {formatCurrency(lastCalc.reconciliation.inputVatDelta)}. Review journal entries before
                marking this period as ready.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Auto-calculated 201 form preview */}
      {lastCalc && (
        <Card>
          <CardHeader>
            <CardTitle>Current period: {formatDate(lastCalc.period.start)} – {formatDate(lastCalc.period.end)}</CardTitle>
            <CardDescription>
              Due {formatDate(lastCalc.period.dueDate)} ·{' '}
              {lastCalc.invoicesProcessed} invoices, {lastCalc.receiptsProcessed} receipts
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 rounded-md border p-4">
                <h3 className="font-medium">Output VAT (sales)</h3>
                <BoxRow label="Standard rated supplies" amount={lastCalc.boxes.standardRatedSales} vat={lastCalc.boxes.standardRatedVat} />
                <BoxRow label="Zero rated supplies" amount={lastCalc.boxes.zeroRatedSales} vat={0} />
                <BoxRow label="Exempt supplies" amount={lastCalc.boxes.exemptSales} vat={0} />
                <BoxRow label="Reverse charge (output)" amount={lastCalc.boxes.reverseChargeAmount} vat={lastCalc.boxes.reverseChargeVat} />
                <div className="flex justify-between font-medium border-t pt-2">
                  <span>Box 12 — Total output VAT</span>
                  <span>{formatCurrency(lastCalc.boxes.totalOutputVat)}</span>
                </div>
              </div>
              <div className="space-y-2 rounded-md border p-4">
                <h3 className="font-medium">Input VAT (purchases)</h3>
                <BoxRow label="Standard expenses" amount={lastCalc.boxes.totalExpenses} vat={lastCalc.boxes.inputVatRecoverable} />
                <BoxRow label="Reverse charge (input)" amount={lastCalc.boxes.reverseChargeAmount} vat={lastCalc.boxes.reverseChargeVatRecoverable} />
                {lastCalc.boxes.inputVatIrrecoverable > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Partial exemption reduced input VAT by {formatCurrency(lastCalc.boxes.inputVatIrrecoverable)}.
                  </p>
                )}
                <div className="flex justify-between font-medium border-t pt-2">
                  <span>Box 13 — Total input VAT</span>
                  <span>{formatCurrency(lastCalc.boxes.totalInputVat)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-md bg-muted p-4 flex items-center justify-between">
              <span className="font-medium">Box 14 — Net VAT payable</span>
              <span className="text-lg font-semibold">{formatCurrency(lastCalc.boxes.netVatPayable)}</span>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setAdjustmentOpen(true)} disabled={!currentPeriodId}>
                Add manual adjustment
              </Button>
              {currentPeriodId && currentPeriodStatus === 'draft' && (
                <Button
                  variant="default"
                  onClick={() => statusMutation.mutate({ periodId: currentPeriodId, status: 'ready' })}
                  disabled={statusMutation.isPending}
                  data-testid="button-mark-ready"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Mark ready
                </Button>
              )}
              {currentPeriodId && currentPeriodStatus === 'ready' && (
                <Button
                  variant="secondary"
                  onClick={() => statusMutation.mutate({ periodId: currentPeriodId, status: 'submitted' })}
                  disabled={statusMutation.isPending}
                  data-testid="button-mark-submitted"
                >
                  <Send className="h-4 w-4 mr-2" />
                  Mark submitted
                </Button>
              )}
              {currentPeriodId && currentPeriodStatus === 'submitted' && (
                <Button
                  variant="secondary"
                  onClick={() => statusMutation.mutate({ periodId: currentPeriodId, status: 'accepted' })}
                  disabled={statusMutation.isPending}
                  data-testid="button-mark-accepted"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Mark accepted by FTA
                </Button>
              )}
              {currentPeriodId && currentPeriodStatus === 'accepted' && (
                <Badge variant="secondary" className="text-xs">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Accepted by FTA
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Periods table */}
      <Card>
        <CardHeader>
          <CardTitle>Periods</CardTitle>
          <CardDescription>Last several VAT filing windows for this company.</CardDescription>
        </CardHeader>
        <CardContent>
          {periodsQuery.isLoading ? (
            <Skeleton className="h-32" data-testid="periods-loading" />
          ) : periodsQuery.isError ? (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              data-testid="periods-error"
            >
              <XCircle className="h-4 w-4 mt-0.5" />
              <div>
                <p className="font-medium">Could not load VAT periods</p>
                <p className="text-xs">
                  {(periodsQuery.error as Error)?.message || 'Please try again or contact support.'}
                </p>
              </div>
            </div>
          ) : (periodsQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="periods-empty">
              No VAT periods yet. Click “Calculate now” to generate the first one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Output VAT</TableHead>
                  <TableHead className="text-right">Input VAT</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(periodsQuery.data || []).map(p => (
                  <TableRow key={`${p.periodStart}-${p.periodEnd}`} data-testid="row-period">
                    <TableCell>
                      <div className="font-medium">{formatDate(p.periodStart)} – {formatDate(p.periodEnd)}</div>
                      <div className="text-xs text-muted-foreground capitalize">{p.frequency}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {formatDate(p.dueDate)}
                        <Badge className={LEVEL_BADGE[p.deadline.level].className}>
                          {LEVEL_BADGE[p.deadline.level].label}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[p.status]} className="capitalize">{p.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(p.outputVat)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(p.inputVat)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(p.netVatPayable)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Firm-wide deadlines */}
      <Card>
        <CardHeader>
          <CardTitle>Upcoming deadlines</CardTitle>
          <CardDescription>VAT 201 due dates across companies you have access to.</CardDescription>
        </CardHeader>
        <CardContent>
          {dueDatesQuery.isLoading ? (
            <Skeleton className="h-32" data-testid="due-dates-loading" />
          ) : dueDatesQuery.isError ? (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              data-testid="due-dates-error"
            >
              <XCircle className="h-4 w-4 mt-0.5" />
              <div>
                <p className="font-medium">Could not load upcoming deadlines</p>
                <p className="text-xs">
                  {(dueDatesQuery.error as Error)?.message || 'Please try again or contact support.'}
                </p>
              </div>
            </div>
          ) : upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="due-dates-empty">No upcoming VAT deadlines.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>TRN</TableHead>
                  <TableHead>Period end</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {upcoming.map(d => (
                  <TableRow key={d.companyId} data-testid="row-due-date">
                    <TableCell className="font-medium">{d.companyName}</TableCell>
                    <TableCell className="font-mono text-xs">{d.trnVatNumber || '—'}</TableCell>
                    <TableCell>{formatDate(d.periodEnd)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {formatDate(d.dueDate)}
                        <Badge className={LEVEL_BADGE[d.level].className}>
                          <Clock className="h-3 w-3 mr-1" />
                          {d.daysUntilDue >= 0 ? `${d.daysUntilDue}d` : `${Math.abs(d.daysUntilDue)}d late`}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[d.status]} className="capitalize">{d.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Adjustment dialog */}
      <Dialog open={adjustmentOpen} onOpenChange={setAdjustmentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manual adjustment</DialogTitle>
            <DialogDescription>
              Adjustments are appended to the audit trail and applied on top of auto-calculated boxes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Box</Label>
              <Select value={adjustmentBox} onValueChange={setAdjustmentBox}>
                <SelectTrigger data-testid="select-adjustment-box"><SelectValue placeholder="Select a box" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="box1aAbuDhabiAmount">Box 1a — Abu Dhabi standard supplies (amount)</SelectItem>
                  <SelectItem value="box1aAbuDhabiVat">Box 1a — Abu Dhabi standard supplies (VAT)</SelectItem>
                  <SelectItem value="box1bDubaiAmount">Box 1b — Dubai standard supplies (amount)</SelectItem>
                  <SelectItem value="box1bDubaiVat">Box 1b — Dubai standard supplies (VAT)</SelectItem>
                  <SelectItem value="box1cSharjahAmount">Box 1c — Sharjah standard supplies (amount)</SelectItem>
                  <SelectItem value="box1cSharjahVat">Box 1c — Sharjah standard supplies (VAT)</SelectItem>
                  <SelectItem value="box1dAjmanAmount">Box 1d — Ajman standard supplies (amount)</SelectItem>
                  <SelectItem value="box1dAjmanVat">Box 1d — Ajman standard supplies (VAT)</SelectItem>
                  <SelectItem value="box1eUmmAlQuwainAmount">Box 1e — Umm Al Quwain standard supplies (amount)</SelectItem>
                  <SelectItem value="box1eUmmAlQuwainVat">Box 1e — Umm Al Quwain standard supplies (VAT)</SelectItem>
                  <SelectItem value="box1fRasAlKhaimahAmount">Box 1f — Ras Al Khaimah standard supplies (amount)</SelectItem>
                  <SelectItem value="box1fRasAlKhaimahVat">Box 1f — Ras Al Khaimah standard supplies (VAT)</SelectItem>
                  <SelectItem value="box1gFujairahAmount">Box 1g — Fujairah standard supplies (amount)</SelectItem>
                  <SelectItem value="box1gFujairahVat">Box 1g — Fujairah standard supplies (VAT)</SelectItem>
                  <SelectItem value="box3ReverseChargeAmount">Box 3 — Reverse-charge supplies (amount)</SelectItem>
                  <SelectItem value="box3ReverseChargeVat">Box 3 — Reverse-charge supplies (VAT)</SelectItem>
                  <SelectItem value="box4ZeroRatedAmount">Box 4 — Zero rated supplies</SelectItem>
                  <SelectItem value="box5ExemptAmount">Box 5 — Exempt supplies</SelectItem>
                  <SelectItem value="box9ExpensesAmount">Box 9 — Standard expenses (amount)</SelectItem>
                  <SelectItem value="box9ExpensesVat">Box 9 — Standard expenses input VAT</SelectItem>
                  <SelectItem value="box10ReverseChargeAmount">Box 10 — Reverse-charge expenses (amount)</SelectItem>
                  <SelectItem value="box10ReverseChargeVat">Box 10 — Reverse-charge input VAT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Adjustment (AED)</Label>
              <Input
                type="number"
                step="0.01"
                value={adjustmentAmount}
                onChange={e => setAdjustmentAmount(e.target.value)}
                data-testid="input-adjustment-amount"
              />
              {adjustmentAmount.trim() !== '' && !adjustmentAmountValid && (
                <p className="text-xs text-destructive mt-1">
                  Amount must be a non-zero number (negatives allowed for corrections).
                </p>
              )}
            </div>
            <div>
              <Label>Reason</Label>
              <Textarea
                value={adjustmentReason}
                onChange={e => setAdjustmentReason(e.target.value)}
                placeholder="e.g. VAT correction for invoice INV-2026-00042"
                data-testid="input-adjustment-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustmentOpen(false)}>Cancel</Button>
            <Button
              onClick={() => adjustmentMutation.mutate()}
              disabled={
                !adjustmentBox ||
                !adjustmentReason.trim() ||
                !adjustmentAmountValid ||
                adjustmentMutation.isPending
              }
              data-testid="button-save-adjustment"
            >
              {adjustmentMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <FileText className="h-4 w-4 mr-2" />
              Save adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BoxRow({ label, amount, vat }: { label: string; amount: number; vat: number }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>
        {formatCurrency(amount)}
        {vat > 0 && <span className="text-muted-foreground"> · {formatCurrency(vat)} VAT</span>}
      </span>
    </div>
  );
}
