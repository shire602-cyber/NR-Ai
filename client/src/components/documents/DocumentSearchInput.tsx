import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface DocumentSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testId: string;
}

/** Search box shared by the quote, credit-note and debit-note lists (RTL-safe: logical padding). */
export function DocumentSearchInput({
  value,
  onChange,
  placeholder,
  testId,
}: DocumentSearchInputProps) {
  return (
    <div className="relative w-full sm:max-w-sm">
      <Search
        className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 ps-9"
        data-testid={testId}
      />
    </div>
  );
}
