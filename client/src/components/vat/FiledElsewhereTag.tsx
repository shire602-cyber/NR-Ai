import { Badge } from "@/components/ui/badge";
import { CALENDAR_DATE_SHORT_FORMAT, formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { messages as pageMessages } from "./FiledElsewhereTag.i18n";

/** The server's stand-in when a filing was recorded without a reference. */
const NO_REFERENCE = "(not recorded)";

interface Props {
  filing: { filedAt: string; referenceNumber: string };
  testId?: string;
}

/** Tag, filing date and reference for a return that was filed outside Muhasib. */
export function FiledElsewhereTag({ filing, testId }: Props) {
  const tr = pageMessages.useT();
  const locale = useI18n((s) => s.locale);
  const date = formatDate(
    `${filing.filedAt.slice(0, 10)}T00:00:00Z`,
    locale,
    CALENDAR_DATE_SHORT_FORMAT
  );
  const hasRef = filing.referenceNumber && filing.referenceNumber !== NO_REFERENCE;
  return (
    <div className="flex flex-col items-start gap-0.5" data-testid={testId}>
      <Badge variant="outline">{tr("tag")}</Badge>
      <span className="text-xs text-muted-foreground">
        <bdi dir="ltr">{tr("filedOn", { date })}</bdi>
        {hasRef ? (
          <>
            {" · "}
            <bdi dir="ltr">{tr("reference", { reference: filing.referenceNumber })}</bdi>
          </>
        ) : null}
      </span>
    </div>
  );
}
