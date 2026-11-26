import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileCheck2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { translateNow } from "@/lib/i18n";

type AppointmentState =
  | "not_started"
  | "terms_outdated"
  | "awaiting_emaratax"
  | "active"
  | "revoked"
  | "not_required";

interface PartnerResponse {
  partner: {
    provider: string;
    displayName: string;
    termsUrl: string | null;
    termsVersion: string;
    requiresAppointment: boolean;
  };
  appointment: {
    termsAcceptedAt: string;
    emarataxConfirmedAt: string | null;
    revokedAt: string | null;
  } | null;
  state: AppointmentState;
}

const STATE_BADGE: Record<
  AppointmentState,
  { label: string; variant: "success" | "warning" | "neutral" | "danger" | "info" }
> = {
  active: { label: "Active", variant: "success" },
  awaiting_emaratax: { label: "Step 2 of 2", variant: "warning" },
  not_started: { label: "Not set up", variant: "neutral" },
  terms_outdated: { label: "New terms", variant: "warning" },
  revoked: { label: "Switched off", variant: "danger" },
  not_required: { label: "Test mode", variant: "info" },
};

/**
 * Client setup for e-invoicing under the reseller model: the client accepts the
 * accredited partner's own terms, then appoints that partner in EmaraTax. The
 * server blocks invoice submission until both steps are recorded.
 */
export function EInvoicingPartnerCard({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const [agreed, setAgreed] = useState(false);
  const [appointed, setAppointed] = useState(false);
  const queryKey = ["/api/companies", companyId, "einvoice/partner"];
  const base = `/api/companies/${companyId}/einvoice/partner`;

  const { data, isLoading } = useQuery<PartnerResponse>({ queryKey, enabled: !!companyId });

  const onDone = (message: string) => () => {
    queryClient.invalidateQueries({ queryKey });
    setAgreed(false);
    setAppointed(false);
    toast({ title: message });
  };
  const onError = (err: any) =>
    toast({ title: translateNow("toasts.couldNotSave"), description: err?.message, variant: "destructive" });

  const accept = useMutation({
    mutationFn: () =>
      apiRequest("POST", `${base}/accept-terms`, {
        accepted: true,
        termsVersion: data?.partner.termsVersion,
      }),
    onSuccess: onDone("Partner terms accepted"),
    onError,
  });
  const confirm = useMutation({
    mutationFn: () => apiRequest("POST", `${base}/confirm-emaratax`, { confirmed: true }),
    onSuccess: onDone("E-invoicing is active"),
    onError,
  });
  const revoke = useMutation({
    mutationFn: () => apiRequest("POST", `${base}/revoke`),
    onSuccess: onDone("E-invoicing switched off"),
    onError,
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="py-6">
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const { partner, state } = data;
  const badge = STATE_BADGE[state];
  const needsTerms = state === "not_started" || state === "terms_outdated" || state === "revoked";

  return (
    <Card data-testid="einvoicing-partner-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileCheck2 className="w-5 h-5 text-primary" />
            <div>
              <CardTitle>E-invoicing</CardTitle>
              <CardDescription>
                Your e-invoices are sent through {partner.displayName}, a Ministry of Finance
                accredited service provider.
              </CardDescription>
            </div>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {state === "not_required" && (
          // i18n-ignore: UI copy awaiting AR sweep
          <p className="text-muted-foreground">
            No accredited partner is connected in this environment, so nothing is sent to the FTA.
          </p>
        )}

        {needsTerms && (
          <section className="space-y-3">
            <h3 className="font-medium">Step 1: Accept {partner.displayName}'s terms</h3>
            <p className="text-muted-foreground">
              {state === "terms_outdated"
                ? `${partner.displayName} has updated its terms. Please review and accept them to keep sending e-invoices.`
                : `Your company signs up with ${partner.displayName} directly. We connect your invoices to it.`}
            </p>
            {partner.termsUrl ? (
              <>
                <a
                  href={partner.termsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  Read {partner.displayName}'s terms (version {partner.termsVersion})
                </a>
                <label className="flex items-start gap-2">
                  <Checkbox
                    checked={agreed}
                    onCheckedChange={(v) => setAgreed(v === true)}
                    data-testid="einvoice-terms-checkbox"
                  />
                  <span>I have read these terms and accept them on behalf of my company.</span>
                </label>
                {/* i18n-ignore: UI copy awaiting AR sweep */}
                <Button disabled={!agreed || accept.isPending} onClick={() => accept.mutate()}>
                  Accept terms
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">
                {partner.displayName}'s terms are not published here yet. Setup opens once they are.
              </p>
            )}
          </section>
        )}

        {state === "awaiting_emaratax" && (
          <section className="space-y-3">
            <h3 className="font-medium">Step 2: Appoint {partner.displayName} in EmaraTax</h3>
            <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
              <li>Sign in to EmaraTax with your company's account.</li> {/* i18n-ignore: UI copy awaiting AR sweep */}
              <li>Open the e-invoicing service and choose to appoint a service provider.</li>
              <li>Select {partner.displayName} from the list and submit.</li>
            </ol>
            {/* i18n-ignore: UI copy awaiting AR sweep */}
            <p className="text-muted-foreground">
              Businesses under AED 50 million revenue must appoint a provider by 31 March 2027.
            </p>
            <label className="flex items-start gap-2">
              <Checkbox
                checked={appointed}
                onCheckedChange={(v) => setAppointed(v === true)}
                data-testid="einvoice-emaratax-checkbox"
              />
              <span>I have appointed {partner.displayName} in EmaraTax.</span>
            </label>
            {/* i18n-ignore: UI copy awaiting AR sweep */}
            <Button disabled={!appointed || confirm.isPending} onClick={() => confirm.mutate()}>
              Confirm
            </Button>
          </section>
        )}

        {state === "active" && (
          // i18n-ignore: UI copy awaiting AR sweep
          <p className="text-muted-foreground">
            You can now send invoices for clearance from each invoice's e-invoicing menu.
          </p>
        )}

        {(state === "active" || state === "awaiting_emaratax") && (
          <Button
            variant="outline"
            disabled={revoke.isPending}
            onClick={() => {
              if (
                window.confirm(
                  "Switch off e-invoicing? Invoices will not be sent until you set it up again."
                )
              )
                revoke.mutate();
            }}
            // i18n-ignore: UI copy awaiting AR sweep
          >
            Switch off e-invoicing
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
