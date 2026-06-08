import { useMutation,useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Calculator,Check,Copy,FileText,Plus,RefreshCw,Upload } from 'lucide-react';
import { useEffect,useMemo,useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardHeader,CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { Table,TableBody,TableCell,TableHead,TableHeader,TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { apiRequest,queryClient } from '@/lib/queryClient';
import {
parseVatPasteRows,
vat201CopyGroups,
vatEmirates,
vatRowCategories,
vatRowCategoryLabel,
type VatRowCategory,
} from '@/lib/vat-workpaper-grid';

interface VatWorkpaperSummary {
  id: string;
  companyId: string;
  companyName: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: string;
  generatedVatReturnId: string | null;
  totalsSnapshot: Record<string, number>;
  updatedAt: string;
}

interface VatWorkpaperRow {
  id: string;
  rowCategory: VatRowCategory;
  vat201Box: string;
  invoiceNumber: string | null;
  documentDate: string | null;
  counterpartyName: string | null;
  counterpartyTrn: string | null;
  emirate: string | null;
  taxableAmount: number;
  vatAmount: number;
  adjustmentAmount: number;
  grossAmount: number;
  status: 'draft' | 'approved' | 'excluded';
  sourceMethod: 'manual' | 'ocr' | 'import' | 'generated';
  notes: string | null;
  auditReason: string | null;
}

interface VatWorkpaperDetail {
  workpaper: VatWorkpaperSummary;
  rows: VatWorkpaperRow[];
  totals: Record<string, number>;
}

interface VatRowForm {
  rowCategory: VatRowCategory;
  vat201Box: string;
  invoiceNumber: string;
  documentDate: string;
  counterpartyName: string;
  counterpartyTrn: string;
  emirate: string;
  taxableAmount: string;
  vatAmount: string;
  adjustmentAmount: string;
  grossAmount: string;
  notes: string;
  auditReason: string;
}

function _dateInput(date: Date | string | null | undefined) {
  if (!date) return '';
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isNaN(parsed.getTime()) ? '' : format(parsed, 'yyyy-MM-dd');
}

function dueDateForPeriodEnd(periodEnd: string) {
  const end = new Date(`${periodEnd}T00:00:00`);
  if (Number.isNaN(end.getTime())) return '';
  end.setDate(end.getDate() + 28);
  return format(end, 'yyyy-MM-dd');
}

function money(value: unknown) {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function emptyRowForm(emirate: string): VatRowForm {
  return {
    rowCategory: 'standard_sale',
    vat201Box: 'box1bDubaiAmount',
    invoiceNumber: '',
    documentDate: format(new Date(), 'yyyy-MM-dd'),
    counterpartyName: '',
    counterpartyTrn: '',
    emirate: emirate || 'dubai',
    taxableAmount: '',
    vatAmount: '',
    adjustmentAmount: '',
    grossAmount: '',
    notes: '',
    auditReason: '',
  };
}

function statusBadge(status: VatWorkpaperRow['status']) {
  if (status === 'approved') return <Badge className="bg-green-100 text-green-800">Approved</Badge>;
  if (status === 'excluded') return <Badge variant="outline">Excluded</Badge>;
  return <Badge className="bg-amber-100 text-amber-800">Draft</Badge>;
}

async function readFileAsBase64(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
  return dataUrl;
}

function copyText(value: unknown) {
  void navigator.clipboard?.writeText(String(Number(value ?? 0).toFixed(2)));
}

export function VatWorkpaperWorkspace({
  companyId,
  companyName,
  companyEmirate,
  defaultPeriodStart,
  defaultPeriodEnd,
  onReturnGenerated,
}: {
  companyId: string | undefined;
  companyName: string | undefined;
  companyEmirate?: string | null;
  defaultPeriodStart: string;
  defaultPeriodEnd: string;
  onReturnGenerated?: () => void;
}) {
  const { toast } = useToast();
  const emirate = companyEmirate || 'dubai';
  const [selectedWorkpaperId, setSelectedWorkpaperId] = useState<string | null>(null);
  const [periodStart, setPeriodStart] = useState(defaultPeriodStart);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd);
  const [dueDate, setDueDate] = useState(dueDateForPeriodEnd(defaultPeriodEnd));
  const [rowForm, setRowForm] = useState<VatRowForm>(() => emptyRowForm(emirate));
  const [pasteText, setPasteText] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceInputKey, setEvidenceInputKey] = useState(0);

  useEffect(() => {
    setPeriodStart(defaultPeriodStart);
    setPeriodEnd(defaultPeriodEnd);
    setDueDate(dueDateForPeriodEnd(defaultPeriodEnd));
  }, [defaultPeriodEnd, defaultPeriodStart]);

  useEffect(() => {
    setRowForm(form => ({ ...form, emirate }));
  }, [emirate]);

  const workpapersQuery = useQuery<{ workpapers: VatWorkpaperSummary[] }>({
    queryKey: ['/api/firm/vat-workpapers', companyId],
    queryFn: () => apiRequest('GET', `/api/firm/vat-workpapers?companyId=${companyId}`),
    enabled: !!companyId,
    retry: false,
  });
  const workpapers = useMemo(() => workpapersQuery.data?.workpapers ?? [], [workpapersQuery.data?.workpapers]);

  useEffect(() => {
    if (!selectedWorkpaperId && workpapers.length > 0) setSelectedWorkpaperId(workpapers[0].id);
    if (selectedWorkpaperId && workpapers.length > 0 && !workpapers.some(workpaper => workpaper.id === selectedWorkpaperId)) {
      setSelectedWorkpaperId(workpapers[0].id);
    }
  }, [selectedWorkpaperId, workpapers]);

  const detailQuery = useQuery<VatWorkpaperDetail>({
    queryKey: ['/api/firm/vat-workpapers/detail', selectedWorkpaperId],
    queryFn: () => apiRequest('GET', `/api/firm/vat-workpapers/${selectedWorkpaperId}`),
    enabled: !!selectedWorkpaperId,
    retry: false,
  });

  const invalidateWorkspace = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/firm/vat-workpapers'] });
    queryClient.invalidateQueries({ queryKey: ['/api/firm/vat-workpapers', companyId] });
    queryClient.invalidateQueries({ queryKey: ['/api/firm/vat-workpapers/detail', selectedWorkpaperId] });
  };

  const createWorkpaper = useMutation({
    mutationFn: () => apiRequest('POST', '/api/firm/vat-workpapers', {
      companyId,
      periodStart,
      periodEnd,
      dueDate: dueDate || null,
    }),
    onSuccess: (workpaper: VatWorkpaperSummary) => {
      setSelectedWorkpaperId(workpaper.id);
      invalidateWorkspace();
      toast({ title: 'VAT workpaper ready' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Could not create VAT workpaper', description: error?.message });
    },
  });

  const rowPayload = (status: 'approved' | 'draft', sourceMethod: 'manual' | 'ocr' = 'manual') => ({
    rowCategory: rowForm.rowCategory,
    vat201Box: rowForm.rowCategory === 'manual_adjustment' ? rowForm.vat201Box : undefined,
    invoiceNumber: rowForm.invoiceNumber || null,
    documentDate: rowForm.documentDate || null,
    counterpartyName: rowForm.counterpartyName || null,
    counterpartyTrn: rowForm.counterpartyTrn || null,
    emirate: rowForm.emirate || null,
    taxableAmount: Number(rowForm.taxableAmount || 0),
    vatAmount: Number(rowForm.vatAmount || 0),
    adjustmentAmount: Number(rowForm.adjustmentAmount || 0),
    grossAmount: Number(rowForm.grossAmount || 0),
    status,
    sourceMethod,
    notes: rowForm.notes || null,
    auditReason: rowForm.auditReason || null,
  });

  const resetRow = () => {
    setRowForm(emptyRowForm(emirate));
    setEvidenceFile(null);
    setEvidenceInputKey(key => key + 1);
  };

  const addRow = useMutation({
    mutationFn: () => apiRequest('POST', `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows`, rowPayload('approved')),
    onSuccess: () => {
      invalidateWorkspace();
      resetRow();
      toast({ title: 'VAT row added' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Could not add VAT row', description: error?.message });
    },
  });

  const importRows = useMutation({
    mutationFn: async () => {
      if (!selectedWorkpaperId) throw new Error('Create or select a VAT workpaper first');
      const rows = parseVatPasteRows(pasteText, rowForm.emirate);
      if (rows.length === 0) throw new Error('Paste at least one VAT row');
      for (const row of rows) {
        await apiRequest('POST', `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows`, row);
      }
      return rows.length;
    },
    onSuccess: count => {
      invalidateWorkspace();
      setPasteText('');
      toast({ title: 'VAT rows imported', description: `${count} row${count === 1 ? '' : 's'} added.` });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Could not import VAT rows', description: error?.message });
    },
  });

  const scanDraft = useMutation({
    mutationFn: async () => apiRequest('POST', `/api/firm/vat-workpapers/${selectedWorkpaperId}/scan`, {
      attachment: {
        fileName: evidenceFile?.name || rowForm.invoiceNumber || 'vat-evidence',
        mimeType: evidenceFile?.type || 'application/octet-stream',
        fileDataBase64: evidenceFile ? await readFileAsBase64(evidenceFile) : null,
        extractedText: rowForm.notes || null,
        extractionJson: { source: evidenceFile ? 'uploaded_evidence' : 'manual_draft' },
      },
      draftRow: rowPayload('draft', 'ocr'),
    }),
    onSuccess: () => {
      invalidateWorkspace();
      resetRow();
      toast({ title: 'Draft evidence row logged' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Could not log draft evidence', description: error?.message });
    },
  });

  const updateRowStatus = useMutation({
    mutationFn: ({ rowId, status }: { rowId: string; status: 'approved' | 'excluded' }) =>
      apiRequest('PATCH', `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows/${rowId}`, { status }),
    onSuccess: invalidateWorkspace,
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Could not update VAT row', description: error?.message });
    },
  });

  const recalculate = useMutation({
    mutationFn: () => apiRequest('POST', `/api/firm/vat-workpapers/${selectedWorkpaperId}/recalculate`),
    onSuccess: invalidateWorkspace,
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Could not recalculate VAT workpaper', description: error?.message });
    },
  });

  const generateReturn = useMutation({
    mutationFn: () => apiRequest('POST', `/api/firm/vat-workpapers/${selectedWorkpaperId}/generate-return`),
    onSuccess: () => {
      invalidateWorkspace();
      onReturnGenerated?.();
      toast({ title: 'VAT 201 generated', description: 'No FTA submission was performed.' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Could not generate VAT 201', description: error?.message });
    },
  });

  const selectedWorkpaper = workpapers.find(workpaper => workpaper.id === selectedWorkpaperId);
  const rows = detailQuery.data?.rows ?? [];
  const totals = detailQuery.data?.totals ?? selectedWorkpaper?.totalsSnapshot ?? {};
  const approvedRows = rows.filter(row => row.status === 'approved');
  const draftRows = rows.filter(row => row.status === 'draft');
  const pastePreviewCount = useMemo(() => parseVatPasteRows(pasteText, rowForm.emirate).length, [pasteText, rowForm.emirate]);
  const copyFields = useMemo(() => {
    const fields: Array<readonly [string, string]> = [];
    vat201CopyGroups.forEach(group => {
      (group.fields as readonly unknown[]).forEach(field => {
        fields.push(field as readonly [string, string]);
      });
    });
    return fields;
  }, []);

  if (workpapersQuery.isError) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="pt-4 text-sm text-red-800">
          Could not load the VAT input workbook: {workpapersQuery.error instanceof Error ? workpapersQuery.error.message : 'Unknown error'}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Calculator className="w-4 h-4 text-primary" />
              VAT Input Workbook
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {companyName || 'Client'} · invoice rows, bills, imports, reverse-charge, zero-rated, exempt, and adjustments
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => recalculate.mutate()} disabled={!selectedWorkpaperId || recalculate.isPending}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Recalculate
            </Button>
            <Button size="sm" onClick={() => generateReturn.mutate()} disabled={!selectedWorkpaperId || generateReturn.isPending}>
              <FileText className="w-4 h-4 mr-2" />
              Generate VAT 201
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
          <div className="space-y-1.5">
            <Label htmlFor="vat-workpaper-start">Period start</Label>
            <Input id="vat-workpaper-start" type="date" value={periodStart} onChange={event => setPeriodStart(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vat-workpaper-end">Period end</Label>
            <Input
              id="vat-workpaper-end"
              type="date"
              value={periodEnd}
              onChange={event => {
                setPeriodEnd(event.target.value);
                setDueDate(dueDateForPeriodEnd(event.target.value));
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vat-workpaper-due">Due date</Label>
            <Input id="vat-workpaper-due" type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} />
          </div>
          <Button onClick={() => createWorkpaper.mutate()} disabled={!companyId || !periodStart || !periodEnd || createWorkpaper.isPending}>
            <Plus className="w-4 h-4 mr-2" />
            Open period
          </Button>
        </div>

        {workpapers.length > 0 && (
          <div className="grid gap-1.5">
            <Label>Open workbook</Label>
            <Select value={selectedWorkpaperId ?? undefined} onValueChange={setSelectedWorkpaperId}>
              <SelectTrigger>
                <SelectValue placeholder="Select VAT workpaper" />
              </SelectTrigger>
              <SelectContent>
                {workpapers.map(workpaper => (
                  <SelectItem key={workpaper.id} value={workpaper.id}>
                    {format(new Date(workpaper.periodStart), 'dd MMM yyyy')} - {format(new Date(workpaper.periodEnd), 'dd MMM yyyy')} · {workpaper.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {selectedWorkpaperId ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Approved rows</p>
                <p className="text-xl font-semibold">{approvedRows.length}</p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Draft evidence</p>
                <p className="text-xl font-semibold">{draftRows.length}</p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Output VAT</p>
                <p className="text-xl font-semibold">{money(totals.box12TotalDueTax)}</p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Payable / refund</p>
                <p className="text-xl font-semibold">{money(totals.box14PayableTax)}</p>
              </div>
            </div>

            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-48">Category</TableHead>
                    <TableHead className="min-w-36">Invoice no.</TableHead>
                    <TableHead className="min-w-36">Date</TableHead>
                    <TableHead className="min-w-44">Customer / vendor</TableHead>
                    <TableHead className="min-w-32">TRN</TableHead>
                    <TableHead className="min-w-36">Emirate</TableHead>
                    <TableHead className="min-w-32 text-right">Taxable</TableHead>
                    <TableHead className="min-w-32 text-right">VAT</TableHead>
                    <TableHead className="min-w-32 text-right">Gross</TableHead>
                    <TableHead className="min-w-40">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <Select value={rowForm.rowCategory} onValueChange={value => setRowForm(form => ({ ...form, rowCategory: value as VatRowCategory }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {vatRowCategories.map(category => (
                            <SelectItem key={category.value} value={category.value}>{category.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input value={rowForm.invoiceNumber} onChange={event => setRowForm(form => ({ ...form, invoiceNumber: event.target.value }))} placeholder="INV-1001" /></TableCell>
                    <TableCell><Input type="date" value={rowForm.documentDate} onChange={event => setRowForm(form => ({ ...form, documentDate: event.target.value }))} /></TableCell>
                    <TableCell><Input value={rowForm.counterpartyName} onChange={event => setRowForm(form => ({ ...form, counterpartyName: event.target.value }))} placeholder="Customer / supplier" /></TableCell>
                    <TableCell><Input value={rowForm.counterpartyTrn} onChange={event => setRowForm(form => ({ ...form, counterpartyTrn: event.target.value }))} placeholder="TRN" /></TableCell>
                    <TableCell>
                      <Select value={rowForm.emirate} onValueChange={value => setRowForm(form => ({ ...form, emirate: value }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {vatEmirates.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input className="text-right" inputMode="decimal" value={rowForm.taxableAmount} onChange={event => setRowForm(form => ({ ...form, taxableAmount: event.target.value }))} placeholder="0.00" /></TableCell>
                    <TableCell><Input className="text-right" inputMode="decimal" value={rowForm.vatAmount} onChange={event => setRowForm(form => ({ ...form, vatAmount: event.target.value }))} placeholder="0.00" /></TableCell>
                    <TableCell><Input className="text-right" inputMode="decimal" value={rowForm.grossAmount} onChange={event => setRowForm(form => ({ ...form, grossAmount: event.target.value }))} placeholder="0.00" /></TableCell>
                    <TableCell><Input value={rowForm.notes} onChange={event => setRowForm(form => ({ ...form, notes: event.target.value }))} placeholder="Optional" /></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {rowForm.rowCategory === 'manual_adjustment' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Adjustment VAT 201 box</Label>
                  <Select value={rowForm.vat201Box} onValueChange={value => setRowForm(form => ({ ...form, vat201Box: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {copyFields.map(([key, label]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Audit reason</Label>
                  <Input value={rowForm.auditReason} onChange={event => setRowForm(form => ({ ...form, auditReason: event.target.value }))} placeholder="Required for manual adjustments" />
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => addRow.mutate()} disabled={addRow.isPending}>
                <Check className="w-4 h-4 mr-2" />
                Add approved row
              </Button>
              <Input
                key={evidenceInputKey}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv"
                className="max-w-xs"
                onChange={event => setEvidenceFile(event.target.files?.[0] ?? null)}
              />
              <Button variant="outline" onClick={() => scanDraft.mutate()} disabled={scanDraft.isPending}>
                <Upload className="w-4 h-4 mr-2" />
                Log OCR draft
              </Button>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Paste rows from Excel</Label>
                <Textarea
                  value={pasteText}
                  onChange={event => setPasteText(event.target.value)}
                  className="min-h-32 font-mono text-xs"
                  placeholder={'category\tinvoice number\tdate\tcustomer/vendor\tTRN\temirate\ttaxable amount\tVAT amount\tgross amount\tnotes'}
                />
                <Button variant="outline" onClick={() => importRows.mutate()} disabled={!pasteText.trim() || importRows.isPending}>
                  Import {pastePreviewCount || ''} row{pastePreviewCount === 1 ? '' : 's'}
                </Button>
              </div>

              <div className="space-y-2">
                <Label>Copy-ready FTA boxes</Label>
                <div className="rounded-md border divide-y max-h-64 overflow-auto">
                  {copyFields.map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="truncate text-muted-foreground">{label}</span>
                      <button
                        type="button"
                        onClick={() => copyText(totals[key])}
                        className="inline-flex items-center gap-2 font-mono hover:text-primary"
                      >
                        {Number(totals[key] ?? 0).toFixed(2)}
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead>Box</TableHead>
                    <TableHead className="text-right">Taxable</TableHead>
                    <TableHead className="text-right">VAT</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        No VAT rows entered for this period.
                      </TableCell>
                    </TableRow>
                  ) : rows.map(row => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <p className="font-medium">{vatRowCategoryLabel(row.rowCategory)}</p>
                        <p className="text-xs text-muted-foreground">{row.sourceMethod}</p>
                      </TableCell>
                      <TableCell>{row.invoiceNumber || '—'}</TableCell>
                      <TableCell>{row.counterpartyName || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.vat201Box}</TableCell>
                      <TableCell className="text-right font-mono">{money(row.taxableAmount)}</TableCell>
                      <TableCell className="text-right font-mono">{money(row.vatAmount)}</TableCell>
                      <TableCell>{statusBadge(row.status)}</TableCell>
                      <TableCell className="text-right">
                        {row.status === 'draft' && (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => updateRowStatus.mutate({ rowId: row.id, status: 'approved' })}>Approve</Button>
                            <Button size="sm" variant="ghost" onClick={() => updateRowStatus.mutate({ rowId: row.id, status: 'excluded' })}>Exclude</Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              No FTA submission happens from Muhasib.ai. Approved rows generate copy-ready VAT 201 values for manual FTA entry.
            </div>
          </>
        ) : (
          <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            Open a VAT period to start entering sales, purchases, import, reverse-charge, zero-rated, exempt, and adjustment rows.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
