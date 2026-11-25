import { T } from "@/components/layout/T";
import { Link } from "wouter";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { localizeNotification } from "@/lib/notification-display";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery, useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ar as arLocale } from "date-fns/locale";
import {
  Bell,
  CheckCircle,
  AlertTriangle,
  Clock,
  Newspaper,
  ChevronRight,
  Check,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Notification, RegulatoryNews } from "@shared/schema";

const ROW_ACTION_KEY = ["notifications", "row-action"] as const;

export default function Notifications() {
  const { toast } = useToast();
  const { t, locale } = useTranslation();
  const [activeTab, setActiveTab] = useState("notifications");

  const {
    data: notificationsData,
    isPending: notificationsPending,
    fetchStatus: notificationsFetchStatus,
    error: notificationsError,
    refetch: refetchNotifications,
  } = useQuery<{
    notifications: Notification[];
    unreadCount: number;
  }>({
    queryKey: ["/api/notifications"],
  });

  const {
    data: regulatoryNews,
    isLoading: newsLoading,
    error: newsError,
    fetchStatus: newsFetchStatus,
    refetch: refetchNews,
  } = useQuery<RegulatoryNews[]>({
    queryKey: ["/api/regulatory-news"],
  });

  const actionFailed = () =>
    toast({ title: t["pageLabels.notificationActionFailed"], variant: "destructive" });

  // Read and dismiss share one mutation key, so the mutation cache is the single source of truth
  // for which rows have a request in flight or paused offline. It survives navigating away and
  // back, and covers several rows at once.
  const rowMutationClient = useQueryClient();
  const rowMutations = useMutationState({
    filters: { mutationKey: ROW_ACTION_KEY, status: "pending" },
    select: (m) => ({ id: m.state.variables as string, paused: m.state.isPaused }),
  });
  const pendingRows = new Map<string, { paused: boolean }>();
  for (const m of rowMutations) pendingRows.set(m.id, { paused: m.paused });

  const markAsReadMutation = useMutation({
    mutationKey: ROW_ACTION_KEY,
    mutationFn: (id: string) => apiRequest("PATCH", `/api/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
    onError: actionFailed,
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notifications/read-all"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: t["pages.notificationsAllRead"] });
    },
    onError: actionFailed,
  });

  const dismissMutation = useMutation({
    mutationKey: ROW_ACTION_KEY,
    mutationFn: (id: string) => apiRequest("PATCH", `/api/notifications/${id}/dismiss`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: t["pages.notificationDismissed"] });
    },
    onError: actionFailed,
  });

  const submitRowAction = (id: string, run: (id: string) => void) => {
    // Read-only cache lookup: a double click before the next render still finds the first request.
    const inFlight = rowMutationClient
      .getMutationCache()
      .findAll({ mutationKey: ROW_ACTION_KEY, status: "pending" })
      .some((m) => m.state.variables === id);
    if (inFlight) return;
    run(id);
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "deadline":
      case "payment_due":
        return <Clock className="text-warning" />;
      case "overdue":
        return <AlertTriangle className="text-danger" />;
      case "regulatory":
        return <Newspaper className="text-info" />;
      case "referral":
        return <CheckCircle className="text-success" />;
      case "system":
        return <Bell />;
      default:
        return <Bell />;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "urgent":
        return (
          <Badge variant="danger">
            <T k="pageLabels.urgent" />
          </Badge>
        );
      case "high":
        return (
          <Badge variant="warning">
            <T k="pageLabels.priorityHigh" />
          </Badge>
        );
      // Normal / low priority stay quiet: a pill per row is noise (CTO issue 10).
      default:
        return null;
    }
  };

  const hasNews = !newsLoading && (regulatoryNews?.length ?? 0) > 0;
  // A news load that failed (or is paused offline) with nothing cached keeps its tab so the retry
  // panel is reachable. A successful empty response still hides the tab (WP-E, spec 3.15).
  const newsUnavailable =
    !newsLoading && !regulatoryNews && (!!newsError || newsFetchStatus === "paused");
  // A retry with no data clears the error and reports loading again; while the user is on the news
  // tab keep the strip (and the loading panel) so focus and selection survive the retry.
  const newsRetrying = newsLoading && activeTab === "regulatory";
  const showNewsTab = hasNews || newsUnavailable || newsRetrying;
  // Derived selection: when the news tab disappears (e.g. a retry returns []) fall back to
  // Notifications for the header toolbar and the tab value alike.
  const effectiveTab = showNewsTab ? activeTab : "notifications";

  const getNewsBadge = (category: string) => {
    // Categories are topics, not statuses: one neutral outline pill.
    const known: Record<string, string> = {
      vat: t["pageLabels.newsCategoryVat"],
      corporate_tax: t["pageLabels.newsCategoryCorporateTax"],
      customs: t["pageLabels.newsCategoryCustoms"],
      labor: t["pageLabels.newsCategoryLabor"],
      general: t["pageLabels.newsCategoryGeneral"],
    };
    return (
      <Badge variant="outline" className="capitalize">
        {known[category] ?? category.replace(/_/g, " ")}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t["components.launchWorkspace"]}
        title={t["pageLabels.notificationsPageTitle"]}
        description={t["pageLabels.notificationsPageDesc"]}
        actions={
          effectiveTab === "notifications" && notificationsData?.unreadCount ? (
            <Button
              onClick={() => markAllAsReadMutation.mutate()}
              disabled={markAllAsReadMutation.isPending}
              data-testid="button-mark-all-read"
            >
              <Check className="w-4 h-4 me-2" />
              <T k="pageLabels.markAllAsRead" />
            </Button>
          ) : null
        }
      />

      <Tabs value={effectiveTab} onValueChange={setActiveTab}>
        {/* WP-E (spec 3.15): the Regulatory news tab only exists when there is news, or when the
            news request failed and needs its retry panel. */}
        <TabsList className={showNewsTab ? undefined : "hidden"}>
          <TabsTrigger value="notifications" data-testid="tab-notifications">
            <Bell aria-hidden />
            <T k="pageLabels.notificationsTab" />
            {notificationsData?.unreadCount ? (
              <Badge variant="secondary" className="ms-1 px-1.5 py-0 tabular-nums">
                {notificationsData.unreadCount}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="regulatory" data-testid="tab-regulatory">
            <Newspaper className="w-4 h-4 me-2" />
            <T k="pageLabels.regulatoryNews" />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="notifications" className="mt-6">
          {notificationsPending && notificationsFetchStatus !== "paused" ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : notificationsError && !notificationsData ? (
            <LoadErrorState
              error={notificationsError}
              onRetry={() => void refetchNotifications()}
              testId="notifications-load-error"
            />
          ) : !notificationsData ? (
            // No data and no error: the first fetch is paused offline. Never "caught up".
            <LoadErrorState
              error={null}
              onRetry={() => void refetchNotifications()}
              testId="notifications-offline"
            />
          ) : !notificationsData.notifications?.length ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Bell className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">
                  <T k="pageLabels.noNotifications" />
                </h3>
                <p className="text-muted-foreground text-center">
                  <T k="pageLabels.youReAllCaughtUpNew" />
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-hairline" aria-label={t["components.notificationsTitle"]}>
                {notificationsData.notifications.map((notification) => {
                  const copy = localizeNotification(
                    notification,
                    t as Record<string, string>,
                    locale === "ar" ? "ar" : "en"
                  );
                  const actionUrl = copy.actionUrl ?? notification.actionUrl;
                  const unread = !notification.isRead;
                  const rowState = pendingRows.get(notification.id);
                  const rowBusy = !!rowState;
                  return (
                    <li
                      key={notification.id}
                      className="group/notification relative flex items-start gap-3 px-4 py-3.5 transition-colors duration-fast hover:bg-muted/50 md:px-5"
                      data-testid={`card-notification-${notification.id}`}
                      data-unread={unread ? "" : undefined}
                    >
                      {/* Unread marker: brand dot at the inline start (no tinted row). */}
                      <span
                        className={`mt-2 h-2 w-2 shrink-0 rounded-full ${unread ? "bg-primary" : "bg-transparent"}`}
                        aria-hidden
                      />
                      <span className="mt-0.5 hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-muted-foreground sm:flex [&_svg]:h-4 [&_svg]:w-4">
                        {getNotificationIcon(notification.type)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h4
                            className={`text-body ${unread ? "font-semibold text-foreground" : "font-medium text-foreground/90"}`}
                            dir="auto"
                          >
                            {actionUrl ? (
                              <a
                                href={actionUrl}
                                className="after:absolute after:inset-0 after:content-['']"
                              >
                                {copy.title}
                              </a>
                            ) : (
                              copy.title
                            )}
                          </h4>
                          {getPriorityBadge(notification.priority)}
                          {unread && (
                            <span className="sr-only">
                              <T k="pageLabels.unread" />
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-small text-muted-foreground" dir="auto">
                          {copy.message}
                        </p>
                        {copy.setupEmailHref ? (
                          <Link
                            href={copy.setupEmailHref as string}
                            className="mt-1 inline-block text-small font-medium text-accent hover:underline"
                          >
                            {t["components.notificationEmailNotSetUpLink"]}
                          </Link>
                        ) : null}
                        {rowState?.paused ? (
                          <p
                            role="status"
                            className="mt-1 text-small text-warning"
                            data-testid={`status-paused-${notification.id}`}
                          >
                            {t["pageLabels.notificationActionOffline"]}
                          </p>
                        ) : null}
                        <p className="mt-1.5 text-caption text-muted-foreground">
                          {formatDistanceToNow(new Date(notification.createdAt), {
                            addSuffix: true,
                            locale: locale === "ar" ? arLocale : undefined,
                          })}
                        </p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="relative z-10 -me-2 shrink-0 text-muted-foreground hover:text-foreground"
                            aria-label={t["components.notificationMore"]}
                            data-testid={`button-more-${notification.id}`}
                          >
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {actionUrl && (
                            <DropdownMenuItem asChild>
                              <a href={actionUrl}>{t["pageLabels.notificationOpen"]}</a>
                            </DropdownMenuItem>
                          )}
                          {unread && (
                            <DropdownMenuItem
                              disabled={rowBusy}
                              data-testid={`action-read-${notification.id}`}
                              onSelect={() =>
                                submitRowAction(notification.id, markAsReadMutation.mutate)
                              }
                            >
                              {t["pageLabels.notificationMarkRead"]}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            disabled={rowBusy}
                            data-testid={`action-dismiss-${notification.id}`}
                            onSelect={() =>
                              submitRowAction(notification.id, dismissMutation.mutate)
                            }
                          >
                            {t["pageLabels.notificationDismiss"]}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="regulatory" className="mt-6">
          {newsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : newsUnavailable ? (
            <LoadErrorState
              error={newsError}
              onRetry={() => void refetchNews()}
              testId="news-load-error"
            />
          ) : !regulatoryNews?.length ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Newspaper className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">
                  <T k="pageLabels.noRegulatoryUpdates" />
                </h3>
                <p className="text-muted-foreground text-center">
                  <T k="pageLabels.latestRegulatoryNewsAndUpdatesWill" />
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {regulatoryNews.map((news) => (
                <Card key={news.id} data-testid={`card-news-${news.id}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          {getNewsBadge(news.category)}
                          {news.importance === "critical" && (
                            <Badge variant="danger">
                              <T k="pages.critical" />
                            </Badge>
                          )}
                          {news.importance === "high" && (
                            <Badge variant="warning">
                              <T k="pageLabels.important" />
                            </Badge>
                          )}
                        </div>
                        <CardTitle dir="auto">
                          {(locale === "ar" && news.titleAr) || news.title}
                        </CardTitle>
                        {news.source && (
                          <CardDescription>
                            {formatMessage(t["settingsPages.newsSource"], { source: news.source })}
                          </CardDescription>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(news.publishedAt), {
                          addSuffix: true,
                          locale: locale === "ar" ? arLocale : undefined,
                        })}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground" dir="auto">
                      {(locale === "ar" && news.summaryAr) || news.summary}
                    </p>
                    {news.effectiveDate && (
                      <p className="text-sm mt-2">
                        {formatMessage(t["settingsPages.newsEffective"], {
                          date: formatDate(news.effectiveDate, locale),
                        })}
                      </p>
                    )}
                    {news.sourceUrl && (
                      <Button variant="ghost" className="p-0 mt-2" asChild>
                        <a href={news.sourceUrl} target="_blank" rel="noopener noreferrer">
                          <T k="pageLabels.readMore" />{" "}
                          <ChevronRight className="w-4 h-4 ms-1 rtl:-scale-x-100" aria-hidden />
                        </a>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
