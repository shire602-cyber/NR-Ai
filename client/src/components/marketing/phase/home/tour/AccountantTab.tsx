import { useState } from "react";
import { money } from "./model";
import { TOUR_CLIENTS } from "./sample";
import { Sample, type TabProps } from "./shared";

function formatDue(iso: string, locale: TabProps["locale"]) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

export default function AccountantTab({ locale, text }: TabProps) {
  const [selected, setSelected] = useState(0);
  const client = TOUR_CLIENTS[selected];
  return (
    <div className="mz-tour-accountant">
      <div role="group" aria-label={text("hxTourClientsLabel")} className="mz-tour-clients">
        {TOUR_CLIENTS.map((c, i) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={i === selected}
            data-testid={`tour-client-${c.id}`}
            onClick={() => setSelected(i)}
          >
            <Sample>{c.name[locale]}</Sample>
          </button>
        ))}
      </div>
      <section className="mz-tour-summary" aria-live="polite" data-testid="tour-client-summary">
        <h4>
          <Sample>{client.name[locale]}</Sample>
        </h4>
        <dl>
          <div>
            <dt>{text("hxTourAcOpenInv")}</dt>
            <dd>
              {text("hxTourAcInvCount", {
                count: client.openInvoices,
                amount: money(client.openAmountFils),
              })}
            </dd>
          </div>
          <div>
            <dt>{text("hxTourAcVatDue")}</dt>
            <dd>{formatDue(client.vatDue, locale)}</dd>
          </div>
          <div>
            <dt>{text("hxTourAcReview")}</dt>
            <dd>{client.review === 0 ? text("hxTourAcAllClear") : String(client.review)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
