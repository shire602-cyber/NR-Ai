import { useState } from "react";
import { X } from "lucide-react";
import { Link } from "wouter";
import { MARKETING_BRAND } from "@shared/marketing-brand";
import type { SectionProps } from "./types";
import { useMarketingText } from "./text";

const DISMISS_KEY = "mz-announcement-dismissed";

function wasDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    window.sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* storage blocked: dismissal lasts for this view only */
  }
}

export function AnnouncementBar({ base, locale }: SectionProps) {
  const text = useMarketingText(locale);
  const [dismissed, setDismissed] = useState(wasDismissed);
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
          <Link href={`${base}/uae-e-invoicing`}>{text("hxAnnLink")}</Link>
        </p>
        <button
          type="button"
          aria-label={text("hxAnnDismiss")}
          data-testid="button-announcement-dismiss"
          onClick={() => {
            rememberDismissed();
            setDismissed(true);
          }}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
