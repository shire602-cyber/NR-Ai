import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [documentId, setDocumentId] = useState("");
  const verify = useMutation({
    mutationFn: (body: { environment: "sandbox" | "production"; documentId?: string }) =>
      apiRequest("POST", `/api/invoices/${invoiceId}/einvoice/confirm-environment`, body),
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
  const manual = verification.reference === "manual";
  const help =
    verification.reference === "search"
      ? "einvoicing.trackingSearchHelp"
      : manual
        ? "einvoicing.trackingManualHelp"
        : "einvoicing.trackingVerificationHelp";
  const id = documentId.trim();
  return (
    <div
      className="space-y-3 rounded-lg bg-surface-sunken p-4 text-small"
      data-testid="einvoice-tracking-verification"
    >
      <p>{formatMessage(t[help], { provider: providerName })}</p>
      {manual && (
        <label className="block space-y-1">
          <span className="font-medium">{t["einvoicing.trackingDocumentId"]}</span>
          <Input
            value={documentId}
            onChange={(event) => setDocumentId(event.target.value)}
            disabled={disabled}
            dir="ltr"
            data-testid="einvoice-tracking-document-id"
          />
        </label>
      )}
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
        disabled={
          disabled || !selected || !verification.environments.includes(selected) || (manual && !id)
        }
        onClick={() =>
          selected &&
          verify.mutate({ environment: selected, ...(manual ? { documentId: id } : {}) })
        }
        data-testid="einvoice-tracking-confirm"
      >
        {t[verify.isPending ? "einvoicing.trackingVerifying" : "einvoicing.trackingVerifyAndSave"]}
      </Button>
    </div>
  );
}
