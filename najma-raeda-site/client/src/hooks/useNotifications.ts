import { useState, useEffect, useCallback, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthHeaders } from "@/lib/auth";
import { API_BASE_URL, apiUrl } from "@/lib/api";
import { useCurrentUser } from "./useCurrentUser";

export interface AppNotification {
  id: string;
  userId: string;
  companyId?: string | null;
  type: string;
  title: string;
  message: string;
  priority: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  actionUrl?: string | null;
  isRead: boolean;
  readAt?: string | null;
  isDismissed: boolean;
  createdAt: string;
}

export interface UseNotificationsReturn {
  notifications: AppNotification[];
  unreadCount: number;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  isConnected: boolean;
}

export function useNotifications(): UseNotificationsReturn {
  const { data: user } = useCurrentUser();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/notifications"), {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      // network error — silently ignore
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    fetchNotifications();

    const socket = io(API_BASE_URL || window.location.origin, {
      path: "/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));

    socket.on("notification:new", (notification: AppNotification) => {
      setNotifications((prev) => [notification, ...prev]);
      setUnreadCount((prev) => prev + 1);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [fetchNotifications, user]);

  const markAsRead = useCallback(async (id: string) => {
    try {
      const res = await fetch(apiUrl(`/api/notifications/${id}/read`), {
        method: "PATCH",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) return;
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // ignore
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/notifications/read-all"), {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) return;
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  }, []);

  return { notifications, unreadCount, markAsRead, markAllAsRead, isConnected };
}
