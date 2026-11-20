import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { formatDate } from "@/lib/format-date";
import { translateNow, useTranslation } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { useToast } from "@/hooks/use-toast";
import type { UserFeedback } from "@shared/schema";

const FEEDBACK_TYPES = ["bug", "feature_request", "improvement", "praise"] as const;
type FeedbackType = (typeof FEEDBACK_TYPES)[number];

const TYPE_LABEL: Record<string, string> = {
  bug: "settingsPages.feedbackTypeBug",
  feature_request: "settingsPages.feedbackTypeIdea",
  improvement: "settingsPages.feedbackTypeImprovement",
  praise: "settingsPages.feedbackTypePraise",
  other: "settingsPages.feedbackTypeOther",
};

const STATUS: Record<string, { key: string; tone: StatusTone }> = {
  new: { key: "settingsPages.feedbackStatusNew", tone: "neutral" },
  reviewed: { key: "settingsPages.feedbackStatusReviewed", tone: "info" },
  in_progress: { key: "settingsPages.feedbackStatusInProgress", tone: "info" },
  resolved: { key: "settingsPages.feedbackStatusResolved", tone: "success" },
};

const MIN_MESSAGE = 10;

/**
 * Feedback (spec 3.15): a segmented type control, one message box and a submit button,
 * with the user's earlier feedback listed below.
 */
export default function Feedback() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const [location] = useLocation();
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("improvement");
  const [message, setMessage] = useState("");

  const history = useQuery<UserFeedback[]>({ queryKey: ["/api/feedback"] });

  const submit = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/feedback", {
        feedbackType,
        message: message.trim(),
        allowContact: true,
        pageContext: location,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      toast({ title: translateNow("toasts.thankYouForYourFeedback") });
      setMessage("");
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const tooShort = message.trim().length < MIN_MESSAGE;

  return (
    <div className="mx-auto max-w-[760px] space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title={t["feedback.feedback"]}
        description={t["feedback.helpUsImproveBySharing"]}
      />

      <SectionCard title={t["pageLabels.shareYourFeedback"]}>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!tooShort) submit.mutate();
          }}
        >
          <div className="space-y-2">
            <span id="feedback-type-label" className="text-small font-medium text-foreground">
              {t["pageLabels.feedbackType"]}
            </span>
            <div
              role="radiogroup"
              aria-labelledby="feedback-type-label"
              className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-sunken p-1"
            >
              {FEEDBACK_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={feedbackType === type}
                  onClick={() => setFeedbackType(type)}
                  className={cn(
                    "min-h-9 flex-1 rounded-md px-3 text-small font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    feedbackType === type
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid={`button-type-${type}`}
                >
                  {t[TYPE_LABEL[type]]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-message">{t["settingsPages.feedbackMessageLabel"]}</Label>
            <Textarea
              id="feedback-message"
              placeholder={t["feedback.pleaseProvideAsMuchDetail"]}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              data-testid="input-message"
            />
            <p className="text-small text-muted-foreground">
              {t["settingsPages.feedbackMessageHelp"]}
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={tooShort || submit.isPending}
              data-testid="button-submit"
            >
              {t["pages.submitFeedback"]}
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title={t["pageLabels.myFeedback"]} flush testId="feedback-history">
        {history.isLoading ? (
          <div className="space-y-2 border-t p-5">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : !history.data?.length ? (
          <p className="border-t px-5 py-4 text-small text-muted-foreground md:px-6">
            {t["pageLabels.yourSubmittedFeedbackWillAppearHere"]}
          </p>
        ) : (
          <ul className="divide-y divide-border border-t">
            {history.data.map((item) => {
              const status = STATUS[item.status] ?? STATUS.new;
              return (
                <li
                  key={item.id}
                  className="space-y-1 px-5 py-4 md:px-6"
                  data-testid={`card-feedback-${item.id}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-foreground">
                      {item.title || t[TYPE_LABEL[item.feedbackType] ?? TYPE_LABEL.other]}
                    </p>
                    <StatusBadge tone={status.tone}>{t[status.key]}</StatusBadge>
                  </div>
                  <p className="text-caption text-muted-foreground">
                    {t[TYPE_LABEL[item.feedbackType] ?? TYPE_LABEL.other]} ·{" "}
                    {formatDate(item.createdAt, locale)}
                  </p>
                  <p className="line-clamp-3 text-small text-foreground" dir="auto">
                    {item.message}
                  </p>
                  {item.responseMessage && (
                    <div className="mt-2 border-s-2 border-border ps-3">
                      <p className="text-caption font-medium text-muted-foreground">
                        {t["settingsPages.feedbackReply"]}
                      </p>
                      <p className="text-small text-foreground" dir="auto">
                        {item.responseMessage}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
