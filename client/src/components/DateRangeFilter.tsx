import { useState } from "react";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
  endOfYear,
  subYears,
  startOfQuarter,
  endOfQuarter,
  subQuarters,
} from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format-date";
import { useTranslation } from "@/lib/i18n";

interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

interface DateRangeFilterProps {
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  className?: string;
}

export function DateRangeFilter({ dateRange, onDateRangeChange, className }: DateRangeFilterProps) {
  const { t, locale } = useTranslation();
  const tt = t as Record<string, string>;
  const [preset, setPreset] = useState<string>("");

  const presetRanges = [
    { label: tt.thisMonth ?? "This Month", value: "this-month" },
    { label: tt.lastMonth ?? "Last Month", value: "last-month" },
    { label: tt.thisQuarter ?? "This Quarter", value: "this-quarter" },
    { label: tt.lastQuarter ?? "Last Quarter", value: "last-quarter" },
    { label: tt.thisYear ?? "This Year", value: "this-year" },
    { label: tt.lastYear ?? "Last Year", value: "last-year" },
    { label: tt.custom ?? "Custom", value: "custom" },
  ];

  const handlePresetChange = (value: string) => {
    setPreset(value);
    const now = new Date();

    switch (value) {
      case "this-month":
        onDateRangeChange({ from: startOfMonth(now), to: endOfMonth(now) });
        break;
      case "last-month": {
        const lastMonth = subMonths(now, 1);
        onDateRangeChange({ from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) });
        break;
      }
      case "this-quarter":
        onDateRangeChange({ from: startOfQuarter(now), to: endOfQuarter(now) });
        break;
      case "last-quarter": {
        const lastQuarter = subQuarters(now, 1);
        onDateRangeChange({ from: startOfQuarter(lastQuarter), to: endOfQuarter(lastQuarter) });
        break;
      }
      case "this-year":
        onDateRangeChange({ from: startOfYear(now), to: endOfYear(now) });
        break;
      case "last-year": {
        const lastYear = subYears(now, 1);
        onDateRangeChange({ from: startOfYear(lastYear), to: endOfYear(lastYear) });
        break;
      }
      case "custom":
        break;
      default:
        break;
    }
  };

  const clearDateRange = () => {
    setPreset("");
    onDateRangeChange({ from: undefined, to: undefined });
  };

  // D2b (CTO 8): one full-width row on mobile (preset 100%, date pair 50/50), inline from sm.
  return (
    <div
      className={cn(
        "mobile-keep-cols grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap",
        className
      )}
    >
      <Select value={preset} onValueChange={handlePresetChange}>
        <SelectTrigger
          className="col-span-2 h-9 w-full sm:w-[160px]"
          data-testid="select-date-preset"
          aria-label={tt.dateRange ?? "Date range"}
        >
          <SelectValue placeholder={tt.dateRange ?? "Date range"} />
        </SelectTrigger>
        <SelectContent>
          {presetRanges.map((range) => (
            <SelectItem key={range.value} value={range.value}>
              {range.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "h-9 min-w-0 justify-start px-3 text-start font-normal",
              !dateRange.from && "text-muted-foreground"
            )}
            data-testid="button-date-from"
            aria-label={tt.startDate ?? "Start date"}
          >
            <CalendarIcon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">
              {dateRange.from ? formatDate(dateRange.from, locale) : (tt.startDate ?? "Start date")}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={dateRange.from}
            onSelect={(date) => {
              setPreset("custom");
              onDateRangeChange({ ...dateRange, from: date });
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>

      <span className="hidden text-small text-muted-foreground sm:inline">{tt.dateTo ?? "to"}</span>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "h-9 min-w-0 justify-start px-3 text-start font-normal",
              !dateRange.to && "text-muted-foreground"
            )}
            data-testid="button-date-to"
            aria-label={tt.endDate ?? "End date"}
          >
            <CalendarIcon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">
              {dateRange.to ? formatDate(dateRange.to, locale) : (tt.endDate ?? "End date")}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={dateRange.to}
            onSelect={(date) => {
              setPreset("custom");
              onDateRangeChange({ ...dateRange, to: date });
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>

      {(dateRange.from || dateRange.to) && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={clearDateRange}
          className="col-span-2 justify-self-end sm:col-span-1"
          aria-label={tt["components.clearDates"]}
          data-testid="button-clear-dates"
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}

export type { DateRange };
