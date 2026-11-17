import { Suspense } from "react";
import { useLocation, useSearch } from "wouter";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { lazyWithReload } from "@/lib/lazyWithReload";
import { useTranslation } from "@/lib/i18n";
import { ASSISTANT_TABS, resolveAssistantTab, type AssistantTab } from "@/pages/assistant/model";

const AskPanel = lazyWithReload(() => import("@/pages/assistant/AskPanel"));
const ReviewPanel = lazyWithReload(() => import("@/pages/assistant/ReviewPanel"));
const AutomationsPanel = lazyWithReload(() => import("@/pages/assistant/AutomationsPanel"));

const PANELS: Record<AssistantTab, { labelKey: string; Panel: typeof AskPanel }> = {
  ask: { labelKey: "assistant.tabAsk", Panel: AskPanel },
  review: { labelKey: "assistant.tabReview", Panel: ReviewPanel },
  automations: { labelKey: "assistant.tabAutomations", Panel: AutomationsPanel },
};

/**
 * Assistant (spec 3.14): one route, `/assistant`, with three tabs: Ask · Review ·
 * Automations. The former AI hub routes (/ai, /ai-cfo, /ai-chat, /smart-assistant,
 * /ai-inbox, /ai-features) redirect here; their legacy `?tab=` ids resolve to the tab
 * that replaced them (see `resolveAssistantTab`).
 */
export default function AIHub() {
  const { t } = useTranslation();
  const [location, navigate] = useLocation();
  const search = useSearch();
  const active = resolveAssistantTab(new URLSearchParams(search).get("tab"));

  const select = (next: string) => {
    const params = new URLSearchParams(search);
    params.set("tab", next);
    navigate(`${location.split("?")[0]}?${params.toString()}`, { replace: true });
  };

  return (
    <div className="space-y-6" data-testid="page-ai-hub">
      <PageHeader
        title={t["assistant.title"]}
        description={t["assistant.description"]}
        testId="text-assistant-title"
      />
      <Tabs value={active} onValueChange={select}>
        <TabsList aria-label={t["assistant.title"]}>
          {ASSISTANT_TABS.map((id) => (
            <TabsTrigger key={id} value={id} data-testid={`hub-tab-${id}`}>
              {t[PANELS[id].labelKey]}
            </TabsTrigger>
          ))}
        </TabsList>
        {ASSISTANT_TABS.map((id) => {
          const { Panel } = PANELS[id];
          return (
            <TabsContent key={id} value={id} className="mt-6">
              {id === active ? (
                <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                  <Panel />
                </Suspense>
              ) : null}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
