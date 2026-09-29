import { AlertTriangle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { useTranslation } from "@/lib/i18n";

/**
 * Shown on a VAT return computed for a period that has not ended yet. Such a
 * return is a preview only: it is never saved, submitted or filed.
 */
export default function DraftPreviewBanner({ previewAsOf }: { previewAsOf?: string | null }) {
  const { locale } = useTranslation();
  const isAr = locale === "ar";
  return (
    <Alert
      className="border-warning/40 bg-warning-subtle text-warning-subtle-foreground"
      data-testid="banner-draft-preview"
    >
      <AlertTriangle className="h-4 w-4" />
      <div className="text-sm">
        <p className="font-semibold">
          {isAr ? "مسودة للمعاينة — الفترة لم تنتهِ بعد" : "Draft preview — period not ended"}
        </p>
        <p>
          {isAr
            ? "هذه الأرقام محسوبة حتى الآن فقط وقد تتغير. لا يمكن تقديم هذا الإقرار أو إيداعه قبل انتهاء الفترة."
            : "These figures are calculated to date and may still change. This return cannot be submitted or filed until the period has ended."}
          {previewAsOf ? (isAr ? ` (حتى ${previewAsOf})` : ` (as of ${previewAsOf})`) : ""}
        </p>
      </div>
    </Alert>
  );
}
