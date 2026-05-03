import { currentUserQueryKey } from '@/hooks/useCurrentUser';
import { fetchCurrentUser, setStoredUser } from './auth';
import { queryClient } from './queryClient';

export async function establishAuthenticatedSession(authUser: any): Promise<any> {
  await queryClient.cancelQueries({ queryKey: currentUserQueryKey });

  // Optimistically replace the pre-login `/auth/me` null cache so route guards
  // do not bounce the user back to /login while the verified request runs.
  setStoredUser(authUser);
  queryClient.setQueryData(currentUserQueryKey, authUser);

  const currentUser = await fetchCurrentUser();
  if (!currentUser) {
    queryClient.setQueryData(currentUserQueryKey, null);
    throw new Error(
      'Login succeeded, but the browser session was not established. Please refresh and try again.',
    );
  }

  queryClient.setQueryData(currentUserQueryKey, currentUser);
  await queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
  return currentUser;
}
