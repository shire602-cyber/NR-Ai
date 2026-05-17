import { useQuery } from "@tanstack/react-query";
import { fetchCurrentUser } from "@/lib/auth";

export const currentUserQueryKey = ["/api/auth/me"] as const;

export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserQueryKey,
    queryFn: fetchCurrentUser,
    staleTime: 60_000,
    retry: false,
  });
}
