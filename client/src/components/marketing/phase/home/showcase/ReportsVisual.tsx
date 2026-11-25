import { VisualFrame, stagger, type VisualProps } from "./frame";
import {
  REPORT_AGEING,
  REPORT_EXPENSES,
  REPORT_LABELS,
  REPORT_REVENUE,
  REPORT_TABS,
  pick,
} from "./sample";

const W = 320;
const H = 120;
const MAX = Math.max(...REPORT_REVENUE, ...REPORT_EXPENSES);

function path(values: readonly number[]) {
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - (v / MAX) * (H - 8);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Report tabs, a two-line chart that draws itself in and a receivables ageing bar. */
export default function ReportsVisual({ locale, text, label }: VisualProps) {
  const revenue = path(REPORT_REVENUE);
  return (
    <VisualFrame text={text} label={label}>
      {() => (
        <div className="mz-show-paper mz-show-reports" lang={locale}>
          <ul className="mz-show-tabs">
            {REPORT_TABS.map((tab, i) => (
              <li className="mz-show-tab" data-active={i === 0 ? "true" : "false"} key={tab.id}>
                {pick(tab.label, locale)}
              </li>
            ))}
          </ul>
          <svg
            className="mz-show-chart"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            <path className="mz-show-area" d={`${revenue} L${W} ${H} L0 ${H} Z`} />
            <path
              className="mz-show-draw mz-show-line-b"
              pathLength={1}
              d={path(REPORT_EXPENSES)}
            />
            <path className="mz-show-draw mz-show-line-a" pathLength={1} d={revenue} />
          </svg>
          <p className="mz-show-legend">
            <span className="mz-show-key mz-show-key-a">{pick(REPORT_LABELS.revenue, locale)}</span>
            <span className="mz-show-key mz-show-key-b">
              {pick(REPORT_LABELS.expenses, locale)}
            </span>
          </p>
          <p className="mz-show-muted">{pick(REPORT_LABELS.ageing, locale)}</p>
          <ul className="mz-show-ageing">
            {REPORT_AGEING.map((bucket, i) => (
              <li
                className="mz-show-bucket mz-show-anim"
                style={{ ...stagger(i + 3), flexGrow: bucket.share }}
                key={bucket.id}
                data-bucket={bucket.id}
              >
                <span dir="ltr">{pick(bucket.label, locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </VisualFrame>
  );
}
