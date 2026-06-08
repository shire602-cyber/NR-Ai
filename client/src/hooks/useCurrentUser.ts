import { fetchCurrentUser } from '@/lib/auth';
import { useQuery } from '@tanstack/react-query';

export const currentUserQueryKey = ['/api/auth/me'] as const;

export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserQueryKey,
    queryFn: fetchCurrentUser,
    staleTime: 60_000,
    retry: false,
  });
}
