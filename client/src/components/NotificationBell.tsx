import { useState } from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useNotifications, type AppNotification } from '@/hooks/useNotifications';
import { useLocation } from 'wouter';
import { cn } from '@/lib/utils';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function priorityDot(priority: string) {
  if (priority === 'urgent') return 'bg-red-500';
  if (priority === 'high') return 'bg-orange-400';
  return 'bg-blue-400';
}

export function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
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
          size="sm"
          className="relative"
          data-testid="button-notifications"
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : 'Notifications'
          }
        >
          <Bell className="w-4 h-4" aria-hidden="true" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              aria-hidden="true"
              className="absolute -top-1 -right-1 h-4 min-w-[1rem] px-1 text-[10px] flex items-center justify-center"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0" sideOffset={8}>
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={markAllAsRead}
            >
              <CheckCheck className="w-3 h-3 mr-1" />
              Mark all read
            </Button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No notifications</p>
          ) : (
            recent.map((n) => (
              <div
                key={n.id}
                onClick={() => handleClick(n)}
                className={cn(
                  'flex items-start gap-2 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors border-b last:border-0',
                  !n.isRead && 'bg-muted/30'
                )}
              >
                <span
                  className={cn(
                    'mt-1.5 h-2 w-2 flex-shrink-0 rounded-full',
                    n.isRead ? 'bg-transparent' : priorityDot(n.priority)
                  )}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug truncate">{n.title}</p>
                  <p className="text-xs text-muted-foreground leading-snug line-clamp-2 mt-0.5">
                    {n.message}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.createdAt)}</p>
                </div>
                {!n.isRead && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 flex-shrink-0 opacity-50 hover:opacity-100"
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
          <div className="px-3 py-2 border-t">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              onClick={() => { navigate('/notifications'); setOpen(false); }}
            >
              View all notifications
            </Button>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
