import { Redirect } from "wouter";
import { mergeLegacySearch } from "@/lib/route-config";

interface RedirectToProps {
  /** Destination path, optionally with a query string (`/ai?tab=chat`). */
  to: string;
}

/**
 * Replace-navigation for consolidated/legacy routes. The query string of the
 * legacy URL is carried over (destination params win), so deep links such as
 * `/advanced-reports?tab=comparison` keep their state after the redirect.
 */
export function RedirectTo({ to }: RedirectToProps) {
  return <Redirect to={mergeLegacySearch(to, safeSearch())} replace />;
}

/** Forward an authorization return to a path-only destination without reserializing its query. */
export function RawQueryRedirect({ to }: RedirectToProps) {
  return <Redirect to={`${to}${safeSearch()}`} replace />;
}

function safeSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}
