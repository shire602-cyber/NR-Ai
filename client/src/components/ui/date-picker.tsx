import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { ar as arLocale } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate, toCalendarDate } from "@/lib/format-date";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface DatePickerProps {
  /** Calendar date as `YYYY-MM-DD` (the same value a native date input held). */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "data-testid"?: string;
}

function toIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Shared date picker (R2 item 7): a button showing the date through `formatDate`
 * ("16 Nov 2026" / "16 نوفمبر 2026", never the browser's US `mm/dd/yyyy`) that opens the
 * shared Calendar. Value in/out stays a `YYYY-MM-DD` string so callers keep their query keys
 * and request bodies unchanged.
 */
export function DatePicker({
  value,
  onChange,
  id,
  className,
  disabled,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: DatePickerProps) {
  const { t, locale } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const selected = toCalendarDate(value) ?? undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel}
          data-testid={testId}
          className={cn(
            "w-full justify-start text-start font-normal tabular-nums",
            !value && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="h-4 w-4" aria-hidden />
          <span>{value ? formatDate(value, locale) : t["pages.pickADate"]}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          locale={locale === "ar" ? arLocale : undefined}
          dir={locale === "ar" ? "rtl" : "ltr"}
          onSelect={(d) => {
            if (d) {
              onChange(toIso(d));
              setOpen(false);
            }
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
