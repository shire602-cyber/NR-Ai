import { ArrowUpRight } from "lucide-react";
import { Link } from "wouter";
import { motion } from "framer-motion";

// ─── Quick action ────────────────────────────────────────────────────────────

export function QuickAction({ icon: Icon, title, description, href, delay = 0 }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.4, 0, 0.2, 1] }}
    >
      <Link href={href}>
        <div className="group relative h-full p-5 rounded-xl border border-card-border bg-card hover-lift cursor-pointer overflow-hidden transition-colors">
          <div
            aria-hidden
            className="absolute -inset-px rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
          />
          <div className="relative">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-foreground/5 text-foreground/80 ring-1 ring-border/60 group-hover:bg-accent/10 group-hover:text-accent group-hover:ring-accent/30 transition-colors">
                <Icon className="w-4 h-4" strokeWidth={2} />
              </div>
              <ArrowUpRight className="ms-auto w-4 h-4 text-muted-foreground/50 group-hover:text-accent group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-transform duration-200" />
            </div>
            <div className="mt-4 font-semibold text-[14px] tracking-tight text-foreground">
              {title}
            </div>
            <div className="mt-1 text-[12.5px] text-muted-foreground leading-snug">
              {description}
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

// ─── Section header ──────────────────────────────────────────────────────────

export function SectionHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <div>
        {eyebrow && (
          <div className="text-[10.5px] uppercase tracking-[0.16em] font-semibold text-muted-foreground">
            {eyebrow}
          </div>
        )}
        <h2 className="mt-1 font-display text-[22px] md:text-[26px] leading-none text-foreground tracking-tight">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}
