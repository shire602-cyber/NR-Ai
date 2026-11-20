// Reports page context (W5-A, R20-09).
import { createContext, useContext } from "react";
import type { useReportsPage } from "./useReportsPage";

export type ReportsPageState = ReturnType<typeof useReportsPage>;

export const ReportsPageContext = createContext<ReportsPageState | null>(null);

export function useReportsPageContext(): ReportsPageState {
  const value = useContext(ReportsPageContext);
  if (!value) throw new Error("useReportsPageContext must be used inside the Reports page");
  return value;
}
