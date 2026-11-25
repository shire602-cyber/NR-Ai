/**
 * date-fns locale options for the active UI locale (R18-02): `format(d, "d MMM yyyy",
 * dateFnsOptions(locale))` renders Arabic month names in Arabic mode instead of English.
 * Machine formats (yyyy-MM-dd keys, file names, export cells) should not pass these.
 */
import { ar } from "date-fns/locale";
import type { Locale as DateFnsLocale } from "date-fns";

export function dateFnsLocale(locale: string): DateFnsLocale | undefined {
  return locale === "ar" ? ar : undefined;
}

export function dateFnsOptions(locale: string): { locale?: DateFnsLocale } {
  const resolved = dateFnsLocale(locale);
  return resolved ? { locale: resolved } : {};
}
