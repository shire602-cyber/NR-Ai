import { useMemo } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownView } from "@/components/help/MarkdownView";
import { PublicShell } from "@/components/PublicShell";
import { useI18n } from "@/lib/i18n";
import { getArticle } from "@/lib/help/articles";
import { parseBlocks, plainText } from "@/lib/help/markdown-lite";
import { messages as pageMessages } from "./HelpArticle.i18n";

export default function HelpArticle() {
  const tr = pageMessages.useT();
  const locale = useI18n((s) => s.locale);
  const [, params] = useRoute("/help/:slug");
  const slug = params?.slug ?? "";
  const article = getArticle(locale, slug);
  const toc = useMemo(() => (article ? parseBlocks(article.body).filter((b) => b.t === "h2") : []), [article]);

  return (
    <PublicShell>
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <Link href="/help" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          {tr("back")}
        </Link>
        {!article ? (
          <div className="mt-6" data-testid="help-not-found">
            <h1 className="text-3xl font-bold tracking-tight">{tr("notFoundTitle")}</h1>
            <p className="mt-3 text-muted-foreground">{tr("notFoundBody")}</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-10 lg:grid-cols-[1fr_16rem]">
            <article lang={article.locale} dir={article.locale === "ar" ? "rtl" : "ltr"} className="min-w-0">
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl" data-testid="help-article-title">
                {article.title}
              </h1>
              {article.summary && <p className="mt-3 text-lg text-muted-foreground">{article.summary}</p>}
              {article.locale !== locale && <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">{tr("translationNote")}</p>}
              <MarkdownView source={article.body} />
              <div className="mt-10 flex flex-wrap items-center gap-3 border-t pt-6">
                <span className="text-sm text-muted-foreground">{tr("stillStuck")}</span>
                <a href="mailto:support@muhasib.ai?subject=Help%20article%20question">
                  <Button size="sm" variant="outline">
                    {tr("contact")}
                  </Button>
                </a>
              </div>
            </article>
            <aside className="space-y-6 text-sm lg:sticky lg:top-6 lg:self-start">
              {toc.length > 0 && (
                <nav aria-label={tr("onThisPage")}>
                  <h2 className="mb-2 font-semibold">{tr("onThisPage")}</h2>
                  <ul className="space-y-1.5">
                    {toc.map((b) =>
                      b.t === "h2" ? (
                        <li key={b.id}>
                          <a href={`#${b.id}`} className="inline-flex min-h-[28px] items-center text-muted-foreground hover:text-foreground">
                            {plainText(b.c) || b.id}
                          </a>
                        </li>
                      ) : null
                    )}
                  </ul>
                </nav>
              )}
              {article.related.length > 0 && (
                <nav aria-label={tr("related")}>
                  <h2 className="mb-2 font-semibold">{tr("related")}</h2>
                  <ul className="space-y-1.5">
                    {article.related.map((slugRef) => {
                      const rel = getArticle(locale, slugRef);
                      return rel ? (
                        <li key={slugRef}>
                          <Link href={`/help/${slugRef}`} className="inline-flex min-h-[28px] items-center text-primary hover:underline">
                            {rel.title}
                          </Link>
                        </li>
                      ) : null;
                    })}
                  </ul>
                </nav>
              )}
            </aside>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
