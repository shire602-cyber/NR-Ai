import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import type { SectionProps } from "../home/types";
import { SectionHead } from "../home/SectionHead";
import { useMarketingRich, useMarketingText, type MarketingKey } from "../home/text";
import {
  COMPARISON_ROWS,
  COMPARISON_SOURCES,
  VENDOR_NAME,
  visibleColumns,
  type ComparisonCell,
  type ComparisonColumn,
} from "../home/comparison";
import "./comparison.css";

export interface ComparisonTableProps extends SectionProps {
  /** Show only Muhasib and this competitor (/compare/wafeq, /compare/zoho); omit for all three. */
  focus?: "wafeq" | "zoho";
}

/** Placeholder glyph for "not confirmed"; the accessible label comes from the catalog. */
const DASH = "-";

/**
 * The competitor comparison: prices, feature rows, sources, the checked-on date, the VAT note and
 * the trademark disclaimer. It renders only on the /compare pages; rows come from home/comparison.ts.
 */
export function ComparisonTable({ base, locale, focus }: ComparisonTableProps) {
  const text = useMarketingText(locale);
  const rich = useMarketingRich(locale);
  const columns = visibleColumns(focus);
  const competitors = columns.filter((c): c is "wafeq" | "zoho" => c !== "muhasib");
  // Under the table: the detail pages on the hub, the other vendor's page on a focused one.
  const otherPages = (["wafeq", "zoho"] as const).filter((id) => id !== focus);

  const renderCell = (cell: ComparisonCell) =>
    cell.key ? (
      <>
        {rich(cell.key, cell.vars)}
        {cell.source && cell.sourceLabelKey && (
          <>
            {" "}
            <a
              className="phase-textlink"
              href={cell.source}
              target="_blank"
              rel="noopener noreferrer"
            >
              {text(cell.sourceLabelKey)}
            </a>
          </>
        )}
      </>
    ) : (
      <span role="img" aria-label={text("hxCmpDashLabel")}>
        {DASH}
      </span>
    );

  const header = (column: ComparisonColumn) =>
    column === "muhasib" ? (
      text("hxCmpColMuhasib")
    ) : (
      <bdi translate="no">{VENDOR_NAME[column]}</bdi>
    );

  return (
    <section id="compare" data-testid="section-compare" className="mz-band mz-band--light mz-cmp">
      <div className="phase-wrap">
        <SectionHead
          title={text("hxCmpTitle")}
          lead={focus ? text("hxCmpLeadOne", { vendor: VENDOR_NAME[focus] }) : text("hxCmpLead")}
        />

        <div className="mz-cmp-scroll" tabIndex={0} role="region" aria-label={text("hxCmpCaption")}>
          <table className="mz-cmp-table" data-columns={columns.length}>
            <caption className="mz-cmp-caption">
              {focus
                ? text("hxCmpCaptionOne", { vendor: VENDOR_NAME[focus] })
                : text("hxCmpCaption")}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="mz-cmp-feature">
                  {text("hxCmpColFeature")}
                </th>
                {columns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className={column === "muhasib" ? "mz-cmp-us" : undefined}
                    data-column={column}
                  >
                    {header(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.id} data-row={row.id}>
                  <th scope="row" className="mz-cmp-feature">
                    {text(row.labelKey)}
                  </th>
                  {columns.map((column) => (
                    <td
                      key={column}
                      className={column === "muhasib" ? "mz-cmp-us" : undefined}
                      data-column={column}
                      data-dash={row.cells[column].key ? undefined : "true"}
                    >
                      {renderCell(row.cells[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mz-cmp-foot" data-testid="compare-footnote">
          <p>{text("hxCmpFootAsOf")}</p>
          <p className="mz-cmp-sources">
            <span>{text("hxCmpFootSources")}:</span>
            {competitors.map((id) => (
              <a
                key={id}
                href={COMPARISON_SOURCES[id].url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {text(COMPARISON_SOURCES[id].labelKey as MarketingKey)}
              </a>
            ))}
          </p>
          <p>{text("hxCmpFootMarks")}</p>
        </div>

        <p className="mz-cmp-links">
          {otherPages.map((id) => (
            <Link
              key={id}
              className="phase-textlink"
              href={`${base}/compare/${COMPARISON_SOURCES[id].path}`}
            >
              {text(COMPARISON_SOURCES[id].pageKey as MarketingKey)}{" "}
              <ArrowRight aria-hidden="true" />
            </Link>
          ))}
        </p>
      </div>
    </section>
  );
}
