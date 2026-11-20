// zod 3-compatible API/validation messages, as in PublicProviders and App. This also keeps the
// shared toast chunk and the zod message map one chunk (scripts/qa/bundle-baseline.json).
import "@shared/zod-config";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Data, tooltip and toast providers of the signed-in client portal (no forms): the same shared
 * `queryClient` as <App />, so the session probed here is already cached when the full app takes
 * over.
 */
export default function PortalProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
