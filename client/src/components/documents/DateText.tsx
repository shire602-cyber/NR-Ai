import { formatDate } from "@/lib/format-date";

/**
 * A calendar date as an isolated run. The RTL stylesheet forces leaf `.tabular-nums` elements to
 * LTR so figures keep their order, which reversed an Arabic date ("5 نوفمبر 2026" drew as
 * "5 2026 نوفمبر"). The `<bdi>` makes the element a non-leaf and lets the date pick its own
 * direction from its first strong character.
 */
export function DateText({ value, locale }: { value: string | Date; locale: string }) {
  return <bdi dir="auto">{formatDate(value, locale)}</bdi>;
}
