import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Building2,
  FileSpreadsheet,
  Gauge,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import type { Company } from "@shared/schema";
import { OnboardingShell, StepActions, StepHeading } from "./OnboardingShell";
import { InviteField } from "./InviteField";

/*
 * Firm-owner onboarding (NR-internal firm workspace, spec 3.3): the same shell as the customer
 * flow, three steps "Team · Clients · Done". Step 1 invites staff inline (the team invitation
 * the team page sends); step 2 offers adding one client or importing a list; step 3 marks
 * onboarding complete and offers two places to start. No role pill, no new-tab instruction.
 */

type FirmStep = 1 | 2 | 3;
const TOTAL = 3;

function OptionCard({
  icon: Icon,
  title,
  body,
  onClick,
  disabled,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        "group flex flex-col items-start rounded-lg border border-border bg-card p-4 text-start",
        "transition-[border-color,box-shadow] duration-fast hover:border-border-strong hover:shadow-card-soft",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      )}
    >
      <Icon aria-hidden="true" strokeWidth={1.5} className="h-5 w-5 text-primary" />
      <span className="mt-3 text-[0.9375rem] font-semibold">{title}</span>
      <span className="mt-1 text-small text-muted-foreground">{body}</span>
      <ArrowRight
        aria-hidden="true"
        className="mt-3 h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary rtl:rotate-180"
      />
    </button>
  );
}

export function FirmOnboarding({ firmRole }: { firmRole: "firm_owner" | "firm_admin" }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [step, setStep] = useState<FirmStep>(1);
  const isOwner = firmRole === "firm_owner";

  // Registration always seeds a company; the firm flow does not ask the user to fill it in,
  // it only marks onboarding complete so ProtectedLayout stops redirecting here.
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const company = companies?.[0];

  const complete = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${company!.id}/onboarding/complete`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/companies"] }),
    onError: (err: Error) =>
      toast({
        title: t["onboarding.firm.setupFailed"],
        description: err.message,
        variant: "destructive",
      }),
  });

  const finishAndGo = async (path: string) => {
    if (company && !complete.isSuccess) await complete.mutateAsync();
    setLocation(path);
  };

  const toDone = async () => {
    if (company && !complete.isSuccess) await complete.mutateAsync();
    setStep(3);
  };

  const skip = (
    <Button
      type="button"
      variant="ghost"
      onClick={() => void finishAndGo("/firm/clients")}
      disabled={complete.isPending}
      data-testid="firm-onboarding-skip"
    >
      {t["onboarding.v3Skip"]}
    </Button>
  );

  if (step === 1) {
    return (
      <OnboardingShell step={1} total={TOTAL}>
        <StepHeading
          title={t["onboarding.firm.stepTeam"]}
          lead={isOwner ? t["onboarding.v3FirmTeamLead"] : t["onboarding.firm.teamStaffDesc"]}
        />
        {isOwner ? (
          <InviteField companyId={company?.id} />
        ) : (
          <p className="text-small text-muted-foreground">{t["onboarding.firm.teamStaffBody"]}</p>
        )}
        <StepActions
          secondary={skip}
          primary={
            <Button type="button" onClick={() => setStep(2)} data-testid="onboarding-next">
              {t["onboarding.v3Continue"]}
            </Button>
          }
        />
      </OnboardingShell>
    );
  }

  if (step === 2) {
    return (
      <OnboardingShell step={2} total={TOTAL}>
        <StepHeading
          title={t["onboarding.firm.stepClients"]}
          lead={t["onboarding.firm.clientsDesc"]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <OptionCard
            icon={Building2}
            title={t["pageLabels.addAClient"]}
            body={t["onboarding.firm.addClientDesc"]}
            onClick={() => void finishAndGo("/firm/clients")}
            disabled={complete.isPending}
            testId="firm-onboarding-add-client"
          />
          <OptionCard
            icon={FileSpreadsheet}
            title={t["pageLabels.importInBulk"]}
            body={t["onboarding.firm.bulkDesc"]}
            onClick={() => void finishAndGo("/firm/bulk")}
            disabled={complete.isPending}
            testId="firm-onboarding-bulk"
          />
        </div>
        <StepActions
          onBack={() => setStep(1)}
          primary={
            <Button
              type="button"
              onClick={() => void toDone()}
              disabled={complete.isPending}
              data-testid="firm-onboarding-finish"
            >
              {complete.isPending ? t["onboarding.firm.finishing"] : t["onboarding.v3Continue"]}
            </Button>
          }
        />
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell step={3} total={TOTAL}>
      <StepHeading
        title={t["pageLabels.yourFirmIsSetUp"]}
        lead={t["onboarding.firm.completeDesc"]}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <OptionCard
          icon={Users}
          title={t["pageLabels.goToClients"]}
          body={t["onboarding.v3FirmDoneClients"]}
          onClick={() => setLocation("/firm/clients")}
          testId="firm-onboarding-go"
        />
        <OptionCard
          icon={Gauge}
          title={t["onboarding.v3FirmDoneHealth"]}
          body={t["onboarding.v3FirmDoneHealthBody"]}
          onClick={() => setLocation("/firm/health")}
          testId="firm-onboarding-health"
        />
      </div>
    </OnboardingShell>
  );
}
