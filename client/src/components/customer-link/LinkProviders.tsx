import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * The only providers the no-login e-mail pages need: data fetching and tooltips. No toasts and
 * no form-validation (zod) setup, so a customer opening an invoice link does not download them.
 */
export default function LinkProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
