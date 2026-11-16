import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

const labelVariants = cva(
  "text-small font-medium leading-5 peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
);

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />
));
Label.displayName = LabelPrimitive.Root.displayName;

/**
 * Required-field marker (CTO form spec): a text-danger asterisk after the label text.
 * The asterisk is decorative; screen readers hear the translated "required".
 */
function RequiredMark({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <>
      <span aria-hidden="true" className={cn("ms-0.5 text-danger", className)}>
        *
      </span>
      <span className="sr-only">{` (${t["forms.required"]})`}</span>
    </>
  );
}

export { Label, RequiredMark };
