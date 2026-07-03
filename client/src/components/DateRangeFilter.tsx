import { useState } from "react";
import {
  format,
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
  const { t } = useTranslation();
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

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Select value={preset} onValueChange={handlePresetChange}>
        <SelectTrigger className="w-[140px]" data-testid="select-date-preset">
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
              "justify-start text-left font-normal",
              !dateRange.from && "text-muted-foreground"
            )}
            data-testid="button-date-from"
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {dateRange.from
              ? format(dateRange.from, "MMM dd, yyyy")
              : (tt.startDate ?? "Start date")}
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

      <span className="text-muted-foreground">{tt.dateTo ?? "to"}</span>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "justify-start text-left font-normal",
              !dateRange.to && "text-muted-foreground"
            )}
            data-testid="button-date-to"
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {dateRange.to ? format(dateRange.to, "MMM dd, yyyy") : (tt.endDate ?? "End date")}
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
          size="icon"
          onClick={clearDateRange}
          className="h-8 w-8"
          data-testid="button-clear-dates"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export type { DateRange };
