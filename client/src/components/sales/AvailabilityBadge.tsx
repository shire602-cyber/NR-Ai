import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiRequest } from "@/lib/queryClient";
import { availabilityState, salesKeys, type ProductAvailability } from "@/lib/sales-api";
import { messages } from "./SalesShared.i18n";

/** Availability for a set of products (one request); undefined while loading. Untracked products are absent from the map. */
export function useProductAvailability(companyId: string | undefined | null, productIds: Array<string | null | undefined>) {
  const ids = [...new Set(productIds.filter((p): p is string => !!p))].sort();
  const key = ids.join(",");
  const query = useQuery<ProductAvailability[]>({
    queryKey: salesKeys.availability(companyId, key),
    enabled: Boolean(companyId) && ids.length > 0,
    staleTime: 15_000,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/products/availability?ids=${key}`),
  });
  return new Map((query.data ?? []).map((a) => [a.productId, a]));
}

interface Props {
  requested: number;
  availability: Pick<ProductAvailability, "available"> | null | undefined;
  /** Whether the product is stock-tracked: untracked products show nothing. */
  tracked?: boolean;
  testId?: string;
}

/** "In stock" / "Short by N" next to a line quantity. Stock is shown, never reserved. */
export function AvailabilityBadge({ requested, availability, tracked = true, testId }: Props) {
  const tr = messages.useT();
  if (!tracked || !availability) return null;
  const state = availabilityState(requested, availability);
  if (state.tone === "unknown") return null;
  return (
    <StatusBadge tone={state.tone === "short" ? "warning" : "success"} data-testid={testId ?? "availability-badge"}>
      {state.tone === "short" ? tr("availabilityShort", { short: state.shortfall, available: state.available ?? 0 }) : tr("availabilityOk", { available: state.available ?? 0 })}
    </StatusBadge>
  );
}
