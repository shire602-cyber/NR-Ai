import { useI18n } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";
import type { ProposedLine } from "@/lib/banking-api-types";
import { messages } from "./ProposedLinesPreview.i18n";

/** The Dr/Cr lines a suggestion would post, shown before anything is accepted. */
export function ProposedLinesPreview({ lines, posts }: { lines: ProposedLine[]; posts: boolean }) {
  const tr = messages.useT();
  const locale = useI18n((s) => s.locale);
  if (!posts || lines.length === 0) {
    return <p className="text-xs text-muted-foreground">{tr("linkOnly")}</p>;
  }
  const debit = lines.reduce((s, l) => s + Math.round(l.debit * 100), 0) / 100;
  const credit = lines.reduce((s, l) => s + Math.round(l.credit * 100), 0) / 100;
  return (
    <div className="rounded-md border text-xs overflow-x-auto" data-testid="proposed-lines">
      <p className="px-2 py-1 font-medium bg-muted/40">{tr("heading")}</p>
      <table className="w-full min-w-[260px]">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-start font-normal px-2 py-1">{tr("account")}</th>
            <th className="text-end font-normal px-2 py-1 w-24">{tr("debit")}</th>
            <th className="text-end font-normal px-2 py-1 w-24">{tr("credit")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={`${l.accountId}-${i}`} className="border-t">
              <td className="px-2 py-1" dir="auto">
                <span className="font-mono" dir="ltr">
                  {l.accountCode}
                </span>{" "}
                {l.accountName}
              </td>
              <td dir="ltr" className="px-2 py-1 text-end font-mono">
                {l.debit ? formatNumber(l.debit, locale) : ""}
              </td>
              <td dir="ltr" className="px-2 py-1 text-end font-mono">
                {l.credit ? formatNumber(l.credit, locale) : ""}
              </td>
            </tr>
          ))}
          <tr className="border-t font-medium">
            <td className="px-2 py-1">{tr("total")}</td>
            <td dir="ltr" className="px-2 py-1 text-end font-mono">
              {formatNumber(debit, locale)}
            </td>
            <td dir="ltr" className="px-2 py-1 text-end font-mono">
              {formatNumber(credit, locale)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
