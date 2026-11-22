import { currentUserQueryKey } from "@/hooks/useCurrentUser";
import { fetchCurrentUser, setStoredUser } from "./auth";
import { queryClient } from "./queryClient";

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
  // Sign-in can happen within the workspace shell, where the company query is already mounted.
  void queryClient.invalidateQueries({ queryKey: ["/api/companies"], exact: true });
  await queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
  return currentUser;
}
