import { useState } from "react";
import { X } from "lucide-react";
import { Link } from "wouter";
import { MARKETING_BRAND } from "@shared/marketing-brand";
import { featurePath } from "../route-content";
import type { SectionProps } from "./types";
import { useMarketingText } from "./text";

export function AnnouncementBar({ base, locale }: SectionProps) {
  const text = useMarketingText(locale);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <section
      id="announcement"
      data-testid="section-announcement"
      className="mz-announcement"
      aria-label={text("hxAnnLabel")}
    >
      <div className="phase-wrap mz-announcement-inner">
        <p>
          {text("hxAnnText", { brand: MARKETING_BRAND.name[locale] })}{" "}
          <Link href={`${base}${featurePath("e-invoicing")}`}>{text("hxAnnLink")}</Link>
        </p>
        <button type="button" aria-label={text("hxAnnDismiss")} onClick={() => setDismissed(true)}>
          <X aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
