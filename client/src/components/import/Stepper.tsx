import { Check } from "lucide-react";
import { WIZARD_STEPS, stepIndex, type WizardStep } from "@/lib/import-wizard";
import { messages as pageMessages } from "./Stepper.i18n";

const LABEL = {
  source: "stepSource",
  entity: "stepEntity",
  upload: "stepUpload",
  mapping: "stepMapping",
  review: "stepReview",
  done: "stepDone",
} as const;

export function Stepper({ step }: { step: WizardStep }) {
  const tr = pageMessages.useT();
  const current = stepIndex(step);
  return (
    <nav aria-label={tr("stepsLabel")}>
      <p className="mb-2 text-xs text-muted-foreground sm:hidden">{tr("stepOf", { current: current + 1, total: WIZARD_STEPS.length })}</p>
      <ol className="flex flex-wrap gap-x-4 gap-y-2">
        {WIZARD_STEPS.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s} aria-current={active ? "step" : undefined} className={`flex items-center gap-2 text-sm ${active ? "font-semibold text-foreground" : "text-muted-foreground"} ${active ? "" : "max-sm:hidden"}`}>
              <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${done ? "border-primary bg-primary text-primary-foreground" : active ? "border-primary text-primary" : ""}`}>
                {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : i + 1}
              </span>
              {tr(LABEL[s])}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
