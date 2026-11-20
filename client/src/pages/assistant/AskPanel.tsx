import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowUp, Loader2, MessageSquareText } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { SetupNotice } from "@/components/ui/setup-notice";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate, formatDateRange, formatEmbeddedDates } from "@/lib/format-date";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  answerSegments,
  factLabelValues,
  NAME_LABELLED_FACTS,
  factSources,
  presentFigure,
  revealScrollDelta,
  sourcesFor,
  type AnswerFigure,
  type AnswerMissing,
  type AnswerSegment,
  type GroundedFigure,
} from "./model";

interface AskResponse {
  response: string;
  grounded?: boolean;
  insufficientData?: boolean;
  citations?: GroundedFigure[];
  /** AS1: the answer split into text and amounts (no citation markers). */
  segments?: AnswerSegment[];
  /** AS1: the facts the answer rests on, labelled by key. */
  figures?: AnswerFigure[];
  /** AS1: what the books do not hold yet, with where to add it. */
  missing?: AnswerMissing[];
  followUpPrompts?: string[];
  timestamp: string;
}

interface Turn {
  id: string;
  question: string;
  answer?: AskResponse;
  failed?: boolean;
}

const RECENT_KEY = "muhasib-assistant-recent";
/** Suggestions shown below md: the rest would sit under the docked composer (B2). */
const MOBILE_SUGGESTIONS = 4;
const SUGGESTION_KEYS = [
  "assistant.suggestOverdue",
  "assistant.suggestVat",
  "assistant.suggestTopExpenses",
  "assistant.suggestProfit",
  "assistant.suggestOwesMost",
  "assistant.suggestUnposted",
] as const;

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((q): q is string => typeof q === "string") : [];
  } catch {
    return [];
  }
}

function rememberQuestion(question: string): string[] {
  const next = [question, ...readRecent().filter((q) => q !== question)].slice(0, 5);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private mode or blocked storage: recent questions are a convenience only.
  }
  return next;
}

/**
 * Assistant → Ask. One conversation surface grounded in the company's posted books
 * (`/api/ai/nl-gateway`): each answer lists the figures it used and links to the report
 * they came from. The composer is docked at the bottom of the content area, above the
 * mobile tab bar.
 */
export default function AskPanel() {
  const { t, locale } = useTranslation();
  const { companyId } = useDefaultCompany();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const [unavailable, setUnavailable] = useState(false);
  const threadRef = useRef<HTMLOListElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  const { data: stats } = useQuery<{ outstanding?: number }>({
    queryKey: ["/api/companies", companyId, "dashboard/stats"],
    enabled: !!companyId,
  });
  // B3: know up front whether the assistant can answer, so an unconfigured workspace sees the
  // notice instead of chips and a composer that can only fail.
  const { data: aiStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/ai/status"],
    staleTime: 5 * 60_000,
  });
  const switchedOff = unavailable || aiStatus?.configured === false;

  // N3: after each question and each answer, scroll the newest turn to just above the docked
  // composer. `scrollIntoView({ block: "end" })` aligned it with the bottom of the scroll area,
  // which sits behind the composer and the phone tab bar, so from the second answer on the
  // figures ended up hidden. Measured again on the next frame, once the answer has laid out.
  useLayoutEffect(() => {
    const reveal = () => {
      const latest = threadRef.current?.lastElementChild as HTMLElement | null;
      const dock = dockRef.current;
      if (!latest || !dock) return;
      const scroller = scrollParent(latest);
      const turn = latest.getBoundingClientRect();
      const delta = revealScrollDelta({
        turnTop: turn.top,
        turnBottom: turn.bottom,
        composerTop: dock.getBoundingClientRect().top,
        visibleTop:
          scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top,
      });
      if (delta > 0) scroller.scrollBy?.({ top: delta });
    };
    reveal();
    const frame = window.requestAnimationFrame(reveal);
    return () => window.cancelAnimationFrame(frame);
  }, [turns]);

  const ask = useMutation({
    mutationFn: async ({ question }: { id: string; question: string }) =>
      (await apiRequest("POST", "/api/ai/nl-gateway", {
        companyId,
        message: question,
        locale,
      })) as AskResponse,
    onSuccess: (answer, { id }) => {
      setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, answer } : turn)));
    },
    onError: (error, { id }) => {
      if (error instanceof ApiError && error.status === 503) setUnavailable(true);
      setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, failed: true } : turn)));
    },
  });

  const submit = (raw: string) => {
    const question = raw.trim();
    if (!question || ask.isPending || !companyId || switchedOff) return;
    const id = `q-${turns.length + 1}-${question.length}`;
    setTurns((prev) => [...prev, { id, question }]);
    setRecent(rememberQuestion(question));
    setInput("");
    ask.mutate({ id, question });
  };

  const suggestions = SUGGESTION_KEYS.filter(
    (key) => key !== "assistant.suggestOverdue" || (stats?.outstanding ?? 0) > 0
  ).map((key) => t[key]);

  return (
    <div
      className="mx-auto flex min-h-[calc(100dvh-16rem)] w-full max-w-[760px] flex-col"
      data-testid="assistant-ask"
    >
      {switchedOff && (
        <SetupNotice
          className="mb-4"
          testId="assistant-unavailable"
          action={{
            label: t["assistant.openReports"],
            href: "/reports",
            testId: "assistant-open-reports",
          }}
        >
          {t["assistant.notAvailable"]}
        </SetupNotice>
      )}

      {turns.length === 0 ? (
        <div className="flex-1 pb-4">
          <EmptyState
            size="lg"
            previewColumns={0}
            icon={MessageSquareText}
            title={t["assistant.askEmptyTitle"]}
            description={t["assistant.askEmptyBody"]}
            testId="assistant-ask-empty"
          />
          {/* B2: four suggestions on a phone so none sits under the docked composer. */}
          {!switchedOff && (
            <div
              className="mt-6 flex flex-wrap justify-center gap-2"
              data-testid="assistant-suggestions"
            >
              {suggestions.map((text, index) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => submit(text)}
                  className={cn(
                    "rounded-full border border-border bg-card px-3 py-1.5 text-small text-foreground transition-colors duration-fast hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    index >= MOBILE_SUGGESTIONS && "max-md:hidden"
                  )}
                >
                  {text}
                </button>
              ))}
            </div>
          )}
          {!switchedOff && recent.length > 0 && (
            <section className="mt-8" aria-labelledby="assistant-recent">
              <h3 id="assistant-recent" className="text-caption font-medium text-muted-foreground">
                {t["assistant.recentQuestions"]}
              </h3>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
                {recent.map((q) => (
                  <li key={q}>
                    <button
                      type="button"
                      onClick={() => submit(q)}
                      className="w-full px-4 py-3 text-start text-small text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : (
        <ol
          ref={threadRef}
          className="flex-1 space-y-6 pb-4"
          aria-live="polite"
          data-testid="assistant-thread"
        >
          {turns.map((turn) => (
            <li key={turn.id} className="space-y-3">
              <p className="ms-auto w-fit max-w-[85%] rounded-lg bg-secondary px-4 py-2.5 text-body text-foreground">
                {turn.question}
              </p>
              {turn.answer ? (
                <Answer answer={turn.answer} />
              ) : turn.failed ? (
                <Alert tone="danger" data-testid="assistant-answer-failed">
                  {t["assistant.answerFailed"]}
                </Alert>
              ) : (
                <p className="flex items-center gap-2 text-small text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {t["assistant.thinking"]}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      {/* N3: the dock sticks to the bottom of the scroll area. `<main>` already keeps its
          bottom padding clear of the phone tab bar, so the dock needs no offset of its own (the
          old 3.75rem offset left a strip of thread showing under the composer). Its background
          also reaches down through that padding (::after) to the tab bar or the window edge, and
          a short fade above it lets text slide under instead of being cut. */}
      <div
        ref={dockRef}
        className={cn(
          "sticky bottom-0 z-10 mt-4 bg-background pb-2 pt-2 md:pb-4",
          "before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-4 before:bg-gradient-to-t before:from-background before:to-transparent",
          "after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-[var(--mobile-nav-height)] after:bg-background md:after:h-8"
        )}
        data-testid="assistant-composer-dock"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 shadow-card-soft"
          data-testid="assistant-composer"
        >
          <label htmlFor="assistant-input" className="sr-only">
            {t["assistant.composerLabel"]}
          </label>
          <Textarea
            id="assistant-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            placeholder={t["assistant.composerPlaceholder"]}
            disabled={switchedOff}
            rows={1}
            className="min-h-11 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            data-testid="assistant-input"
          />
          <Button
            type="submit"
            size="icon"
            className="h-11 w-11 shrink-0"
            disabled={!input.trim() || ask.isPending || !companyId || switchedOff}
            aria-label={t["assistant.send"]}
            data-testid="assistant-send"
          >
            {ask.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

/** The nearest ancestor that scrolls (the app's `<main>`), else the document. */
function scrollParent(el: HTMLElement): Element {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = window.getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return document.scrollingElement ?? document.documentElement;
}

/** One figure row: the fact's label in the active language and its amount (A4). */
interface FigureRow {
  id: string;
  label: string;
  value: number;
  unit: "AED" | "count";
}

function Answer({ answer }: { answer: AskResponse }) {
  const { t, locale } = useTranslation();
  const catalog = t as unknown as Record<string, string | undefined>;
  const numberLocale = locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB";

  // AS1: the server sends labelled facts; older answers (and history) only carry citations.
  let rows: FigureRow[];
  let sources: Array<{ labelKey: string; href: string }>;
  if (answer.figures) {
    rows = answer.figures
      .map((f) => {
        const values = factLabelValues(f.params ?? {}, locale, {
          date: formatDate,
          range: formatDateRange,
        });
        // A customer, bank account or expense account is labelled by its own name (data).
        if (NAME_LABELLED_FACTS.has(f.key) && typeof values.name === "string") {
          return { id: f.id, label: values.name, value: f.value, unit: f.unit };
        }
        const template = catalog[`assistant.fact.${f.key}`];
        if (!template) return null;
        return { id: f.id, label: formatMessage(template, values), value: f.value, unit: f.unit };
      })
      .filter((r): r is FigureRow => r !== null);
    sources = factSources(answer.figures);
  } else {
    const legacy = (answer.citations ?? []).filter((f) => presentFigure(f));
    rows = legacy.map((f) => ({
      id: f.id,
      label: catalog[presentFigure(f)!.labelKey] ?? "",
      value: f.value,
      unit: f.unit,
    }));
    sources = sourcesFor(legacy).map((s) => ({ labelKey: s.sourceKey, href: s.href }));
  }
  const missing = (answer.missing ?? []).filter((m) => catalog[`assistant.missing.${m.key}`]);

  return (
    <div className="space-y-3" data-testid="assistant-answer">
      <p
        className="whitespace-pre-wrap text-body leading-relaxed text-foreground"
        data-testid="assistant-answer-text"
      >
        {answerSegments(answer).map((seg, i) =>
          seg.type === "text" ? (
            <Fragment key={i}>{formatEmbeddedDates(seg.text, locale)}</Fragment>
          ) : seg.type === "money" ? (
            // A3: the app's money format; one bidi-isolated, unbreakable unit.
            <Money key={i} amount={seg.value} currency={seg.currency} />
          ) : (
            <span key={i} className="tabular-nums">
              {seg.value.toLocaleString(numberLocale)}
            </span>
          )
        )}
      </p>
      {rows.length > 0 && (
        // B1: `mobile-fit` opts out of the phone-wide 600 px table minimum, so the figures stay
        // inside the answer column; under 480 px each label sits over its amount.
        <table
          className="mobile-fit w-full max-w-md table-fixed text-small"
          data-testid="assistant-figures"
        >
          <caption className="sr-only">{t["assistant.figuresUsed"]}</caption>
          <tbody className="divide-y divide-border">
            {rows.map((f) => (
              <tr key={f.id} className="max-[479px]:flex max-[479px]:flex-col max-[479px]:py-1.5">
                <th
                  scope="row"
                  className="break-words py-1.5 pe-4 text-start font-normal text-muted-foreground max-[479px]:p-0"
                >
                  {f.label}
                </th>
                <td className="w-40 whitespace-nowrap py-1.5 text-end tabular-nums text-foreground max-[479px]:w-auto max-[479px]:p-0 max-[479px]:text-start max-[479px]:font-medium">
                  {f.unit === "AED" ? (
                    <Money amount={f.value} currency="AED" />
                  ) : (
                    f.value.toLocaleString(numberLocale)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="assistant-sources">
          <span className="text-caption text-muted-foreground">{t["assistant.source"]}</span>
          {sources.map((s) => (
            <SourceChip key={s.href} href={s.href} label={catalog[s.labelKey] ?? ""} />
          ))}
        </div>
      )}
      {missing.length > 0 && (
        // A1: what the books do not hold yet, and where to add it (no generic advice).
        <ul className="space-y-1.5" data-testid="assistant-missing">
          {missing.map((m) => (
            <li
              key={m.key}
              className="flex flex-wrap items-center gap-2 text-small text-muted-foreground"
            >
              <span>{catalog[`assistant.missing.${m.key}`]}</span>
              <SourceChip href={m.href} label={catalog[`assistant.missingLink.${m.key}`] ?? ""} />
            </li>
          ))}
        </ul>
      )}
      {answer.insufficientData && missing.length === 0 && (
        <p className="text-small text-muted-foreground">{t["assistant.insufficientData"]}</p>
      )}
    </div>
  );
}

function SourceChip({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      // Fable P19: chip height follows its text; the 44 px tap area comes from ::after.
      className="relative inline-flex !min-h-0 items-center rounded-full border border-border px-2.5 py-0.5 text-caption font-medium text-primary after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-[''] hover:bg-secondary"
    >
      {label}
    </Link>
  );
}
