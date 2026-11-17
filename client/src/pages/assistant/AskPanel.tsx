import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowUp, Loader2, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { SetupNotice } from "@/components/ui/setup-notice";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useTranslation } from "@/lib/i18n";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { presentFigure, sourcesFor, type GroundedFigure } from "./model";

interface AskResponse {
  response: string;
  grounded?: boolean;
  insufficientData?: boolean;
  citations?: GroundedFigure[];
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
  const endRef = useRef<HTMLDivElement>(null);

  const { data: stats } = useQuery<{ outstanding?: number }>({
    queryKey: ["/api/companies", companyId, "dashboard/stats"],
    enabled: !!companyId,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
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
    if (!question || ask.isPending || !companyId) return;
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
      {unavailable && (
        <SetupNotice className="mb-4" testId="assistant-unavailable">
          {t["assistant.notAvailable"]}
        </SetupNotice>
      )}

      {turns.length === 0 ? (
        <div className="flex-1">
          <EmptyState
            size="lg"
            previewColumns={0}
            icon={MessageSquareText}
            title={t["assistant.askEmptyTitle"]}
            description={t["assistant.askEmptyBody"]}
            testId="assistant-ask-empty"
          />
          <div
            className="mt-6 flex flex-wrap justify-center gap-2"
            data-testid="assistant-suggestions"
          >
            {suggestions.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => submit(text)}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-small text-foreground transition-colors duration-fast hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {text}
              </button>
            ))}
          </div>
          {recent.length > 0 && (
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
        <ol className="flex-1 space-y-6 pb-4" aria-live="polite" data-testid="assistant-thread">
          {turns.map((turn) => (
            <li key={turn.id} className="space-y-3">
              <p className="ms-auto w-fit max-w-[85%] rounded-lg bg-secondary px-4 py-2.5 text-body text-foreground">
                {turn.question}
              </p>
              {turn.answer ? (
                <Answer answer={turn.answer} />
              ) : turn.failed ? (
                <p className="text-small text-danger">{t["assistant.answerFailed"]}</p>
              ) : (
                <p className="flex items-center gap-2 text-small text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {t["assistant.thinking"]}
                </p>
              )}
            </li>
          ))}
          <div ref={endRef} />
        </ol>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className={cn(
          "sticky z-10 mt-4 flex items-end gap-2 rounded-xl border border-border bg-card p-2 shadow-card-soft",
          "bottom-[calc(3.75rem_+_env(safe-area-inset-bottom,0px)_+_0.5rem)] md:bottom-4"
        )}
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
          rows={1}
          className="min-h-11 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          data-testid="assistant-input"
        />
        <Button
          type="submit"
          size="icon"
          className="h-11 w-11 shrink-0"
          disabled={!input.trim() || ask.isPending || !companyId}
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
  );
}

function Answer({ answer }: { answer: AskResponse }) {
  const { t, locale } = useTranslation();
  const figures = (answer.citations ?? []).filter((f) => presentFigure(f));
  const sources = sourcesFor(figures);
  return (
    <div className="space-y-3" data-testid="assistant-answer">
      <p className="whitespace-pre-wrap text-body leading-relaxed text-foreground">
        {answer.response}
      </p>
      {figures.length > 0 && (
        <table className="w-full max-w-md text-small" data-testid="assistant-figures">
          <caption className="sr-only">{t["assistant.figuresUsed"]}</caption>
          <tbody className="divide-y divide-border">
            {figures.map((f) => {
              const p = presentFigure(f)!;
              return (
                <tr key={f.id}>
                  <th
                    scope="row"
                    className="py-1.5 pe-4 text-start font-normal text-muted-foreground"
                  >
                    {t[p.labelKey]}
                  </th>
                  <td className="py-1.5 text-end tabular-nums text-foreground">
                    {f.unit === "AED" ? (
                      <Money amount={f.value} currency="AED" />
                    ) : (
                      f.value.toLocaleString(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB")
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="assistant-sources">
          <span className="text-caption text-muted-foreground">{t["assistant.source"]}</span>
          {sources.map((s) => (
            <Link
              key={s.sourceKey}
              href={s.href}
              className="rounded-full border border-border px-2.5 py-0.5 text-caption font-medium text-primary hover:bg-secondary"
            >
              {t[s.sourceKey]}
            </Link>
          ))}
        </div>
      )}
      {answer.insufficientData && (
        <p className="text-small text-muted-foreground">{t["assistant.insufficientData"]}</p>
      )}
    </div>
  );
}
