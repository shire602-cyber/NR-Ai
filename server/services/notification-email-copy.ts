import { marketingBrand } from "../../shared/marketing-brand";
import { escapeHtml, renderBilingualEmail } from "./email-layout";

export function renderNotificationEmail(title: string, message: string): string {
  return renderBilingualEmail(
    {
      brandName: marketingBrand,
      heading: { en: title, ar: title },
      paragraphs: { en: [escapeHtml(message)], ar: [] },
      footer: `${marketingBrand} notifications — manage them under Settings → Notifications`,
    },
    "en"
  );
}
