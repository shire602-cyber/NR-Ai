/** Catalog key of the preview chip: the real lifecycle status, "Draft" only for a draft. */
export function previewStatusKey(status?: string | null): string {
  switch (status) {
    case "paid":
    case "partial":
    case "void":
      return `forms.preview.status.${status}`;
    case "cancelled":
      return "forms.preview.status.void";
    case "sent":
    case "posted":
    case "overdue":
      return "forms.preview.status.sent";
    default:
      return "forms.preview.draftBadge";
  }
}
