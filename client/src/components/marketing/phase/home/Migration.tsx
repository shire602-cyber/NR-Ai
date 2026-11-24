import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import type { SectionProps } from "./types";
import { FREE_MIGRATION_HELP } from "./flags";
import { SectionHead } from "./SectionHead";
import { useMarketingText } from "./text";

const SOURCES = [
  ["excel", "Excel"],
  ["wafeq", "Wafeq"],
  ["mazeed", "Mazeed"],
  ["zoho", "Zoho Books"],
] as const;

export function Migration({ base, locale }: SectionProps) {
  const text = useMarketingText(locale);
  return (
    <section id="migration" data-testid="section-migration" className="mz-band mz-band--sand">
      <div className="phase-wrap phase-split phase-migration">
        <div>
          <SectionHead title={text("hxMigTitle")} lead={text("hxMigLead")} />
          {FREE_MIGRATION_HELP && <p className="mz-badge">{text("hxMigFreeHelp")}</p>}
          <Link className="phase-textlink" href={`${base}/migration-guides`}>
            {text("hxMigLink")} <ArrowRight aria-hidden="true" />
          </Link>
        </div>
        <ul>
          {SOURCES.map(([source, name]) => (
            <li key={source}>
              <Link href={`${base}/migration-guides/${source}`}>
                <bdi translate="no">{name}</bdi>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
