import {
  BarChart3,
  CheckCircle2,
  ChevronsUpDown,
  FileSpreadsheet,
  FileText,
  Landmark,
  LayoutDashboard,
  Receipt,
  Users,
} from "lucide-react";
import "./product-preview.css";
import { useTranslation } from "@/lib/i18n";
import { BrandMark } from "@/components/BrandMark";
import { buttonVariants } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { StatusBadge as Status, type StatusTone } from "@/components/ui/status-badge";
import { SAMPLE } from "./sample";

/** Sample amounts go through the shared Money component (one formatter for the whole product). */
export function Amount({ value, currency = true }: { value: number; currency?: boolean }) {
  return <Money amount={value} showCurrency={currency} />;
}

const STATUS_TONE: Record<string, StatusTone> = {
  paid: "success",
  sent: "info",
  draft: "neutral",
  matched: "success",
  review: "warning",
};

/** The app's StatusBadge with the sample statuses' locale labels. */
export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const key = `marketing.status${status[0].toUpperCase()}${status.slice(1)}`;
  return (
    <Status tone={STATUS_TONE[status] ?? "neutral"} className="mk-status">
      {t[key]}
    </Status>
  );
}

/**
 * Revenue vs expenses, drawn like the dashboard's trends chart after the CTO
 * review: straight segments (no overshoot), 1.5px strokes, a faint area under
 * revenue, dashed horizontal gridlines only, revenue in brand and expenses neutral.
 */
function TrendsChart() {
  const { t, locale } = useTranslation();
  const { revenue, expenses } = SAMPLE.trends;
  const width = 320;
  const height = 120;
  const max = Math.max(...revenue, ...expenses) * 1.08;
  const min = Math.min(...revenue, ...expenses) * 0.82;
  const toPoints = (values: readonly number[]) =>
    values.map((v, i) => [
      (i / (values.length - 1)) * width,
      height - ((v - min) / (max - min)) * height,
    ]);
  const path = (points: number[][]) =>
    points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const revenueLine = path(toPoints(revenue));
  const expensesLine = path(toPoints(expenses));
  const months = Array.from({ length: 6 }, (_, i) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-AE", {
      month: "short",
      numberingSystem: "latn",
    }).format(new Date(Date.UTC(2026, i, 15)))
  );
  return (
    <div>
      <div className="mk-legend">
        <span data-series="revenue">{t["marketing.previewSeriesRevenue"]}</span>
        <span data-series="expenses">{t["marketing.previewSeriesExpenses"]}</span>
      </div>
      <div dir="ltr">
        <svg
          className="mk-chart"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1="0"
              x2={width}
              y1={height * f}
              y2={height * f}
              stroke="hsl(var(--border))"
              strokeWidth="1"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path
            d={`${revenueLine} L${width} ${height} L0 ${height} Z`}
            fill="hsl(var(--chart-1))"
            fillOpacity="0.08"
          />
          <path
            d={expensesLine}
            fill="none"
            className="mk-chart__expenses"
            strokeWidth="1.5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={revenueLine}
            fill="none"
            stroke="hsl(var(--chart-1))"
            strokeWidth="1.5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="mk-chart__months">
          {months.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A faithful miniature of the signed-in app as it looks after the D2 design
 * pass: the light sidebar (app sidebar tokens), the "Overview" header with the
 * period summary, the Cash / Receivables / Payables / VAT strip with neutral
 * figures, the trends chart and the recent invoices list. Sample data only.
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
    { key: "marketing.previewKpiCash", value: SAMPLE.cash, sub: "marketing.previewKpiCashDelta" },
    {
      key: "marketing.previewKpiReceivables",
      value: SAMPLE.receivables,
      sub: "marketing.previewKpiReceivablesDelta",
    },
    {
      key: "marketing.previewKpiPayables",
      value: SAMPLE.payables,
      sub: "marketing.previewKpiPayablesDelta",
    },
    {
      key: "marketing.previewKpiVat",
      value: SAMPLE.vatPayable,
      sub: "marketing.previewKpiVatDelta",
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
          <div className="mk-app__brand">
            <BrandMark size="sm" />
            <span translate="no" lang="en" dir="ltr">
              {"Muhasib"}
              <span className="mk-brand__dot">{".ai"}</span>
            </span>
          </div>
          <div className="mk-app__company">
            <span>{"P"}</span>
            <span translate="no">{"Pearl Trading LLC"}</span>
            <ChevronsUpDown />
          </div>
          <div className="mk-app__group">{t["marketing.previewNavGroup"]}</div>
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
            <div className="mk-app__period">{t["marketing.previewPeriod"]}</div>
          </div>
          <div className="mk-kpis">
            {kpis.map((kpi) => (
              <div key={kpi.key} className="mk-kpi">
                <div className="mk-kpi__label">{t[kpi.key]}</div>
                <div className="mk-kpi__value">
                  <Amount value={kpi.value} />
                </div>
                <div className="mk-kpi__delta">{t[kpi.sub]}</div>
              </div>
            ))}
          </div>
          <div className="mk-app__grid">
            <div className="mk-panel">
              <div className="mk-panel__title">{t["marketing.previewChartTitle"]}</div>
              <div className="mk-panel__sub">{t["marketing.previewChartSub"]}</div>
              <TrendsChart />
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
        <span className={buttonVariants({ variant: "outline", size: "sm" })} aria-hidden="true">
          <FileSpreadsheet />
          {t["marketing.vatExport"]}
        </span>
      </div>
    </div>
  );
}
