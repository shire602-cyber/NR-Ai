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

  function handleClick(n: AppNotification) {
    if (!n.isRead) markAsRead(n.id);
    if (n.actionUrl) {
      navigate(n.actionUrl);
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
              ? t["components.notificationsUnreadAria"].replace("{count}", String(unreadCount))
              : t["components.notificationsTitle"]
          }
        >
          <Bell aria-hidden="true" />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="money absolute -top-0.5 -end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-danger-foreground ring-2 ring-background"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
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
            recent.map((n) => (
              <div
                key={n.id}
                onClick={() => handleClick(n)}
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
                    className="text-[13px] font-medium leading-snug truncate text-start"
                  >
                    {n.title}
                  </p>
                  <p
                    dir="auto"
                    className="text-xs text-muted-foreground leading-snug line-clamp-2 mt-0.5 text-start"
                  >
                    {n.message}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
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
            ))
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
