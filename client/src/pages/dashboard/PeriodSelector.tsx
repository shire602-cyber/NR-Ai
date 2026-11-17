import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { DatePicker } from "@/components/ui/date-picker";
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
  const { t } = useTranslation();
  const ar = locale === "ar";
  return (
    <div
      className="flex w-full flex-wrap items-center gap-3 sm:w-auto"
      data-testid="dashboard-period-selector"
    >
      {/* Segmented control: four equal columns on mobile so nothing clips at the edge (CTO 12). */}
      <div
        role="group"
        aria-label={ar ? "الفترة" : "Period"}
        className="grid w-full grid-cols-4 items-stretch gap-0.5 rounded-lg bg-muted p-0.5 sm:inline-flex sm:h-9 sm:w-auto sm:items-center"
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
                "min-w-0 rounded-md px-1.5 text-caption font-medium leading-tight sm:h-8 sm:whitespace-nowrap transition-[color,background-color,box-shadow] duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3 sm:text-small",
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
        <div
          className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
          data-testid="dashboard-period-custom"
        >
          <DatePicker
            aria-label={ar ? "من" : "From"}
            value={choice.from ?? ""}
            onChange={(value) => onChange({ ...choice, from: value })}
            className="h-9 min-w-0 flex-1 sm:w-[10.5rem] sm:flex-none"
          />
          <span className="text-muted-foreground text-xs">{ar ? "إلى" : "to"}</span>
          <DatePicker
            aria-label={ar ? "إلى" : "To"}
            value={choice.to ?? ""}
            onChange={(value) => onChange({ ...choice, to: value })}
            className="h-9 min-w-0 flex-1 sm:w-[10.5rem] sm:flex-none"
          />
          {!isCompleteChoice(choice) && (
            <span className="w-full text-xs text-muted-foreground">
              {t["dashboard.periodPickValidDates"]}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
