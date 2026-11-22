import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface PortalCompany {
  accountId: string;
  name: string;
  logoUrl?: string | null;
  firmName?: string | null;
  customer?: { name: string; nameAr?: string | null };
}

export const PortalSupplierContext = createContext<{
  company: PortalCompany;
  switchSupplier: (accountId: string) => void;
} | null>(null);

export function usePortalSupplier() {
  return useContext(PortalSupplierContext);
}

export function portalSupplierHeaders(accountId: string) {
  return { "X-Portal-Account": accountId };
}

export function usePortalSupplierQuery<T>(key: string, resource: string, staleTime?: number) {
  const accountId = usePortalSupplier()?.company.accountId;
  return useQuery<T>({
    queryKey: [key, accountId],
    enabled: !!accountId,
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/client-portal/${resource}`,
        undefined,
        portalSupplierHeaders(accountId!)
      ),
    staleTime,
  });
}
