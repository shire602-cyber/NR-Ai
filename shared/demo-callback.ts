import { toAsciiDigits } from "./arabic-text";

/** Normalize local digits while preserving the visitor's phone formatting. */
export function normalizeCallbackPhone(input: string): string | null {
  const phone = toAsciiDigits(input.trim());
  return /^\+?[0-9 ().-]{7,32}$/.test(phone) && phone.replace(/\D/g, "").length >= 7 ? phone : null;
}
