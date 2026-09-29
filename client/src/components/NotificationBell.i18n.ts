import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "NotificationBell",
  {
    notificationsUnread: "Notifications, {unreadCount} unread",
    notifications: "Notifications",
    markAllRead: "Mark all read",
    noNotifications: "No notifications",
    viewAllNotifications: "View all notifications",
  },
  {
    notificationsUnread: "الإشعارات، {unreadCount} غير مقروءة",
    notifications: "الإشعارات",
    markAllRead: "وسم الكل كمقروء",
    noNotifications: "لا توجد إشعارات",
    viewAllNotifications: "عرض جميع الإشعارات",
  }
);
