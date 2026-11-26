import { MAX_UPLOAD_BYTES } from "@shared/upload-limits";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { accountDisplayName } from "@/lib/account-name";
import { localizeServerWarning } from "@/lib/validation-messages";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useMutation, useMutationState, onlineManager } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileDrop } from "@/components/ui/file-drop";
import { Label } from "@/components/ui/label";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { MatchSuggestions } from "./AutoReconcile";
import { translateMatchReasons } from "./auto-reconcile-match-reasons";
import { ReconciliationRulesPanel } from "./ReconciliationRules";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { formatMessage, useI18n, useTranslation, translateNow } from "@/lib/i18n";
import { formatDate as formatDisplayDate } from "@/lib/format-date";
import { StatCard } from "@/components/ui/stat-card";
import { DataTableCard } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/error-state";
import { Money, MoneyCell } from "@/components/ui/money";
import { RowActionButton } from "@/components/ui/row-actions";
import { useToast } from "@/hooks/use-toast";
import { effectiveCompanyId } from "@/lib/activeCompany";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import {
  Upload,
  FileText,
  CheckCircle2,
  Loader2,
  Link2,
  Unlink,
  Search,
  Building2,
  ArrowRightLeft,
  Sparkles,
  FileSpreadsheet,
  BookOpen,
  Receipt,
  Check,
  BarChart3,
  Eye,
} from "lucide-react";
import { T } from "@/components/layout/T";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────

interface BankTransaction {
  id: string;
  companyId: string;
  bankAccountId: string | null;
  bankStatementAccountId: string | null;
  transactionDate: string;
  description: string;
  amount: number;
  balance: number | null;
  reference: string | null;
  category: string | null;
  matchStatus: string;
  isReconciled: boolean;
  matchedJournalEntryId: string | null;
  matchedReceiptId: string | null;
  matchedInvoiceId: string | null;
  matchConfidence: number | null;
  matchedType?: string | null;
  importSource: string | null;
  createdAt: string;
}

interface BankAccount {
  id: string;
  nameEn: string;
  bankName: string;
  accountNumber: string | null;
  iban: string | null;
  currency: string;
  glAccountId: string | null;
  isActive: boolean;
}

interface MatchSuggestion {
  bankTransactionId: string;
  matchedType: "journal_entry" | "invoice" | "receipt" | "bill";
  matchedId: string;
  confidence: number;
  matchReason: string;
  bankDescription?: string;
  bankAmount?: number;
  bankDate?: string;
  matchedDescription?: string;
  matchedAmount?: number;
  matchedDate?: string;
}

interface ReportData {
  summary: {
    totalTransactions: number;
    reconciledCount: number;
    unreconciledCount: number;
    suggestedCount: number;
    reconciledPct: number;
  };
  amounts: {
    totalCredits: number;
    totalDebits: number;
    netAmount: number;
    reconciledCredits: number;
    reconciledDebits: number;
    unreconciledCredits: number;
    unreconciledDebits: number;
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const matchTypeConfig = {
  journal_entry: {
    icon: BookOpen,
    label: "Journal entry",
    color: "text-muted-foreground",
    bg: "bg-muted",
  },
  invoice: {
    icon: FileText,
    label: "Invoice",
    color: "text-muted-foreground",
    bg: "bg-muted",
  },
  receipt: {
    icon: Receipt,
    label: "Receipt",
    color: "text-success",
    bg: "bg-success-subtle",
  },
  bill: {
    icon: FileText,
    label: "Bill",
    color: "text-muted-foreground",
    bg: "bg-muted",
  },
};

const SAMPLE_BANK_CSV = `Date,Description,Debit,Credit,Balance,Reference
2026-06-13,ADCB BANK CHARGE,42.00,0,58218.00,FEE-0613
2026-06-14,ETISALAT UAE,1260.00,0,56958.00,TEL-0614
2026-06-15,AL NOOR RETAIL FZCO,0,19425.00,76383.00,INV-1042
`;

function confidenceLabel(score: number): {
  label: string;
  labelKey: string;
  color: string;
  bg: string;
} {
  if (score >= 80)
    return {
      label: "High",
      labelKey: "screens.confidenceHigh",
      color: "text-success",
      bg: "bg-success-subtle",
    };
  if (score >= 60)
    return {
      label: "Medium",
      labelKey: "screens.confidenceMedium",
      color: "text-warning",
      bg: "bg-warning-subtle",
    };
  return {
    label: "Low",
    labelKey: "screens.confidenceLow",
    color: "text-destructive",
    bg: "bg-danger-subtle",
  };
}

function formatDate(dateStr: string) {
  try {
    return formatDisplayDate(dateStr, useI18n.getState().locale) || dateStr;
  } catch {
    return dateStr;
  }
}

// ─── Statement import: preview + column mapper (R06-23) ─────────────────────

const MAPPER_FIELDS = [
  "date",
  "description",
  "reference",
  "debit",
  "credit",
  "amount",
  "direction",
  "balance",
] as const;
type MapperField = (typeof MAPPER_FIELDS)[number];

interface StatementPreview {
  kind: "csv";
  detectedFormat: string;
  detectedFormatLabel: string;
  delimiter: string | null;
  decimalSeparator: "." | ",";
  dateOrder: "DMY" | "MDY" | "YMD" | null;
  headerRow: number | null;
  headers: string[];
  mapping: Partial<Record<MapperField, number | null>>;
  totalRows: number;
  validRows: number;
  errorRows: number;
  firstInvalidDateRow: number | null;
  sampleRows: Array<{
    rowIndex: number;
    date: string | null;
    description: string;
    debit: number;
    credit: number;
    errors: string[];
  }>;
  warnings: Array<{ code: string; message: string; requiresChoice?: boolean }>;
  requiresChoice: boolean;
}

interface StatementOverrides {
  dateOrder?: "DMY" | "MDY";
  decimalSeparator?: "." | ",";
  mapping?: Partial<Record<MapperField, number | null>>;
}

type StatementPreviewPayload = StatementOverrides & {
  fileBase64: string;
  fileName: string;
  expectedKind: "csv";
  headerRow?: number;
};

interface ReviewedStatement {
  requestId: number;
  companyId: string;
  file: File;
  payload: StatementPreviewPayload;
  preview: StatementPreview;
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function downloadSampleBankCsv() {
  const blob = new Blob([SAMPLE_BANK_CSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "muhasib-sample-bank-statement.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// A paused query is not proof of being offline (an unfocused retry pauses too), so offline copy
// follows React Query's connectivity state only.
const subscribeConnectivity = (notify: () => void) => onlineManager.subscribe(notify);
const isKnownOffline = () => !onlineManager.isOnline();

// Match/unmatch writes outstanding per company; the last one to settle refreshes the list.
const rowWritesInFlight = new Map<string, number>();

// ─── Main Component ─────────────────────────────────────────────────────────

export default function BankReconciliation() {
  const company = useDefaultCompany();
  return <CompanyBankReconciliation key={company.companyId} company={company} />;
}

function CompanyBankReconciliation({ company }: { company: ReturnType<typeof useDefaultCompany> }) {
  const { t, locale } = useTranslation();
  const { gate } = useCompanyPermission();
  const { toast } = useToast();
  const knownOffline = useSyncExternalStore(subscribeConnectivity, isKnownOffline);
  const { companyId, companies, isLoading: isLoadingCompany } = company;
  const isActive = () => !!companyId && effectiveCompanyId(companies, companyId) === companyId;

  const [selectedBankAccount, setSelectedBankAccount] = useState<string>("");
  // `?import=1` (e.g. from the legacy banking route) opens the statement import straight away.
  const [importDialogOpen, setImportDialogOpen] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("import") === "1"
  );
  // Spec 3.9: suggested matches and rules are tabs of this page (old routes redirect here).
  const [reconTab, setReconTab] = useState<string>(() => {
    const tab =
      typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
    return tab === "suggestions" || tab === "rules" ? tab : "transactions";
  });
  const [scanRequest, setScanRequest] = useState(0);
  // E3 (J1-r3): lines with a suggested match from the last "Find matches" search (null = none run).
  const [scanSuggested, setScanSuggested] = useState<number | null>(null);
  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<BankTransaction | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showReconciled, setShowReconciled] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const latestPreviewRequest = useRef(0);
  const [reviewedStatement, setReviewedStatement] = useState<ReviewedStatement | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [statementOverrides, setStatementOverrides] = useState<StatementOverrides>({});
  const [acknowledgeAmbiguity, setAcknowledgeAmbiguity] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // ─── Queries ──────────────────────────────────────────────────────────────

  const {
    data: bankAccounts,
    isLoading: isLoadingBankAccounts,
    error: accountsError,
    refetch: refetchAccounts,
  } = useQuery<BankAccount[]>({
    queryKey: ["/api/companies", companyId, "bank-accounts"],
    enabled: !!companyId,
  });

  const statementPreview =
    reviewedStatement?.file === importFile && reviewedStatement.companyId === companyId
      ? reviewedStatement.preview
      : null;
  // The server rejects the whole file when any row has a missing/invalid date, so the preview
  // must say so even when other rows are valid (otherwise it looks importable).
  const firstInvalidDateRow = !previewLoading
    ? (statementPreview?.firstInvalidDateRow ?? null)
    : null;
  // During a re-preview the previous rows stay on screen but are stale: only the latest finished
  // response (a failed one clears it) may be called recognized.
  const statementRecognized = Boolean(
    statementPreview &&
    !previewLoading &&
    statementPreview.validRows > 0 &&
    statementPreview.firstInvalidDateRow == null
  );
  const canConfirmImport = Boolean(
    statementPreview &&
    bankAccounts?.some((account) => account.id === selectedBankAccount) &&
    !isImporting &&
    !previewLoading &&
    statementPreview.validRows > 0 &&
    statementPreview.firstInvalidDateRow == null &&
    (!statementPreview.requiresChoice || acknowledgeAmbiguity)
  );

  const transactionsKey = ["/api/companies", companyId, "bank-statements", "transactions"];
  const {
    data: transactions,
    isLoading: isLoadingTransactions,
    error: transactionsError,
    isSuccess: transactionsSuccess,
    fetchStatus: transactionsFetchStatus,
    refetch: refetchTransactions,
  } = useQuery<BankTransaction[]>({
    queryKey: transactionsKey,
    enabled: !!companyId,
  });
  const transactionsPaused = transactionsFetchStatus === "paused";

  const {
    data: matchSuggestions,
    isLoading: isLoadingMatches,
    error: matchesError,
    isSuccess: matchesSuccess,
    fetchStatus: matchesFetchStatus,
    refetch: refetchMatches,
  } = useQuery<MatchSuggestion[]>({
    queryKey: [
      "/api/companies",
      companyId,
      "bank-statements",
      selectedTransaction?.id,
      "suggestions",
    ],
    enabled: !!selectedTransaction?.id && matchDialogOpen,
  });
  const matchesPaused = matchesFetchStatus === "paused";
  const hasMatches = !!matchSuggestions && matchSuggestions.length > 0;

  const {
    data: reportData,
    error: reportError,
    fetchStatus: reportFetchStatus,
    refetch: refetchReport,
  } = useQuery<ReportData>({
    queryKey: [
      "/api/companies",
      companyId,
      "bank-statements",
      "report",
      selectedBankAccount || "all",
    ],
    enabled: !!companyId && reportDialogOpen,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (selectedBankAccount) params.set("bankAccountId", selectedBankAccount);
      const url = `/api/companies/${companyId}/bank-statements/report?${params}`;
      return apiRequest("GET", url, undefined, undefined, { signal });
    },
  });
  const reportPaused = reportFetchStatus === "paused";

  // ─── Derived state ────────────────────────────────────────────────────────

  // Paused with nothing cached while disconnected: say offline, never an empty import.
  const transactionsOffline =
    knownOffline && transactionsPaused && !transactions && !transactionsError;

  // One normalized query drives both the row filter and the search-empty state.
  const normalizedSearch = searchQuery.trim().toLowerCase();

  // Rows visible for the selected account and reconciled toggle, before the search.
  const viewTransactions = useMemo(() => {
    if (!transactions) return [];
    return transactions.filter((tx) => {
      if (!showReconciled && tx.isReconciled) return false;
      if (selectedBankAccount && tx.bankStatementAccountId !== selectedBankAccount) return false;
      return true;
    });
  }, [transactions, showReconciled, selectedBankAccount]);

  const filteredTransactions = useMemo(() => {
    if (!normalizedSearch) return viewTransactions;
    return viewTransactions.filter(
      (tx) =>
        tx.description.toLowerCase().includes(normalizedSearch) ||
        tx.reference?.toLowerCase().includes(normalizedSearch) ||
        String(Math.abs(tx.amount)).includes(normalizedSearch)
    );
  }, [viewTransactions, normalizedSearch]);

  // The search (not the data) emptied a view that otherwise had visible rows.
  const searchEmptiedView =
    normalizedSearch !== "" && viewTransactions.length > 0 && filteredTransactions.length === 0;

  const allReconciledHidden =
    !showReconciled &&
    viewTransactions.length === 0 &&
    (transactions ?? []).some(
      (tx) =>
        tx.isReconciled &&
        (!selectedBankAccount || tx.bankStatementAccountId === selectedBankAccount)
    );

  const stats = useMemo(() => {
    if (!transactions)
      return { total: 0, reconciled: 0, unreconciled: 0, suggested: 0, totalAmount: 0 };
    const reconciled = transactions.filter((t) => t.isReconciled).length;
    const suggested = transactions.filter(
      (t) => !t.isReconciled && t.matchStatus === "suggested"
    ).length;
    const totalAmount = transactions.reduce((s, t) => s + t.amount, 0);
    return {
      total: transactions.length,
      reconciled,
      unreconciled: transactions.length - reconciled,
      // The search on the Suggestions tab is the live count once it has run.
      suggested: scanSuggested ?? suggested,
      totalAmount,
    };
  }, [transactions, scanSuggested]);

  // ─── Mutations ────────────────────────────────────────────────────────────

  const importMutation = useMutation({
    mutationFn: async ({
      companyId: reviewedCompanyId,
      ...payload
    }: StatementPreviewPayload & {
      companyId: string;
      bankAccountId: string;
      acknowledgeAmbiguity: boolean;
    }) => {
      if (!isActive()) throw new Error(t["banking.import.companyChanged"]);
      return apiRequest(
        "POST",
        `/api/companies/${reviewedCompanyId}/bank-statements/import`,
        payload
      );
    },
    onSuccess: (data: any, { companyId: reviewedCompanyId }) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", reviewedCompanyId, "bank-statements"],
      });
      toast({
        title: translateNow("toasts.importSuccessful"),
        description:
          data.skippedDuplicates > 0
            ? formatMessage(
                translateNow(
                  (data.imported ?? 0) > 0
                    ? "toasts.importedSkippedDuplicates"
                    : "toasts.importedNothingNew"
                ),
                { imported: data.imported ?? 0, skipped: data.skippedDuplicates }
              )
            : formatMessage(translateNow("toasts.importedMatchingPrepared"), {
                imported: data.imported ?? 0,
              }),
      });
      setImportDialogOpen(false);
      resetStatementPreview();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.importFailed"),
        description: error?.message,
      });
    },
  });

  // Match and unmatch share one key so the last outstanding write refreshes the list, and so a
  // row with a write in flight rejects the opposite write (other rows may still overlap).
  const rowWriteKey = ["bank-statements", "row-write", companyId];
  const pendingRowIds = useMutationState({
    filters: { mutationKey: rowWriteKey, status: "pending" },
    select: (m) => {
      const v = m.state.variables as string | { transactionId: string } | undefined;
      return typeof v === "string" ? v : v?.transactionId;
    },
  });
  const isRowBusy = (id: string) => pendingRowIds.includes(id);
  // Event-time guard. TanStack dispatches "pending" synchronously inside mutate(), before onMutate
  // is awaited, so this sees a write started earlier in the same tick (before React rerenders).
  const hasRowWriteInFlight = (id: string) =>
    queryClient.isMutating({
      mutationKey: rowWriteKey,
      exact: true,
      predicate: (m) => {
        const v = m.state.variables as string | { transactionId: string } | undefined;
        return (typeof v === "string" ? v : v?.transactionId) === id;
      },
    }) > 0;
  // A new write needs no write in flight on the row and the row's current cached state (never a
  // copy a dialog captured earlier) to fit: Match/dialog actions need an unreconciled line,
  // Unmatch a reconciled one. With no cached list there is no state to contradict the request.
  const canWriteRow = (id: string, reconciled: boolean) => {
    if (hasRowWriteInFlight(id)) return false;
    const rows = queryClient.getQueryData<BankTransaction[]>(transactionsKey);
    if (!rows) return true;
    const row = rows.find((x) => x.id === id);
    return !!row && !!row.isReconciled === reconciled;
  };
  const startUnmatch = (id: string) => {
    if (!canWriteRow(id, true)) return;
    // A dialog left open on this line must not come back to life with the optimistic row.
    if (selectedTransaction?.id === id) {
      setMatchDialogOpen(false);
      setSelectedTransaction(null);
    }
    unmatchMutation.mutate(id);
  };
  const startMatch = (vars: { transactionId: string; matchedId: string; matchedType: string }) => {
    if (!canWriteRow(vars.transactionId, false)) return;
    matchMutation.mutate(vars);
  };
  const refreshAfterLastRowWrite = () => {
    // The tally is kept by us, not read from the mutation cache: two writes settling together
    // would each still see the other as pending. Runs after any rollback in onError.
    const key = companyId ?? "";
    const remaining = (rowWritesInFlight.get(key) ?? 0) - 1;
    if (remaining > 0) {
      rowWritesInFlight.set(key, remaining);
      return;
    }
    rowWritesInFlight.delete(key);
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "bank-statements"] });
  };

  // Optimistic write to one row of the list; the returned context restores only that row.
  const patchTransactionRow = async (transactionId: string, patch: Partial<BankTransaction>) => {
    // Count the write synchronously, before the first await, so overlapping writes always see
    // each other; every call is paired with one onSettled (it runs even if this throws).
    const key = companyId ?? "";
    rowWritesInFlight.set(key, (rowWritesInFlight.get(key) ?? 0) + 1);
    // Stop in-flight reads (prefix), then write the list's own key.
    await queryClient.cancelQueries({
      queryKey: ["/api/companies", companyId, "bank-statements"],
    });
    const queryKey = transactionsKey;
    const previousRow = queryClient
      .getQueryData<BankTransaction[]>(queryKey)
      ?.find((tx) => tx.id === transactionId);
    // An absent list stays absent: returning undefined creates no cache entry.
    queryClient.setQueryData<BankTransaction[]>(queryKey, (old) =>
      old?.map((tx) => (tx.id === transactionId ? { ...tx, ...patch } : tx))
    );
    return { queryKey, previousRow };
  };
  const restoreTransactionRow = (
    context: Awaited<ReturnType<typeof patchTransactionRow>> | undefined
  ) => {
    const previousRow = context?.previousRow;
    if (!context || !previousRow) return;
    queryClient.setQueryData<BankTransaction[]>(context.queryKey, (old) =>
      old?.map((tx) => (tx.id === previousRow.id ? previousRow : tx))
    );
  };

  const matchMutation = useMutation({
    mutationKey: rowWriteKey,
    mutationFn: ({
      transactionId,
      matchedId,
      matchedType,
    }: {
      transactionId: string;
      matchedId: string;
      matchedType: string;
    }) =>
      apiRequest("POST", `/api/companies/${companyId}/bank-statements/${transactionId}/match`, {
        matchedType: matchedType === "journal_entry" ? "journal" : matchedType,
        matchedId,
      }),
    onMutate: ({ transactionId, matchedId, matchedType }) => {
      const type = matchedType === "journal_entry" ? "journal" : matchedType;
      // Only the reference the request names is known here; the refetch fills in the rest.
      return patchTransactionRow(transactionId, {
        matchStatus: "matched",
        isReconciled: true,
        matchedType: type,
        matchedJournalEntryId: type === "journal" ? matchedId : null,
        matchedReceiptId: type === "receipt" ? matchedId : null,
        matchedInvoiceId: type === "invoice" ? matchedId : null,
        matchConfidence: 1,
      });
    },
    onSuccess: () => {
      toast({
        title: translateNow("toasts.transactionReconciled"),
        description: translateNow("toasts.bankTransactionMatchedSuccessfully"),
      });
      setMatchDialogOpen(false);
      setSelectedTransaction(null);
    },
    onError: (error: any, _vars, context) => {
      restoreTransactionRow(context);
      toast({
        variant: "destructive",
        title: translateNow("toasts.reconciliationFailed"),
        description: error?.message,
      });
    },
    onSettled: refreshAfterLastRowWrite,
  });

  const unmatchMutation = useMutation({
    mutationKey: rowWriteKey,
    mutationFn: (transactionId: string) =>
      apiRequest("DELETE", `/api/companies/${companyId}/bank-statements/${transactionId}/match`),
    onMutate: (transactionId: string) =>
      patchTransactionRow(transactionId, {
        matchStatus: "unmatched",
        isReconciled: false,
        matchedType: null,
        matchedJournalEntryId: null,
        matchedReceiptId: null,
        matchedInvoiceId: null,
        matchConfidence: null,
      }),
    onSuccess: () => {
      toast({
        title: translateNow("toasts.matchRemoved"),
        description: translateNow("toasts.transactionResetToUnmatched"),
      });
    },
    onError: (error: any, _id, context) => {
      restoreTransactionRow(context);
      toast({
        variant: "destructive",
        title: translateNow("toasts.error"),
        description: error?.message,
      });
    },
    onSettled: refreshAfterLastRowWrite,
  });

  const confirmDraftMutation = useMutation({
    mutationFn: (transactionId: string) =>
      apiRequest(
        "POST",
        `/api/companies/${companyId}/bank-statements/${transactionId}/confirm-entry`,
        {}
      ),
    onSuccess: () => toast({ title: t["banking.line.matched"] }),
    onError: (error: Error) =>
      toast({
        variant: "destructive",
        title: t["banking.common.error"],
        description: error?.message,
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "bank-statements"] }),
  });

  // ─── File import handlers ─────────────────────────────────────────────────

  // Step 1 / F4: the import dialog copy lives in the banking catalog (en + ar).
  const strings = {
    recognized: t["banking.import.statementRecognized"],
    reviewTitle: t["banking.import.reviewTitle"],
    rows: t["banking.import.rows"],
    valid: t["banking.import.valid"],
    withErrors: t["banking.import.withErrors"],
    dateOrder: t["banking.import.dateOrder"],
    decimalSeparator: t["banking.import.decimalSeparator"],
    decimalPoint: t["banking.import.decimalPoint"],
    decimalComma: t["banking.import.decimalComma"],
    columnMapping: t["banking.import.columnMapping"],
    notMapped: t["banking.import.notMapped"],
    confirmAssumption: t["banking.import.confirmAssumption"],
    previewLoading: t["banking.import.previewLoading"],
    previewFailed: t["pageLabels.bankCsvPreviewFailed"],
    sampleRows: t["banking.import.sampleRows"],
    colDate: t["banking.import.colDate"],
    colDescription: t["banking.import.colDescription"],
    colDebit: t["banking.import.colDebit"],
    colCredit: t["banking.import.colCredit"],
    formatCsv: t["banking.import.formatCsv"],
    formatDelimiters: t["banking.import.formatDelimiters"],
    formatDrCr: t["banking.import.formatDrCr"],
    importAction: t["banking.import.importAction"],
    fields: {
      date: t["banking.import.field.date"],
      description: t["banking.import.field.description"],
      reference: t["banking.import.field.reference"],
      debit: t["banking.import.field.debit"],
      credit: t["banking.import.field.credit"],
      amount: t["banking.import.field.amount"],
      direction: t["banking.import.field.direction"],
      balance: t["banking.import.field.balance"],
    } as Record<MapperField, string>,
  };

  const resetStatementPreview = () => {
    latestPreviewRequest.current += 1;
    setImportFile(null);
    setReviewedStatement(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setStatementOverrides({});
    setAcknowledgeAmbiguity(false);
  };

  const runStatementPreview = async (
    file: File,
    overrides: StatementOverrides,
    headerRow?: number
  ) => {
    if (!companyId || !isActive()) return;
    // A later file, mapping or dialog reset invalidates every earlier response.
    const requestId = ++latestPreviewRequest.current;
    setPreviewLoading(true);
    setPreviewError(null);
    setAcknowledgeAmbiguity(false);
    try {
      if (file.size > MAX_UPLOAD_BYTES) {
        setReviewedStatement(null);
        setPreviewError(t["serverErrors.FILE_TOO_LARGE"]);
        return;
      }
      const fileBase64 = await fileToBase64(file).catch(() => null);
      if (requestId !== latestPreviewRequest.current || !isActive()) return;
      if (fileBase64 === null) {
        setReviewedStatement(null);
        setPreviewError(t["banking.import.fileUnreadable"]);
        return;
      }
      const payload: StatementPreviewPayload = {
        fileBase64,
        fileName: file.name,
        expectedKind: "csv",
        ...overrides,
        ...(overrides.mapping && headerRow ? { headerRow } : {}),
      };
      const preview = (await apiRequest(
        "POST",
        `/api/companies/${companyId}/bank-statements/preview`,
        payload
      )) as StatementPreview;
      if (requestId !== latestPreviewRequest.current || !isActive()) return;
      setReviewedStatement({ requestId, companyId, file, payload, preview });
    } catch {
      if (requestId !== latestPreviewRequest.current || !isActive()) return;
      setReviewedStatement(null);
      setPreviewError(strings.previewFailed);
    } finally {
      if (requestId === latestPreviewRequest.current) setPreviewLoading(false);
    }
  };

  const updateOverrides = (next: StatementOverrides) => {
    setStatementOverrides(next);
    if (importFile)
      void runStatementPreview(importFile, next, statementPreview?.headerRow ?? undefined);
  };

  const handleMappingChange = (field: MapperField, value: string) => {
    const base = statementOverrides.mapping ?? statementPreview?.mapping ?? {};
    updateOverrides({
      ...statementOverrides,
      mapping: { ...base, [field]: value === "__none" ? null : Number(value) },
    });
  };

  const handleStatementFile = (file: File | undefined) => {
    if (!file || !isActive()) return;
    resetStatementPreview();
    if (!/\.csv$/i.test(file.name)) {
      setPreviewError(t["banking.import.csvRequired"]);
      return;
    }
    setImportFile(file);
    void runStatementPreview(file, {});
  };

  const handleImport = async () => {
    if (
      !canConfirmImport ||
      !reviewedStatement ||
      reviewedStatement.requestId !== latestPreviewRequest.current
    ) {
      return;
    }
    if (!isActive()) {
      setPreviewError(t["banking.import.companyChanged"]);
      return;
    }

    setIsImporting(true);
    try {
      await importMutation.mutateAsync({
        ...reviewedStatement.payload,
        companyId: reviewedStatement.companyId,
        bankAccountId: selectedBankAccount,
        acknowledgeAmbiguity,
      });
    } catch {
      // The mutation keeps the selected file and reports the import error.
    } finally {
      setIsImporting(false);
    }
  };

  // ─── Render helpers ───────────────────────────────────────────────────────

  // The dialog's line is read from the current list, not the row captured when it opened, so a
  // rolled-back or optimistic row is never resurrected from a stale copy.
  const dialogLine = selectedTransaction
    ? (transactions?.find((x) => x.id === selectedTransaction.id) ?? null)
    : null;

  const handleOpenMatch = (transaction: BankTransaction) => {
    // Checked against the current list: a line with a write in flight (e.g. an optimistic Unmatch),
    // or one rolled back to reconciled since this handler rendered, does not open.
    if (!canWriteRow(transaction.id, false)) return;
    setSelectedTransaction(transaction);
    setMatchDialogOpen(true);
  };

  const handleAcceptSuggestion = (tx: BankTransaction) => {
    // A rule / create-entry draft waiting for review: posting the draft reconciles the line.
    if (tx.matchedType === "rule" || tx.matchedType === "entry") {
      confirmDraftMutation.mutate(tx.id);
      return;
    }
    if (!tx.matchedJournalEntryId && !tx.matchedInvoiceId && !tx.matchedReceiptId) return;
    const matchedId = tx.matchedJournalEntryId ?? tx.matchedInvoiceId ?? tx.matchedReceiptId!;
    const matchedType = tx.matchedJournalEntryId
      ? "journal"
      : tx.matchedInvoiceId
        ? "invoice"
        : "receipt";
    startMatch({ transactionId: tx.id, matchedId, matchedType });
  };

  if (isLoadingCompany || isLoadingBankAccounts) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <PageHeader
        eyebrow={t["shell.nav.banking"]}
        title={t.bankReconciliation}
        description={t["pageLabels.bankCsvWorkflow"]}
        primaryAction={
          <Button
            onClick={() => setImportDialogOpen(true)}
            data-testid="button-import-transactions"
            {...gate("documents.write")}
          >
            <Upload aria-hidden />
            {t["banking.recon.importStatement"]}
          </Button>
        }
        secondaryActions={
          <Button
            variant="outline"
            onClick={() => {
              setReconTab("suggestions");
              setScanRequest((n) => n + 1);
            }}
            data-testid="button-auto-reconcile"
          >
            <Search aria-hidden />
            {t["banking.recon.findMatches"]}
          </Button>
        }
        overflow={
          <DropdownMenuItem onSelect={() => setReportDialogOpen(true)}>
            <BarChart3 aria-hidden />
            {t["banking.recon.report"]}
          </DropdownMenuItem>
        }
        overflowLabel={t["banking.recon.moreActions"]}
      />

      {/* ── Summary: exceptions first. Spec 2.6: no KPI row while there are no bank lines. ── */}
      {stats.total > 0 && (
        <div className="mobile-keep-cols grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label={t["screens.needsReview"]}
            value={<span className="tabular-nums">{stats.total - stats.reconciled}</span>}
            hint={formatMessage(t["screens.suggestedCount"], { count: stats.suggested })}
          />
          <StatCard
            label={t["pages.reconciled"]}
            value={<span className="tabular-nums">{stats.reconciled}</span>}
            hint={formatMessage(t["screens.reconciledOfTotal"], {
              done: stats.reconciled,
              total: stats.total,
            })}
            visualOverlay
            visual={
              stats.total > 0 ? (
                <Progress
                  value={(stats.reconciled / stats.total) * 100}
                  aria-label={t["pages.reconciled"]}
                  className="h-1"
                />
              ) : undefined
            }
          />
          <StatCard
            label={t["pages.total2"]}
            value={<span className="tabular-nums">{stats.total}</span>}
            hint={t["screens.bankLinesInView"]}
          />
          <StatCard
            label={t["pageLabels.netAmount"]}
            value={<Money amount={stats.totalAmount} tone="auto" />}
            hint={t["screens.netAmountHint"]}
          />
        </div>
      )}

      <Tabs value={reconTab} onValueChange={setReconTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="transactions" data-testid="tab-recon-transactions">
            {t["banking.recon.tabTransactions"]}
          </TabsTrigger>
          <TabsTrigger value="suggestions" data-testid="tab-recon-suggestions">
            {t["banking.recon.tabSuggestions"]}
          </TabsTrigger>
          <TabsTrigger value="rules" data-testid="tab-recon-rules">
            {t["banking.recon.tabRules"]}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="transactions" className="mt-0">
          {/* ── Filters (one row, not in a card) ── */}
          <section className="space-y-4" aria-labelledby="bank-transactions-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="bank-transactions-title" className="text-h2 text-foreground">
                {t.bankTransactions}
              </h2>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <div className="relative w-full sm:w-56">
                  <Search
                    className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    placeholder={t.search}
                    aria-label={t.search}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 ps-9"
                    data-testid="input-search"
                  />
                </div>
                <Select
                  value={selectedBankAccount || "all"}
                  onValueChange={(v) => setSelectedBankAccount(v === "all" ? "" : v)}
                >
                  <SelectTrigger
                    className="h-9 w-full sm:w-44"
                    data-testid="select-bank-account"
                    aria-label={t["screens.bankAccount"]}
                  >
                    <SelectValue placeholder={t["pageLabels.allAccounts"]} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      <T k="pageLabels.allAccounts" />
                    </SelectItem>
                    {bankAccounts?.map((acct) => (
                      <SelectItem key={acct.id} value={acct.id}>
                        {acct.nameEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  id="show-reconciled"
                  aria-pressed={showReconciled}
                  onClick={() => setShowReconciled(!showReconciled)}
                  className={cn(
                    "h-9",
                    showReconciled && "border-primary bg-primary/5 text-foreground"
                  )}
                >
                  {showReconciled ? <Check aria-hidden /> : <Eye aria-hidden />}
                  <T k="pageLabels.showReconciled" />
                </Button>
              </div>
            </div>

            <DataTableCard
              error={{
                onRetry: () => {
                  if (accountsError) void refetchAccounts();
                  if (transactionsError) void refetchTransactions();
                },
              }}
              // A paused or failed load is never "empty"; cached rows stay with a notice.
              status={
                accountsError && !bankAccounts
                  ? "error"
                  : isLoadingTransactions
                    ? "loading"
                    : filteredTransactions.length > 0 || transactionsPaused
                      ? "ready"
                      : transactionsError
                        ? "error"
                        : transactionsSuccess
                          ? "empty"
                          : "loading"
              }
              columnLabels={[t.date, t.description, t.amount, t.status]}
              empty={
                // X5 (J1 L6): lines exist but every one is reconciled (and hidden) — say so.
                searchEmptiedView
                  ? {
                      icon: Search,
                      title: t["banking.noSearchMatchTitle"],
                      description: t["banking.noSearchMatchDescription"],
                      action: {
                        label: t["banking.clearSearch"],
                        variant: "outline",
                        onClick: () => setSearchQuery(""),
                      },
                      testId: "empty-state-bank-search",
                    }
                  : allReconciledHidden
                    ? {
                        icon: Check,
                        title: t["banking.allReconciledTitle"],
                        description: t["banking.allReconciledDescription"],
                        action: {
                          label: t["pageLabels.showReconciled"],
                          icon: Eye,
                          variant: "outline",
                          onClick: () => setShowReconciled(true),
                        },
                        testId: "empty-state-all-reconciled",
                      }
                    : {
                        icon: Building2,
                        title: t["banking.emptyTransactionsTitle"],
                        description: t["pageLabels.bankCsvWorkflow"],
                        action: {
                          label: t["banking.importStatementAction"],
                          permission: "documents.write",
                          icon: Upload,
                          variant: "outline",
                          onClick: () => setImportDialogOpen(true),
                        },
                        testId: "empty-state-bank-transactions",
                      }
              }
            >
              {transactionsPaused ? (
                <>
                  <p
                    role="status"
                    className="px-4 py-3 text-center text-small text-muted-foreground"
                    data-testid="status-transactions-paused"
                  >
                    {filteredTransactions.length > 0
                      ? t["banking.query.pausedCached"]
                      : t["banking.query.paused"]}
                  </p>
                  {transactionsOffline && (
                    <p
                      role="status"
                      className="px-4 py-3 text-center text-small text-muted-foreground"
                      data-testid="bank-transactions-offline"
                    >
                      {t["common.errorHeading.offline"]}
                    </p>
                  )}
                </>
              ) : transactionsError ? (
                <ErrorState
                  compact
                  testId="error-transactions-refresh"
                  onRetry={() => void refetchTransactions()}
                />
              ) : null}
              {/* Phones: one two-line row per bank line, the next step as a single button. */}
              <div
                className={cn(
                  "divide-hairline md:hidden",
                  filteredTransactions.length === 0 && "hidden"
                )}
                data-testid="mobile-bank-transaction-list"
              >
                {filteredTransactions.map((tx) => {
                  const conf =
                    tx.matchConfidence != null ? Math.round(tx.matchConfidence * 100) : null;
                  const confMeta = conf != null ? confidenceLabel(conf) : null;
                  return (
                    <div key={tx.id} className="space-y-2 px-4 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <p
                          dir="auto"
                          className="min-w-0 truncate text-sm font-medium text-foreground"
                        >
                          {tx.description}
                        </p>
                        <Money
                          amount={tx.amount}
                          tone="auto"
                          className="shrink-0 text-sm font-semibold"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-caption text-muted-foreground">
                          {formatDate(tx.transactionDate)}
                          {" · "}
                          <span dir="ltr" className="[unicode-bidi:isolate]">
                            {tx.reference || "—"}
                          </span>
                        </p>
                        <StatusBadge
                          status={
                            tx.isReconciled
                              ? "reconciled"
                              : tx.matchStatus === "suggested"
                                ? "suggested"
                                : "unmatched"
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-caption text-muted-foreground">
                          {confMeta && !tx.isReconciled
                            ? formatMessage(t["screens.matchConfidence"], {
                                pct: conf ?? 0,
                                level: t[confMeta.labelKey],
                              })
                            : null}
                        </span>
                        {tx.isReconciled ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startUnmatch(tx.id)}
                            disabled={isRowBusy(tx.id)}
                          >
                            <Unlink aria-hidden />
                            <T k="pageLabels.unmatch" />
                          </Button>
                        ) : tx.matchStatus === "suggested" ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenMatch(tx)}
                              disabled={isRowBusy(tx.id)}
                            >
                              <T k="pages.review" />
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleAcceptSuggestion(tx)}
                              disabled={isRowBusy(tx.id)}
                            >
                              <Check aria-hidden />
                              <T k="pages.accept" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenMatch(tx)}
                            disabled={isRowBusy(tx.id)}
                            data-testid={`mobile-button-match-${tx.id}`}
                          >
                            <Link2 aria-hidden />
                            <T k="pageLabels.match" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div
                className={cn("hidden", filteredTransactions.length > 0 && "md:block")}
                data-testid="bank-transaction-table"
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.date}</TableHead>
                      <TableHead className="w-full">
                        <T k="banking.common.description" />
                      </TableHead>
                      <TableHead>
                        <T k="banking.common.reference" />
                      </TableHead>
                      <TableHead data-numeric="">
                        <T k="banking.common.amount" />
                      </TableHead>
                      <TableHead>
                        <T k="banking.common.status" />
                      </TableHead>
                      <TableHead>
                        <span className="sr-only">
                          <T k="banking.common.actions" />
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTransactions.map((tx) => {
                      const conf =
                        tx.matchConfidence != null ? Math.round(tx.matchConfidence * 100) : null;
                      const confMeta = conf != null ? confidenceLabel(conf) : null;
                      return (
                        <TableRow key={tx.id} data-testid={`row-transaction-${tx.id}`}>
                          <TableCell data-nowrap="" className="text-muted-foreground">
                            {formatDate(tx.transactionDate)}
                          </TableCell>
                          <TableCell data-truncate="" dir="auto" className="font-medium">
                            {tx.description}
                          </TableCell>
                          <TableCell data-nowrap="" className="text-muted-foreground">
                            <span dir="ltr" className="[unicode-bidi:isolate]">
                              {tx.reference || "—"}
                            </span>
                          </TableCell>
                          <MoneyCell amount={tx.amount} tone="auto" className="font-medium" />
                          <TableCell data-nowrap="">
                            <div className="flex items-center gap-2">
                              <StatusBadge
                                status={
                                  tx.isReconciled
                                    ? "reconciled"
                                    : tx.matchStatus === "suggested"
                                      ? "suggested"
                                      : "unmatched"
                                }
                              />
                              {confMeta && !tx.isReconciled && (
                                <span
                                  className={`text-caption font-medium tabular-nums ${confMeta.color}`}
                                  title={t[confMeta.labelKey]}
                                >
                                  {conf}%
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell data-nowrap="" className="text-end">
                            <div className="flex items-center justify-end gap-1">
                              {tx.isReconciled ? (
                                <RowActionButton
                                  label={t["pageLabels.unmatch"]}
                                  icon={Unlink}
                                  onClick={() => startUnmatch(tx.id)}
                                  disabled={isRowBusy(tx.id)}
                                />
                              ) : tx.matchStatus === "suggested" ? (
                                <>
                                  <RowActionButton
                                    label={t["screens.reviewMatch"]}
                                    icon={Eye}
                                    onClick={() => handleOpenMatch(tx)}
                                    disabled={isRowBusy(tx.id)}
                                  />
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleAcceptSuggestion(tx)}
                                    disabled={isRowBusy(tx.id)}
                                  >
                                    <Check aria-hidden />
                                    <T k="pages.accept" />
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleOpenMatch(tx)}
                                  disabled={isRowBusy(tx.id)}
                                  data-testid={`button-match-${tx.id}`}
                                >
                                  <Link2 aria-hidden />
                                  <T k="pageLabels.match" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </DataTableCard>
          </section>
        </TabsContent>
        <TabsContent value="suggestions" className="mt-0">
          <MatchSuggestions
            companyId={companyId}
            scanRequest={scanRequest}
            onSuggestedCount={setScanSuggested}
          />
        </TabsContent>
        <TabsContent value="rules" className="mt-0">
          <ReconciliationRulesPanel />
        </TabsContent>
      </Tabs>

      {/* ── Match Dialog ─────────────────────────────────────────────────────── */}
      <Dialog
        open={matchDialogOpen}
        onOpenChange={(open) => {
          setMatchDialogOpen(open);
          if (!open) setSelectedTransaction(null);
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              <T k="pageLabels.matchTransaction" />
            </DialogTitle>
            <DialogDescription>
              {selectedTransaction && (
                <span>
                  {selectedTransaction.description} &mdash;{" "}
                  {formatCurrency(selectedTransaction.amount)} ·{" "}
                  {formatDate(selectedTransaction.transactionDate)}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Side-by-side layout */}
          <div className="grid grid-cols-2 gap-4 mt-2">
            {/* Left: Bank transaction */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground">
                <T k="pageLabels.bankTransaction" />
              </p>
              {selectedTransaction && (
                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-muted-foreground">{t.date}</p>
                    <p className="font-medium">{formatDate(selectedTransaction.transactionDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      <T k="banking.common.description" />
                    </p>
                    <p className="font-medium text-sm">{selectedTransaction.description}</p>
                  </div>
                  {selectedTransaction.reference && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        <T k="banking.common.reference" />
                      </p>
                      <p className="text-sm">{selectedTransaction.reference}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">
                      <T k="banking.common.amount" />
                    </p>
                    <p
                      className={`text-xl font-bold ${selectedTransaction.amount >= 0 ? "text-success" : "text-destructive"}`}
                    >
                      {formatCurrency(selectedTransaction.amount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      <T k="pageLabels.direction" />
                    </p>
                    <Badge variant="outline" className="text-xs">
                      {selectedTransaction.amount >= 0 ? "↑ Credit / Inflow" : "↓ Debit / outflow"}
                    </Badge>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Match suggestions */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground">
                <T k="pageLabels.suggestedMatches" />
              </p>
              {matchesPaused ? (
                <>
                  <p
                    role="status"
                    className="text-center text-small text-muted-foreground"
                    data-testid="status-matches-paused"
                  >
                    {hasMatches ? t["banking.query.pausedCached"] : t["banking.query.paused"]}
                  </p>
                  {knownOffline && (
                    <p
                      role="status"
                      className="text-center text-small text-muted-foreground"
                      data-testid="match-suggestions-offline"
                    >
                      {t["common.errorHeading.offline"]}
                    </p>
                  )}
                </>
              ) : matchesError && !isLoadingMatches ? (
                <div data-testid="match-suggestions-error">
                  <ErrorState
                    compact
                    testId="error-matches"
                    onRetry={() => void refetchMatches()}
                  />
                </div>
              ) : null}
              {isLoadingMatches ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-20" />
                  ))}
                </div>
              ) : hasMatches ? (
                <div className="space-y-2 max-h-[360px] overflow-y-auto pe-1">
                  {matchSuggestions.map((s) => {
                    const typeCfg = matchTypeConfig[s.matchedType];
                    const TypeIcon = typeCfg.icon;
                    const confMeta = confidenceLabel(s.confidence);
                    return (
                      <div
                        key={`${s.matchedType}-${s.matchedId}`}
                        className="rounded-lg border bg-card p-3 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                        onClick={() => {
                          const id = selectedTransaction?.id;
                          if (!id) return;
                          startMatch({
                            transactionId: id,
                            matchedId: s.matchedId,
                            matchedType: s.matchedType,
                          });
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`p-1.5 rounded shrink-0 ${typeCfg.bg}`}>
                              <TypeIcon className={`w-3.5 h-3.5 ${typeCfg.color}`} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-muted-foreground">
                                {typeCfg.label}
                              </p>
                              <p className="text-sm font-medium truncate">
                                {s.matchedDescription || s.matchedId.slice(0, 8)}
                              </p>
                            </div>
                          </div>
                          <div className="text-end shrink-0">
                            <p className="font-semibold text-sm">
                              {s.matchedAmount != null ? formatCurrency(s.matchedAmount) : "—"}
                            </p>
                            <span className={`text-xs font-medium ${confMeta.color}`}>
                              {s.confidence}% {confMeta.label}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2">
                          <Progress
                            value={s.confidence}
                            aria-label={`${s.confidence}% ${confMeta.label}`}
                            className="h-1"
                          />
                        </div>
                        {s.matchedDate && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDate(s.matchedDate)}
                          </p>
                        )}
                        {translateMatchReasons(s.matchReason, t) && (
                          <p className="text-xs text-muted-foreground mt-1 italic">
                            {translateMatchReasons(s.matchReason, t)}
                          </p>
                        )}
                        <div className="mt-2 flex justify-end">
                          <Badge variant="outline" className="text-xs">
                            <T k="pageLabels.clickToMatch" />
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : matchesPaused || matchesError ? null : !matchesSuccess ? (
                <Skeleton className="h-20" />
              ) : (
                <div
                  className="text-center py-8 text-muted-foreground"
                  data-testid="match-suggestions-empty"
                >
                  <div data-testid="empty-state-match-suggestions">
                    <ArrowRightLeft className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">
                      <T k="pageLabels.noMatchesFound2" />
                    </p>
                    <p className="text-xs mt-1">
                      <T k="pageLabels.tryReconcilingManuallyViaJournalEntries" />
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {dialogLine && !dialogLine.isReconciled && !isRowBusy(dialogLine.id) && companyId && (
            <BankLineActions
              companyId={companyId}
              transaction={dialogLine}
              canSubmit={() => canWriteRow(dialogLine.id, false)}
              bankAccounts={bankAccounts ?? []}
              transactions={transactions ?? []}
              onDone={() => {
                setMatchDialogOpen(false);
                setSelectedTransaction(null);
              }}
            />
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMatchDialogOpen(false)}>
              <T k="banking.common.close" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Import Dialog ─────────────────────────────────────────────────────── */}
      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          if (isImporting) return;
          setImportDialogOpen(open);
          if (!open) resetStatementPreview();
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto grid-cols-[minmax(0,1fr)]">
          <DialogHeader>
            <DialogTitle>{t.importBankStatement}</DialogTitle>
            <DialogDescription>{t["pageLabels.bankCsvWorkflow"]}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>
                <T k="pageLabels.bankAccount" />
              </Label>
              <Select
                value={selectedBankAccount}
                onValueChange={setSelectedBankAccount}
                disabled={!bankAccounts?.length || isImporting}
              >
                <SelectTrigger data-testid="select-import-bank-account">
                  <SelectValue placeholder={t["bankReconciliation.selectAccount"]} />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts?.map((acct) => (
                    <SelectItem key={acct.id} value={acct.id}>
                      {acct.nameEn} — {acct.bankName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {bankAccounts?.length === 0 && (
                <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2">
                  <p className="text-small text-foreground">{t["banking.accounts.none"]}</p>
                  <Button asChild variant="link" className="px-0">
                    <Link href="/bank-accounts">{t["banking.accounts.title"]}</Link>
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>
                <T k="pageLabels.statementFile" />
              </Label>
              <FileDrop
                accept=".csv,text/csv"
                onFiles={(files) => handleStatementFile(files[0])}
                disabled={isImporting}
                value={importFile?.name ?? null}
                onClear={resetStatementPreview}
                inputTestId="input-bank-statement-file"
              />
              {previewLoading && (
                <p
                  role="status"
                  className="text-small text-muted-foreground flex items-center gap-2"
                >
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {strings.previewLoading}
                </p>
              )}
              {previewError && (
                <p
                  role="alert"
                  className="text-small text-destructive"
                  data-testid="text-statement-preview-error"
                >
                  {previewError}
                </p>
              )}
            </div>
            {statementPreview && importFile && (
              <div
                className="border rounded-md p-3 space-y-3"
                dir={locale === "ar" ? "rtl" : "ltr"}
                data-testid="panel-statement-mapper"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-sm">{strings.reviewTitle}</p>
                  {statementRecognized && (
                    <Badge variant="secondary" data-testid="statement-recognized">
                      {strings.recognized}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {statementPreview.totalRows} {strings.rows} · {statementPreview.validRows}{" "}
                  {strings.valid}
                  {statementPreview.errorRows > 0 && (
                    <span className="text-destructive">
                      {" "}
                      · {statementPreview.errorRows} {strings.withErrors}
                    </span>
                  )}
                </p>

                {firstInvalidDateRow != null && (
                  <p
                    role="alert"
                    className="text-xs text-destructive"
                    data-testid="text-statement-preview-date-error"
                  >
                    {formatMessage(t["banking.import.invalidDateRow"], {
                      rowIndex: firstInvalidDateRow,
                    })}
                  </p>
                )}

                {statementPreview.warnings.length > 0 && (
                  <ul className="space-y-1" data-testid="list-statement-warnings">
                    {statementPreview.warnings.map((w) => (
                      <li
                        key={w.code + w.message}
                        className={
                          w.requiresChoice
                            ? "text-xs text-warning"
                            : "text-xs text-muted-foreground"
                        }
                      >
                        {localizeServerWarning(w)}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {statementPreview.dateOrder && statementPreview.dateOrder !== "YMD" && (
                    <div className="space-y-1">
                      <Label className="text-xs">{strings.dateOrder}</Label>
                      <Select
                        disabled={previewLoading || isImporting}
                        value={statementOverrides.dateOrder ?? statementPreview.dateOrder}
                        onValueChange={(value) =>
                          updateOverrides({
                            ...statementOverrides,
                            dateOrder: value as "DMY" | "MDY",
                          })
                        }
                      >
                        <SelectTrigger data-testid="select-statement-date-order">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="DMY">DD/MM/YYYY</SelectItem>
                          <SelectItem value="MDY">MM/DD/YYYY</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs">{strings.decimalSeparator}</Label>
                    <Select
                      disabled={previewLoading || isImporting}
                      value={
                        statementOverrides.decimalSeparator ?? statementPreview.decimalSeparator
                      }
                      onValueChange={(value) =>
                        updateOverrides({
                          ...statementOverrides,
                          decimalSeparator: value as "." | ",",
                        })
                      }
                    >
                      <SelectTrigger data-testid="select-statement-decimal">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value=".">{strings.decimalPoint}</SelectItem>
                        <SelectItem value=",">{strings.decimalComma}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {statementPreview.headers.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium">{strings.columnMapping}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {MAPPER_FIELDS.map((field) => {
                        const current = (statementOverrides.mapping ?? statementPreview.mapping)[
                          field
                        ];
                        return (
                          <div key={field} className="space-y-1">
                            <Label className="text-xs">{strings.fields[field]}</Label>
                            <Select
                              disabled={previewLoading || isImporting}
                              value={current == null ? "__none" : String(current)}
                              onValueChange={(value) => handleMappingChange(field, value)}
                            >
                              <SelectTrigger data-testid={`select-map-${field}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none">{strings.notMapped}</SelectItem>
                                {statementPreview.headers.map((header, index) => (
                                  <SelectItem key={index} value={String(index)}>
                                    {index + 1}. {header || "—"}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {statementPreview.sampleRows.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium">{strings.sampleRows}</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs" data-testid="table-statement-sample">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="text-start font-normal pe-2">#</th>
                            <th className="text-start font-normal pe-2">{strings.colDate}</th>
                            <th className="text-start font-normal pe-2">
                              {strings.colDescription}
                            </th>
                            <th className="text-end font-normal pe-2">{strings.colDebit}</th>
                            <th className="text-end font-normal">{strings.colCredit}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statementPreview.sampleRows.slice(0, 5).map((row) => (
                            <tr
                              key={row.rowIndex}
                              className={row.errors.length > 0 ? "text-destructive" : undefined}
                              title={
                                row.date === null
                                  ? [
                                      formatMessage(t["banking.import.invalidDateRow"], {
                                        rowIndex: row.rowIndex,
                                      }),
                                      ...row.errors.filter(
                                        (error) =>
                                          !/^(Missing date$|(Invalid|Unrecognised) date )/.test(
                                            error
                                          )
                                      ),
                                    ].join("; ")
                                  : row.errors.join("; ")
                              }
                            >
                              <td className="pe-2">{row.rowIndex}</td>
                              <td className="pe-2">{row.date ?? "—"}</td>
                              <td className="pe-2 max-w-[16rem] truncate">{row.description}</td>
                              <td className="text-end pe-2">
                                {row.debit ? row.debit.toFixed(2) : ""}
                              </td>
                              <td className="text-end">
                                {row.credit ? row.credit.toFixed(2) : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {statementPreview.requiresChoice && (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="ack-statement-ambiguity"
                      checked={acknowledgeAmbiguity}
                      disabled={previewLoading || isImporting}
                      onCheckedChange={(checked) => setAcknowledgeAmbiguity(checked === true)}
                      data-testid="checkbox-acknowledge-ambiguity"
                    />
                    <Label htmlFor="ack-statement-ambiguity" className="text-xs">
                      {strings.confirmAssumption}
                    </Label>
                  </div>
                )}
              </div>
            )}
            <div className="bg-muted/50 p-3 rounded-md text-sm space-y-1.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <p className="font-medium text-xs">
                    <T k="banking.import.csvDetails" />
                  </p>
                  <div className="flex items-center gap-2 text-xs">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-success" />
                    <span>{strings.formatCsv}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                    <span>{strings.formatDelimiters}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                    <span>{strings.formatDrCr}</span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={downloadSampleBankCsv}
                  data-testid="button-download-sample-bank-csv"
                >
                  <T k="pageLabels.sampleCSV" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setImportDialogOpen(false);
                resetStatementPreview();
              }}
              disabled={isImporting}
            >
              <T k="banking.common.cancel" />
            </Button>
            <Button
              onClick={handleImport}
              disabled={!canConfirmImport}
              data-testid="button-confirm-import"
            >
              {isImporting && <Loader2 className="w-4 h-4 animate-spin" />}
              {strings.importAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Report Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              <T k="pageLabels.reconciliationReport" />
            </DialogTitle>
            <DialogDescription>
              {selectedBankAccount && bankAccounts?.find((a) => a.id === selectedBankAccount)
                ? formatMessage(t["banking.report.descriptionAccount"], {
                    account: bankAccounts.find((a) => a.id === selectedBankAccount)!.nameEn,
                  })
                : t["banking.report.descriptionAll"]}
            </DialogDescription>
          </DialogHeader>
          {reportData ? (
            <div className="space-y-4">
              {/* A paused or failed refresh keeps the last loaded totals, with a notice. */}
              {reportPaused ? (
                <p
                  role="status"
                  className="text-center text-small text-muted-foreground"
                  data-testid="report-refresh-paused"
                >
                  {t["banking.query.pausedCached"]}
                </p>
              ) : reportError ? (
                <ErrorState
                  compact
                  testId="report-refresh-error"
                  description={t["banking.common.refreshFailed"]}
                  onRetry={() => void refetchReport()}
                />
              ) : null}
              {/* Status breakdown */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">
                  <T k="banking.common.status" />
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border p-3 text-center">
                    <div className="text-2xl font-bold">{reportData.summary.totalTransactions}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      <T k="pages.total2" />
                    </div>
                  </div>
                  <div className="rounded-lg border border-success/30 bg-success-subtle p-3 text-center">
                    <div className="text-2xl font-bold text-success">
                      {reportData.summary.reconciledCount}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      <T k="pages.reconciled" />
                    </div>
                  </div>
                  <div className="rounded-lg border border-warning/30 bg-warning-subtle p-3 text-center">
                    <div className="text-2xl font-bold text-warning">
                      {reportData.summary.unreconciledCount}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      <T k="pageLabels.unreconciled" />
                    </div>
                  </div>
                </div>
                {reportData.summary.totalTransactions > 0 && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">
                        <T k="pageLabels.completion" />
                      </span>
                      <span className="font-medium">{reportData.summary.reconciledPct}%</span>
                    </div>
                    <Progress
                      value={reportData.summary.reconciledPct}
                      aria-label={t["pageLabels.completion"]}
                      className="h-2"
                    />
                  </div>
                )}
              </div>

              <Separator />

              {/* Amount breakdown */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">
                  <T k="pageLabels.amounts" />
                </p>
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">
                      <T k="pageLabels.totalCredits" />
                    </span>
                    <span className="font-medium text-success">
                      {formatCurrency(reportData.amounts.totalCredits)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">
                      <T k="pageLabels.totalDebits" />
                    </span>
                    <span className="font-medium text-destructive">
                      {formatCurrency(reportData.amounts.totalDebits)}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">
                      <T k="pageLabels.reconciledCredits" />
                    </span>
                    <span className="text-success">
                      {formatCurrency(reportData.amounts.reconciledCredits)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">
                      <T k="pageLabels.reconciledDebits" />
                    </span>
                    <span className="text-destructive">
                      {formatCurrency(reportData.amounts.reconciledDebits)}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center text-sm font-semibold">
                    <span>
                      <T k="pageLabels.unreconciledCredits" />
                    </span>
                    <span className="text-warning">
                      {formatCurrency(reportData.amounts.unreconciledCredits)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-semibold">
                    <span>
                      <T k="pageLabels.unreconciledDebits" />
                    </span>
                    <span className="text-warning">
                      {formatCurrency(reportData.amounts.unreconciledDebits)}
                    </span>
                  </div>
                </div>
              </div>

              {reportData.summary.suggestedCount > 0 && (
                <>
                  <Separator />
                  <div className="flex items-center gap-2 rounded-lg bg-warning-subtle border border-warning/30 p-3">
                    <Sparkles className="w-4 h-4 text-warning shrink-0" />
                    <p className="text-sm text-foreground">
                      {formatMessage(t["banking.report.suggestedNotice"], {
                        count: reportData.summary.suggestedCount,
                      })}
                    </p>
                  </div>
                </>
              )}
            </div>
          ) : reportPaused ? (
            <div className="space-y-2 text-center text-small text-muted-foreground">
              <p role="status" data-testid="report-paused">
                {t["banking.query.paused"]}
              </p>
              {knownOffline && (
                <p role="status" data-testid="report-offline">
                  {t["common.errorHeading.offline"]}
                </p>
              )}
            </div>
          ) : reportError ? (
            <ErrorState compact testId="report-load-error" onRetry={() => void refetchReport()} />
          ) : (
            <div className="space-y-3" aria-busy="true" data-testid="report-loading">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportDialogOpen(false)}>
              <T k="banking.common.close" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Other ways to reconcile a line (W3-C, R06-21 / R06-22) ─────────────────

interface GlAccountOption {
  id: string;
  code: string;
  nameEn: string;
  type: string;
  subType: string | null;
  isActive: boolean;
}

interface OpenDocument {
  id: string;
  number?: string;
  customerName?: string;
  total?: number;
  status?: string;
}

type LineMode = "entry" | "split" | "transfer" | "exclude";

function BankLineActions({
  companyId,
  transaction,
  bankAccounts,
  transactions,
  canSubmit,
  onDone,
}: {
  companyId: string;
  transaction: BankTransaction;
  canSubmit: () => boolean;
  bankAccounts: BankAccount[];
  transactions: BankTransaction[];
  onDone: () => void;
}) {
  const { t, locale } = useTranslation();
  const tr = (k: string) => t[k] ?? k;
  const { toast } = useToast();
  const [mode, setMode] = useState<LineMode>("entry");
  const [accountId, setAccountId] = useState("");
  const [vatTreatment, setVatTreatment] = useState("none");
  const [bankFee, setBankFee] = useState("");
  const [memo, setMemo] = useState("");
  const [draft, setDraft] = useState(false);
  const [allocations, setAllocations] = useState<Array<{ id: string; amount: string }>>([
    { id: "", amount: "" },
  ]);
  const [otherAccount, setOtherAccount] = useState("");
  const [counterpart, setCounterpart] = useState("none");
  const [reason, setReason] = useState("");

  const inflow = transaction.amount > 0;
  const { data: glAccounts } = useQuery<GlAccountOption[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
  });
  const { data: invoices } = useQuery<OpenDocument[]>({
    queryKey: ["/api/companies", companyId, "invoices"],
    // R20-05: the list endpoint paginates by default; split matching needs every open invoice.
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/invoices?all=true`),
    enabled: mode === "split" && inflow,
  });
  const contraAccounts = (glAccounts ?? []).filter(
    (a) => a.isActive && !(a.type === "asset" && a.subType === "bank")
  );
  const openInvoices = (invoices ?? []).filter((i) =>
    ["sent", "posted", "partial", "overdue"].includes(i.status ?? "")
  );
  const toFilsLocal = (v: string) => Math.round(Number(v || 0) * 100);
  const allocatedFils = allocations.reduce((s, a) => s + toFilsLocal(a.amount), 0);
  const bankFils = Math.round(Math.abs(transaction.amount) * 100);
  const counterparts = transactions.filter(
    (x) =>
      x.bankStatementAccountId === otherAccount &&
      !x.isReconciled &&
      Math.round(x.amount * 100) === -Math.round(transaction.amount * 100)
  );

  const done = (title: string) => {
    toast({ title });
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "bank-statements"] });
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "invoices"] });
    onDone();
  };
  const onError = (error: Error) =>
    toast({
      variant: "destructive",
      title: tr("banking.common.error"),
      description: error?.message,
    });
  const base = `/api/companies/${companyId}/bank-statements/${transaction.id}`;

  const entryMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `${base}/create-entry`, {
        accountId,
        vatTreatment,
        ...(bankFee ? { bankFee } : {}),
        ...(memo ? { memo } : {}),
        postingMode: draft ? "draft" : "posted",
      }),
    onSuccess: () => done(tr("banking.line.entryCreated")),
    onError,
  });
  const splitMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `${base}/match`, {
        allocations: allocations
          .filter((a) => a.id && a.amount)
          .map((a) => ({ type: "invoice", id: a.id, amount: a.amount })),
      }),
    onSuccess: () => done(tr("banking.line.matched")),
    onError,
  });
  const transferMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `${base}/match`, {
        matchedType: "transfer",
        matchedId: otherAccount,
        ...(counterpart !== "none" ? { counterpartTransactionId: counterpart } : {}),
      }),
    onSuccess: () => done(tr("banking.line.matched")),
    onError,
  });
  const excludeMutation = useMutation({
    mutationFn: () => apiRequest("POST", `${base}/exclude`, { reason }),
    onSuccess: () => done(tr("banking.line.excluded")),
    onError,
  });

  // Re-checked at submission against the current list and in-flight writes, not render time.
  const submit = (m: { mutate: () => void }) => {
    if (!canSubmit()) return;
    m.mutate();
  };

  const modes: Array<[LineMode, string]> = [
    ["entry", "banking.line.createEntry"],
    ...(inflow ? ([["split", "banking.line.split"]] as Array<[LineMode, string]>) : []),
    ["transfer", "banking.line.transfer"],
    ["exclude", "banking.line.exclude"],
  ];

  return (
    <div className="mt-4 rounded-lg border p-4 space-y-3" data-testid="bank-line-actions">
      <p className="text-xs font-semibold text-muted-foreground">{tr("banking.line.actions")}</p>
      <div className="flex flex-wrap gap-2">
        {modes.map(([m, key]) => (
          <Button
            key={m}
            size="sm"
            variant={mode === m ? "default" : "outline"}
            onClick={() => setMode(m)}
          >
            {tr(key)}
          </Button>
        ))}
      </div>

      {mode === "entry" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>{tr("banking.line.account")}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger data-testid="select-entry-account">
                <SelectValue placeholder={tr("banking.line.account")} />
              </SelectTrigger>
              <SelectContent>
                {contraAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} {accountDisplayName(a, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{tr("banking.line.vatTreatment")}</Label>
            <Select value={vatTreatment} onValueChange={setVatTreatment}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["none", "standard", "zero_rated", "exempt"].map((v) => (
                  <SelectItem key={v} value={v}>
                    {tr(`banking.line.vat.${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="line-fee">{tr("banking.line.bankFee")}</Label>
            <Input
              id="line-fee"
              inputMode="decimal"
              value={bankFee}
              onChange={(e) => setBankFee(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="line-memo">{tr("banking.line.memo")}</Label>
            <Input id="line-memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={draft} onCheckedChange={(v) => setDraft(v === true)} />
            {tr("banking.line.draft")}
          </label>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => submit(entryMutation)}
              disabled={!accountId || entryMutation.isPending}
              data-testid="button-create-entry"
            >
              {tr("banking.line.post")}
            </Button>
          </div>
        </div>
      )}

      {mode === "split" && (
        <div className="space-y-2">
          {allocations.map((a, i) => (
            <div key={i} className="grid grid-cols-3 gap-2">
              <Select
                value={a.id}
                onValueChange={(v) =>
                  setAllocations(allocations.map((x, j) => (j === i ? { ...x, id: v } : x)))
                }
              >
                <SelectTrigger className="col-span-2">
                  <SelectValue placeholder={tr("banking.line.document")} />
                </SelectTrigger>
                <SelectContent>
                  {openInvoices.map((inv) => (
                    <SelectItem key={inv.id} value={inv.id}>
                      {inv.number} {inv.customerName}{" "}
                      {inv.total != null ? formatCurrency(inv.total) : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                inputMode="decimal"
                value={a.amount}
                aria-label={tr("banking.common.amount")}
                onChange={(e) =>
                  setAllocations(
                    allocations.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x))
                  )
                }
              />
            </div>
          ))}
          <div className="flex items-center justify-between text-sm">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAllocations([...allocations, { id: "", amount: "" }])}
            >
              {tr("banking.line.addAllocation")}
            </Button>
            <span>
              {tr("banking.line.allocated")}: {(allocatedFils / 100).toFixed(2)} ·{" "}
              {tr("banking.line.remaining")}: {((bankFils - allocatedFils) / 100).toFixed(2)}
            </span>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => submit(splitMutation)}
              disabled={allocatedFils !== bankFils || splitMutation.isPending}
            >
              {tr("banking.line.applySplit")}
            </Button>
          </div>
        </div>
      )}

      {mode === "transfer" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>{tr("banking.line.otherAccount")}</Label>
            <Select value={otherAccount} onValueChange={setOtherAccount}>
              <SelectTrigger>
                <SelectValue placeholder={tr("banking.line.otherAccount")} />
              </SelectTrigger>
              <SelectContent>
                {bankAccounts
                  .filter((b) => b.id !== transaction.bankStatementAccountId)
                  .map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.nameEn}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{tr("banking.line.counterpart")}</Label>
            <Select value={counterpart} onValueChange={setCounterpart}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{tr("banking.line.noCounterpart")}</SelectItem>
                {counterparts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.transactionDate.slice(0, 10)} {c.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button
              size="sm"
              onClick={() => submit(transferMutation)}
              disabled={!otherAccount || transferMutation.isPending}
            >
              {tr("banking.line.applyTransfer")}
            </Button>
          </div>
        </div>
      )}

      {mode === "exclude" && (
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Label htmlFor="line-reason">{tr("banking.line.excludeReason")}</Label>
            <Input id="line-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => submit(excludeMutation)}
            disabled={reason.trim().length < 3 || excludeMutation.isPending}
          >
            {tr("banking.line.excludeApply")}
          </Button>
        </div>
      )}
    </div>
  );
}
