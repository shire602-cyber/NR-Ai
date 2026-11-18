import { ApiError } from "@/lib/queryClient";
import { translateNow } from "@/lib/i18n";

/**
 * E2 (J3-r2): a specific toast heading for a failed request instead of "Something went wrong".
 * The description keeps the server's (localised) message; the heading says what kind of problem
 * it is so the user knows where to look: the form's fields, their role, the item's state, ...
 */
export type ErrorHeadingKind =
  | "fields"
  | "permission"
  | "notFound"
  | "conflict"
  | "rule"
  | "offline"
  | "server"
  | "generic";

export function errorHeadingKind(err: unknown): ErrorHeadingKind {
  if (!(err instanceof ApiError)) return "generic";
  const body = (err.body ?? {}) as { code?: string; fields?: unknown; errors?: unknown };
  const hasFields =
    (body.fields && typeof body.fields === "object" && Object.keys(body.fields).length > 0) ||
    (body.errors && typeof body.errors === "object" && Object.keys(body.errors).length > 0);
  if (err.status === 0) return "offline";
  if (hasFields || body.code === "VALIDATION_ERROR") return "fields";
  if (err.status === 401 || err.status === 403) return "permission";
  if (err.status === 404) return "notFound";
  if (err.status === 409) return "conflict";
  if (err.status === 422 || err.status === 400) return "rule";
  if (err.status >= 500) return "server";
  return "generic";
}

export function errorHeading(err: unknown): string {
  return translateNow(`common.errorHeading.${errorHeadingKind(err)}`);
}
