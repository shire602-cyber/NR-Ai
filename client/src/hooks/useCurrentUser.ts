import { useQuery } from '@tanstack/react-query';
import { fetchCurrentUser } from '@/lib/auth';

export const currentUserQueryKey = ['/api/auth/me'] as const;

export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserQueryKey,
    queryFn: fetchCurrentUser,
    staleTime: 60_000,
    // fetchCurrentUser resolves null for a real 401 (after a refresh
    // attempt), so any thrown error here is transient — rate limiting,
    // network, 5xx. Retry those instead of treating them as logged-out.
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });
}
