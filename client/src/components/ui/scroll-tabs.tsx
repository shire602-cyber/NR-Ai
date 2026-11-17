import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useActiveIntoView, useEdgeFade } from "@/components/ui/use-scroll-fade";

function setRefs<T>(node: T, ...refs: Array<React.Ref<T> | undefined>) {
  for (const r of refs) {
    if (typeof r === "function") r(node);
    else if (r) (r as React.MutableRefObject<T>).current = node;
  }
}

type TriggerElement = React.ReactElement<
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { "data-testid"?: string }
>;

export interface ScrollTabsProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  /** `pill` = segmented control (default, same look as TabsList); `line` = underline tabs. */
  variant?: "pill" | "line";
  /** Stretch to the container width (mobile full-width segmented control). */
  fullWidth?: boolean;
  /**
   * Spec 2.4: at most 5 tabs visible. With `maxVisible`, the remaining `TabsTrigger` children
   * move into a "More" menu; pass the Tabs `value` and `onValueChange` so the menu can switch.
   */
  maxVisible?: number;
  value?: string;
  onValueChange?: (value: string) => void;
  moreLabel?: string;
}

/**
 * ScrollTabs (spec G4) — a drop-in for `TabsList` inside `<Tabs>`: scrolls sideways on narrow
 * screens with a 24 px fade at the overflowing edge, scroll-snap, and the active tab scrolled
 * into view. Never clips a half label.
 *
 *   <Tabs value={tab} onValueChange={setTab}>
 *     <ScrollTabs aria-label={t["x.sections"]}>
 *       <TabsTrigger value="a">…</TabsTrigger>
 *     </ScrollTabs>
 *   </Tabs>
 */
export const ScrollTabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  ScrollTabsProps
>(
  (
    {
      className,
      style,
      variant = "pill",
      fullWidth = false,
      maxVisible,
      value,
      onValueChange,
      moreLabel,
      children,
      ...props
    },
    ref
  ) => {
    const { t } = useTranslation();
    const inner = React.useRef<HTMLDivElement | null>(null);
    const fade = useEdgeFade(inner);
    useActiveIntoView(inner);

    const all = React.Children.toArray(children).filter(React.isValidElement) as TriggerElement[];
    const limit = maxVisible && all.length > maxVisible ? Math.max(1, maxVisible - 1) : all.length;
    const visible = all.slice(0, limit);
    const overflow = all.slice(limit);
    const activeOverflow = overflow.find((c) => c.props.value === value);

    return (
      <TabsPrimitive.List
        ref={(node) => setRefs(node, inner, ref)}
        className={cn(
          "scroll-fade-x max-w-full snap-x snap-proximity items-center justify-start overflow-x-auto",
          variant === "pill"
            ? "inline-flex h-9 rounded-lg bg-muted p-1 text-muted-foreground"
            : "flex h-10 gap-4 border-b border-border text-muted-foreground [&>[role=tab]]:h-10 [&>[role=tab]]:rounded-none [&>[role=tab]]:border-b-2 [&>[role=tab]]:border-transparent [&>[role=tab]]:bg-transparent [&>[role=tab]]:px-0.5 [&>[role=tab]]:shadow-none [&>[role=tab][data-state=active]]:border-primary [&>[role=tab][data-state=active]]:bg-transparent [&>[role=tab][data-state=active]]:shadow-none dark:[&>[role=tab][data-state=active]]:bg-transparent",
          fullWidth && "flex w-full [&>[role=tab]]:flex-1",
          className
        )}
        style={{ ...style, ...fade }}
        {...props}
      >
        {visible}
        {overflow.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-3 text-[13px] font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                activeOverflow &&
                  (variant === "pill"
                    ? "bg-card text-foreground shadow-sm dark:bg-neutral-800"
                    : "text-foreground")
              )}
              // Inside a tablist every owned element must be a tab (axe aria-required-children).
              role="tab"
              aria-selected={Boolean(activeOverflow)}
              data-testid="scroll-tabs-more"
            >
              {activeOverflow
                ? activeOverflow.props.children
                : (moreLabel ?? t["components.ui.more"])}
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {overflow.map((c) => (
                <DropdownMenuItem
                  key={c.props.value}
                  disabled={c.props.disabled}
                  data-testid={c.props["data-testid"]}
                  aria-current={c.props.value === value ? "true" : undefined}
                  onSelect={() => onValueChange?.(c.props.value)}
                >
                  {c.props.children}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TabsPrimitive.List>
    );
  }
);
ScrollTabs.displayName = "ScrollTabs";
