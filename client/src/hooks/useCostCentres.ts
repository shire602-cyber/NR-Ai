import { useQuery } from "@tanstack/react-query";
import type { CostCentreOption } from "@/components/invoices/LineCostCentrePicker";

/** The company's active cost centres (empty when the plan has none or none are set up). */
export function useCostCentres(companyId: string | undefined) {
  return useQuery<CostCentreOption[]>({
    queryKey: ["/api/companies", companyId, "cost-centers"],
    enabled: !!companyId,
    retry: false,
    select: (rows) => (Array.isArray(rows) ? rows.filter((c) => c.isActive !== false) : []),
  });
}
