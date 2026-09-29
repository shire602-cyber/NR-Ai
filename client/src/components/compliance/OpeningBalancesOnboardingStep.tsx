import { ArrowLeft, ArrowRight, Scale } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useComplianceText } from "@/lib/i18n-compliance";

/**
 * Optional onboarding step: point new users who already have books at the
 * opening-balances page. Never forced: "Skip for now" moves on.
 */
export default function OpeningBalancesOnboardingStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { c } = useComplianceText();
  return (
    <div className="space-y-6" data-testid="onboarding-opening-step">
      <div className="space-y-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <Scale className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{c.obStepTitle}</h2>
          <p className="mt-1 text-muted-foreground">{c.obStepBody}</p>
        </div>
      </div>
      <Button asChild variant="outline" data-testid="link-enter-opening-balances">
        <Link href="/opening-balances">{c.obStepEnter}</Link>
      </Button>
      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ArrowLeft className="h-4 w-4" />
          {c.obStepBack}
        </Button>
        <Button onClick={onNext} className="flex-1 gap-2" data-testid="onboarding-next">
          {c.obStepSkip}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
