import type { ChecklistItemLike } from "./checklist-text";
import { resolveDescription, resolveDetails, resolveTitle } from "./checklist-text";
import { messages } from "./ChecklistItemText.i18n";

/** A checklist item's title and its detail line in the reader's language; a sentence it does not know stays as written. */
export function ChecklistItemText({ item }: { item: ChecklistItemLike }) {
  const tr = messages.useT();
  const title = resolveTitle(item);
  const detail = resolveDetails(item.details);
  const desc = resolveDescription(item);
  return (
    <div>
      <p className="text-sm font-medium">{title ? tr(title.key as never, title.params) : item.title}</p>
      <p className="text-xs text-muted-foreground" data-testid={`checklist-detail-${item.id}`}>
        {detail ? tr(detail.key as never, detail.params) : item.details ? item.details : desc ? tr(desc.key as never) : item.description}
      </p>
    </div>
  );
}
