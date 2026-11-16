import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { loadNamespace, t as catalogs, useTranslation, type Locale } from "@/lib/i18n";
import { Money } from "@/components/ui/money";
import { formatDate } from "@/lib/format";

/**
 * D5b — live bilingual tax-invoice preview (BENCHMARK move 7, "bilingual invoice as the
 * form"). It mirrors the open invoice form as the customer will read it: English and
 * Arabic labels together (the active language first), Latin identifiers isolated LTR,
 * amounts through the shared Money formatter. Display only — nothing here is sent.
 */

export interface InvoicePreviewLine {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  /** net + VAT, major units */
  lineTotal: number;
}

export interface InvoicePreviewProps {
  sellerName?: string | null;
  sellerTrn?: string | null;
  sellerAddress?: string | null;
  number?: string | null;
  date?: Date | null;
  customerName?: string | null;
  customerTrn?: string | null;
  placeOfSupply?: string | null;
  currency: string;
  lines: InvoicePreviewLine[];
  subtotal: number;
  vatAmount: number;
  total: number;
  ratesLabel: string;
  className?: string;
}

const NS = "forms";

/** Both languages of one catalog key, active language first. */
function useBilingual() {
  const { locale } = useTranslation();
  const other: Locale = locale === "ar" ? "en" : "ar";
  useEffect(() => {
    void loadNamespace(other, NS);
    void loadNamespace(locale, NS);
  }, [locale, other]);
  return (key: string) => {
    const primary = catalogs[locale]?.[key as keyof (typeof catalogs)["en"]] as string | undefined;
    const secondary = catalogs[other]?.[key as keyof (typeof catalogs)["en"]] as string | undefined;
    return { primary: primary ?? "", secondary: secondary ?? "", other };
  };
}

function Bi({
  k,
  bi,
  className,
  align = "start",
}: {
  k: string;
  bi: ReturnType<typeof useBilingual>;
  className?: string;
  align?: "start" | "end";
}) {
  const { primary, secondary, other } = bi(k);
  return (
    <span
      className={cn(
        "flex flex-col leading-tight",
        align === "end" ? "items-end text-end" : "items-start text-start",
        className
      )}
    >
      <span>{primary}</span>
      {secondary && secondary !== primary && (
        <span
          lang={other}
          dir={other === "ar" ? "rtl" : "ltr"}
          className="text-caption font-normal text-muted-foreground"
        >
          {secondary}
        </span>
      )}
    </span>
  );
}

function Ltr({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={cn("tabular-nums [unicode-bidi:isolate]", className)}>
      {children}
    </span>
  );
}

export function InvoicePreview(props: InvoicePreviewProps) {
  const { t, locale } = useTranslation();
  const bi = useBilingual();
  const {
    sellerName,
    sellerTrn,
    sellerAddress,
    number,
    date,
    customerName,
    customerTrn,
    placeOfSupply,
    currency,
    lines,
    subtotal,
    vatAmount,
    total,
    ratesLabel,
    className,
  } = props;
  const visibleLines = lines.filter((l) => l.description || l.unitPrice || l.lineTotal);
  const placeholder = <span className="text-muted-foreground">—</span>;

  return (
    <div
      className={cn("rounded-xl bg-surface-sunken p-3 sm:p-4", className)}
      data-testid="invoice-preview"
      aria-label={t["forms.preview.ariaLabel"]}
      role="region"
    >
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <p className="text-caption font-medium text-muted-foreground">
          {t["forms.preview.heading"]}
        </p>
        <span className="rounded-full bg-card px-2 py-0.5 text-caption text-muted-foreground">
          {t["forms.preview.draftBadge"]}
        </span>
      </div>

      <article className="space-y-5 rounded-lg bg-card p-5 text-small text-card-foreground shadow-card-soft">
        {/* Seller + document title */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-0.5">
            <p dir="auto" className="truncate text-h4 font-semibold text-foreground">
              {sellerName || placeholder}
            </p>
            {sellerAddress && (
              <p dir="auto" className="text-caption text-muted-foreground">
                {sellerAddress}
              </p>
            )}
            {sellerTrn && (
              <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
                <span>{t["forms.preview.trnShort"]}</span>
                <Ltr>{sellerTrn}</Ltr>
              </p>
            )}
          </div>
          <Bi
            k="forms.preview.taxInvoice"
            bi={bi}
            align="end"
            className="text-h3 font-semibold text-foreground"
          />
        </header>

        {/* Document meta + bill to */}
        <div className="grid grid-cols-1 gap-4 border-y border-border py-4 sm:grid-cols-2">
          <dl className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">
                <Bi k="forms.preview.invoiceNo" bi={bi} />
              </dt>
              <dd className="font-medium">
                {number ? (
                  <Ltr>{number}</Ltr>
                ) : (
                  <span className="text-muted-foreground">{t["forms.preview.numberOnSave"]}</span>
                )}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">
                <Bi k="forms.preview.issueDate" bi={bi} />
              </dt>
              <dd className="font-medium">
                {date ? (
                  <span className="whitespace-nowrap">{formatDate(date, locale)}</span>
                ) : (
                  placeholder
                )}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">
                <Bi k="forms.preview.placeOfSupply" bi={bi} />
              </dt>
              <dd className="text-end font-medium">{placeOfSupply || placeholder}</dd>
            </div>
          </dl>
          <div className="space-y-1">
            <p className="text-muted-foreground">
              <Bi k="forms.preview.billTo" bi={bi} />
            </p>
            <p dir="auto" className="font-medium text-foreground">
              {customerName || placeholder}
            </p>
            {customerTrn && (
              <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
                <span>{t["forms.preview.trnShort"]}</span>
                <Ltr>{customerTrn}</Ltr>
              </p>
            )}
          </div>
        </div>

        {/* Lines */}
        <table className="w-full table-fixed text-small">
          <thead>
            <tr className="border-b border-border text-caption text-muted-foreground">
              <th scope="col" className="w-[44%] pb-2 text-start font-medium">
                <Bi k="forms.preview.description" bi={bi} />
              </th>
              <th scope="col" className="pb-2 text-end font-medium">
                <Bi k="forms.preview.qty" bi={bi} align="end" />
              </th>
              <th scope="col" className="pb-2 text-end font-medium">
                <Bi k="forms.preview.vat" bi={bi} align="end" />
              </th>
              <th scope="col" className="pb-2 text-end font-medium">
                <Bi k="forms.preview.amount" bi={bi} align="end" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleLines.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-4 text-center text-muted-foreground">
                  {t["forms.preview.noLines"]}
                </td>
              </tr>
            ) : (
              visibleLines.map((line, i) => (
                <tr key={i} className="align-top">
                  <td className="py-2 pe-2">
                    <span dir="auto" className="block break-words">
                      {line.description || placeholder}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      <Money amount={line.unitPrice} currency={currency} />
                    </span>
                  </td>
                  <td className="py-2 text-end">
                    <Ltr>{line.quantity}</Ltr>
                  </td>
                  <td className="py-2 text-end">
                    <Ltr>{`${Math.round(line.vatRate * 100)}%`}</Ltr>
                  </td>
                  <td className="py-2 text-end">
                    <Money amount={line.lineTotal} currency={currency} showCurrency={false} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Totals */}
        <dl className="ms-auto w-full max-w-xs space-y-1.5 border-t border-border pt-3">
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">
              <Bi k="forms.preview.subtotal" bi={bi} />
            </dt>
            <dd>
              <Money amount={subtotal} currency={currency} />
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">
              <span className="flex items-center gap-1">
                <Bi k="forms.preview.vatTotal" bi={bi} />
                <Ltr className="self-start text-caption">{`(${ratesLabel})`}</Ltr>
              </span>
            </dt>
            <dd>
              <Money amount={vatAmount} currency={currency} />
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3 border-t border-border-strong pt-2 text-h4 font-semibold text-foreground">
            <dt>
              <Bi k="forms.preview.total" bi={bi} />
            </dt>
            <dd data-testid="invoice-preview-total">
              <Money amount={total} currency={currency} />
            </dd>
          </div>
        </dl>

        <p className="text-caption text-muted-foreground">{t["forms.preview.footnote"]}</p>
      </article>
    </div>
  );
}
