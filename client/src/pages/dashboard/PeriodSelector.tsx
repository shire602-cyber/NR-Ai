import { cn } from "@/lib/utils";
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
    <div className="flex flex-wrap items-center gap-3" data-testid="dashboard-period-selector">
      <div
        role="group"
        aria-label={ar ? "الفترة" : "Period"}
        className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-muted p-0.5"
      >
        {DASHBOARD_PRESETS.map((preset) => {
          const active = choice.preset === preset;
          return (
            <button
              type="button"
              key={preset}
              aria-pressed={active}
              onClick={() => onChange({ ...choice, preset })}
              data-testid={`dashboard-period-${preset}`}
              className={cn(
                "h-8 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-[color,background-color,box-shadow] duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-card text-foreground shadow-sm dark:bg-neutral-800"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {ar ? LABELS[preset].ar : LABELS[preset].en}
            </button>
          );
        })}
      </div>
      {choice.preset === "custom" && (
        <div className="flex items-center gap-2" data-testid="dashboard-period-custom">
          <Input
            type="date"
            aria-label={ar ? "من" : "From"}
            value={choice.from ?? ""}
            onChange={(e) => onChange({ ...choice, from: e.target.value })}
            className="h-9 w-[10.5rem]"
          />
          <span className="text-muted-foreground text-xs">{ar ? "إلى" : "to"}</span>
          <Input
            type="date"
            aria-label={ar ? "إلى" : "To"}
            value={choice.to ?? ""}
            onChange={(e) => onChange({ ...choice, to: e.target.value })}
            className="h-9 w-[10.5rem]"
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
