import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

// Opt-in (phones): the control element itself is 44 px tall below 768 px and the 36 x 20 track
// is drawn by ::before, so the measured element is a full touch target.
const TOUCH_TARGET =
  "max-md:h-11 max-md:w-12 max-md:border-0 max-md:ps-2 max-md:data-[state=checked]:bg-transparent max-md:data-[state=unchecked]:bg-transparent max-md:dark:data-[state=unchecked]:bg-transparent max-md:before:absolute max-md:before:inset-x-1.5 max-md:before:top-1/2 max-md:before:h-5 max-md:before:-translate-y-1/2 max-md:before:rounded-full max-md:before:content-[''] max-md:data-[state=checked]:before:bg-primary max-md:data-[state=unchecked]:before:bg-neutral-300 max-md:dark:data-[state=unchecked]:before:bg-neutral-700 relative";

type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> & {
  /** Make the control element itself a 44 px touch target below 768 px. */
  touchTarget?: boolean;
};

const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitives.Root>, SwitchProps>(
  ({ className, touchTarget = false, ...props }, ref) => (
    <SwitchPrimitives.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-neutral-300 dark:data-[state=unchecked]:bg-neutral-700",
        touchTarget && TOUCH_TARGET,
        className
      )}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          touchTarget && "relative z-10",
          "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-base ease-standard data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0 rtl:data-[state=checked]:-translate-x-4"
        )}
      />
    </SwitchPrimitives.Root>
  )
);
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
