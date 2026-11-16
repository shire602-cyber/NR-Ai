import { T } from "@/components/layout/T";
import { Link } from "wouter";
import { useTranslation } from "@/lib/i18n";
import { localizeNotification } from "@/lib/notification-display";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ar as arLocale } from "date-fns/locale";
import {
  Bell,
  CheckCircle,
  X,
  AlertTriangle,
  Clock,
  Newspaper,
  ChevronRight,
  Check,
} from "lucide-react";
import type { Notification, RegulatoryNews } from "@shared/schema";

export default function Notifications() {
  const { toast } = useToast();
  const { t, locale } = useTranslation();
  const [activeTab, setActiveTab] = useState("notifications");

  const { data: notificationsData, isLoading: notificationsLoading } = useQuery<{
    notifications: Notification[];
    unreadCount: number;
  }>({
    queryKey: ["/api/notifications"],
  });

  const { data: regulatoryNews, isLoading: newsLoading } = useQuery<RegulatoryNews[]>({
    queryKey: ["/api/regulatory-news"],
  });

  const markAsReadMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notifications/read-all"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: "All notifications marked as read" });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/notifications/${id}/dismiss`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: "Notification dismissed" });
    },
  });

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

  const getNewsBadge = (category: string) => {
    // Categories are topics, not statuses: one neutral outline pill.
    const label = category.replace("_", " ");
    return (
      <Badge variant="outline" className="capitalize">
        {category === "vat" ? "VAT" : label}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title={t["pageLabels.notificationsPageTitle"]}
        description={t["pageLabels.notificationsPageDesc"]}
        actions={
          activeTab === "notifications" && notificationsData?.unreadCount ? (
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="notifications" data-testid="tab-notifications">
            <Bell aria-hidden />
            <T k="pageLabels.notificationsTab" />
            {notificationsData?.unreadCount ? (
              <Badge variant="danger" className="ms-1 px-1.5 py-0 tabular-nums">
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
          {notificationsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : !notificationsData?.notifications?.length ? (
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
                  const copy = localizeNotification(notification, t as Record<string, string>);
                  const unread = !notification.isRead;
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
                            {copy.title}
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
                        <p className="mt-1.5 text-caption text-muted-foreground">
                          {formatDistanceToNow(new Date(notification.createdAt), {
                            addSuffix: true,
                            locale: locale === "ar" ? arLocale : undefined,
                          })}
                        </p>
                      </div>
                      <div className="-me-2 flex shrink-0 flex-col items-center gap-0.5 sm:me-0 sm:flex-row">
                        {notification.actionUrl && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            asChild
                          >
                            <a
                              href={notification.actionUrl}
                              aria-label={t["pageLabels.notificationOpen"]}
                              title={t["pageLabels.notificationOpen"]}
                            >
                              <ChevronRight className="rtl:-scale-x-100" aria-hidden />
                            </a>
                          </Button>
                        )}
                        {unread && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => markAsReadMutation.mutate(notification.id)}
                            aria-label={t["pageLabels.notificationMarkRead"]}
                            title={t["pageLabels.notificationMarkRead"]}
                            data-testid={`button-read-${notification.id}`}
                          >
                            <Check aria-hidden />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => dismissMutation.mutate(notification.id)}
                          aria-label={t["pageLabels.notificationDismiss"]}
                          title={t["pageLabels.notificationDismiss"]}
                          data-testid={`button-dismiss-${notification.id}`}
                        >
                          <X aria-hidden />
                        </Button>
                      </div>
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
                        <CardTitle>{news.title}</CardTitle>
                        {news.source && <CardDescription>Source: {news.source}</CardDescription>}
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
                    <p className="text-muted-foreground">{news.summary}</p>
                    {news.effectiveDate && (
                      <p className="text-sm mt-2">
                        <strong>Effective:</strong> {formatDate(news.effectiveDate, locale)}
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
