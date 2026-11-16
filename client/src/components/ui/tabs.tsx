import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

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
 * R2-15: segmented tabs scroll sideways on narrow screens; a soft edge fade (only on the sides
 * that still hide tabs) and scroll-snap show that more tabs exist instead of clipping a label.
 */
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, style, ...props }, ref) => {
  const inner = React.useRef<HTMLDivElement | null>(null);
  const [fade, setFade] = React.useState({ left: false, right: false });
  const update = React.useCallback(() => {
    const el = inner.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 1) {
      setFade((f) => (f.left || f.right ? { left: false, right: false } : f));
      return;
    }
    const rtl = getComputedStyle(el).direction === "rtl";
    const x = el.scrollLeft;
    const next = rtl ? { left: -x < max - 1, right: x < -1 } : { left: x > 1, right: x < max - 1 };
    setFade((f) => (f.left === next.left && f.right === next.right ? f : next));
  }, []);
  React.useEffect(() => {
    const el = inner.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [update]);
  const mask =
    fade.left || fade.right
      ? `linear-gradient(to right, ${fade.left ? "transparent 0, #000 20px" : "#000 0"}, ${
          fade.right ? "#000 calc(100% - 20px), transparent 100%" : "#000 100%"
        })`
      : undefined;
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
      style={{ ...style, ...(mask ? { maskImage: mask, WebkitMaskImage: mask } : null) }}
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
