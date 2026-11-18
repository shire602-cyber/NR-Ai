/**
 * WQ5: the no-login page for whoever approves the e-invoicing partner in EmaraTax.
 * /portal/einvoicing-approve/:token — a single-purpose, expiring (14 days), revocable link.
 *
 * It shows only the company's display name, the partner and the numbered steps, and a Done
 * button that tells the company owner (through the email outbox). Owner decision pending:
 * whether the company's TRN may appear here; until then it does not.
 */
import { useState } from "react";
import { useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, FileCheck2, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiUrl } from "@/lib/api";
import { formatMessage, useI18n, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { EmaraTaxSteps, type StepsPartner } from "@/components/einvoice/EmaraTaxSteps";

interface ApproverPageData {
  state: "active" | "completed";
  companyName: string;
  approverName: string | null;
  expiresAt: string;
  completedAt: string | null;
  partner: (StepsPartner & { emaraTaxListing: string }) | null;
}

type LoadResult =
  | { kind: "ok"; data: ApproverPageData }
  | { kind: "gone"; state: "expired" | "revoked" }
  | { kind: "invalid" };

async function load(token: string): Promise<LoadResult> {
  const res = await fetch(apiUrl(`/api/portal/einvoicing-approve/${encodeURIComponent(token)}`), {
    credentials: "omit",
  });
  if (res.status === 410) {
    const body = await res.json().catch(() => ({}));
    return { kind: "gone", state: body.state === "revoked" ? "revoked" : "expired" };
  }
  if (!res.ok) return { kind: "invalid" };
  return { kind: "ok", data: (await res.json()) as ApproverPageData };
}

export default function EInvoicingApprove() {
  const { token = "" } = useParams<{ token: string }>();
  const { t, locale } = useTranslation();
  const setLocale = useI18n((s) => s.setLocale);
  const [doneData, setDoneData] = useState<ApproverPageData | null>(null);
  const query = useQuery<LoadResult>({
    queryKey: ["einvoicing-approve", token],
    queryFn: () => load(token),
    retry: false,
  });
  const done = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        apiUrl(`/api/portal/einvoicing-approve/${encodeURIComponent(token)}/done`),
        {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }
      );
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as ApproverPageData;
    },
    onSuccess: setDoneData,
  });

  const result = query.data;
  const data = doneData ?? (result?.kind === "ok" ? result.data : null);

  return (
    <main
      className="min-h-screen bg-background px-4 py-10 text-foreground"
      dir={locale === "ar" ? "rtl" : "ltr"}
      data-testid="einvoicing-approve-page"
    >
      <div className="mx-auto max-w-xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-small font-semibold text-muted-foreground">
            <FileCheck2 className="h-5 w-5 text-brand-600" aria-hidden />
            {t["einvoicing.appoint.pageEyebrow"]}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
            data-testid="approve-language"
          >
            <Languages className="h-4 w-4" aria-hidden />
            {/* Sweep: the target language's name, in that language and marked as such (as in
                the site's LocaleToggle); it read "English · الإنجليزية" untagged before. */}
            <span
              lang={locale === "ar" ? "en" : "ar"}
              title={t["einvoicing.appoint.switchLanguage"]}
            >
              {locale === "ar" ? "English" : "العربية"}
            </span>
          </Button>
        </div>

        <section className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm">
          {query.isLoading && (
            <div className="h-40 animate-pulse rounded-lg bg-muted" aria-busy="true" />
          )}
          {result?.kind === "invalid" && (
            <div className="space-y-2" data-testid="approve-invalid">
              <h1 className="text-h2 font-semibold">{t["einvoicing.appoint.invalidTitle"]}</h1>
              <p className="text-small text-muted-foreground">
                {t["einvoicing.appoint.invalidBody"]}
              </p>
            </div>
          )}
          {result?.kind === "gone" && (
            <div className="space-y-2" data-testid={`approve-${result.state}`}>
              <h1 className="flex items-center gap-2 text-h2 font-semibold">
                <Clock className="h-5 w-5 text-muted-foreground" aria-hidden />
                {result.state === "revoked"
                  ? t["einvoicing.appoint.revokedTitle"]
                  : t["einvoicing.appoint.expiredTitle"]}
              </h1>
              <p className="text-small text-muted-foreground">{t["einvoicing.appoint.goneBody"]}</p>
            </div>
          )}
          {data && (
            <>
              <div className="space-y-1">
                <h1 className="text-h2 font-semibold" data-testid="approve-title">
                  {formatMessage(t["einvoicing.appoint.pageTitle"], {
                    company: data.companyName,
                  })}
                </h1>
                <p className="text-small text-muted-foreground">
                  {data.approverName
                    ? formatMessage(t["einvoicing.appoint.pageIntroNamed"], {
                        name: data.approverName,
                        company: data.companyName,
                      })
                    : formatMessage(t["einvoicing.appoint.pageIntro"], {
                        company: data.companyName,
                      })}
                </p>
              </div>
              <EmaraTaxSteps partner={data.partner} companyName={data.companyName} withDone />
              {data.state === "completed" ? (
                <div
                  className="flex items-start gap-2 rounded-lg bg-success-subtle p-3 text-small text-success-subtle-foreground"
                  data-testid="approve-completed"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    {formatMessage(t["einvoicing.appoint.doneThanks"], {
                      company: data.companyName,
                    })}
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <StatusBadge tone="info">
                    {formatMessage(t["einvoicing.appoint.expiresOn"], {
                      date: formatDate(data.expiresAt, locale),
                    })}
                  </StatusBadge>
                  <Button
                    onClick={() => done.mutate()}
                    disabled={done.isPending}
                    data-testid="approve-done"
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden />
                    {t["einvoicing.appoint.doneButton"]}
                  </Button>
                </div>
              )}
              {done.isError && (
                <p className="text-small text-danger" role="alert">
                  {t["einvoicing.appoint.doneFailed"]}
                </p>
              )}
            </>
          )}
        </section>
        <p className="text-center text-caption text-muted-foreground">
          {t["einvoicing.appoint.pageFooter"]}
        </p>
      </div>
    </main>
  );
}
