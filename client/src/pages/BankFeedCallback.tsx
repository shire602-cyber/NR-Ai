import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useTranslation } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import BankFeeds from "./BankFeeds";

function readCallback() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code") ?? params.get("entity_id");
  const state = params.get("state");
  if (!code || !state) return null;
  const provider = params.get("provider") ?? window.sessionStorage.getItem("bankFeedProvider");
  return provider ? { provider, code, state } : null;
}

/** Complete provider returns already in flight before showing reconciliation. */
export default function BankFeedCallback() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { companyId } = useDefaultCompany();
  const [callback] = useState(readCallback);
  const submitted = useRef(false);

  const { mutate } = useMutation({
    mutationFn: ({
      companyId,
      ...payload
    }: {
      companyId: string;
      provider: string;
      code: string;
      state: string;
    }) => apiRequest("POST", `/api/companies/${companyId}/bank-connections/callback`, payload),
    onSuccess: (_data, { companyId }) => {
      void queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "bank-connections"],
      });
      navigate("/bank-feeds", { replace: true });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: t["banking.common.error"],
        description: error.message,
      });
      navigate("/bank-feeds", { replace: true });
    },
  });

  useEffect(() => {
    if (!companyId || !callback || submitted.current) return;
    // Provider callback state is single-use, including during React effect replay.
    submitted.current = true;
    mutate({ companyId, ...callback });
  }, [callback, companyId, mutate]);

  if (!callback) return <BankFeeds />;

  return (
    <div
      className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center"
      role="status"
    >
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      <h1 className="text-h2 text-foreground">{t["banking.feeds.returningToReconciliation"]}</h1>
    </div>
  );
}
