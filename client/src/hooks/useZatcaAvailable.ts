/**
 * Owner decision (2026-11-18): Saudi ZATCA is hidden at launch behind a server flag (default
 * off, GET /api/features). A ZATCA surface (settings page, navigation, e-invoicing link, the
 * Saudi country option, the 15% KSA rate) shows only when the flag is on AND, for company-
 * specific surfaces, the company is Saudi.
 */
import { useQuery } from "@tanstack/react-query";
import { isSaudiCompany } from "@/lib/company-country";

export interface ServerFeatures {
  zatca: boolean;
}

export const FEATURES_QUERY_KEY = ["/api/features"] as const;

/** The ZATCA flag alone (false while loading or on error). */
export function useZatcaFlag(): boolean {
  const { data } = useQuery<ServerFeatures>({
    queryKey: FEATURES_QUERY_KEY,
    staleTime: Infinity,
    retry: false,
  });
  return data?.zatca === true;
}

/** ZATCA for this company: the flag is on and the company is registered in Saudi Arabia. */
export function useZatcaAvailable(
  company: { addressCountry?: string | null } | null | undefined
): boolean {
  const flag = useZatcaFlag();
  return flag && isSaudiCompany(company);
}
