import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import type { SectionProps } from "./types";
import { SectionHead } from "./SectionHead";
import { useMarketingRich, useMarketingText, type MarketingKey } from "./text";
import {
  COMPARISON_ROWS,
  COMPARISON_SOURCES,
  VENDOR_NAME,
  visibleColumns,
  type ComparisonCell,
  type ComparisonColumn,
} from "./comparison";
import "./comparison.css";

export interface ComparisonTableProps extends SectionProps {
  /** Show only Muhasib and this competitor (for the /compare pages). */
  focus?: "wafeq" | "zoho";
  headingLevel?: 1 | 2 | 3;
}

/** Placeholder glyph for "not confirmed"; the accessible label comes from the catalog. */
const DASH = "-";

export function ComparisonTable({ base, locale, focus, headingLevel = 2 }: ComparisonTableProps) {
  const text = useMarketingText(locale);
  const rich = useMarketingRich(locale);
  const columns = visibleColumns(focus);
  const competitors = columns.filter((c): c is "wafeq" | "zoho" => c !== "muhasib");
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3";

  const renderCell = (cell: ComparisonCell) =>
    cell.key ? (
      rich(cell.key, cell.vars)
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
        {headingLevel === 2 ? (
          <SectionHead title={text("hxCmpTitle")} lead={text("hxCmpLead")} />
        ) : (
          <header className="mz-head">
            <Heading className="mz-h2">{text("hxCmpTitle")}</Heading>
            <p className="mz-lead">{text("hxCmpLead")}</p>
          </header>
        )}

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
          {competitors.map((id) => (
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
