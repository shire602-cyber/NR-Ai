/**
 * Owner decision (2026-11-18): Saudi ZATCA is hidden at launch. The code stays, behind a server
 * flag that is OFF unless `ZATCA_ENABLED=true`:
 *   - every /api/companies/:id/zatca/* endpoint answers 503 ZATCA_NOT_AVAILABLE;
 *   - GET /api/features reports `zatca: false`, so the app shows no ZATCA settings, links or
 *     navigation, and offers the 15% KSA rate to nobody;
 *   - the server stores and charges the 15% KSA standard rate only for a Saudi company with the
 *     flag on (`vatJurisdictionWithFlag`).
 */
import type { NextFunction, Request, Response } from "express";
import {
  vatJurisdictionForCountry,
  type VatJurisdiction,
} from "../../../shared/vat-classification";

export function zatcaEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    String(env.ZATCA_ENABLED ?? "")
      .trim()
      .toLowerCase() === "true"
  );
}

/** The company's VAT jurisdiction, with Saudi Arabia only while ZATCA is enabled. */
export function vatJurisdictionWithFlag(country: string | null | undefined): VatJurisdiction {
  const j = vatJurisdictionForCountry(country);
  return j === "SA" && !zatcaEnabled() ? "AE" : j;
}

export const ZATCA_NOT_AVAILABLE_MESSAGE =
  "Saudi ZATCA e-invoicing is not available on this service.";

/** 503 for every ZATCA endpoint while the flag is off (mounted ahead of the routes). */
export function requireZatcaEnabled(_req: Request, res: Response, next: NextFunction) {
  if (zatcaEnabled()) return next();
  res.status(503).json({
    code: "ZATCA_NOT_AVAILABLE",
    messageKey: "forms.serverErrors.ZATCA_NOT_AVAILABLE",
    message: ZATCA_NOT_AVAILABLE_MESSAGE,
  });
}
