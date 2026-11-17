/**
 * E2: provider-neutral pieces of the Settings → E-invoicing provider card (five corners,
 * go-live / accreditation / register facts, mandate timeline, scope notes). Shared by the A-Cube
 * and Complyance cards and the neutral "Not connected" card, so removing a provider removes only
 * its own card. `prefix` keeps each card's data-testids stable.
 */
import type { ReactNode } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";

export interface GoLiveView {
  goLiveDate: string | null;
  appointAspBy: string | null;
  band: string | null;
  timeline: Record<string, { appointAspBy: string; goLive: string }>;
  reportWindowDays?: number;
}

export function Ltr({ children }: { children: ReactNode }) {
  return (
    <span dir="ltr" className="[unicode-bidi:isolate]">
      {children}
    </span>
  );
}

/** The five corners, in plain words. Corner 2 names the provider when there is one. */
export function FiveCorners({
  prefix,
  corner2Title,
  corner5Body,
}: {
  prefix: string;
  corner2Title: string;
  corner5Body: string;
}) {
  const { t } = useTranslation();
  const corners = [1, 2, 3, 4].map((n) => ({
    n,
    title: n === 2 ? corner2Title : t[`einvoicing.corner${n}Title`],
    body: t[`einvoicing.corner${n}Body`],
  }));
  return (
    <div data-testid={`${prefix}-five-corners`}>
      <ol className="grid gap-2 sm:grid-cols-4 sm:gap-0">
        {corners.map((c, i) => (
          <li key={c.n} className="flex items-stretch gap-2 sm:gap-0">
            <div
              className={cn(
                "flex-1 rounded-lg border border-border bg-card p-3",
                c.n === 2 && "border-brand-300 bg-brand-50 dark:border-brand-800 dark:bg-brand-950"
              )}
            >
              <p className="text-caption text-muted-foreground">
                {formatMessage(t["einvoicing.cornerLabel"], { n: c.n })}
              </p>
              <p className="text-small font-semibold text-foreground">{c.title}</p>
              <p className="mt-0.5 text-caption text-muted-foreground">{c.body}</p>
            </div>
            {i < corners.length - 1 && (
              <ArrowRight
                aria-hidden
                className="hidden h-4 w-4 shrink-0 self-center text-muted-foreground sm:mx-1 sm:block rtl:-scale-x-100"
              />
            )}
          </li>
        ))}
      </ol>
      <p className="mt-2 rounded-lg bg-surface-sunken px-3 py-2 text-caption text-muted-foreground">
        <span className="font-medium text-foreground">
          {formatMessage(t["einvoicing.cornerLabel"], { n: 5 })} · {t["einvoicing.corner5Title"]}
        </span>{" "}
        — {corner5Body}
      </p>
    </div>
  );
}

/** Go-live date, the provider's MoF accreditation number (when there is one) and the register. */
export function ProviderFacts({
  prefix,
  goLiveDate,
  accreditationLabel,
  accreditationNumber,
  registerUrl,
}: {
  prefix: string;
  goLiveDate: string | null;
  accreditationLabel?: string;
  accreditationNumber?: string | null;
  registerUrl: string;
}) {
  const { t, locale } = useTranslation();
  return (
    <dl className="grid gap-4 border-t border-border pt-5 text-small sm:grid-cols-3">
      <div>
        <dt className="text-caption text-muted-foreground">{t["einvoicing.goLive"]}</dt>
        <dd className="font-medium text-foreground" data-testid={`${prefix}-go-live`}>
          {goLiveDate ? formatDate(goLiveDate, locale) : t["einvoicing.goLiveUnset"]}
        </dd>
      </div>
      {accreditationNumber ? (
        <div>
          <dt className="text-caption text-muted-foreground">{accreditationLabel}</dt>
          <dd className="font-medium text-foreground" data-testid={`${prefix}-accreditation`}>
            <Ltr>{accreditationNumber}</Ltr>
          </dd>
        </div>
      ) : (
        <div>
          <dt className="text-caption text-muted-foreground">
            {t["einvoicing.providerAccreditedLabel"]}
          </dt>
          <dd className="text-foreground">{t["einvoicing.providerAccreditedBody"]}</dd>
        </div>
      )}
      <div>
        <dt className="text-caption text-muted-foreground">{t["einvoicing.registerLabel"]}</dt>
        <dd>
          <a
            href={registerUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 font-medium text-accent underline-offset-4 hover:underline"
            data-testid={`${prefix}-register-link`}
          >
            {t["einvoicing.registerLink"]}
            <ExternalLink aria-hidden className="h-3.5 w-3.5 rtl:-scale-x-100" />
          </a>
        </dd>
      </div>
    </dl>
  );
}

/** Mandate timeline per the published Ministerial Decisions, with the company's band marked. */
export function MandateTimeline({
  prefix,
  goLive,
  reportWindowText,
}: {
  prefix: string;
  goLive: GoLiveView;
  reportWindowText: string;
}) {
  const { t, locale } = useTranslation();
  return (
    <section aria-labelledby={`${prefix}-timeline-title`} className="space-y-2">
      <h3 id={`${prefix}-timeline-title`} className="text-small font-semibold text-foreground">
        {t["einvoicing.timelineTitle"]}
      </h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-small" data-testid={`${prefix}-timeline`}>
          <thead>
            <tr className="border-b border-border text-caption text-muted-foreground">
              <th scope="col" className="h-9 px-3 text-start font-medium">
                {t["einvoicing.timelineWho"]}
              </th>
              <th scope="col" className="h-9 px-3 text-start font-medium whitespace-nowrap">
                {t["einvoicing.timelineAppoint"]}
              </th>
              <th scope="col" className="h-9 px-3 text-start font-medium whitespace-nowrap">
                {t["einvoicing.timelineGoLive"]}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(["large", "standard", "government"] as const).map((band) => {
              const row = goLive.timeline[band];
              if (!row) return null;
              return (
                <tr key={band} className={cn(goLive.band === band && "bg-muted/50")}>
                  <td className="px-3 py-2.5 text-foreground">{t[`einvoicing.band_${band}`]}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {formatDate(row.appointAspBy, locale)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {formatDate(row.goLive, locale)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-caption text-muted-foreground">{t["einvoicing.timelineSource"]}</p>
      {goLive.reportWindowDays ? (
        <p className="text-caption text-muted-foreground" data-testid={`${prefix}-report-window`}>
          {formatMessage(reportWindowText, { days: goLive.reportWindowDays })}
        </p>
      ) : null}
    </section>
  );
}

export function ScopeNotes({ prefix }: { prefix: string }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby={`${prefix}-scope-title`} className="space-y-2">
      <h3 id={`${prefix}-scope-title`} className="text-small font-semibold text-foreground">
        {t["einvoicing.scopeNotesTitle"]}
      </h3>
      <ul className="list-disc space-y-1 ps-5 text-small text-muted-foreground">
        <li>{t["einvoicing.scopeB2b"]}</li>
        <li>{t["einvoicing.scopeB2c"]}</li>
        <li>{t["einvoicing.scopeCreditNotes"]}</li>
        <li>{t["einvoicing.scopeVoid"]}</li>
      </ul>
    </section>
  );
}

/** The honest "nothing is connected" panel with a Request connection mailto. */
export function RequestConnection({
  testId,
  buttonTestId,
  title,
  body,
  subject,
}: {
  testId: string;
  buttonTestId: string;
  title: string;
  body: string;
  subject: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg bg-surface-sunken p-4 text-small" data-testid={testId}>
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-muted-foreground">{body}</p>
      <Button asChild className="mt-3" data-testid={buttonTestId}>
        <a href={`mailto:hello@muhasib.ai?subject=${encodeURIComponent(subject)}`}>
          {t["einvoicing.requestConnection"]}
        </a>
      </Button>
    </div>
  );
}
