import { useTranslation } from "@/lib/i18n";
import { fieldLabel, type DisplayField } from "@/lib/sales-api";

/** Fields flagged "show on PDF", with the label in the reader's language (public invoice, quote, portal). */
export function CustomFieldsDisplay({ fields, className }: { fields: DisplayField[] | null | undefined; className?: string }) {
  const { locale } = useTranslation();
  if (!fields || fields.length === 0) return null;
  return (
    <dl className={className ?? "grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2"} data-testid="custom-fields-display">
      {fields.map((f) => (
        <div key={f.key} className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">{fieldLabel(f, locale)}:</dt>
          <dd className="font-medium">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
