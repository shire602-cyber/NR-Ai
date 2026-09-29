import { PageHeader } from "@/components/ui/page-header";
import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Upload,
  FileText,
  ReceiptIcon,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Play,
  RefreshCw,
  Building2,
  ChevronDown,
  Loader2,
  CheckSquare,
  Square,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Company } from "@shared/schema";
import { messages as pageMessages } from "./BulkOperations.i18n";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientWithStats extends Company {
  invoiceCount: number;
  outstandingAr: number;
}

interface OcrFileItem {
  id: string;
  file: File;
  companyId: string;
  preview?: string;
  status: "pending" | "processing" | "success" | "error";
  receiptId?: string;
  error?: string;
}

interface VatQueueEntry {
  companyId: string;
  companyName: string;
  trn: string;
  period: string;
  totalSales: number;
  totalPurchases: number;
  vatPayable: number;
  status: string;
}

interface BulkInvoiceResult {
  companyId: string;
  companyName: string;
  success: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  error?: string;
}

interface PeriodCloseStatus {
  companyId: string;
  companyName: string;
  period: string;
  checks: {
    trialBalanceOk: boolean;
    bankRecDone: boolean;
    allReceiptsPosted: boolean;
    vatPrepared: boolean;
  };
  issues: string[];
  readyToClose: boolean;
}

interface BankImportStatus {
  companyId: string;
  companyName: string;
  lastImportDate: string | null;
  unreconciledCount: number;
  totalTransactions: number;
  matchRate: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAed(n: number) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function VatStatusBadge({ status }: { status: string }) {
  const tr = pageMessages.useT();

  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: tr("draft"), cls: "bg-muted text-foreground border-border" },
    pending_review: { label: tr("pendingReview"), cls: "bg-info-subtle text-info border-info/30" },
    submitted: { label: tr("submitted"), cls: "bg-warning-subtle text-warning border-warning/30" },
    filed: { label: tr("filed"), cls: "bg-success-subtle text-success border-success/30" },
    none: { label: tr("notStarted"), cls: "bg-muted text-muted-foreground border-border" },
  };
  const { label, cls } = map[status] ?? map.draft;
  return <Badge className={cls}>{label}</Badge>;
}

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />
      )}
      <span className={ok ? "text-success" : "text-destructive"}>{label}</span>
    </div>
  );
}

// ─── Tab 1: Batch OCR ─────────────────────────────────────────────────────────

function BatchOCRTab({ clients }: { clients: ClientWithStats[] }) {
  const tr = pageMessages.useT();

  const { toast } = useToast();
  const [items, setItems] = useState<OcrFileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
      const newItems: OcrFileItem[] = arr.map((file) => ({
        id: `${file.name}-${Date.now()}-${Math.random()}`,
        file,
        companyId: clients[0]?.id ?? "",
        status: "pending",
      }));
      setItems((prev) => [...prev, ...newItems]);
    },
    [clients]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const setCompanyForItem = (id: string, companyId: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, companyId } : i)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const [isProcessing, setIsProcessing] = useState(false);

  const processAll = async () => {
    const pendingItems = items.filter((i) => i.status === "pending");
    if (!pendingItems.length) return;
    if (pendingItems.some((i) => !i.companyId)) {
      toast({ variant: "destructive", title: tr("selectAClientForEachReceipt") });
      return;
    }

    setIsProcessing(true);
    setItems((prev) =>
      prev.map((i) => (i.status === "pending" ? { ...i, status: "processing" } : i))
    );

    for (const item of pendingItems) {
      try {
        const imageData = await fileToBase64(item.file);
        const result = await apiRequest("POST", "/api/firm/bulk/ocr", {
          items: [{ companyId: item.companyId, imageData, filename: item.file.name }],
        });
        const r = result.results?.[0];
        if (r?.success) {
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id ? { ...i, status: "success", receiptId: r.receiptId } : i
            )
          );
        } else {
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id ? { ...i, status: "error", error: r?.error ?? tr("ocrFailed") } : i
            )
          );
        }
      } catch (err: any) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? { ...i, status: "error", error: err?.message ?? tr("requestFailed") }
              : i
          )
        );
      }
    }
    setIsProcessing(false);
  };

  const successCount = items.filter((i) => i.status === "success").length;
  const errorCount = items.filter((i) => i.status === "error").length;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{tr("batchOcrProcessing")}</h3>
        <p className="text-sm text-muted-foreground mt-1">
          {tr("uploadMultipleReceiptImagesAndAssign")}
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="font-medium">{tr("dropReceiptImagesHereOrClick")}</p>
        <p className="text-sm text-muted-foreground mt-1">
          {tr("jpegPngWebpMultipleFilesSupported")}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {/* Items list */}
      {items.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {tr.plural("filesQueued", items.length)}
                {successCount > 0 && (
                  <span className="ms-2 text-success text-sm font-normal">
                    {tr("done", { successCount })}
                  </span>
                )}
                {errorCount > 0 && (
                  <span className="ms-2 text-destructive text-sm font-normal">
                    {tr("failed", { errorCount })}
                  </span>
                )}
              </CardTitle>
              <Button
                onClick={processAll}
                disabled={isProcessing || items.every((i) => i.status !== "pending")}
              >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 me-2" />
                )}
                {tr("processAll")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("file")}</TableHead>
                    <TableHead>{tr("client")}</TableHead>
                    <TableHead>{tr("status")}</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium text-sm max-w-[200px] truncate">
                        {item.file.name}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={item.companyId}
                          onValueChange={(v) => setCompanyForItem(item.id, v)}
                          disabled={item.status !== "pending"}
                        >
                          <SelectTrigger className="w-44">
                            <SelectValue placeholder={tr("selectClient")} />
                          </SelectTrigger>
                          <SelectContent>
                            {clients.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {item.status === "pending" && (
                          <Badge variant="outline">{tr("pending")}</Badge>
                        )}
                        {item.status === "processing" && (
                          <Badge className="bg-info-subtle text-info">
                            <Loader2 className="w-3 h-3 me-1 animate-spin" />
                            {tr("processing")}
                          </Badge>
                        )}
                        {item.status === "success" && (
                          <Badge className="bg-success-subtle text-success">
                            <CheckCircle2 className="w-3 h-3 me-1" />
                            {tr("done2")}
                          </Badge>
                        )}
                        {item.status === "error" && (
                          <Badge variant="destructive" title={item.error}>
                            <XCircle className="w-3 h-3 me-1" />
                            {tr("failed2")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {item.status === "pending" && (
                          <Button variant="ghost" size="sm" onClick={() => removeItem(item.id)}>
                            ×
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Tab 2: VAT Filing Queue ──────────────────────────────────────────────────

function VatQueueTab({ clients }: { clients: ClientWithStats[] }) {
  const tr = pageMessages.useT();

  const { toast } = useToast();
  const [queue, setQueue] = useState<VatQueueEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const prepareAll = async () => {
    setIsLoading(true);
    try {
      const data = await apiRequest("POST", "/api/firm/bulk/vat-queue", {});
      setQueue(data);
      toast({ title: tr("preparedVatQueueForClientS", { dataCount: data.length }) });
    } catch {
      toast({ variant: "destructive", title: tr("failedToPrepareVatQueue") });
    } finally {
      setIsLoading(false);
    }
  };

  const totalVatPayable = queue.reduce((s, e) => s + e.vatPayable, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">{tr("vatFilingQueue")}</h3>
          <p className="text-sm text-muted-foreground mt-1">{tr("reviewVatPeriodDataAcrossAll")}</p>
        </div>
        <Button onClick={prepareAll} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="w-4 h-4 me-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 me-2" />
          )}
          {tr("prepareAll")}
        </Button>
      </div>

      {queue.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{tr("clientsInQueue")}</p>
                <p className="text-2xl font-bold mt-1">{queue.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{tr("totalVatPayable")}</p>
                <p className="text-2xl font-bold mt-1">{formatAed(totalVatPayable)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{tr("readyToFile")}</p>
                <p className="text-2xl font-bold mt-1">
                  {queue.filter((e) => e.status === "submitted" || e.status === "filed").length}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("company")}</TableHead>
                      <TableHead>{tr("trn")}</TableHead>
                      <TableHead>{tr("period")}</TableHead>
                      <TableHead className="text-end">{tr("sales")}</TableHead>
                      <TableHead className="text-end">{tr("purchases")}</TableHead>
                      <TableHead className="text-end">{tr("vatPayable")}</TableHead>
                      <TableHead>{tr("status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queue.map((entry) => (
                      <TableRow key={entry.companyId}>
                        <TableCell className="font-medium">{entry.companyName}</TableCell>
                        <TableCell className="text-muted-foreground font-mono text-sm">
                          {entry.trn}
                        </TableCell>
                        <TableCell>{entry.period}</TableCell>
                        <TableCell className="text-end">{formatAed(entry.totalSales)}</TableCell>
                        <TableCell className="text-end">
                          {formatAed(entry.totalPurchases)}
                        </TableCell>
                        <TableCell className="text-end font-semibold">
                          {formatAed(entry.vatPayable)}
                        </TableCell>
                        <TableCell>
                          <VatStatusBadge status={entry.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {queue.length === 0 && !isLoading && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">{tr("clickPrepareAllToLoadVat")}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Tab 3: Bulk Invoicing ────────────────────────────────────────────────────

function BulkInvoicingTab({ clients }: { clients: ClientWithStats[] }) {
  const tr = pageMessages.useT();

  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [serviceDescription, setServiceDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [vatRate, setVatRate] = useState("0.05");
  const [results, setResults] = useState<BulkInvoiceResult[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const toggleAll = () => {
    if (selectedIds.size === clients.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(clients.map((c) => c.id)));
    }
  };

  const toggleClient = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const numAmount = parseFloat(amount) || 0;
  const parsedVatRate = parseFloat(vatRate);
  const numVatRate = Number.isFinite(parsedVatRate) ? parsedVatRate : 0.05;
  const vatAmount = parseFloat((numAmount * numVatRate).toFixed(2));
  const total = numAmount + vatAmount;

  const generate = async () => {
    if (!serviceDescription.trim()) {
      toast({ variant: "destructive", title: tr("enterAServiceDescription") });
      return;
    }
    if (numAmount <= 0) {
      toast({ variant: "destructive", title: tr("enterAValidAmount") });
      return;
    }
    if (selectedIds.size === 0) {
      toast({ variant: "destructive", title: tr("selectAtLeastOneClient") });
      return;
    }

    setIsGenerating(true);
    try {
      const data = await apiRequest("POST", "/api/firm/bulk/invoices", {
        companyIds: Array.from(selectedIds),
        serviceDescription: serviceDescription.trim(),
        amount: numAmount,
        vatRate: numVatRate,
      });
      setResults(data.results ?? []);
      const success = (data.results ?? []).filter((r: BulkInvoiceResult) => r.success).length;
      toast({ title: tr("generatedInvoiceS", { success }) });
    } catch {
      toast({ variant: "destructive", title: tr("failedToGenerateInvoices") });
    } finally {
      setIsGenerating(false);
    }
  };

  const allSelected = clients.length > 0 && selectedIds.size === clients.length;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{tr("bulkInvoicing")}</h3>
        <p className="text-sm text-muted-foreground mt-1">
          {tr("generateNraServiceInvoicesToMultiple")}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Left: form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tr("invoiceDetails")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>{tr("serviceDescription")}</Label>
              <Input
                className="mt-1"
                placeholder={tr("eGMonthlyAccountingServicesApril")}
                value={serviceDescription}
                onChange={(e) => setServiceDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{tr("amountAedExclVat")}</Label>
                <Input
                  className="mt-1"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="1500"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div>
                <Label>{tr("vatRate")}</Label>
                <Select value={vatRate} onValueChange={setVatRate}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.05">{tr("n5Standard")}</SelectItem>
                    <SelectItem value="0">{tr("n0ZeroRated")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {numAmount > 0 && (
              <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{tr("subtotal")}</span>
                  <span>{formatAed(numAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {tr("vat", { value: (numVatRate * 100).toFixed(0) })}
                  </span>
                  <span>{formatAed(vatAmount)}</span>
                </div>
                <div className="flex justify-between font-semibold border-t pt-1">
                  <span>{tr("totalPerInvoice")}</span>
                  <span>{formatAed(total)}</span>
                </div>
                {selectedIds.size > 0 && (
                  <div className="flex justify-between text-primary font-semibold pt-1">
                    <span>{tr("totalClients", { size: selectedIds.size })}</span>
                    <span>{formatAed(total * selectedIds.size)}</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: client selector */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{tr("selectClients")}</CardTitle>
              <Button variant="ghost" size="sm" onClick={toggleAll}>
                {allSelected ? (
                  <CheckSquare className="w-4 h-4 me-1" />
                ) : (
                  <Square className="w-4 h-4 me-1" />
                )}
                {allSelected ? tr("deselectAll") : tr("selectAll")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="max-h-64 overflow-y-auto space-y-1 pe-2">
            {clients.map((client) => (
              <div
                key={client.id}
                className={`flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors ${
                  selectedIds.has(client.id) ? "bg-primary/10" : "hover:bg-muted/50"
                }`}
                onClick={() => toggleClient(client.id)}
              >
                {selectedIds.has(client.id) ? (
                  <CheckSquare className="w-4 h-4 text-primary flex-shrink-0" />
                ) : (
                  <Square className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <span className="text-sm">{client.name}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={generate} disabled={isGenerating || selectedIds.size === 0}>
          {isGenerating ? (
            <Loader2 className="w-4 h-4 me-2 animate-spin" />
          ) : (
            <Play className="w-4 h-4 me-2" />
          )}
          {tr("generate")}
          {selectedIds.size > 0 ? tr.plural("invoicesCount", selectedIds.size) : tr("invoices")}
        </Button>
      </div>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tr("results")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("company")}</TableHead>
                  <TableHead>{tr("invoice")}</TableHead>
                  <TableHead>{tr("status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => (
                  <TableRow key={r.companyId}>
                    <TableCell className="font-medium">{r.companyName}</TableCell>
                    <TableCell className="font-mono text-sm">{r.invoiceNumber ?? "—"}</TableCell>
                    <TableCell>
                      {r.success ? (
                        <Badge className="bg-success-subtle text-success">
                          <CheckCircle2 className="w-3 h-3 me-1" />
                          {tr("created")}
                        </Badge>
                      ) : (
                        <Badge variant="destructive" title={r.error}>
                          <XCircle className="w-3 h-3 me-1" />
                          {tr("failed2")}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Tab 4: Period Close ──────────────────────────────────────────────────────

function PeriodCloseTab({ clients }: { clients: ClientWithStats[] }) {
  const tr = pageMessages.useT();

  const { toast } = useToast();
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(clients.map((c) => c.id)));
  const [statuses, setStatuses] = useState<PeriodCloseStatus[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  const toggleClient = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runCheck = async () => {
    if (selectedIds.size === 0) {
      toast({ variant: "destructive", title: tr("selectAtLeastOneClient") });
      return;
    }
    setIsChecking(true);
    try {
      const data = await apiRequest("POST", "/api/firm/bulk/period-close", {
        companyIds: Array.from(selectedIds),
        period,
      });
      setStatuses(data);
      const readyCount = data.filter((s: PeriodCloseStatus) => s.readyToClose).length;
      toast({ title: tr("clientsReadyToClose", { readyCount, dataCount: data.length }) });
    } catch {
      toast({ variant: "destructive", title: tr("periodCloseCheckFailed") });
    } finally {
      setIsChecking(false);
    }
  };

  const quarterOptions = (() => {
    const now = new Date();
    const opts: string[] = [];
    for (let y = now.getFullYear(); y >= now.getFullYear() - 1; y--) {
      for (let q = 4; q >= 1; q--) {
        opts.push(`Q${q} ${y}`);
      }
    }
    return opts;
  })();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{tr("periodEndClose")}</h3>
        <p className="text-sm text-muted-foreground mt-1">{tr("runAPreCloseChecklistAcross")}</p>
      </div>

      <div className="flex items-end gap-4">
        <div>
          <Label>{tr("period")}</Label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="mt-1 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {quarterOptions.map((q) => (
                <SelectItem key={q} value={q}>
                  {q}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={runCheck} disabled={isChecking || selectedIds.size === 0}>
          {isChecking ? (
            <Loader2 className="w-4 h-4 me-2 animate-spin" />
          ) : (
            <CheckCircle2 className="w-4 h-4 me-2" />
          )}
          {tr("runChecklist")}
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Client selector */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {tr("clients", { size: selectedIds.size, clientsCount: clients.length })}
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelectedIds(
                    selectedIds.size === clients.length
                      ? new Set()
                      : new Set(clients.map((c) => c.id))
                  )
                }
              >
                {selectedIds.size === clients.length ? tr("deselectAll") : tr("selectAll")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="max-h-64 overflow-y-auto space-y-1">
            {clients.map((client) => (
              <div
                key={client.id}
                className={`flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors ${
                  selectedIds.has(client.id) ? "bg-primary/10" : "hover:bg-muted/50"
                }`}
                onClick={() => toggleClient(client.id)}
              >
                {selectedIds.has(client.id) ? (
                  <CheckSquare className="w-4 h-4 text-primary flex-shrink-0" />
                ) : (
                  <Square className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <span className="text-sm">{client.name}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Status summary */}
        {statuses.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{tr("summary")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{tr("readyToClose")}</span>
                <span className="font-semibold text-success">
                  {statuses.filter((s) => s.readyToClose).length}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{tr("issuesFound")}</span>
                <span className="font-semibold text-warning">
                  {statuses.filter((s) => !s.readyToClose).length}
                </span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Results */}
      {statuses.length > 0 && (
        <div className="space-y-3">
          {statuses.map((s) => (
            <Card
              key={s.companyId}
              className={s.readyToClose ? "border-success/30" : "border-warning/30"}
            >
              <CardContent className="pt-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold">{s.companyName}</p>
                    <p className="text-sm text-muted-foreground">{s.period}</p>
                  </div>
                  {s.readyToClose ? (
                    <Badge className="bg-success-subtle text-success">{tr("ready")}</Badge>
                  ) : (
                    <Badge className="bg-warning-subtle text-warning">
                      {tr.plural("issuesCount", s.issues.length)}
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <CheckItem ok={s.checks.trialBalanceOk} label={tr("trialBalance")} />
                  <CheckItem ok={s.checks.bankRecDone} label={tr("bankReconciliation")} />
                  <CheckItem ok={s.checks.allReceiptsPosted} label={tr("allReceiptsPosted")} />
                  <CheckItem ok={s.checks.vatPrepared} label={tr("vatReturnPrepared")} />
                </div>
                {s.issues.length > 0 && (
                  <div className="mt-3 bg-warning-subtle border border-warning/30 rounded p-2">
                    {s.issues.map((issue, i) => (
                      <p key={i} className="text-xs text-warning">
                        · {issue}
                      </p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {statuses.length === 0 && !isChecking && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">{tr("selectClientsAndClickRunChecklist")}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BulkOperations() {
  const tr = pageMessages.useT();

  const { data: clients = [], isLoading } = useQuery<ClientWithStats[]>({
    queryKey: ["/api/firm/clients"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("firm")}
        title={tr("bulkOperations")}
        description={tr("batchActionsAcrossAllManagedClients")}
      />

      <Tabs defaultValue="ocr">
        <div className="overflow-x-auto">
          <TabsList className="grid w-full grid-cols-4 min-w-[500px]">
            <TabsTrigger value="ocr">
              <ReceiptIcon className="w-4 h-4 me-2" />
              {tr("batchOcr")}
            </TabsTrigger>
            <TabsTrigger value="vat">
              <FileText className="w-4 h-4 me-2" />
              {tr("vatQueue")}
            </TabsTrigger>
            <TabsTrigger value="invoices">
              <Building2 className="w-4 h-4 me-2" />
              {tr("invoicing")}
            </TabsTrigger>
            <TabsTrigger value="close">
              <CheckCircle2 className="w-4 h-4 me-2" />
              {tr("periodClose")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="ocr" className="mt-6">
          <BatchOCRTab clients={clients} />
        </TabsContent>
        <TabsContent value="vat" className="mt-6">
          <VatQueueTab clients={clients} />
        </TabsContent>
        <TabsContent value="invoices" className="mt-6">
          <BulkInvoicingTab clients={clients} />
        </TabsContent>
        <TabsContent value="close" className="mt-6">
          <PeriodCloseTab clients={clients} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
