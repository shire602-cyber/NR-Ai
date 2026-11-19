import { currentUserQueryKey } from "@/hooks/useCurrentUser";
import { fetchCurrentUser, setStoredUser } from "./auth";
import { queryClient } from "./queryClient";
import { prefetchPortalData } from "./portal-prefetch";

export async function establishAuthenticatedSession(authUser: any): Promise<any> {
  await queryClient.cancelQueries({ queryKey: currentUserQueryKey });
  setStoredUser(authUser);
  queryClient.setQueryData(currentUserQueryKey, authUser);

  const currentUser = await fetchCurrentUser();
  if (!currentUser) {
    queryClient.setQueryData(currentUserQueryKey, null);
    throw new Error(
      "Login succeeded, but the browser session was not established. Please refresh and try again."
    );
  }

  queryClient.setQueryData(currentUserQueryKey, currentUser);
  // A portal customer lands on the portal dashboard: start loading its data right now.
  if (currentUser.userType === "client_portal") prefetchPortalData(queryClient);
  await queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
  return currentUser;
}
