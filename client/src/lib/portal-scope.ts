import { createContext, useContext } from "react";

/** The supplier shown by the portal shell, shared by its data and actions. */
export const PortalAccountScope = createContext<string | null>(null);

export function usePortalAccountScope(): string {
  const account = useContext(PortalAccountScope);
  if (!account) throw new Error("Portal pages require a selected supplier");
  return account;
}
