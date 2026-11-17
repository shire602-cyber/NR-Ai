/**
 * E2: the provider-aware Settings → E-invoicing card.
 *
 * GET /api/companies/:id/einvoicing/provider says which accredited provider this deployment uses
 * (only when it is selected AND configured). With one, that provider's own card is shown (its
 * name, MoF accreditation number, onboarding steps). With none, a neutral "Not connected" card
 * that names no provider and claims no connection, with Request connection.
 *
 * To drop a provider: remove its card import and its line in PROVIDER_CARDS.
 */
import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "@/lib/i18n";
import { AcubeConnectCard } from "./AcubeConnectCard";
import { ComplyanceConnectCard } from "./ComplyanceConnectCard";
import {
  FiveCorners,
  MandateTimeline,
  ProviderFacts,
  RequestConnection,
  ScopeNotes,
  type GoLiveView,
} from "./ProviderCardParts";

const PROVIDER_CARDS: Record<string, ComponentType<{ companyId: string }>> = {
  acube: AcubeConnectCard,
  complyance: ComplyanceConnectCard,
};

export interface ProviderInfoView {
  provider: {
    id: string;
    displayName: string;
    legalName: string;
    accreditationNumber: string;
    registerUrl: string;
    environment: "sandbox" | "production";
  } | null;
  registerUrl: string;
  tin: string | null;
  goLive: GoLiveView;
}

function NotConnectedCard({ info }: { info: ProviderInfoView | undefined }) {
  const { t } = useTranslation();
  return (
    <SectionCard
      testId="einvoice-provider-card"
      title={t["einvoicing.providerCardTitle"]}
      description={t["einvoicing.providerCardDescription"]}
      actions={
        <StatusBadge tone="neutral" data-testid="einvoice-provider-status">
          {t["einvoicing.acubeNotConnected"]}
        </StatusBadge>
      }
    >
      <div className="space-y-6">
        <section aria-labelledby="provider-model-title" className="space-y-3">
          <h3 id="provider-model-title" className="text-small font-semibold text-foreground">
            {t["einvoicing.modelTitle"]}
          </h3>
          <FiveCorners
            prefix="provider"
            corner2Title={t["einvoicing.corner2TitleNeutral"]}
            corner5Body={t["einvoicing.corner5BodyNeutral"]}
          />
        </section>
        <RequestConnection
          testId="einvoice-provider-not-connected"
          buttonTestId="einvoice-provider-request-connection"
          title={t["einvoicing.providerNotConnectedHeading"]}
          body={t["einvoicing.providerNotConnectedBody"]}
          subject={t["einvoicing.requestConnectionSubjectNeutral"]}
        />
        {info && (
          <>
            <ProviderFacts
              prefix="provider"
              goLiveDate={info.goLive.goLiveDate}
              registerUrl={info.registerUrl}
            />
            <MandateTimeline
              prefix="provider"
              goLive={info.goLive}
              reportWindowText={t["einvoicing.reportWindowAssumptionNeutral"]}
            />
          </>
        )}
        <ScopeNotes prefix="provider" />
      </div>
    </SectionCard>
  );
}

export function EInvoiceProviderCard({ companyId }: { companyId: string }) {
  const info = useQuery<ProviderInfoView>({
    queryKey: ["/api/companies", companyId, "einvoicing", "provider"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/einvoicing/provider`),
    retry: false,
  });
  if (info.isLoading) {
    return <div className="h-40 animate-pulse rounded-xl bg-muted" aria-busy="true" />;
  }
  const Card = info.data?.provider ? PROVIDER_CARDS[info.data.provider.id] : undefined;
  return Card ? <Card companyId={companyId} /> : <NotConnectedCard info={info.data} />;
}
