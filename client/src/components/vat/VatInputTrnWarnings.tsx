import { AlertTriangle } from "lucide-react";
import { formatMessage, useTranslation } from "@/lib/i18n";

/**
 * X6a (beat item 6): the VAT 201 issues list warns when input VAT is claimed on a purchase whose
 * supplier has no valid TRN (server/tax/vat-engine.ts inputVatWithoutSupplierTrn). A warning: it
 * never blocks the return, but input VAT is only recoverable against a tax invoice with a TRN.
 */
export interface VatIssueLike {
  code: string;
  severity?: "error" | "warning";
  documentType?: string;
  documentId?: string;
  reference?: string | null;
}

function inputVatTrnWarnings(issues: VatIssueLike[] | null | undefined): VatIssueLike[] {
  return (issues ?? []).filter((i) => i.code === "INPUT_VAT_NO_SUPPLIER_TRN");
}

export function VatInputTrnWarnings({ issues }: { issues: VatIssueLike[] | null | undefined }) {
  const { t } = useTranslation();
  const list = inputVatTrnWarnings(issues);
  if (list.length === 0) return null;
  return (
    <div
      className="space-y-1 rounded-md border border-warning/30 bg-warning-subtle p-3 text-small text-warning-subtle-foreground"
      data-testid="vat-input-trn-warnings"
      role="status"
    >
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
        {formatMessage(t["compliance.vatInputTrn.title"], { count: list.length })}
      </p>
      <p>{t["compliance.vatInputTrn.body"]}</p>
      <ul className="list-disc space-y-0.5 ps-5">
        {list.map((i) => (
          <li key={`${i.documentType}:${i.documentId}`} dir="auto">
            {formatMessage(
              i.documentType === "receipt"
                ? t["compliance.vatInputTrn.receipt"]
                : t["compliance.vatInputTrn.bill"],
              { reference: i.reference ?? "—" }
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
