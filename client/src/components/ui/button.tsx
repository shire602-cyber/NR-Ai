import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Button — D2 design system.
 * Heights: sm 32 · default 36 · lg 40 · xl 48 (every size is 44 on touch screens). One primary action per view;
 * pair it with `outline` or `ghost` secondaries. Icons inherit 16px.
 */
const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium" +
    " select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" +
    " disabled:pointer-events-none disabled:opacity-50" +
    " transition-[background-color,color,border-color,box-shadow] duration-fast ease-standard" +
    " [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border border-primary-border shadow-xs hover:bg-[hsl(var(--primary-hover))] active:shadow-none",
        destructive:
          "bg-destructive text-destructive-foreground border border-destructive-border shadow-xs hover:bg-destructive/90 active:shadow-none",
        accent:
          "bg-accent text-accent-foreground border border-accent-border shadow-xs hover:bg-accent/90 active:shadow-none",
        outline:
          "border border-input bg-card text-foreground shadow-xs hover:bg-secondary hover:border-border-strong active:shadow-none",
        secondary:
          "border border-transparent bg-secondary text-secondary-foreground hover:bg-neutral-200 dark:hover:bg-neutral-700",
        ghost: "border border-transparent text-foreground hover:bg-secondary",
        link: "border border-transparent text-accent underline-offset-4 hover:underline px-0",
      },
      size: {
        // X3 (J2): 44px minimum hit area on touch screens (CTO rule); compact on mouse.
        default: "min-h-9 px-4 py-2 [@media(pointer:coarse)]:min-h-11",
        sm: "min-h-8 px-3 text-[13px] gap-1.5 [@media(pointer:coarse)]:min-h-11",
        lg: "min-h-10 px-5 text-sm [@media(pointer:coarse)]:min-h-11",
        xl: "min-h-12 rounded-lg px-6 text-base",
        icon: "h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
        "icon-sm": "h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
