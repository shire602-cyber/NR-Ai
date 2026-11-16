import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DASHBOARD_PRESETS,
  DASHBOARD_PRESET_LABELS,
  isCompleteChoice,
  type DashboardPeriodChoice,
} from "./period";

const LABELS = DASHBOARD_PRESET_LABELS;

interface PeriodSelectorProps {
  choice: DashboardPeriodChoice;
  onChange: (next: DashboardPeriodChoice) => void;
  locale: string;
}

export function PeriodSelector({ choice, onChange, locale }: PeriodSelectorProps) {
  const ar = locale === "ar";
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="dashboard-period-selector">
      <div role="group" aria-label={ar ? "الفترة" : "Period"} className="flex flex-wrap gap-1.5">
        {DASHBOARD_PRESETS.map((preset) => (
          <Button
            key={preset}
            size="sm"
            variant={choice.preset === preset ? "default" : "outline"}
            aria-pressed={choice.preset === preset}
            onClick={() => onChange({ ...choice, preset })}
            data-testid={`dashboard-period-${preset}`}
          >
            {ar ? LABELS[preset].ar : LABELS[preset].en}
          </Button>
        ))}
      </div>
      {choice.preset === "custom" && (
        <div className="flex items-center gap-2" data-testid="dashboard-period-custom">
          <Input
            type="date"
            aria-label={ar ? "من" : "From"}
            value={choice.from ?? ""}
            onChange={(e) => onChange({ ...choice, from: e.target.value })}
            className="h-8 w-[10.5rem]"
          />
          <span className="text-muted-foreground text-xs">{ar ? "إلى" : "to"}</span>
          <Input
            type="date"
            aria-label={ar ? "إلى" : "To"}
            value={choice.to ?? ""}
            onChange={(e) => onChange({ ...choice, to: e.target.value })}
            className="h-8 w-[10.5rem]"
          />
          {!isCompleteChoice(choice) && (
            <span className="text-xs text-muted-foreground">
              {ar ? "اختر تاريخ بداية ونهاية صحيحين" : "Pick a valid start and end date"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
