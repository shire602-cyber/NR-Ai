import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  Check,
  FileCheck2,
  Handshake,
  Settings,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { MARKETING_BRAND } from "@shared/marketing-brand";
import type { SectionProps } from "./types";
import { useMarketingText, type MarketingKey, type MarketingText } from "./text";
import { useCountUp, useInView } from "./motion";
import { PROVIDER_FEES_CONFIRMED_ZERO } from "./flags";
import {
  DEADLINE_SOURCES,
  DEADLINE_SEGMENTS,
  DEFAULT_SEGMENT,
  PENALTY_TEXT_VARS,
  deadlineState,
  formatDeadlineDate,
  timelineLayout,
  type DeadlineSegment,
  type MilestoneKey,
  type MilestoneState,
} from "./deadlines";
import "./deadline.css";

export interface DeadlineFinderProps extends SectionProps {
  /** Heading level of the title (default 2). Use 1 where the finder opens a page. */
  headingLevel?: 1 | 2 | 3;
  /** Drop the heading block and the three steps (for pages that provide their own). */
  compact?: boolean;
}

const SEGMENT_KEYS: Record<DeadlineSegment, MarketingKey> = {
  large: "hxDlSegLarge",
  small: "hxDlSegSmall",
  government: "hxDlSegGov",
};
const MILESTONE_KEYS: Record<MilestoneKey, MarketingKey> = {
  appoint: "hxDlMsAppoint",
  live: "hxDlMsLive",
};
const DAY_KEYS: Record<string, MarketingKey> = {
  one: "hxDlDayOne",
  two: "hxDlDayTwo",
  few: "hxDlDayFew",
  many: "hxDlDayMany",
  other: "hxDlDayOther",
  zero: "hxDlDayOther",
};
const STEPS: readonly { icon: LucideIcon; key: MarketingKey }[] = [
  { icon: Settings, key: "hxDlStep1" },
  { icon: Handshake, key: "hxDlStep2" },
  { icon: FileCheck2, key: "hxDlStep3" },
];

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // The initial state is read on mount; refresh it so the countdown rolls over at Dubai midnight.
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function dayCount(text: MarketingText, locale: "en" | "ar", n: number): string {
  const category = new Intl.PluralRules(locale).select(n);
  return text(DAY_KEYS[category] ?? "hxDlDayOther", { n });
}

function milestoneStatus(m: MilestoneState, next: MilestoneState | null, other: MilestoneState) {
  if (m.passed) {
    if (m.key === "live") return { key: "hxDlMandatoryNow" as const, tone: "warn" };
    return {
      key: other.passed ? ("hxDlPassed" as const) : ("hxDlPassedAct" as const),
      tone: "warn",
    };
  }
  return next?.key === m.key
    ? { key: "hxDlStatusNext" as const, tone: "next" }
    : { key: "hxDlStatusUpcoming" as const, tone: "later" };
}

function SegmentControl({
  value,
  onChange,
  text,
  rtl,
}: {
  value: DeadlineSegment;
  onChange: (value: DeadlineSegment) => void;
  text: MarketingText;
  rtl: boolean;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const select = (index: number) => {
    const count = DEADLINE_SEGMENTS.length;
    const target = (index + count) % count;
    onChange(DEADLINE_SEGMENTS[target]);
    buttons.current[target]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = DEADLINE_SEGMENTS.indexOf(value);
    // In RTL the first option sits on the right, so ArrowLeft moves forward.
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const backward = rtl ? "ArrowRight" : "ArrowLeft";
    if (event.key === forward || event.key === "ArrowDown") select(index + 1);
    else if (event.key === backward || event.key === "ArrowUp") select(index - 1);
    else if (event.key === "Home") select(0);
    else if (event.key === "End") select(DEADLINE_SEGMENTS.length - 1);
    else return;
    event.preventDefault();
  };
  return (
    <div
      className="mz-dl-segments"
      role="radiogroup"
      aria-label={text("hxDlSegLabel")}
      data-testid="deadline-segments"
      onKeyDown={onKeyDown}
    >
      {DEADLINE_SEGMENTS.map((segment, index) => {
        const active = segment === value;
        return (
          <button
            key={segment}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            data-value={segment}
            data-active={active}
            data-testid={`deadline-segment-${segment}`}
            className="mz-dl-segment"
            onClick={() => onChange(segment)}
          >
            {text(SEGMENT_KEYS[segment])}
          </button>
        );
      })}
    </div>
  );
}

function ExternalLink({
  href,
  children,
  hint,
}: {
  href: string;
  children: ReactNode;
  hint: string;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="mz-dl-link">
      {children}
      <span className="mz-dl-sr"> {hint}</span>
    </a>
  );
}

export function DeadlineFinder({
  base,
  locale,
  headingLevel = 2,
  compact = false,
}: DeadlineFinderProps) {
  const text = useMarketingText(locale);
  const brand = MARKETING_BRAND.name[locale];
  const now = useNow();
  const rtl = locale === "ar";
  const [segment, setSegment] = useState<DeadlineSegment>(DEFAULT_SEGMENT);
  const stageRef = useRef<HTMLDivElement>(null);
  const inView = useInView(stageRef);
  const headingId = useId();

  const state = deadlineState(segment, now);
  const layout = timelineLayout(segment, now);
  const { appoint, live, next } = state;
  const count = Math.round(useCountUp(next?.daysLeft ?? 0, { enabled: inView }));
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3";

  const milestones = [appoint, live] as const;
  const actNow = appoint.passed && !live.passed;
  const tone = !next ? "warn" : actNow ? "act" : "ok";

  let sentence: string;
  if (!next) sentence = text("hxDlAllPassed");
  else if (next.daysLeft === 0)
    sentence = text(next.key === "appoint" ? "hxDlTodayAppoint" : "hxDlTodayLive");
  else
    sentence = text(next.key === "appoint" ? "hxDlNextAppoint" : "hxDlNextLive", {
      days: dayCount(text, locale, next.daysLeft),
    });

  return (
    <section
      id="e-invoicing-deadlines"
      data-testid="section-e-invoicing-deadlines"
      className="mz-band mz-band--dark mz-dl"
      dir={rtl ? "rtl" : "ltr"}
      aria-labelledby={compact ? undefined : headingId}
      aria-label={compact ? text("hxDlTitle") : undefined}
    >
      <div className="phase-wrap">
        {!compact && (
          <header className="mz-head">
            <p className="mz-eyebrow">{text("hxDlEyebrow")}</p>
            <Heading className="mz-h2" id={headingId}>
              {text("hxDlTitle")}
            </Heading>
            <p className="mz-lead">{text("hxDlLead")}</p>
          </header>
        )}

        <SegmentControl value={segment} onChange={setSegment} text={text} rtl={rtl} />

        <div className="mz-dl-stage" ref={stageRef} data-ready={inView ? "true" : "false"}>
          <div
            className="mz-dl-result"
            data-tone={tone}
            data-testid="deadline-result"
            aria-live="polite"
            aria-atomic="true"
          >
            <p className="mz-dl-note">{text("hxDlIfInScope")}</p>
            {next ? (
              <span className="mz-dl-count" aria-hidden="true" data-testid="deadline-count">
                {count}
              </span>
            ) : (
              <span className="mz-dl-flag" data-tone="warn" data-testid="deadline-flag">
                <TriangleAlert aria-hidden="true" /> {text("hxDlMandatoryNow")}
              </span>
            )}
            {actNow && (
              <span className="mz-dl-flag" data-tone="warn" data-testid="deadline-flag">
                <TriangleAlert aria-hidden="true" /> {text("hxDlPassedAct")}
              </span>
            )}
            <p className="mz-dl-sentence" data-testid="deadline-sentence">
              {sentence}
            </p>
            {actNow && <p className="mz-dl-note">{text("hxDlActNote")}</p>}
          </div>

          <div className="mz-dl-timeline" role="group" aria-label={text("hxDlTimelineLabel")}>
            <div
              className="mz-dl-track"
              style={
                {
                  "--mz-dl-today": `${layout.today}%`,
                  "--mz-dl-appoint": `${layout.appoint}%`,
                  "--mz-dl-live": `${layout.live}%`,
                } as CSSProperties
              }
            >
              <span className="mz-dl-fill" />
              <span className="mz-dl-pin mz-dl-pin--today" data-testid="deadline-today">
                <span className="mz-dl-pin-label">{text("hxDlToday")}</span>
                <span className="mz-dl-dot" />
              </span>
              {milestones.map((m) => {
                const status = milestoneStatus(m, next, m.key === "appoint" ? live : appoint);
                return (
                  <span
                    key={m.key}
                    className={`mz-dl-pin mz-dl-pin--${m.key}`}
                    data-tone={status.tone}
                    aria-hidden="true"
                  >
                    <span className="mz-dl-node">
                      {m.passed ? <Check /> : <span className="mz-dl-node-core" />}
                    </span>
                  </span>
                );
              })}
            </div>

            <ol className="mz-dl-milestones">
              {milestones.map((m) => {
                const status = milestoneStatus(m, next, m.key === "appoint" ? live : appoint);
                return (
                  <li
                    key={m.key}
                    className="mz-dl-milestone"
                    data-tone={status.tone}
                    data-testid={`deadline-milestone-${m.key}`}
                  >
                    <span className="mz-dl-ms-name">{text(MILESTONE_KEYS[m.key])}</span>
                    <time className="mz-dl-ms-date" dateTime={m.date}>
                      {formatDeadlineDate(m.date, locale)}
                    </time>
                    <span className="mz-dl-ms-status">{text(status.key)}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <div className="mz-dl-penalty" data-testid="deadline-penalty">
          <TriangleAlert aria-hidden="true" />
          <p>{text("hxDlPenalty", PENALTY_TEXT_VARS)}</p>
        </div>

        {!compact && (
          <ol className="mz-dl-steps" aria-label={text("hxDlStepsLabel")}>
            {STEPS.map(({ icon: Icon, key }) => (
              <li key={key} className="mz-dl-step">
                <span className="mz-dl-step-icon">
                  <Icon aria-hidden="true" />
                </span>
                <span>{text(key, { brand })}</span>
              </li>
            ))}
          </ol>
        )}

        <div className="mz-dl-included">
          <p>{text("hxDlIncluded")}</p>
          <p>{text("hxDlBuiltIn", { brand })}</p>
          {/* TODO(owner): confirm whether the accredited provider charges separate fees; do not claim zero fees */}
          {PROVIDER_FEES_CONFIRMED_ZERO && <p>{text("hxDlFeesZero")}</p>}
        </div>

        <Link
          className="phase-button phase-primary"
          href={`${base}/tools/e-invoicing-readiness`}
          data-testid="deadline-cta"
        >
          {text("hxDlCta")} <ArrowRight aria-hidden="true" className="mz-dl-arrow" />
        </Link>

        <p className="mz-dl-footnote" data-testid="deadline-sources">
          {text("hxDlScopeNote")} {text("hxDlSourcesIntro")}{" "}
          <ExternalLink href={DEADLINE_SOURCES.fta} hint={text("hxDlNewTab")}>
            {text("hxDlSourceFta")}
          </ExternalLink>
          {" | "}
          <ExternalLink href={DEADLINE_SOURCES.mof} hint={text("hxDlNewTab")}>
            {text("hxDlSourceMof")}
          </ExternalLink>
          {" | "}
          <ExternalLink href={DEADLINE_SOURCES.scope[locale]} hint={text("hxDlNewTab")}>
            {text("hxDlSourceScope")}
          </ExternalLink>
          {" | "}
          <ExternalLink href={DEADLINE_SOURCES.penalty} hint={text("hxDlNewTab")}>
            {text("hxDlSourcePenalty")}
          </ExternalLink>
        </p>
      </div>
    </section>
  );
}
