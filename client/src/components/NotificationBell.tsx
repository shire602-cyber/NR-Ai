import { useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNotifications, type AppNotification } from "@/hooks/useNotifications";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { localizeNotification } from "@/lib/notification-display";

function timeAgo(iso: string, locale: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale === "ar" ? "ar-AE" : "en", {
    numeric: "auto",
    style: "short",
  });
  if (mins < 60) return rtf.format(-Math.max(mins, 0), "minute");
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return rtf.format(-hrs, "hour");
  return rtf.format(-Math.floor(hrs / 24), "day");
}

function priorityDot(priority: string) {
  if (priority === "urgent") return "bg-danger";
  if (priority === "high") return "bg-warning";
  return "bg-info";
}

export function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const { t, locale } = useTranslation();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);

  const recent = notifications.slice(0, 10);
  // Spec 3.5: the count is neutral; it turns red only when something unread is overdue/urgent.
  const hasOverdue = notifications.some(
    (n) => !n.isRead && (n.priority === "urgent" || /overdue/i.test(n.type ?? ""))
  );

  function handleClick(n: AppNotification, actionUrl: string | null | undefined) {
    if (!n.isRead) markAsRead(n.id);
    if (actionUrl) {
      navigate(actionUrl);
      setOpen(false);
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative text-muted-foreground hover:text-foreground"
          data-testid="button-notifications"
          aria-label={
            unreadCount > 0
              ? t["components.notificationsUnreadAria"].replace(
                  "{count}",
                  unreadCount > 9 ? "9+" : String(unreadCount)
                )
              : t["components.notificationsTitle"]
          }
        >
          <Bell aria-hidden="true" />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              dir="ltr"
              data-tone={hasOverdue ? "danger" : "neutral"}
              className={cn(
                "money absolute -top-1 -end-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-caption font-semibold leading-none ring-2 ring-background",
                hasOverdue ? "bg-danger text-danger-foreground" : "bg-foreground text-background"
              )}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-[22rem] max-w-[calc(100vw-1.5rem)] p-0"
        sideOffset={8}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">{t["components.notificationsTitle"]}</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 min-h-7 gap-1 px-2 text-xs text-muted-foreground"
              onClick={markAllAsRead}
            >
              <CheckCheck className="!size-3.5" />
              {t["components.notificationsMarkAllRead"]}
            </Button>
          )}
        </div>

        <div className="max-h-[22rem] overflow-y-auto">
          {recent.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {t["components.notificationsEmpty"]}
            </p>
          ) : (
            recent.map((n) => {
              const view = localizeNotification(
                n,
                t as Record<string, string>,
                locale === "ar" ? "ar" : "en"
              );
              return (
                <div
                  key={n.id}
                  onClick={() => handleClick(n, view.actionUrl ?? n.actionUrl)}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/60 transition-colors duration-fast border-b border-border last:border-0",
                    !n.isRead && "bg-primary/[0.03]"
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 h-2 w-2 flex-shrink-0 rounded-full",
                      n.isRead ? "bg-transparent" : priorityDot(n.priority)
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <p
                      dir="auto"
                      className="truncate text-start text-small font-medium leading-snug"
                    >
                      {view.title}
                    </p>
                    <p
                      dir="auto"
                      className="mt-0.5 line-clamp-2 text-start text-caption text-muted-foreground"
                    >
                      {view.message}
                    </p>
                    {view.setupEmailHref ? (
                      <button
                        type="button"
                        className="mt-1 text-caption font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!n.isRead) markAsRead(n.id);
                          navigate(view.setupEmailHref as string);
                          setOpen(false);
                        }}
                        data-testid={`notification-setup-email-${n.id}`}
                      >
                        {t["components.notificationEmailNotSetUpLink"]}
                      </button>
                    ) : null}
                    <p className="mt-1 text-caption text-muted-foreground">
                      {timeAgo(n.createdAt, locale)}
                    </p>
                  </div>
                  {!n.isRead && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 min-h-6 w-6 p-0 flex-shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label={t["components.notificationsMarkRead"]}
                      onClick={(e) => {
                        e.stopPropagation();
                        markAsRead(n.id);
                      }}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {notifications.length > 10 && (
          <div className="px-2 py-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              onClick={() => {
                navigate("/notifications");
                setOpen(false);
              }}
            >
              {t["components.notificationsViewAll"]}
            </Button>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
