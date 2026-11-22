/**
 * E2: the provider-aware Settings → E-invoicing card.
 *
 * The company provider endpoint returns connection availability for its selected provider.
 * Configured providers supply their own card; the neutral card explains unavailable connections.
 *
 * To drop a provider: remove its card import and its line in PROVIDER_CARDS.
 */
import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
  status: "not_selected" | "not_configured" | "configured";
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
          {
            t[
              info?.status === "not_configured"
                ? "einvoicing.providerNotConfigured"
                : "einvoicing.notConnected"
            ]
          }
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
  if (info.isError) return <ProviderLoadError retry={() => void info.refetch()} />;
  const Card = info.data?.provider ? PROVIDER_CARDS[info.data.provider.id] : undefined;
  return Card ? <Card companyId={companyId} /> : <NotConnectedCard info={info.data} />;
}

function ProviderLoadError({ retry }: { retry: () => void }) {
  const { t } = useTranslation();
  return (
    <SectionCard title={t["einvoicing.providerCardTitle"]}>
      <div className="flex flex-wrap items-center gap-2" role="alert">
        <p className="text-small text-muted-foreground">{t["einvoicing.loadFailed"]}</p>
        <Button variant="link" className="min-h-11" onClick={retry}>
          {t["einvoicing.retry"]}
        </Button>
      </div>
    </SectionCard>
  );
}
