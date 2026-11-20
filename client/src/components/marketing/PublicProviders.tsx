// zod 3-compatible validation messages for the auth forms (R17-27); see App.tsx.
import "@shared/zod-config";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Data and feedback providers for the public pages that need them (auth forms,
 * demo, help, legal). Loaded lazily by PublicApp so the landing page and
 * pricing do not download React Query. Uses the app's shared `queryClient`, so
 * a session started here (sign-in) is already cached when <App /> takes over.
 */
export default function PublicProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
