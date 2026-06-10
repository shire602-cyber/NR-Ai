import { cn } from '@/lib/utils';

const SIZES = {
  sm: 'w-7 h-7 rounded-md text-[15px]',
  md: 'w-8 h-8 rounded-lg text-[17px]',
  lg: 'w-10 h-10 rounded-xl text-[21px]',
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
export function BrandMark({ size = 'md', className }: BrandMarkProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'flex items-center justify-center shrink-0 select-none font-semibold text-white',
        'bg-gradient-to-br from-[#0D5C3D] to-[#0A4530] shadow-sm ring-1 ring-white/10',
        SIZES[size],
        className,
      )}
    >
      <span className="translate-y-[-1px]">م</span>
    </div>
  );
}
