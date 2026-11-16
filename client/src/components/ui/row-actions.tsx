import * as React from "react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
type RowActionButtonElement = React.ReactElement<{
  label: string;
  icon: LucideIcon;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
}>;

/** Flattens fragments/conditionals and keeps the RowActionButton elements. */
function rowActionButtons(children: React.ReactNode): RowActionButtonElement[] {
  const out: RowActionButtonElement[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      out.push(...rowActionButtons((child.props as { children?: React.ReactNode }).children));
    } else if (child.type === RowActionButton) {
      out.push(child as RowActionButtonElement);
    }
  });
  return out;
}

export function RowActions({
  children,
  menu,
  menuLabel,
  className,
  menuTestId,
  collapseOnMobile = false,
}: {
  /** Up to two RowActionButton elements. */
  children?: React.ReactNode;
  /** DropdownMenu items for the overflow menu. */
  menu?: React.ReactNode;
  menuLabel?: string;
  className?: string;
  menuTestId?: string;
  /**
   * D3a: below 768px hide the visible buttons and offer them as the first items of the ⋯
   * menu instead (row-card tables keep one 44px action target per row).
   */
  collapseOnMobile?: boolean;
}) {
  const { t } = useTranslation();
  const mobileItems = collapseOnMobile ? rowActionButtons(children) : [];
  const hasMenu = Boolean(menu) || mobileItems.length > 0;
  return (
    <div className={cn("flex items-center justify-end gap-0.5", className)}>
      {collapseOnMobile ? (
        <div className="hidden items-center gap-0.5 md:flex">{children}</div>
      ) : (
        children
      )}
      {hasMenu ? (
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
            {mobileItems.map((item, index) => {
              const Icon = item.props.icon;
              return (
                <DropdownMenuItem
                  key={`row-action-${index}`}
                  className="md:hidden"
                  disabled={item.props.disabled}
                  onSelect={() =>
                    item.props.onClick?.({} as React.MouseEvent<HTMLButtonElement, MouseEvent>)
                  }
                >
                  <Icon aria-hidden />
                  {item.props.label}
                </DropdownMenuItem>
              );
            })}
            {mobileItems.length > 0 && menu ? (
              <DropdownMenuSeparator className="md:hidden" />
            ) : null}
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
