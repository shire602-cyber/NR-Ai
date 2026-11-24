import { ArrowRight, Check, FileSpreadsheet, Scale, Table2 } from "lucide-react";
import { Link } from "wouter";
import type { SectionProps } from "./types";
import { FREE_MIGRATION_HELP } from "./flags";
import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";
import { Num } from "./showcase/frame";
import { MIGRATION_SAMPLE, pick } from "./showcase/sample";
import { useMarketingText } from "./text";
import "./migration.css";

/** Brand names are never translated. */
const SOURCES = [
  ["excel", "Excel"],
  ["wafeq", "Wafeq"],
  ["zoho", "Zoho Books"],
  ["mazeed", "Mazeed"],
] as const;

export function Migration({ base, locale }: SectionProps) {
  const text = useMarketingText(locale);
  const { files, mapping, check } = MIGRATION_SAMPLE;
  return (
    <section
      id="migration"
      data-testid="section-migration"
      className="mz-band mz-band--sand mz-mig"
    >
      <div className="phase-wrap">
        <SectionHead title={text("hxMigTitle")} lead={text("hxMigLead")} />
        <Reveal>
          <ul className="mz-mig-cards" aria-label={text("hxMigSourcesLabel")}>
            {SOURCES.map(([source, name]) => (
              <li key={source}>
                <Link className="mz-mig-card" href={`${base}/migration-guides/${source}`}>
                  <bdi translate="no">{name}</bdi>
                  <span>
                    {text("hxMigCardGuide")} <ArrowRight aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delayMs={100}>
          <ol className="mz-mig-steps" aria-label={text("hxMigStepsLabel")}>
            <li className="mz-mig-step">
              <p className="mz-mig-n">{text("hxMigStepN", { n: 1 })}</p>
              <h3>{text("hxMigStep1Title")}</h3>
              <p>{text("hxMigStep1Desc")}</p>
              <div className="mz-mig-mock" translate="no">
                {files.map((file) => (
                  <span className="mz-mig-file" dir="ltr" key={file}>
                    <FileSpreadsheet aria-hidden="true" /> {file}
                  </span>
                ))}
              </div>
            </li>
            <li className="mz-mig-step">
              <p className="mz-mig-n">{text("hxMigStepN", { n: 2 })}</p>
              <h3>{text("hxMigStep2Title")}</h3>
              <p>{text("hxMigStep2Desc")}</p>
              <div className="mz-mig-mock" translate="no" lang={locale}>
                {mapping.map((m) => (
                  <span className="mz-mig-map" key={m.id}>
                    <Table2 aria-hidden="true" />
                    <span>{pick(m.from, locale)}</span>
                    <ArrowRight className="mz-mig-flip" aria-hidden="true" />
                    <b>{pick(m.to, locale)}</b>
                  </span>
                ))}
              </div>
            </li>
            <li className="mz-mig-step">
              <p className="mz-mig-n">{text("hxMigStepN", { n: 3 })}</p>
              <h3>{text("hxMigStep3Title")}</h3>
              <p>{text("hxMigStep3Desc")}</p>
              <div className="mz-mig-mock" translate="no" lang={locale}>
                <span className="mz-mig-map">
                  <Scale aria-hidden="true" />
                  <span>{pick(check.debit, locale)}</span>
                  <Num fils={check.fils} />
                </span>
                <span className="mz-mig-map">
                  <Scale aria-hidden="true" />
                  <span>{pick(check.credit, locale)}</span>
                  <Num fils={check.fils} />
                </span>
                <span className="mz-mig-ok">
                  <Check aria-hidden="true" /> {pick(check.balanced, locale)}
                </span>
              </div>
            </li>
          </ol>
          <p className="mz-mig-sample">{text("hxMigSample")}</p>
        </Reveal>
        <p className="mz-mig-help">
          {/* TODO(owner): confirm. The free-help line renders only when FREE_MIGRATION_HELP is on. */}
          {FREE_MIGRATION_HELP ? (
            <span className="mz-badge">{text("hxMigFreeHelp")}</span>
          ) : (
            <span>{text("hxMigGuides")}</span>
          )}{" "}
          <Link className="phase-textlink" href={`${base}/migration-guides`}>
            {text("hxMigLink")} <ArrowRight aria-hidden="true" />
          </Link>
        </p>
      </div>
    </section>
  );
}
