import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { ArrowRight, HelpCircle, LifeBuoy, Mail, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PublicShell } from "@/components/PublicShell";
import { useI18n } from "@/lib/i18n";
import {
  HELP_CATEGORIES,
  listArticles,
  type HelpArticleData,
  type HelpCategory,
} from "@/lib/help/articles";
import { helpQueryFromSearch, searchArticles } from "@/lib/help/search";
import { messages as pageMessages } from "./HelpCenter.i18n";

const getSlaItems = () => [
  pageMessages.t("launchOnboardingSupportForSetupMigration"),
  pageMessages.t("migrationReviewCoversMazeedWafeqZoho"),
  pageMessages.t("emailSupportForFreeAndStarter"),
  pageMessages.t("enterpriseSupportTermsResponseWindowsAnd"),
  pageMessages.t("criticalAccountingWorkflowIssuesAreTriaged"),
];

function ArticleLink({ article }: { article: HelpArticleData }) {
  return (
    <Link
      href={`/help/${article.slug}`}
      className="block rounded-md p-2 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`help-link-${article.slug}`}
    >
      <span className="block font-medium text-primary">{article.title}</span>
      {article.summary && (
        <span className="mt-0.5 block text-sm text-muted-foreground">{article.summary}</span>
      )}
    </Link>
  );
}

export default function HelpCenter() {
  const tr = pageMessages.useT();
  const locale = useI18n((s) => s.locale);
  const search = useSearch();
  // /help?q=VAT opens with that search already run; typing still works as before.
  const urlQuery = helpQueryFromSearch(search);
  const [query, setQuery] = useState(urlQuery);
  useEffect(() => {
    if (urlQuery) setQuery(urlQuery);
  }, [urlQuery]);
  const articles = useMemo(() => listArticles(locale), [locale]);
  const hits = useMemo(
    () => (query.trim() ? searchArticles(articles, query) : null),
    [articles, query]
  );
  const grouped = useMemo(() => {
    const map = new Map<HelpCategory, HelpArticleData[]>();
    for (const category of HELP_CATEGORIES) map.set(category, []);
    for (const a of articles) map.get(a.category as HelpCategory)?.push(a);
    return Array.from(map).filter(([, list]) => list.length > 0);
  }, [articles]);

  return (
    <PublicShell>
      <section className="border-b bg-muted/30">
        <div className="container mx-auto max-w-6xl px-4 py-12 md:py-16">
          <Badge variant="outline" className="mb-5">
            {tr("helpCenter")}
          </Badge>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">
            {tr("launchSupportForUaeAccountingTeams")}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            {tr("practicalSetupGuidesForInvoicesVat")}
          </p>
          <form
            role="search"
            onSubmit={(e) => e.preventDefault()}
            className="relative mt-8 max-w-xl"
          >
            <label htmlFor="help-search" className="sr-only">
              {tr("searchLabel")}
            </label>
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="help-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr("searchPlaceholder")}
              className="h-11 ps-9"
              data-testid="input-help-search"
            />
          </form>
        </div>
      </section>

      <section className="container mx-auto max-w-6xl px-4 py-10" aria-live="polite">
        {hits ? (
          <div data-testid="help-results">
            <p className="mb-4 text-sm text-muted-foreground" role="status">
              {tr.plural("resultsCount", hits.length)}
            </p>
            {hits.length === 0 ? (
              <p className="text-muted-foreground" data-testid="help-no-results">
                {tr("noResults")}
              </p>
            ) : (
              <ul className="grid gap-1 md:grid-cols-2">
                {hits.map(({ article }) => (
                  <li key={article.slug}>
                    <ArticleLink article={article} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3" data-testid="help-categories">
            {grouped.map(([category, list]) => (
              <div key={category}>
                <h2 className="mb-2 text-lg font-semibold">
                  {tr(`cat_${category.replace(/-/g, "_")}` as "cat_sales")}
                </h2>
                <ul>
                  {list.map((article) => (
                    <li key={article.slug}>
                      <ArticleLink article={article} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="border-y bg-muted/30">
        <div className="container mx-auto grid max-w-6xl gap-8 px-4 py-14 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-semibold">
              <LifeBuoy className="h-6 w-6 text-primary" />
              {tr("supportAndSlaPosture")}
            </h2>
            <p className="mt-3 text-muted-foreground">{tr("weKeepLaunchPromisesSpecificFormal")}</p>
          </div>
          <div className="grid gap-3">
            {getSlaItems().map((item) => (
              <div key={item} className="flex gap-3 rounded-lg border bg-background p-4 text-sm">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span className="text-muted-foreground">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="container mx-auto max-w-6xl px-4 py-14">
        <div className="rounded-lg border p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                <HelpCircle className="h-5 w-5 text-primary" />
                {tr("needHelpChoosingTheRightPath")}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {tr("askForAGuidedMigrationReview")}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href="mailto:support@muhasib.ai?subject=Migration%20review">
                <Button>
                  <Mail className="me-2 h-4 w-4" />
                  {tr("requestReview")}
                </Button>
              </a>
              <Link href="/migration-guides">
                <Button variant="outline">
                  {tr("migrationGuides")}
                  <ArrowRight className="ms-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
