// Month and VAT close-group labels in the reader's language (no hard-coded English months).
export function monthName(month: number, locale: string, style: "long" | "short"): string {
  // en-US short months are all three letters (en-GB gives "Sept").
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-US", {
    month: style,
  }).format(new Date(2000, month - 1, 1));
}

export function monthOptions(locale: string) {
  return Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: monthName(i + 1, locale, "long"),
  }));
}

// A VAT close group is the quarter cycle: the months a return period ends in. The value is the
// `vatPeriodStartMonth` the API stores for that cycle.
const VAT_CLOSE_GROUP_MONTHS: Record<string, number[]> = {
  "11": [1, 4, 7, 10],
  "12": [2, 5, 8, 11],
  "1": [3, 6, 9, 12],
};

export function vatCloseGroups(locale: string) {
  return Object.entries(VAT_CLOSE_GROUP_MONTHS).map(([value, months]) => ({
    value,
    label: months.map((m) => monthName(m, locale, "short")).join(" / "),
  }));
}

export function monthLabel(month: number | string | null | undefined, locale: string): string {
  return monthName(Number(month) || 1, locale, "long");
}

export function vatCloseGroupLabel(
  periodStartMonth: number | string | null | undefined,
  locale: string
): string {
  const months =
    VAT_CLOSE_GROUP_MONTHS[String(periodStartMonth || 1)] ?? VAT_CLOSE_GROUP_MONTHS["1"];
  return months.map((m) => monthName(m, locale, "short")).join(" / ");
}
