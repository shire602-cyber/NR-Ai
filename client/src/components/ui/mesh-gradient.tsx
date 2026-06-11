import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface MeshGradientProps {
  className?: string;
  /** 0–1 opacity multiplier for the emerald blob */
  emerald?: number;
  /** 0–1 opacity multiplier for the gold blob */
  gold?: number;
}

/**
 * The signature Muhasib backdrop — two soft radial blobs (emerald + gold)
 * drifting slowly behind content, exactly like the marketing site's hero.
 * GPU-only (transform/opacity); respects prefers-reduced-motion.
 */
export function MeshGradient({ className, emerald = 0.35, gold = 0.32 }: MeshGradientProps) {
  const reduceMotion = useReducedMotion();

  return (
    <div
      aria-hidden
      className={cn("absolute inset-0 overflow-hidden pointer-events-none", className)}
    >
      <motion.div
        className="absolute -top-[12%] -left-[8%] w-[34rem] h-[34rem] rounded-full"
        style={{
          background: `radial-gradient(circle, rgba(13,92,61,${emerald}) 0%, rgba(13,92,61,0) 60%)`,
          filter: "blur(40px)",
        }}
        animate={reduceMotion ? undefined : { x: [0, 48, -24, 0], y: [0, 28, -18, 0] }}
        transition={{ duration: 24, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -bottom-[18%] -right-[10%] w-[30rem] h-[30rem] rounded-full"
        style={{
          background: `radial-gradient(circle, rgba(193,158,80,${gold}) 0%, rgba(193,158,80,0) 60%)`,
          filter: "blur(40px)",
        }}
        animate={reduceMotion ? undefined : { x: [0, -40, 20, 0], y: [0, -24, 14, 0] }}
        transition={{ duration: 28, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
