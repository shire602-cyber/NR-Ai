import { format, startOfDay } from "date-fns";
import { formatCalendarDate } from "@/lib/calendar-date";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

interface PaymentDateFieldProps {
  value: Date;
  onChange: (date: Date) => void;
  /** Earliest selectable day, normally the invoice/bill date. */
  minDate?: Date | null;
  testId?: string;
}

/** Calendar day as 'YYYY-MM-DD' from the user's local date (never via UTC). */
export function toDateOnly(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Payment-date picker for settlement dialogs. Defaults to today (set by the
 * caller); future days and days before `minDate` are disabled, mirroring the
 * server's validation.
 */
export function PaymentDateField({ value, onChange, minDate, testId }: PaymentDateFieldProps) {
  const { t, locale } = useTranslation();
  const min = minDate ? startOfDay(minDate) : null;
  const today = startOfDay(new Date());

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{t.paymentDate}</label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn("w-full justify-start text-left font-normal")}
            data-testid={testId ?? "button-payment-date"}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {formatCalendarDate(value, locale)}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(d) => d && onChange(d)}
            disabled={(d) => d > today || (min !== null && d < min)}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
