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
 * Row actions (spec 2.4): at most ONE visible quiet icon button plus one ⋯ menu. Icons are
 * muted (never coloured); destructive items live in the menu.
 *
 *   <RowActions maxInline={1} menu={<><DropdownMenuItem …/>…</>}>
 *     <RowActionButton label={t.edit} icon={Pencil} onClick={…} />
 *     <RowActionButton label={t.download} icon={Download} onClick={…} />  // → moves into ⋯
 *   </RowActions>
 *
 * `maxInline` moves the RowActionButtons after the first N into the top of the menu (they keep
 * their `data-testid`). New code passes `maxInline={1}`; without it every child stays inline
 * (legacy screens, until their package converts them).
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
  maxInline,
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
  /** Spec 2.4: how many RowActionButtons stay visible (use 1); the rest move into the menu. */
  maxInline?: number;
}) {
  const { t } = useTranslation();
  const buttons = rowActionButtons(children);
  const limited = maxInline !== undefined && buttons.length > maxInline;
  const inline = limited ? buttons.slice(0, maxInline) : null;
  const moved = limited ? buttons.slice(maxInline) : [];
  const visibleChildren = inline ?? children;
  const mobileItems = collapseOnMobile ? (inline ?? buttons) : [];
  const hasMenu = Boolean(menu) || mobileItems.length > 0 || moved.length > 0;
  return (
    <div className={cn("flex items-center justify-end gap-0.5", className)}>
      {collapseOnMobile ? (
        <div className="hidden items-center gap-0.5 md:flex">{visibleChildren}</div>
      ) : (
        visibleChildren
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
            {mobileItems.length > 0 && (menu || moved.length > 0) ? (
              <DropdownMenuSeparator className="md:hidden" />
            ) : null}
            {moved.map((item, index) => {
              const Icon = item.props.icon;
              const testId = (item.props as { "data-testid"?: string })["data-testid"];
              return (
                <DropdownMenuItem
                  key={`row-action-moved-${index}`}
                  disabled={item.props.disabled}
                  data-testid={testId}
                  onSelect={() =>
                    item.props.onClick?.({} as React.MouseEvent<HTMLButtonElement, MouseEvent>)
                  }
                >
                  <Icon aria-hidden />
                  {item.props.label}
                </DropdownMenuItem>
              );
            })}
            {moved.length > 0 && menu ? <DropdownMenuSeparator /> : null}
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
