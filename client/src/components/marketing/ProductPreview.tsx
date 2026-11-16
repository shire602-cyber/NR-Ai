import {
  BarChart3,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Landmark,
  LayoutDashboard,
  Receipt,
  Users,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { SAMPLE, money } from "./sample";

export function Amount({ value, currency = true }: { value: number; currency?: boolean }) {
  return (
    <span className="mk-num">
      {currency ? "AED " : ""}
      {value < 0 ? `(${money(Math.abs(value))})` : money(value)}
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  paid: "success",
  sent: "info",
  draft: "neutral",
  matched: "success",
  review: "warning",
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const key = `marketing.status${status[0].toUpperCase()}${status.slice(1)}`;
  return (
    <span className="mk-badge" data-tone={STATUS_TONE[status] ?? "neutral"}>
      {t[key]}
    </span>
  );
}

function CashChart() {
  const { locale } = useTranslation();
  const values = SAMPLE.cashSeries;
  const width = 320;
  const height = 120;
  const min = Math.min(...values) * 0.9;
  const max = Math.max(...values) * 1.04;
  const points = values.map((v, i) => [
    (i / (values.length - 1)) * width,
    height - ((v - min) / (max - min)) * height,
  ]);
  const line = points
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const months = Array.from({ length: 6 }, (_, i) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-AE", { month: "short" }).format(
      new Date(Date.UTC(2026, i, 15))
    )
  );
  const [lastX, lastY] = points[points.length - 1];
  return (
    <div dir="ltr">
      <svg
        className="mk-chart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="mk-cash-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            x2={width}
            y1={height * f}
            y2={height * f}
            stroke="var(--hairline)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={area} fill="url(#mk-cash-fill)" />
        <path
          d={line}
          fill="none"
          stroke="var(--brand)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={lastX} cy={lastY} r="3.5" fill="var(--brand)" />
      </svg>
      <div className="mk-chart__months">
        {months.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * A faithful miniature of the signed-in app: the midnight sidebar, the
 * dashboard KPI tiles, the cash chart and the recent invoices list.
 */
export function ProductPreview() {
  const { t } = useTranslation();
  const nav = [
    { icon: LayoutDashboard, key: "marketing.previewNavDashboard", active: true },
    { icon: FileText, key: "marketing.previewNavInvoices" },
    { icon: Receipt, key: "marketing.previewNavReceipts" },
    { icon: Landmark, key: "marketing.previewNavBanking" },
    { icon: FileSpreadsheet, key: "marketing.previewNavVat" },
    { icon: Users, key: "marketing.previewNavPayroll" },
    { icon: BarChart3, key: "marketing.previewNavReports" },
  ];
  const kpis = [
    {
      key: "marketing.previewKpiRevenue",
      value: SAMPLE.revenue,
      delta: "marketing.previewKpiRevenueDelta",
      tone: "good",
    },
    {
      key: "marketing.previewKpiReceivables",
      value: SAMPLE.receivables,
      delta: "marketing.previewKpiReceivablesDelta",
      tone: "warn",
    },
    { key: "marketing.previewKpiCash", value: SAMPLE.cash, delta: "marketing.previewKpiCashDelta" },
    {
      key: "marketing.previewKpiVat",
      value: SAMPLE.vatPayable,
      delta: "marketing.previewKpiVatDelta",
    },
  ];
  return (
    <figure className="mk-app" aria-label={t["marketing.previewLabel"]}>
      <div className="mk-app__chrome" aria-hidden="true">
        <i />
        <i />
        <i />
        <span className="mk-app__caption">{t["marketing.previewCaption"]}</span>
      </div>
      <div className="mk-app__body">
        <div className="mk-app__side" aria-hidden="true">
          <div className="mk-app__company">
            <span>{"PT"}</span>
            <span translate="no">{"Pearl Trading LLC"}</span>
          </div>
          {nav.map(({ icon: Icon, key, active }) => (
            <div key={key} className="mk-app__nav" data-active={active ? "true" : undefined}>
              <Icon />
              {t[key]}
            </div>
          ))}
        </div>
        <div className="mk-app__main">
          <div className="mk-app__head">
            <div className="mk-app__title">{t["marketing.previewGreeting"]}</div>
            <span className="mk-app__pill">{t["marketing.previewPeriod"]}</span>
          </div>
          <div className="mk-kpis">
            {kpis.map((kpi) => (
              <div key={kpi.key} className="mk-kpi">
                <div className="mk-kpi__label">{t[kpi.key]}</div>
                <div className="mk-kpi__value mk-num">
                  <small>{"AED"}</small>
                  {money(kpi.value)}
                </div>
                <div className="mk-kpi__delta" data-tone={kpi.tone}>
                  {t[kpi.delta]}
                </div>
              </div>
            ))}
          </div>
          <div className="mk-app__grid">
            <div className="mk-panel">
              <div className="mk-panel__title">{t["marketing.previewChartTitle"]}</div>
              <div className="mk-panel__sub">{t["marketing.previewChartSub"]}</div>
              <CashChart />
            </div>
            <div className="mk-panel">
              <div className="mk-panel__title" style={{ marginBlockEnd: 6 }}>
                {t["marketing.previewRecentTitle"]}
              </div>
              <table className="mk-table">
                <thead>
                  <tr>
                    <th scope="col">{t["marketing.previewColNumber"]}</th>
                    <th scope="col">{t["marketing.previewColCustomer"]}</th>
                    <th scope="col">{t["marketing.previewColStatus"]}</th>
                    <th scope="col" className="mk-end">
                      {t["marketing.previewColTotal"]}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE.invoices.map((inv) => (
                    <tr key={inv.number}>
                      <td className="mk-num">{inv.number}</td>
                      <td className="mk-truncate" translate="no">
                        {inv.customer}
                      </td>
                      <td>
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className="mk-end">
                        <Amount value={inv.total} currency={false} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

/** The VAT 201 review panel used in the VAT spotlight. */
export function VatPreview() {
  const { t } = useTranslation();
  const net = SAMPLE.vat[0].vat + SAMPLE.vat[1].vat - SAMPLE.vat[2].vat;
  return (
    <div className="mk-card mk-vat" role="group" aria-label={t["marketing.vatPanelTitle"]}>
      <div className="mk-vat__head">
        <div>
          <div className="mk-panel__title" style={{ fontSize: 15 }}>
            {t["marketing.vatPanelTitle"]}
          </div>
          <div className="mk-panel__sub">{t["marketing.vatPanelPeriod"]}</div>
        </div>
        <span className="mk-app__pill">{t["marketing.previewCaption"]}</span>
      </div>
      <div
        style={{ overflowX: "auto" }}
        tabIndex={0}
        role="region"
        aria-label={t["marketing.vatPanelTitle"]}
      >
        <table className="mk-table">
          <thead>
            <tr>
              <th scope="col">{t["marketing.vatColBox"]}</th>
              <th scope="col">{t["marketing.vatColDescription"]}</th>
              <th scope="col" className="mk-end">
                {t["marketing.vatColAmount"]}
              </th>
              <th scope="col" className="mk-end">
                {t["marketing.vatColVat"]}
              </th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE.vat.map((row) => (
              <tr key={row.box}>
                <td>
                  <span className="mk-boxid mk-num">{row.box}</span>
                </td>
                <td className="mk-wrap">{t[row.key]}</td>
                <td className="mk-end">
                  <Amount value={row.amount} currency={false} />
                </td>
                <td className="mk-end">
                  <Amount value={row.vat} currency={false} />
                </td>
              </tr>
            ))}
            <tr className="mk-vat__total">
              <td>
                <span className="mk-boxid mk-num">{"14"}</span>
              </td>
              <td className="mk-wrap" style={{ color: "var(--ink)" }}>
                {t["marketing.vatRow14"]}
              </td>
              <td />
              <td className="mk-end">
                <Amount value={net} currency={false} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mk-vat__foot">
        <div className="mk-vat__status">
          <CheckCircle2 aria-hidden="true" />
          <span>{t["marketing.vatReconciled"]}</span>
          <span>{t["marketing.vatDifference"]}</span>
        </div>
        <span className="mk-btn mk-btn--secondary mk-btn--sm" aria-hidden="true">
          <FileSpreadsheet />
          {t["marketing.vatExport"]}
        </span>
      </div>
    </div>
  );
}
