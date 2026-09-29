import type { Response } from "express";

/**
 * Honest response for a feature that is not built (or deliberately switched
 * off): HTTP 501 with a stable machine-readable code. Use instead of faking
 * success so no caller believes something happened that did not.
 */
export const NOT_AVAILABLE_CODE = "NOT_AVAILABLE";

export function sendNotAvailable(res: Response, message: string) {
  return res.status(501).json({ message, code: NOT_AVAILABLE_CODE });
}
