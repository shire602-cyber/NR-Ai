import { Suspense, useCallback, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

export interface HubTab {
  /** Stable id used in the `?tab=` query parameter. */
  id: string;
  label: string;
  /** Rendered only while the tab is active, so lazy pages load on demand. */
  content: ReactNode;
}

interface TabbedHubProps {
  /** Screen-reader heading for the hub; embedded pages keep their own visible headers. */
  title: string;
  tabs: HubTab[];
  defaultTab?: string;
  /** Query parameter that carries the active tab (default `tab`). */
  param?: string;
  "data-testid"?: string;
}

/**
 * Consolidates several existing pages behind one route with URL-addressable
 * tabs (`/ai?tab=chat`). Legacy routes redirect here, so deep links and
 * bookmarks keep working while the navigation only shows one entry.
 */
export function TabbedHub({ title, tabs, defaultTab, param = "tab", ...rest }: TabbedHubProps) {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const requested = new URLSearchParams(search).get(param);
  const active = tabs.some((tab) => tab.id === requested)
    ? (requested as string)
    : (defaultTab ?? tabs[0]?.id ?? "");

  const selectTab = useCallback(
    (next: string) => {
      const params = new URLSearchParams(search);
      params.set(param, next);
      navigate(`${location.split("?")[0]}?${params.toString()}`, { replace: true });
    },
    [location, navigate, param, search]
  );

  return (
    <div className="space-y-4" data-testid={rest["data-testid"]}>
      <h2 className="sr-only">{title}</h2>
      <Tabs value={active} onValueChange={selectTab}>
        <div className="overflow-x-auto pb-1">
          <TabsList aria-label={title}>
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} data-testid={`hub-tab-${tab.id}`}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {tabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="mt-4">
            {tab.id === active ? (
              <Suspense fallback={<Skeleton className="h-64 w-full" />}>{tab.content}</Suspense>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
