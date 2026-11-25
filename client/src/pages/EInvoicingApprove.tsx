/**
 * WQ5: the no-login page for whoever approves the e-invoicing partner in EmaraTax.
 * /portal/einvoicing-approve/:token — a single-purpose, expiring (14 days), revocable link.
 *
 * It shows only the company's display name, the partner and the numbered steps, and a Done
 * button that tells the company owner (through the email outbox). Owner decision pending:
 * whether the company's TRN may appear here; until then it does not.
 */
import { useState } from "react";
// The light public root does not load the app shell's stylesheets; these pages need the
// mobile row-card tables and the RTL rules.
import "@/styles/rtl.css";
import "@/styles/mobile.css";
import { useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiUrl } from "@/lib/api";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { bidiIsolate, useDocumentTitle, useLinkLocale } from "@/lib/customer-link";
import { LinkLanguageSwitch } from "@/components/customer-link/LinkLanguageSwitch";
import { formatDate } from "@/lib/format-date";
import { EmaraTaxSteps, type StepsPartner } from "@/components/einvoice/EmaraTaxSteps";

const APPROVE_NAMESPACES = ["einvoicing", "customerLink"];

interface ApproverPageData {
  state: "active" | "completed";
  companyName: string;
  /** The company's language (en | ar). */
  locale?: string | null;
  approverName: string | null;
  expiresAt: string;
  completedAt: string | null;
  partner: (StepsPartner & { emaraTaxListing: string }) | null;
}

type LoadResult =
  | { kind: "ok"; data: ApproverPageData }
  | { kind: "gone"; state: "expired" | "revoked" }
  | { kind: "busy" }
  | { kind: "invalid" };

type DoneOutcome =
  | { kind: "completed"; data: ApproverPageData }
  | Extract<LoadResult, { kind: "gone" }>;

/** A 410 body is the terminal state. Anything other than revoked is treated as expired. */
function goneState(body: unknown): "expired" | "revoked" {
  return body && typeof body === "object" && "state" in body && body.state === "revoked"
    ? "revoked"
    : "expired";
}

async function load(token: string): Promise<LoadResult> {
  const res = await fetch(apiUrl(`/api/portal/einvoicing-approve/${encodeURIComponent(token)}`), {
    credentials: "omit",
  });
  if (res.status === 410) {
    const body = await res.json().catch(() => ({}));
    return { kind: "gone", state: goneState(body) };
  }
  // Read the body even when it is not used: an unread response keeps the request open.
  if (res.status === 429) {
    await res.text().catch(() => "");
    return { kind: "busy" };
  }
  if (res.status === 404 || res.status === 400) {
    await res.text().catch(() => "");
    return { kind: "invalid" };
  }
  if (!res.ok) throw new Error(String(res.status));
  return { kind: "ok", data: (await res.json()) as ApproverPageData };
}

/**
 * The page keeps local state (Done response, closed link, mutation). Keying it by token gives
 * in-app navigation from link A to link B fresh state, so B shows its own GET outcome.
 */
export default function EInvoicingApprove() {
  const { token = "" } = useParams<{ token: string }>();
  return <EInvoicingApproveLink key={token} token={token} />;
}

function EInvoicingApproveLink({ token }: { token: string }) {
  const { t, locale } = useTranslation(APPROVE_NAMESPACES);
  const queryClient = useQueryClient();
  const [doneData, setDoneData] = useState<ApproverPageData | null>(null);
  // The Done response is the terminal state. A later read can fail or stay pending; it must
  // not put the active page, or a retry alert, back on screen.
  const [closedLink, setClosedLink] = useState<Extract<LoadResult, { kind: "gone" }> | null>(null);
  const query = useQuery<LoadResult>({
    queryKey: ["einvoicing-approve", token],
    queryFn: () => load(token),
    retry: false,
  });
  const done = useMutation({
    mutationFn: async (): Promise<DoneOutcome> => {
      const res = await fetch(
        apiUrl(`/api/portal/einvoicing-approve/${encodeURIComponent(token)}/done`),
        {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }
      );
      if (res.status === 410) {
        const body = await res.json().catch(() => ({}));
        return { kind: "gone", state: goneState(body) };
      }
      // Read the body even when it is not used: an unread response keeps the request open.
      if (!res.ok) {
        await res.text().catch(() => "");
        throw new Error(String(res.status));
      }
      return { kind: "completed", data: (await res.json()) as ApproverPageData };
    },
    onSuccess: async (outcome) => {
      if (outcome.kind === "gone") {
        setClosedLink(outcome);
        // A reconnect GET already in flight may carry the active state and resolve after this
        // 410. Cancel it (and wait) so it cannot overwrite the terminal result in the cache.
        const queryKey = ["einvoicing-approve", token];
        await queryClient.cancelQueries({ queryKey, exact: true });
        queryClient.setQueryData<LoadResult>(queryKey, outcome);
        return;
      }
      setDoneData(outcome.data);
    },
  });

  const result = closedLink ?? query.data;
  const data = closedLink ? null : (doneData ?? (result?.kind === "ok" ? result.data : null));
  useLinkLocale(!query.isLoading, null, data?.locale);
  // Offline first load: the query is paused with nothing to show. Cached content on a paused
  // refresh keeps rendering as is.
  const waiting = query.fetchStatus === "paused" && !result && !data;
  // A terminal (gone) result, local or cached, is never retried, even if a later read errors.
  const showRetry =
    !waiting && result?.kind !== "gone" && (result?.kind === "busy" || query.isError);
  const company = data ? bidiIsolate(data.companyName) : "";
  useDocumentTitle(
    data
      ? formatMessage(t["customerLink.approveTitle"], { company: data.companyName })
      : waiting
        ? t["customerLink.waitingTitle"]
        : result?.kind === "gone"
          ? t[
              result.state === "revoked"
                ? "einvoicing.appoint.revokedTitle"
                : "einvoicing.appoint.expiredTitle"
            ]
          : result?.kind === "busy"
            ? t["customerLink.busyTitle"]
            : query.isError
              ? t["customerLink.loadFailedTitle"]
              : result?.kind === "invalid"
                ? t["einvoicing.appoint.invalidTitle"]
                : t["einvoicing.appoint.pageEyebrow"]
  );

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
          <LinkLanguageSwitch testId="approve-language" />
        </div>

        <section className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm">
          {query.isLoading && (
            <div
              className="h-40 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
              role="status"
              aria-busy="true"
              aria-label={t["customerLink.loading"]}
            />
          )}
          {waiting && (
            <div
              className="space-y-2"
              role="status"
              aria-live="polite"
              data-testid="approve-waiting"
            >
              <h1 className="text-h2 font-semibold">{t["customerLink.waitingTitle"]}</h1>
              <p className="text-small text-muted-foreground">{t["customerLink.waitingBody"]}</p>
            </div>
          )}
          {result?.kind === "invalid" && (
            <div className="space-y-2" data-testid="approve-invalid">
              <h1 className="text-h2 font-semibold">{t["einvoicing.appoint.invalidTitle"]}</h1>
              <p className="text-small text-muted-foreground">
                {t["einvoicing.appoint.invalidBody"]}
              </p>
            </div>
          )}
          {showRetry && (
            <div className="space-y-3" data-testid="approve-retry">
              <h1 className="text-h2 font-semibold">
                {
                  t[
                    result?.kind === "busy"
                      ? "customerLink.busyTitle"
                      : "customerLink.loadFailedTitle"
                  ]
                }
              </h1>
              <p className="text-small text-muted-foreground">
                {
                  t[
                    result?.kind === "busy"
                      ? "customerLink.busyBody"
                      : "customerLink.loadFailedBody"
                  ]
                }
              </p>
              <Button variant="outline" onClick={() => void query.refetch()}>
                {t["customerLink.retry"]}
              </Button>
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
                  {formatMessage(t["einvoicing.appoint.pageTitle"], { company })}
                </h1>
                <p className="text-small text-muted-foreground">
                  {data.approverName
                    ? formatMessage(t["einvoicing.appoint.pageIntroNamed"], {
                        name: bidiIsolate(data.approverName),
                        company,
                      })
                    : formatMessage(t["einvoicing.appoint.pageIntro"], { company })}
                </p>
              </div>
              <EmaraTaxSteps partner={data.partner} companyName={data.companyName} withDone />
              {data.state === "completed" ? (
                <div
                  className="flex items-start gap-2 rounded-lg bg-success-subtle p-3 text-small text-success-subtle-foreground"
                  data-testid="approve-completed"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{formatMessage(t["einvoicing.appoint.doneThanks"], { company })}</span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <StatusBadge tone="info">
                    {formatMessage(t["einvoicing.appoint.expiresOn"], {
                      date: formatDate(data.expiresAt, locale),
                    })}
                  </StatusBadge>
                  <Button
                    className="min-h-11"
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
