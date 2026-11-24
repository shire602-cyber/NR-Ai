import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Link } from "wouter";
import { marketingBrand } from "@shared/marketing-brand";
import type { Bilingual, SiteLocale } from "../content";
import { editorialDetails } from "./details";
import { editorialIndexes, editorialPages, type EditorialPath } from "./pages";

export default function EditorialContent({
  path,
  locale,
}: {
  path: EditorialPath;
  locale: SiteLocale;
}) {
  const base = `/${locale}`;
  const tr = (copy: Bilingual) => copy[locale === "ar" ? 1 : 0];
  const indexes: Partial<Record<EditorialPath, readonly EditorialPath[]>> = editorialIndexes;
  const entries = indexes[path];
  const details = editorialDetails[path];
  const email = details?.email;
  const subject = email?.subject && encodeURIComponent(tr(email.subject));

  return (
    <div className="phase-editorial" data-editorial-content>
      {entries && (
        <ul className="phase-feature-grid phase-editorial-grid">
          {entries.map((entry) => {
            const page = editorialPages[entry];
            return (
              <li key={entry}>
                <Link className="phase-card phase-feature-card" href={`${base}${entry}`}>
                  <h2>
                    {tr(page.title)} <ArrowUpRight aria-hidden="true" />
                  </h2>
                  <p>{tr(page.lead)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {details?.comparison && (
        <div className="phase-split phase-comparison">
          {details.comparison.map(({ title, body }) => (
            <section className="phase-card" key={title[0]}>
              <h2>
                {title[0] === marketingBrand ? (
                  <bdi lang="en" translate="no">
                    {marketingBrand}
                  </bdi>
                ) : (
                  tr(title)
                )}
              </h2>
              <p>{tr(body)}</p>
            </section>
          ))}
        </div>
      )}
      {(details?.sections || details?.checklist) && (
        <div className="phase-editorial-copy">
          {details.sections?.map(({ title, body }) => (
            <section key={title[0]}>
              <h2>{tr(title)}</h2>
              <p>{tr(body)}</p>
            </section>
          ))}
          {details.checklist && (
            <section>
              <h2>{tr(details.checklist.title)}</h2>
              <ol>
                {details.checklist.items.map((item) => (
                  <li key={item[0]}>{tr(item)}</li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
      {details?.sources && (
        <section className="phase-editorial-links">
          <h2>{tr(["References", "المراجع"])}</h2>
          <ul>
            {details.sources.map(({ title, url }) => (
              <li key={title[0]}>
                <a href={typeof url === "string" ? url : tr(url)}>{tr(title)}</a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {details?.related && (
        <nav className="phase-editorial-links" aria-labelledby="phase-related-title">
          <h2 id="phase-related-title">{tr(["Related pages", "صفحات ذات صلة"])}</h2>
          <ul>
            {details.related.map(({ path: target, title }) => (
              <li key={target}>
                <Link className="phase-textlink" href={`${base}${target}`}>
                  {tr(title)} <ArrowRight aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {email && (
        <a
          className="phase-button phase-primary"
          href={`mailto:${email.address}${subject ? `?subject=${subject}` : ""}`}
        >
          {tr(email.title)}
        </a>
      )}
    </div>
  );
}
