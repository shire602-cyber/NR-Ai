import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium tracking-tight" +
  " focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" +
  " disabled:pointer-events-none disabled:opacity-50" +
  " transition-[transform,box-shadow,background-color,color,border-color] duration-150 ease-out" +
  " active:translate-y-px" +
  " [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
  " hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border border-primary-border shadow-xs hover:shadow-sm",
        destructive:
          "bg-destructive text-destructive-foreground border border-destructive-border shadow-xs hover:shadow-sm",
        accent:
          "bg-accent text-accent-foreground border border-accent-border shadow-xs hover:shadow-sm",
        outline:
          "border [border-color:var(--button-outline)] shadow-xs hover:bg-secondary/50 active:shadow-none",
        secondary:
          "border bg-secondary text-secondary-foreground border-secondary-border",
        ghost: "border border-transparent hover:bg-secondary/60",
        link: "border border-transparent text-primary underline-offset-4 hover:underline px-0",
      },
      size: {
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-10 rounded-md px-6 text-sm",
        xl: "min-h-12 rounded-lg px-7 text-base",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
