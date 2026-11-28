import { useCallback } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { removeToken } from "@/lib/auth";
import { useI18n, useTranslation } from "@/lib/i18n";

/**
 * Sign-out and language switch shared by the sidebar (desktop), the account menu and the
 * mobile "More" sheet, so a phone-width user can reach both (J2).
 */
export function useSessionActions() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { locale } = useTranslation();
  const { setLocale } = useI18n();

  const signOut = useCallback(async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {
      // Network failure shouldn't block local sign-out; cookies still expire.
    }
    removeToken();
    queryClient.clear();
    setLocation("/");
  }, [queryClient, setLocation]);

  const toggleLanguage = useCallback(() => {
    setLocale(locale === "en" ? "ar" : "en");
  }, [locale, setLocale]);

  return { signOut, toggleLanguage, locale };
}
