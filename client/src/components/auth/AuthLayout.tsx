import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { motion } from 'framer-motion';
import { ArrowLeft, ShieldCheck, Landmark, Languages } from 'lucide-react';
import { BrandMark } from '@/components/BrandMark';
import { MeshGradient } from '@/components/ui/mesh-gradient';

const MIDNIGHT = '#0E1320';
const GOLD = '#C19E50';

const TRUST_POINTS = [
  {
    icon: Landmark,
    title: 'FTA-native VAT 201',
    body: 'Returns pre-filled from your ledger, EmaraTax-ready.',
  },
  {
    icon: ShieldCheck,
    title: 'Bank-grade security',
    body: 'Encrypted at rest and in transit, UAE data residency.',
  },
  {
    icon: Languages,
    title: 'Bilingual by design',
    body: 'English and Arabic, side by side — invoices included.',
  },
];

interface AuthLayoutProps {
  children: ReactNode;
  headline: ReactNode;
  subline: string;
}

/**
 * Premium split-screen shell for the auth pages: a midnight brand panel with
 * the drifting emerald/gold mesh on the left, the form on warm paper on the
 * right. Mirrors the marketing site so login feels like the same product.
 */
export function AuthLayout({ children, headline, subline }: AuthLayoutProps) {
  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr] bg-background">
      {/* ── Brand panel ── */}
      <aside
        className="relative hidden lg:flex flex-col justify-between overflow-hidden px-12 xl:px-16 py-12"
        style={{ background: MIDNIGHT }}
      >
        <MeshGradient emerald={0.4} gold={0.3} />

        <Link href="/" className="relative flex items-center gap-2.5 w-fit" data-testid="link-brand-home">
          <BrandMark size="md" />
          <span className="font-semibold text-[15px] tracking-tight text-white">
            Muhasib<span style={{ color: '#34A87A' }}>.ai</span>
          </span>
        </Link>

        <motion.div
          className="relative max-w-md"
          initial={{ opacity: 0, y: 24, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mb-5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>
            <span className="inline-block w-6 h-px" style={{ background: GOLD }} />
            AI-native accounting · UAE
          </div>
          <h1 className="font-display text-[3.4rem] xl:text-[4rem] leading-[1.02] tracking-tight text-white">
            {headline}
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-white/55">{subline}</p>

          <ul className="mt-10 space-y-5">
            {TRUST_POINTS.map(({ icon: Icon, title, body }, i) => (
              <motion.li
                key={title}
                className="flex items-start gap-3.5"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="mt-0.5 flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.06] ring-1 ring-white/10">
                  <Icon className="w-4 h-4" style={{ color: '#34A87A' }} strokeWidth={1.75} />
                </span>
                <span>
                  <span className="block text-[13.5px] font-semibold tracking-tight text-white/90">{title}</span>
                  <span className="block mt-0.5 text-[12.5px] leading-relaxed text-white/45">{body}</span>
                </span>
              </motion.li>
            ))}
          </ul>
        </motion.div>

        <div className="relative flex items-center gap-2 text-[11px] font-mono tracking-tight text-white/35">
          <span className="inline-flex w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse-dot" />
          The ledger, handled · UAE · AED
        </div>
      </aside>

      {/* ── Form panel ── */}
      <main className="relative flex flex-col min-h-screen">
        <div aria-hidden className="absolute inset-0 bg-spotlight pointer-events-none" />

        <header className="relative flex items-center justify-between px-6 md:px-10 h-16">
          <Link href="/" data-testid="button-back-home">
            <span className="inline-flex items-center gap-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </span>
          </Link>
          {/* Compact brand for mobile, where the panel is hidden */}
          <Link href="/" className="flex items-center gap-2 lg:hidden">
            <BrandMark size="sm" />
            <span className="font-semibold text-[14px] tracking-tight text-foreground">
              Muhasib<span className="text-accent">.ai</span>
            </span>
          </Link>
        </header>

        <div className="relative flex-1 flex items-center justify-center px-4 pb-16 pt-4">
          <motion.div
            className="w-full max-w-md"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        </div>

        <footer className="relative px-6 pb-6 text-center text-[11px] text-muted-foreground/70">
          Protected by bank-grade encryption · FTA compliant
        </footer>
      </main>
    </div>
  );
}
