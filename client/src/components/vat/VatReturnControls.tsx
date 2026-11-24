import { MARKETING_BRAND } from "@shared/marketing-brand";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FilePen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTranslation } from "@/lib/i18n";
import { getAuthHeaders } from "@/lib/auth";
import { VatInputTrnWarnings, type VatIssueLike } from "./VatInputTrnWarnings";

/**
 * W4-E controls for one VAT 201 return: VAT-to-GL reconciliation status (R12-08b), the
 * "ready to submit" gate with an audited override (R12-03), the FTA portal-order CSV and the
 * amended-return flow (R07-15). Nothing here transmits anything to the FTA.
 */

const COPY = {
  en: {
    reconTitle: "Ledger reconciliation",
    reconOk: "The return agrees with the VAT control accounts.",
    reconDiff: "Unexplained difference with the VAT control accounts",
    output: "Output VAT",
    input: "Input VAT",
    markReady: "Mark ready to submit",
    overrideLabel: "Reason for submitting with an unexplained difference",
    overridePlaceholder: "Explain the difference (this is recorded in the audit log)",
    readyDone: "Return marked ready",
    exportCsv: "EmaraTax portal CSV",
    amend: "Amend return",
    amendReason: "Reason for the amendment",
    amendDone: "Amended return created as a draft",
    notFiled: `Preparation file only. ${MARKETING_BRAND.name.en} does not file with the FTA.`,
    failed: "Action failed",
  },
  ar: {
    reconTitle: "مطابقة الدفاتر",
    reconOk: "الإقرار مطابق لحسابات ضريبة القيمة المضافة في الدفاتر.",
    reconDiff: "فرق غير مفسر مع حسابات ضريبة القيمة المضافة",
    output: "ضريبة المخرجات",
    input: "ضريبة المدخلات",
    markReady: "تحديد كجاهز للتقديم",
    overrideLabel: "سبب التقديم مع وجود فرق غير مفسر",
    overridePlaceholder: "اشرح الفرق (يُسجل في سجل التدقيق)",
    readyDone: "تم تحديد الإقرار كجاهز",
    exportCsv: "ملف CSV لبوابة إمارات تاكس",
    amend: "تعديل الإقرار",
    amendReason: "سبب التعديل",
    amendDone: "تم إنشاء إقرار معدل كمسودة",
    notFiled: `ملف تحضيري فقط. ${MARKETING_BRAND.name.ar} لا يقدم الإقرارات إلى الهيئة.`,
    failed: "تعذر تنفيذ الإجراء",
  },
} as const;

interface ReconSnapshot {
  hasUnexplainedDifference?: boolean;
  aed?: { unexplainedOutput?: number; unexplainedInput?: number };
  /** Issues listed with the return when it was generated (X6a: TRN warnings). */
  issues?: VatIssueLike[];
}

export interface VatReturnControlsProps {
  companyId: string;
  vatReturn: {
    id: string;
    status: string;
    reconciliationSnapshot?: ReconSnapshot | null;
  };
  onChanged?: () => void;
}

export default function VatReturnControls({
  companyId,
  vatReturn,
  onChanged,
}: VatReturnControlsProps) {
  const { locale } = useTranslation();
  const c = COPY[locale === "ar" ? "ar" : "en"];
  const { toast } = useToast();
  const [override, setOverride] = useState("");
  const [needsOverride, setNeedsOverride] = useState(false);
  const [amendReason, setAmendReason] = useState("");
  const snap = vatReturn.reconciliationSnapshot ?? null;
  const diff = snap?.hasUnexplainedDifference === true;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "vat-returns"] });
    onChanged?.();
  };

  const ready = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/vat-returns/${vatReturn.id}/ready`, {
        ...(override.trim() ? { overrideReason: override.trim() } : {}),
      }),
    onSuccess: () => {
      toast({ title: c.readyDone });
      setNeedsOverride(false);
      refresh();
    },
    onError: (err: Error & { code?: string }) => {
      if (
        String(err?.message || "").includes("VAT control") ||
        err?.code === "VAT_RECONCILIATION_DIFFERENCE"
      ) {
        setNeedsOverride(true);
      }
      toast({ variant: "destructive", title: c.failed, description: err?.message });
    },
  });

  const amend = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/vat-returns/${vatReturn.id}/amend`, { reason: amendReason.trim() }),
    onSuccess: () => {
      toast({ title: c.amendDone });
      setAmendReason("");
      refresh();
    },
    onError: (err: Error) =>
      toast({ variant: "destructive", title: c.failed, description: err?.message }),
  });

  const downloadCsv = async () => {
    const res = await fetch(apiUrl(`/api/vat-returns/${vatReturn.id}/export?format=csv`), {
      headers: getAuthHeaders(),
      credentials: "include",
    });
    if (!res.ok) {
      toast({ variant: "destructive", title: c.failed });
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vat201-${vatReturn.id.slice(0, 8)}-fta.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const canReady = vatReturn.status === "draft" || vatReturn.status === "pending_review";
  const canAmend = vatReturn.status === "submitted" || vatReturn.status === "filed";

  return (
    <div className="space-y-3 rounded-md border p-3 text-sm" data-testid="vat-return-controls">
      <div className="flex items-start gap-2">
        {diff ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
        )}
        <div>
          <p className="font-medium">{c.reconTitle}</p>
          <p className="text-muted-foreground">{diff ? c.reconDiff : c.reconOk}</p>
          {diff && snap?.aed && (
            <p className="tabular-nums">
              {c.output}: {(snap.aed.unexplainedOutput ?? 0).toFixed(2)} · {c.input}:{" "}
              {(snap.aed.unexplainedInput ?? 0).toFixed(2)}
            </p>
          )}
        </div>
      </div>
      <VatInputTrnWarnings issues={snap?.issues} />
      {canReady && (needsOverride || diff) && (
        <div className="space-y-1">
          <label className="text-xs font-medium" htmlFor={`override-${vatReturn.id}`}>
            {c.overrideLabel}
          </label>
          <Textarea
            id={`override-${vatReturn.id}`}
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            placeholder={c.overridePlaceholder}
            className="min-h-16"
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {canReady && (
          <Button size="sm" onClick={() => ready.mutate()} disabled={ready.isPending}>
            {ready.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {c.markReady}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => void downloadCsv()}>
          <Download className="me-2 h-4 w-4" />
          {c.exportCsv}
        </Button>
      </div>
      {canAmend && (
        <div className="space-y-1">
          <label className="text-xs font-medium" htmlFor={`amend-${vatReturn.id}`}>
            {c.amendReason}
          </label>
          <Textarea
            id={`amend-${vatReturn.id}`}
            value={amendReason}
            onChange={(e) => setAmendReason(e.target.value)}
            className="min-h-16"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={amendReason.trim().length < 3 || amend.isPending}
            onClick={() => amend.mutate()}
          >
            <FilePen className="me-2 h-4 w-4" />
            {c.amend}
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{c.notFiled}</p>
    </div>
  );
}
