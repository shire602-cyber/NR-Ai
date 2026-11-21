import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { useToast } from "@/hooks/use-toast";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { ApiError, apiRequest } from "@/lib/queryClient";
import type { EInvoiceEnvironmentVerification } from "./einvoice-meta";

export default function EInvoiceTrackingNotice({
  invoiceId,
  verification,
  providerName,
  onVerified,
}: {
  invoiceId: string;
  verification?: EInvoiceEnvironmentVerification | null;
  providerName: string;
  onVerified: () => void;
}) {
  const { t } = useTranslation();
  const permission = useCompanyPermission();
  const access = permission.gate("tax.submit");
  const { toast } = useToast();
  const groupId = useId();
  const [selected, setSelected] = useState<"sandbox" | "production" | null>(null);
  const verify = useMutation({
    mutationFn: (environment: "sandbox" | "production") =>
      apiRequest("POST", `/api/invoices/${invoiceId}/einvoice/confirm-environment`, {
        environment,
      }),
    onSuccess: () => {
      onVerified();
      toast({ title: t["einvoicing.trackingVerified"] });
    },
    onError: (error) =>
      toast({
        variant: "destructive",
        title: t["einvoicing.trackingVerificationFailed"],
        description: error instanceof ApiError && error.status > 0 ? error.message : undefined,
      }),
  });

  if (!verification?.environments.length) {
    return (
      <p className="rounded-lg bg-surface-sunken p-4 text-small" role="status">
        {t["einvoicing.trackingCredentialsUnavailable"]}
      </p>
    );
  }

  const disabled = !permission.known || access.disabled || verify.isPending;
  return (
    <div
      className="space-y-3 rounded-lg bg-surface-sunken p-4 text-small"
      data-testid="einvoice-tracking-verification"
    >
      <p>{formatMessage(t["einvoicing.trackingVerificationHelp"], { provider: providerName })}</p>
      <fieldset disabled={disabled} className="flex flex-wrap gap-x-4 gap-y-2">
        <legend className="mb-2 font-medium">{t["einvoicing.trackingEnvironment"]}</legend>
        {verification.environments.map((environment) => (
          <label className="inline-flex items-center gap-2" key={environment}>
            <input
              type="radio"
              name={groupId}
              className="size-4 accent-primary"
              checked={selected === environment}
              onChange={() => setSelected(environment)}
              data-testid={`einvoice-tracking-${environment}`}
            />
            {t[environment === "sandbox" ? "einvoicing.sandbox" : "einvoicing.production"]}
          </label>
        ))}
      </fieldset>
      <Button
        size="sm"
        type="button"
        {...access}
        disabled={disabled || !selected || !verification.environments.includes(selected)}
        onClick={() => selected && verify.mutate(selected)}
        data-testid="einvoice-tracking-confirm"
      >
        {t[verify.isPending ? "einvoicing.trackingVerifying" : "einvoicing.trackingVerifyAndSave"]}
      </Button>
    </div>
  );
}
