import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    // A search box with only a placeholder has no accessible name. Name it from the placeholder, but only when
    // nothing else can: an id usually means a <label for>, and aria-* attributes already name it.
    const fallbackLabel =
      props.placeholder && !props.id && !props["aria-label"] && !props["aria-labelledby"] && type !== "hidden"
        ? props.placeholder
        : undefined;
    return (
      <input
        type={type}
        aria-label={fallbackLabel}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-card px-3 py-2 text-base", // 16px on phones stops iOS from zooming on focus
          "shadow-xs transition-[box-shadow,border-color,background-color] duration-150",
          "ring-offset-background",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          "placeholder:text-muted-foreground/70",
          "hover:border-muted-foreground/30",
          "focus-visible:outline-none focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_hsl(var(--ring)/0.18)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "md:text-sm",
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
