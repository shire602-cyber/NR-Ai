import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps extends React.ComponentProps<"input"> {
  /**
   * D5b: Latin identifier / figure field (TRN, IBAN, account number). Renders LTR with
   * tabular figures; in Arabic it keeps the form's start edge (rtl.css [data-ltr-num]).
   */
  ltr?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ltr, dir, ...props }, ref) => {
    const numeric =
      ltr || type === "number" || props.inputMode === "numeric" || props.inputMode === "decimal";
    return (
      <input
        type={type}
        dir={ltr ? "ltr" : dir}
        data-ltr-num={ltr ? "" : undefined}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground",
          "shadow-xs transition-[box-shadow,border-color] duration-fast ease-standard",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          "placeholder:text-muted-foreground",
          "hover:border-border-strong",
          "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 focus-visible:ring-offset-0",
          "aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/20",
          "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
          "text-base md:text-sm",
          numeric && "tabular-nums",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
