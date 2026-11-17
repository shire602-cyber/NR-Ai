import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { useActiveIntoView, useEdgeFade } from "@/components/ui/use-scroll-fade";

/**
 * D3a: Radix Tabs stamps `dir="ltr"` on its root unless told otherwise (there is no
 * DirectionProvider), which flipped every tabbed screen's content — tables, grids, dates —
 * back to LTR in Arabic. Default `dir` to the locale's direction; an explicit prop wins.
 */
const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ dir, ...props }, ref) => {
  const { locale } = useTranslation();
  return <TabsPrimitive.Root ref={ref} dir={dir ?? (locale === "ar" ? "rtl" : "ltr")} {...props} />;
});
Tabs.displayName = TabsPrimitive.Root.displayName;

/**
 * R2-15 / WP-A G4: segmented tabs scroll sideways on narrow screens; a 24 px edge fade (only on
 * the sides that still hide tabs), scroll-snap and the active tab kept in view show that more
 * tabs exist instead of clipping a label. `ScrollTabs` adds the line variant and a More menu.
 */
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, style, ...props }, ref) => {
  const inner = React.useRef<HTMLDivElement | null>(null);
  const fade = useEdgeFade(inner);
  useActiveIntoView(inner);
  return (
    <TabsPrimitive.List
      ref={(node) => {
        inner.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<typeof node>).current = node;
      }}
      className={cn(
        "inline-flex h-9 max-w-full snap-x snap-proximity items-center justify-start overflow-x-auto rounded-lg bg-muted p-1 text-muted-foreground [scrollbar-width:none]",
        className
      )}
      style={{ ...style, ...fade }}
      {...props}
    />
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

/**
 * Radix always stamps `aria-controls` with the panel id, but a tab whose panel is not mounted (an
 * inactive `TabsContent`, or tabs that only switch a URL-driven view) then points at nothing, which
 * axe reports as `aria-valid-attr-value`. Drop the attribute while the referenced panel does not
 * exist; mounted panels keep it. Backwards compatible: nothing changes when the panel exists.
 */
const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const node = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    const el = node.current;
    const controls = el?.getAttribute("aria-controls");
    if (el && controls && !document.getElementById(controls)) el.removeAttribute("aria-controls");
  });
  return (
    <TabsPrimitive.Trigger
      ref={(el) => {
        node.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) (ref as React.MutableRefObject<typeof el>).current = el;
      }}
      className={cn(
        "inline-flex h-7 shrink-0 snap-start items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-medium ring-offset-background transition-[color,background-color,box-shadow] duration-fast ease-standard hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-neutral-800 [&_svg]:size-3.5",
        className
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
