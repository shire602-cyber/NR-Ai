/**
 * WQ5: the numbered EmaraTax steps for appointing the accredited partner. Shown in Settings and
 * on the no-login approver page. Provider-neutral: the partner's name comes from the server.
 */
import { formatMessage, useTranslation } from "@/lib/i18n";

export interface StepsPartner {
  displayName: string;
  legalName: string;
  accreditationNumber: string;
}

/** Renders `template` with the `{slot}` placeholder replaced by a React node. */
function withSlot(template: string, slot: string, node: React.ReactNode): React.ReactNode {
  const marker = `{${slot}}`;
  const at = template.indexOf(marker);
  if (at < 0) return template;
  return (
    <>
      {template.slice(0, at)}
      {node}
      {template.slice(at + marker.length)}
    </>
  );
}

export function EmaraTaxSteps({
  partner,
  companyName,
  withDone = false,
}: {
  partner: StepsPartner | null;
  companyName: string;
  withDone?: boolean;
}) {
  const { t } = useTranslation();
  const partnerLabel = partner
    ? formatMessage(t["einvoicing.appoint.partnerLabel"], {
        name: partner.displayName,
        legal: partner.legalName,
        number: partner.accreditationNumber,
      })
    : t["einvoicing.appoint.partnerUnknown"];
  const steps = [
    formatMessage(t["einvoicing.appoint.step1"], { company: companyName }),
    t["einvoicing.appoint.step2"],
    // Sweep: the partner's display / legal names are proper names; they render in a
    // translate="no" span so Arabic text around them is not read as untranslated copy.
    withSlot(t["einvoicing.appoint.step3"], "partner", <span translate="no">{partnerLabel}</span>),
    t["einvoicing.appoint.step4"],
    ...(withDone ? [t["einvoicing.appoint.step5Done"]] : [t["einvoicing.appoint.step5"]]),
  ];
  return (
    <div className="space-y-2">
      <ol className="space-y-2" data-testid="emaratax-steps">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-small text-foreground">
            <span
              aria-hidden
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-caption font-semibold text-brand-700 tabular-nums dark:bg-brand-950 dark:text-brand-300"
            >
              {i + 1}
            </span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
      <p className="text-caption text-muted-foreground">{t["einvoicing.appoint.menuNote"]}</p>
    </div>
  );
}
