import * as React from "react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/lib/i18n";

/**
 * Row actions (CTO issue 3): at most two visible quiet icon buttons, everything else in
 * one ⋯ menu. Icons are muted (never coloured); destructive items live in the menu.
 *
 *   <RowActions menu={<><DropdownMenuItem …/>…</>}>
 *     <RowActionButton label="Edit" icon={Pencil} onClick={…} />
 *   </RowActions>
 */
export function RowActions({
  children,
  menu,
  menuLabel,
  className,
  menuTestId,
}: {
  /** Up to two RowActionButton elements. */
  children?: React.ReactNode;
  /** DropdownMenu items for the overflow menu. */
  menu?: React.ReactNode;
  menuLabel?: string;
  className?: string;
  menuTestId?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex items-center justify-end gap-0.5", className)}>
      {children}
      {menu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              aria-label={menuLabel ?? t["components.rowMoreActions"]}
              title={menuLabel ?? t["components.rowMoreActions"]}
              data-testid={menuTestId}
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            {menu}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export const RowActionButton = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ComponentPropsWithoutRef<typeof Button>, "children"> & {
    label: string;
    icon: LucideIcon;
  }
>(({ label, icon: Icon, className, ...props }, ref) => (
  <Button
    ref={ref}
    variant="ghost"
    size="icon-sm"
    aria-label={label}
    title={label}
    className={cn("text-muted-foreground hover:text-foreground", className)}
    {...props}
  >
    <Icon aria-hidden />
  </Button>
));
RowActionButton.displayName = "RowActionButton";
