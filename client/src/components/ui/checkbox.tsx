import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

// Opt-in (dense tables on phones): the control itself is 44 x 44 below 768 px and the visible
// 20 px box is drawn by ::before, so the measured element, not only an invisible ::after, is a
// full touch target.
const TOUCH_TARGET =
  "max-md:h-11 max-md:w-11 max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:shadow-none max-md:data-[state=checked]:bg-transparent max-md:before:absolute max-md:before:left-1/2 max-md:before:top-1/2 max-md:before:h-5 max-md:before:w-5 max-md:before:-translate-x-1/2 max-md:before:-translate-y-1/2 max-md:before:rounded-[4px] max-md:before:border max-md:before:border-border-strong max-md:before:bg-card max-md:before:content-[''] max-md:data-[state=checked]:before:border-primary max-md:data-[state=checked]:before:bg-primary";

type CheckboxProps = React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
  /** Make the control element itself a 44 px touch target below 768 px. */
  touchTarget?: boolean;
};

const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
  ({ className, touchTarget = false, ...props }, ref) => (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        // Spec G3: 16 px box on desktop, 20 px below 768 px, always inside a 44 px hit area
        // (the invisible ::after) — the box itself never stretches to 44 px.
        "peer relative h-4 w-4 shrink-0 rounded-[4px] border border-border-strong bg-card shadow-xs transition-colors duration-fast ring-offset-background after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] max-md:h-5 max-md:w-5 data-[state=checked]:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        touchTarget && TOUCH_TARGET,
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className={cn(
          "flex items-center justify-center text-current",
          touchTarget && "relative z-10"
        )}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
);
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
