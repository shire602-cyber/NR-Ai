import type { ChecklistItemLike } from "./checklist-text";
import { resolveDescription, resolveDetails, resolveTitle } from "./checklist-text";
import { statusLabel } from "@/lib/enum-labels";
import { CALENDAR_DATE_SHORT_FORMAT, formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { messages } from "./ChecklistItemText.i18n";

const DATE_PARAMS = new Set(["periodStart", "periodEnd"]);

/** Dates and the return status in the reader's language. */
function localizeParams(params: Record<string, string | number>, locale: string) {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => {
      const text = String(v);
      if (DATE_PARAMS.has(k) && /^\d{4}-\d{2}-\d{2}/.test(text))
        return [
          k,
          formatDate(`${text.slice(0, 10)}T00:00:00Z`, locale, CALENDAR_DATE_SHORT_FORMAT),
        ];
      if (k === "status") return [k, statusLabel(text, locale)];
      return [k, v];
    })
  );
}

/** A checklist item's title and its detail line in the reader's language; a sentence it does not know stays as written. */
export function ChecklistItemText({ item }: { item: ChecklistItemLike }) {
  const tr = messages.useT();
  const locale = useI18n((s) => s.locale);
  const title = resolveTitle(item);
  const detail = resolveDetails(item.details);
  const desc = resolveDescription(item);
  return (
    <div>
      <p className="text-sm font-medium">
        {title ? tr(title.key as never, title.params) : item.title}
      </p>
      <p className="text-xs text-muted-foreground" data-testid={`checklist-detail-${item.id}`}>
        {detail
          ? tr(detail.key as never, localizeParams(detail.params, locale))
          : item.details
            ? item.details
            : desc
              ? tr(desc.key as never)
              : item.description}
      </p>
    </div>
  );
}
