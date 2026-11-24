import { UPGRADE_CONTACT_EMAIL } from "@shared/trial";
import { formatMessage, translateNow } from "@/lib/i18n";

/**
 * `mailto:` link for "talk to us about a plan". The subject follows the interface language
 * (catalog `marketing.planContactSubject*`); the address is the single support address in
 * `@shared/trial`. There is no pre-filled body. Call it while rendering (the caller re-renders
 * on a language switch).
 */
export function planContactHref(planName?: string): string {
  const key = planName ? "marketing.planContactSubject" : "marketing.planContactSubjectGeneric";
  const text = translateNow(key);
  const template = text === key ? (planName ? "Muhasib.ai {plan}" : "Muhasib.ai plan") : text;
  const subject = planName ? formatMessage(template, { plan: planName }) : template;
  return `mailto:${UPGRADE_CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
