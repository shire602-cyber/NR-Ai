import { lazy, Suspense } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useTranslation } from "@/lib/i18n";
import "./einvoice-theme.css";

const EInvoicePanel = lazy(() =>
  import("./EInvoiceStatus").then(({ EInvoicePanel }) => ({ default: EInvoicePanel }))
);

export function EInvoiceSheet({
  invoiceId,
  invoiceNumber,
  open,
  onOpenChange,
  onEdit,
}: {
  invoiceId: string | null;
  invoiceNumber?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: () => void;
}) {
  const { t, locale } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={locale === "ar" ? "left" : "right"}
        className="einvoice-surface w-full overflow-y-auto sm:max-w-lg"
        data-testid="einvoice-sheet"
      >
        <SheetHeader className="mb-5">
          <SheetTitle>
            {t["einvoicing.sheetTitle"]}
            {invoiceNumber ? (
              <>
                {" · "}
                <span dir="ltr" className="[unicode-bidi:isolate]">
                  {invoiceNumber}
                </span>
              </>
            ) : null}
          </SheetTitle>
          <SheetDescription>{t["einvoicing.sheetDescription"]}</SheetDescription>
        </SheetHeader>
        {invoiceId && (
          <Suspense
            fallback={<div className="h-10 animate-pulse rounded bg-muted" aria-busy="true" />}
          >
            <EInvoicePanel invoiceId={invoiceId} onEdit={onEdit} />
          </Suspense>
        )}
      </SheetContent>
    </Sheet>
  );
}
