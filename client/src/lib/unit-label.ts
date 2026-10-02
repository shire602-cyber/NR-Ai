/** Units are stored as short English codes ("pcs", "kg"); the Arabic interface shows the Arabic unit, any other unit as typed. */
const UNITS_AR: Record<string, string> = { pcs: "قطعة", kg: "كجم", m: "م", hr: "ساعة", box: "صندوق", bag: "كيس", l: "لتر", g: "جم" };

export function unitLabel(unit: string | null | undefined, locale: string): string {
  if (!unit) return "";
  return locale === "ar" ? (UNITS_AR[unit.trim().toLowerCase()] ?? unit) : unit;
}
