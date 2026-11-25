import { PRODUCT_NAME } from "@shared/product-brand";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "w-7 h-7 rounded-md text-[15px]",
  md: "w-8 h-8 rounded-lg text-[17px]",
  lg: "w-10 h-10 rounded-xl text-[21px]",
} as const;

interface BrandMarkProps {
  size?: keyof typeof SIZES;
  className?: string;
}

/**
 * The Muhasib.ai identity mark — the Arabic letter م (meem) on an emerald
 * square, matching the marketing site. Reused across the sidebar, auth
 * screens, and anywhere the brand needs to appear.
 */
export function BrandMark({ size = "md", className }: BrandMarkProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex items-center justify-center shrink-0 select-none font-semibold text-white",
        "bg-brand-700 shadow-xs ring-1 ring-inset ring-white/10",
        SIZES[size],
        className
      )}
    >
      <span className="translate-y-[-1px]">م</span>
    </div>
  );
}

const dot = PRODUCT_NAME.lastIndexOf(".");

export function ProductWordmark({
  className,
  accentClassName,
}: {
  className?: string;
  accentClassName?: string;
}) {
  return (
    <span className={className} translate="no" lang="en" dir="ltr">
      {PRODUCT_NAME.slice(0, dot)}
      <span className={accentClassName}>{PRODUCT_NAME.slice(dot)}</span>
    </span>
  );
}
