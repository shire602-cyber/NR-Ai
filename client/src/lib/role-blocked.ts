/**
 * A tiny store for "the server said 403 ROLE_REQUIRED to a page load". The shell shows one standard notice for it
 * instead of every screen toasting its own error. Background requests of the shell itself are ignored.
 */
import { useSyncExternalStore } from "react";

const SHELL_BACKGROUND = ["/api/notifications", "/api/onboarding", "/api/subscription", "/api/auth", "/api/push", "/api/version", "/api/csrf"];

export function isShellBackgroundKey(key: readonly unknown[]): boolean {
  const first = typeof key[0] === "string" ? key[0] : "";
  return SHELL_BACKGROUND.some((p) => first.startsWith(p));
}

export function isRoleRequiredError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === "ROLE_REQUIRED" && (error as { status?: unknown }).status === 403;
}

let blockedPath: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const currentPath = () => (typeof window === "undefined" ? "" : window.location.pathname);

/** Called for a failed query. Idempotent per page: a screen with five forbidden queries produces one notice. */
export function reportRoleRequired(error: unknown, queryKey: readonly unknown[]): void {
  if (!isRoleRequiredError(error) || isShellBackgroundKey(queryKey)) return;
  const path = currentPath();
  if (blockedPath === path) return;
  blockedPath = path;
  emit();
}

export function clearRoleBlocked(): void {
  if (blockedPath === null) return;
  blockedPath = null;
  emit();
}

export const getRoleBlockedPath = (): string | null => blockedPath;

/** The path that was blocked, or null. The notice shows only while the user is still on that path. */
export function useRoleBlockedPath(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => blockedPath,
    () => null
  );
}

/** For tests. */
export function __resetRoleBlocked(): void {
  blockedPath = null;
  listeners.clear();
}
