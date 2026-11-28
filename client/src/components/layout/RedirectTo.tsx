import { Redirect } from "wouter";
import { mergeLegacySearch } from "@/lib/route-config";

interface RedirectToProps {
  /** Destination path, optionally with a query string (`/ai?tab=chat`). */
  to: string;
  /** Drop obsolete tokens from retired callback URLs. */
  preserveSearch?: boolean;
}

/**
 * Replace-navigation for consolidated/legacy routes. The query string of the
 * legacy URL is carried over (destination params win), so deep links such as
 * `/advanced-reports?tab=comparison` keep their state after the redirect.
 */
export function RedirectTo({ to, preserveSearch = true }: RedirectToProps) {
  return <Redirect to={preserveSearch ? mergeLegacySearch(to, safeSearch()) : to} replace />;
}

function safeSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}
