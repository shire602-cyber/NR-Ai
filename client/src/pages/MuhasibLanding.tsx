import { motion, useInView, useScroll, useTransform } from 'framer-motion';
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  ChevronRight,
  Cpu,
  FileCheck,
  FileText,
  Languages,
  Menu,
  Receipt,
  RefreshCw,
  Shield,
  Sparkles,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';

// ─────────────────────────────────────────────────────────────────────────────
// Muhasib.ai · Landing page
// Design system, distilled from a cross-category audit (Big Four, mainstream
// accounting SaaS, AI-first fintech, Big Four firms, and tax SaaS):
//
//   Canvas      #FAFAF6 warm paper       Ink         #131820 deep
//   Primary     #0D5C3D forest emerald   Voltage     #C19E50 warm gold
//   Dark band   #0E1320 midnight         Hairline    rgba(15,20,25,.08)
//
//   Display     Instrument Serif (italic accent)
//   Body / UI   Geist Sans
//   Numerals    Geist Mono (tabular)
//
//   Animation budget: GPU-only — opacity / transform / filter. No parallax,
//   no 3D blobs. Hero IS the product (dashboard mock + AI agent chat).
// ─────────────────────────────────────────────────────────────────────────────

// Brand tokens — kept inline so the file is self-contained.
const C = {
  paper: '#FAFAF6',
  ink: '#131820',
  emerald: '#0D5C3D',
  emeraldSoft: '#E6F1EC',
  gold: '#C19E50',
  goldSoft: '#F7EFDA',
  midnight: '#0E1320',
  hairline: 'rgba(15,20,25,0.08)',
  hairlineStrong: 'rgba(15,20,25,0.14)',
  muted: 'rgba(15,20,25,0.55)',
  whisper: 'rgba(15,20,25,0.04)',
};

// ── 1.  Linear-style scroll-in (blur → clarity + translateY) ─────────────────
function Reveal({
  children,
  delay = 0,
  y = 24,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y, filter: 'blur(8px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ── 2. Animated counter (IntersectionObserver-triggered, cubic ease-out) ─────
function Counter({ to, suffix = '', prefix = '' }: { to: number; suffix?: string; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    const dur = 1800;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      setV(Math.floor(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setV(to);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to]);
  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {v.toLocaleString()}
      {suffix}
    </span>
  );
}

// ── 3. Mesh gradient atmosphere — drifts behind hero, low opacity ────────────
function HeroMesh() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div
        className="absolute -left-32 top-0 h-[640px] w-[640px] rounded-full opacity-50 blur-3xl"
        style={{
          background:
            'radial-gradient(circle, rgba(13,92,61,0.35) 0%, rgba(13,92,61,0) 60%)',
        }}
        animate={{ x: [0, 60, 0], y: [0, -30, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -right-32 top-32 h-[560px] w-[560px] rounded-full opacity-40 blur-3xl"
        style={{
          background:
            'radial-gradient(circle, rgba(193,158,80,0.32) 0%, rgba(193,158,80,0) 60%)',
        }}
        animate={{ x: [0, -40, 0], y: [0, 40, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_60%,#FAFAF6_100%)]" />
    </div>
  );
}

// ── 4. Hero product mock — animated dashboard + AI agent chat surface ────────
function HeroProductMock() {
  return (
    <div className="relative w-full">
      <Reveal delay={0.2} y={40}>
        <div
          className="relative overflow-hidden rounded-2xl border bg-white shadow-[0_24px_80px_-30px_rgba(15,20,25,0.25),0_8px_24px_-12px_rgba(15,20,25,0.08)]"
          style={{ borderColor: C.hairline }}
        >
          {/* Browser chrome */}
          <div
            className="flex items-center gap-1.5 border-b px-4 py-2.5"
            style={{ borderColor: C.hairline, background: 'rgba(15,20,25,0.02)' }}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#ED6B5F' }} />
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#F4BE4F' }} />
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#60C354' }} />
            <span
              className="ml-3 rounded-md px-2.5 py-0.5 font-mono text-[10px]"
              style={{ background: C.whisper, color: C.muted }}
            >
              app.muhasib.ai / dashboard
            </span>
          </div>

          {/* Body */}
          <div className="grid grid-cols-12 gap-px" style={{ background: C.hairline }}>
            {/* Sidebar */}
            <div className="col-span-3 bg-white p-4">
              <div className="mb-4 flex items-center gap-2">
                <div
                  className="flex h-6 w-6 items-center justify-center rounded font-serif text-sm font-bold text-white"
                  style={{ background: C.emerald }}
                >
                  م
                </div>
                <span className="text-[11px] font-semibold tracking-wide" style={{ color: C.ink }}>
                  Acme Trading LLC
                </span>
              </div>
              <div className="space-y-1">
                {['Dashboard', 'Invoices', 'Receipts', 'VAT 201', 'Bank Feeds', 'Reports'].map((l, i) => (
                  <div
                    key={l}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-[11px]"
                    style={{
                      background: i === 0 ? C.emeraldSoft : 'transparent',
                      color: i === 0 ? C.emerald : C.muted,
                      fontWeight: i === 0 ? 600 : 500,
                    }}
                  >
                    <span
                      className="h-1 w-1 rounded-full"
                      style={{ background: i === 0 ? C.emerald : 'transparent' }}
                    />
                    {l}
                  </div>
                ))}
              </div>
            </div>

            {/* Main area */}
            <div className="col-span-9 bg-white p-5">
              {/* KPI row */}
              <div className="grid grid-cols-3 gap-3">
                <KpiTile label="Cash on hand" value="AED 412,840" delta="+8.4%" />
                <KpiTile label="VAT due · Q3" value="AED 48,210" delta="-3.4%" negative />
                <KpiTile label="Runway" value="14.2 mo" delta="+2.1%" />
              </div>

              {/* Chart */}
              <div className="mt-4 rounded-xl border p-4" style={{ borderColor: C.hairline }}>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-semibold" style={{ color: C.ink }}>
                      Cash flow · 90 days
                    </div>
                    <div className="text-[9px] font-medium uppercase tracking-wider" style={{ color: C.muted }}>
                      Operating · Investing · Financing
                    </div>
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5 font-mono text-[9px]"
                    style={{ background: C.emeraldSoft, color: C.emerald }}
                  >
                    +12.6%
                  </span>
                </div>
                <svg viewBox="0 0 400 100" className="h-20 w-full">
                  <defs>
                    <linearGradient id="hg" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor={C.emerald} stopOpacity="0.22" />
                      <stop offset="100%" stopColor={C.emerald} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <motion.path
                    initial={{ pathLength: 0 }}
                    whileInView={{ pathLength: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 2.2, ease: 'easeInOut', delay: 0.6 }}
                    d="M 0 75 Q 40 70 60 60 T 110 55 T 170 42 T 230 35 T 290 28 T 350 22 T 400 14"
                    fill="none"
                    stroke={C.emerald}
                    strokeWidth="1.75"
                  />
                  <path
                    d="M 0 75 Q 40 70 60 60 T 110 55 T 170 42 T 230 35 T 290 28 T 350 22 T 400 14 L 400 100 L 0 100 Z"
                    fill="url(#hg)"
                  />
                </svg>
              </div>

              {/* Transactions row */}
              <div className="mt-4 rounded-xl border" style={{ borderColor: C.hairline }}>
                <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: C.hairline }}>
                  <span className="text-[11px] font-semibold" style={{ color: C.ink }}>
                    Today · auto-categorised
                  </span>
                  <span className="text-[9px] font-medium uppercase tracking-wider" style={{ color: C.muted }}>
                    AI · 99.2% confidence
                  </span>
                </div>
                {[
                  ['Carrefour Hypermarket', 'Office supplies', 'AED 432.10'],
                  ['Etisalat — Business Line', 'Telecom', 'AED 879.00'],
                  ['DEWA — June bill', 'Utilities', 'AED 1,204.50'],
                ].map(([v, c, a], i) => (
                  <motion.div
                    key={v}
                    initial={{ opacity: 0, x: -16 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: 0.9 + i * 0.18 }}
                    className="flex items-center justify-between border-b px-4 py-2 text-[11px] last:border-0"
                    style={{ borderColor: C.hairline }}
                  >
                    <span className="font-medium" style={{ color: C.ink }}>
                      {v}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[9px] font-semibold"
                      style={{ background: C.whisper, color: C.muted }}
                    >
                      {c}
                    </span>
                    <span className="font-mono" style={{ color: C.ink }}>
                      {a}
                    </span>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Reveal>

      {/* Floating AI chat surface */}
      <Reveal delay={0.7} y={20}>
        <div
          className="absolute -bottom-8 -left-8 hidden w-[320px] overflow-hidden rounded-2xl border bg-white p-4 shadow-[0_24px_60px_-30px_rgba(15,20,25,0.3),0_8px_24px_-12px_rgba(15,20,25,0.1)] sm:block"
          style={{ borderColor: C.hairline }}
        >
          <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>
            <span
              className="flex h-5 w-5 items-center justify-center rounded-md"
              style={{ background: C.emerald }}
            >
              <Sparkles className="h-2.5 w-2.5 text-white" />
            </span>
            Ask Muhasib
          </div>
          <div
            className="mb-2 rounded-lg px-3 py-2 text-[11px]"
            style={{ background: C.whisper, color: C.ink }}
          >
            What's my VAT liability for Q3?
          </div>
          <div
            className="rounded-lg px-3 py-2.5 text-[11px] leading-relaxed"
            style={{ background: C.emeraldSoft, color: C.ink }}
          >
            <span className="font-semibold">AED 48,210</span> due 28 October. Down 3.4% from Q2 — driven by lower zero-rated exports. Want me to draft the return?
            <div className="mt-2 flex gap-1.5">
              <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[9px]" style={{ color: C.emerald }}>
                Draft return
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[9px]" style={{ color: C.muted }}>
                Show workpaper
              </span>
            </div>
          </div>
        </div>
      </Reveal>

      {/* Floating compliance ribbon */}
      <Reveal delay={0.9}>
        <div
          className="absolute -right-6 -top-6 hidden items-center gap-2 rounded-full border bg-white px-4 py-2 shadow-[0_12px_30px_-12px_rgba(15,20,25,0.2)] sm:flex"
          style={{ borderColor: C.hairline }}
        >
          <FileCheck className="h-4 w-4" style={{ color: C.emerald }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.ink }}>
            FTA · VAT 201 · ready to file
          </span>
        </div>
      </Reveal>
    </div>
  );
}

function KpiTile({
  label,
  value,
  delta,
  negative,
}: {
  label: string;
  value: string;
  delta: string;
  negative?: boolean;
}) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: C.hairline }}>
      <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>
        {label}
      </div>
      <div className="mt-1 font-mono text-[13px] font-semibold" style={{ color: C.ink }}>
        {value}
      </div>
      <div className="mt-1.5">
        <span
          className="rounded-full px-1.5 py-0.5 font-mono text-[9px]"
          style={{
            background: negative ? '#FBE7E3' : C.emeraldSoft,
            color: negative ? '#B5392B' : C.emerald,
          }}
        >
          {delta}
        </span>
      </div>
    </div>
  );
}

// ── 5. Live FTA regulatory updates ticker (the differentiator) ───────────────
function FtaTicker() {
  const updates = [
    ['FTA Decision 5/2025', 'Real-estate VAT clarification published — effective 1 Sep'],
    ['Cabinet Decision 100/2024', 'Corporate Tax small-business relief threshold confirmed'],
    ['e-Invoicing Phase 2', 'PINT AE format mandatory for B2B from July 2026'],
    ['EmaraTax', 'New API endpoint for bulk VAT 201 submission (v2.4)'],
    ['Public Clarification', 'Treatment of director services for VAT — VATP040'],
    ['FTA Decision 8/2025', 'E-commerce supplies — emirate-level reporting refinement'],
  ];
  // Duplicate for seamless loop.
  const stream = [...updates, ...updates];

  return (
    <div className="relative overflow-hidden border-y" style={{ borderColor: C.hairline, background: C.whisper }}>
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-[#FAFAF6] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-[#FAFAF6] to-transparent" />

      <div className="flex items-center gap-3 px-6 py-3">
        <span
          className="flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-[9px] font-bold uppercase tracking-[0.2em]"
          style={{ background: C.ink, color: C.paper }}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative h-1.5 w-1.5 rounded-full" style={{ background: C.emerald }} />
          </span>
          FTA · Live
        </span>

        <div className="relative flex-1 overflow-hidden">
          <motion.div
            className="flex items-center gap-10 whitespace-nowrap"
            animate={{ x: ['0%', '-50%'] }}
            transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
          >
            {stream.map(([tag, body], i) => (
              <div key={i} className="flex shrink-0 items-center gap-3 text-[12px]">
                <span
                  className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                  style={{ background: C.goldSoft, color: '#7B6228' }}
                >
                  {tag}
                </span>
                <span style={{ color: C.ink }}>{body}</span>
                <span style={{ color: C.muted }}>·</span>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

// ── 6. Capability bento (real product UI in tiles, not icons) ────────────────
function CapabilityBento() {
  return (
    <div className="grid gap-4 md:grid-cols-6 md:grid-rows-2">
      {/* Receipt OCR — wide */}
      <BentoCard className="md:col-span-3 md:row-span-1">
        <BentoHeader icon={Receipt} eyebrow="Receipt vision" title="Photograph it. We do the rest." />
        <BentoBody>
          Vendor, VAT, total, currency, IBAN — extracted in under a second. Arabic and English, faded or crumpled.
        </BentoBody>
        <div
          className="relative mt-5 overflow-hidden rounded-xl border"
          style={{ borderColor: C.hairline, background: 'rgba(15,20,25,0.02)' }}
        >
          <div className="grid grid-cols-5 gap-px p-px">
            <div className="col-span-2 bg-white p-4">
              {/* Mock receipt */}
              <div
                className="relative aspect-[3/4] rounded-md border"
                style={{ borderColor: C.hairline, background: '#FBF9F2' }}
              >
                <div className="p-2.5 text-[8px] font-mono leading-tight" style={{ color: C.ink }}>
                  CARREFOUR<br />
                  Dubai Mall<br />
                  ───────────────<br />
                  Office supplies 432.10<br />
                  VAT 5% 21.61<br />
                  ───────────────<br />
                  TOTAL AED 453.71
                </div>
                {/* Scan line */}
                <motion.div
                  className="absolute inset-x-2 h-0.5"
                  style={{ background: C.emerald, boxShadow: `0 0 12px ${C.emerald}` }}
                  animate={{ top: ['8%', '92%', '8%'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                />
              </div>
            </div>
            <div className="col-span-3 bg-white p-4">
              {[
                ['Vendor', 'Carrefour Hypermarket'],
                ['Date', '12 Jun 2026'],
                ['Subtotal', 'AED 432.10'],
                ['VAT 5%', 'AED 21.61'],
                ['Total', 'AED 453.71'],
                ['Category', 'Office supplies'],
              ].map(([k, v], i) => (
                <motion.div
                  key={k}
                  initial={{ opacity: 0, x: 8 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.08 }}
                  className="flex items-center justify-between border-b py-1.5 text-[10px] last:border-0"
                  style={{ borderColor: C.hairline }}
                >
                  <span style={{ color: C.muted }}>{k}</span>
                  <span className="font-mono font-medium" style={{ color: C.ink }}>
                    {v}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </BentoCard>

      {/* VAT 201 */}
      <BentoCard className="md:col-span-3">
        <BentoHeader icon={FileCheck} eyebrow="VAT 201" title="Pre-filed before you log in." />
        <BentoBody>
          Output VAT, input VAT, reverse charge, designated-zone adjustments — calculated continuously and held audit-ready.
        </BentoBody>
        <div
          className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border"
          style={{ borderColor: C.hairline, background: C.hairline }}
        >
          {[
            ['Box 1a · Standard rated', 'AED 824,000'],
            ['Box 1a · Output VAT', 'AED 41,200'],
            ['Box 9 · Input VAT', 'AED 14,820'],
            ['Net payable', 'AED 26,380'],
          ].map(([k, v], i) => (
            <div key={k} className="bg-white p-3">
              <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>
                {k}
              </div>
              <div className="mt-1 font-mono text-[13px]" style={{ color: C.ink }}>
                {i === 3 ? <span style={{ color: C.emerald }}>{v}</span> : v}
              </div>
            </div>
          ))}
        </div>
      </BentoCard>

      {/* Bilingual invoice — narrow */}
      <BentoCard className="md:col-span-2">
        <BentoHeader icon={Languages} eyebrow="Bilingual" title="One invoice. Two scripts." />
        <BentoBody>FTA-compliant tax invoices with Arabic and English on the same document.</BentoBody>
        <div
          className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border text-[8px]"
          style={{ borderColor: C.hairline, background: C.hairline }}
        >
          <div className="bg-white p-3 leading-tight" style={{ color: C.ink }}>
            <div className="font-semibold" style={{ color: C.emerald }}>
              Tax Invoice
            </div>
            <div className="mt-1 font-mono" style={{ color: C.muted }}>
              TRN 100212345600003
            </div>
            <div className="mt-2 space-y-0.5 font-mono">
              <div>Consulting · AED 5,000.00</div>
              <div>VAT 5% · AED 250.00</div>
              <div className="font-semibold">Total · AED 5,250.00</div>
            </div>
          </div>
          <div className="bg-white p-3 text-right leading-tight" dir="rtl" style={{ color: C.ink, fontFamily: '"Cairo", "Noto Sans Arabic", sans-serif' }}>
            <div className="font-semibold" style={{ color: C.emerald }}>
              فاتورة ضريبية
            </div>
            <div className="mt-1 font-mono" style={{ color: C.muted }}>
              ١٠٠٢١٢٣٤٥٦٠٠٠٠٣
            </div>
            <div className="mt-2 space-y-0.5">
              <div>استشارة · ٥٠٠٠</div>
              <div>ضريبة ٥٪ · ٢٥٠</div>
              <div className="font-semibold">الإجمالي · ٥٢٥٠</div>
            </div>
          </div>
        </div>
      </BentoCard>

      {/* Reconciliation */}
      <BentoCard className="md:col-span-2">
        <BentoHeader icon={RefreshCw} eyebrow="Bank feeds" title="Reconciled while you sleep." />
        <BentoBody>Live feeds from Emirates NBD, ADCB, FAB, Mashreq, RAKBANK, ENBD Islamic. Matched, posted, cleared.</BentoBody>
        <div
          className="mt-5 space-y-1.5 overflow-hidden rounded-xl border bg-white p-3"
          style={{ borderColor: C.hairline }}
        >
          {[
            ['ENBD · 2841', 'matched', 'AED 12,400'],
            ['ADCB · 0119', 'matched', 'AED 3,250'],
            ['Mashreq · 5520', 'review', 'AED 880'],
          ].map(([bank, status, amt], i) => (
            <div key={i} className="flex items-center justify-between text-[10px]">
              <span className="font-mono" style={{ color: C.muted }}>
                {bank}
              </span>
              <span
                className="rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase"
                style={{
                  background: status === 'matched' ? C.emeraldSoft : C.goldSoft,
                  color: status === 'matched' ? C.emerald : '#7B6228',
                }}
              >
                {status}
              </span>
              <span className="font-mono" style={{ color: C.ink }}>
                {amt}
              </span>
            </div>
          ))}
        </div>
      </BentoCard>

      {/* Multi-currency */}
      <BentoCard className="md:col-span-2">
        <BentoHeader icon={Wallet} eyebrow="Multi-currency" title="AED home, 150+ rails." />
        <BentoBody>Live FX rates, automatic gain/loss postings, designated-zone exemption handling.</BentoBody>
        <div className="mt-5 grid grid-cols-3 gap-1.5 text-center text-[10px]">
          {[
            ['USD', '3.6730', '+0.01'],
            ['EUR', '3.9582', '-0.04'],
            ['GBP', '4.6810', '+0.12'],
          ].map(([k, r, d]) => (
            <div key={k} className="rounded-lg border p-2" style={{ borderColor: C.hairline }}>
              <div className="font-mono text-[9px] uppercase tracking-wider" style={{ color: C.muted }}>
                AED · {k}
              </div>
              <div className="mt-0.5 font-mono font-semibold" style={{ color: C.ink }}>
                {r}
              </div>
              <div className="font-mono text-[9px]" style={{ color: d.startsWith('+') ? C.emerald : '#B5392B' }}>
                {d}
              </div>
            </div>
          ))}
        </div>
      </BentoCard>
    </div>
  );
}

function BentoCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <Reveal className={className}>
      <div
        className="group h-full rounded-2xl border bg-white p-6 transition-shadow hover:shadow-[0_12px_40px_-20px_rgba(15,20,25,0.18)]"
        style={{ borderColor: C.hairline }}
      >
        {children}
      </div>
    </Reveal>
  );
}

function BentoHeader({
  icon: Icon,
  eyebrow,
  title,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  eyebrow: string;
  title: string;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: C.muted }}>
        <Icon className="h-3.5 w-3.5" style={{ color: C.emerald }} />
        {eyebrow}
      </div>
      <h3 className="font-serif text-2xl leading-tight tracking-tight" style={{ color: C.ink }}>
        {title}
      </h3>
    </div>
  );
}

function BentoBody({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 text-sm leading-relaxed" style={{ color: C.muted }}>
      {children}
    </p>
  );
}

// ── 7. Comparison strip ──────────────────────────────────────────────────────
function ComparisonTable() {
  const rows = [
    ['FTA-native VAT 201 filing', true, false, false, false],
    ['Arabic + English UI', true, false, false, true],
    ['e-Invoicing PINT AE (2026)', true, false, false, false],
    ['UAE bank feeds (ENBD / ADCB / FAB)', true, false, false, false],
    ['Receipt OCR — Arabic + English', true, true, false, false],
    ['UAE corporate tax workpapers', true, false, false, false],
    ['Pricing in AED', true, false, false, true],
  ];
  const cols = ['Muhasib', 'QuickBooks', 'Xero', 'Zoho Books'];
  return (
    <Reveal>
      <div
        className="overflow-hidden rounded-2xl border bg-white"
        style={{ borderColor: C.hairline }}
      >
        <div
          className="grid grid-cols-[1.6fr_repeat(4,1fr)] items-center border-b text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ borderColor: C.hairline, color: C.muted }}
        >
          <div className="px-5 py-4">UAE-built feature</div>
          {cols.map((c, i) => (
            <div
              key={c}
              className="border-l px-4 py-4 text-center"
              style={{
                borderColor: C.hairline,
                background: i === 0 ? C.emeraldSoft : 'transparent',
                color: i === 0 ? C.emerald : C.muted,
              }}
            >
              {c}
            </div>
          ))}
        </div>
        {rows.map(([label, ...vals], r) => (
          <div
            key={r}
            className="grid grid-cols-[1.6fr_repeat(4,1fr)] items-center border-b text-sm last:border-0"
            style={{ borderColor: C.hairline }}
          >
            <div className="px-5 py-3.5 font-medium" style={{ color: C.ink }}>
              {label}
            </div>
            {(vals as boolean[]).map((v, i) => (
              <div
                key={i}
                className="border-l px-4 py-3.5 text-center"
                style={{ borderColor: C.hairline, background: i === 0 ? C.emeraldSoft : 'transparent' }}
              >
                {v ? (
                  <Check className="mx-auto h-4 w-4" style={{ color: i === 0 ? C.emerald : C.ink }} />
                ) : (
                  <span className="font-mono text-base" style={{ color: 'rgba(15,20,25,0.2)' }}>
                    —
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </Reveal>
  );
}

// ── 8. Workflow walkthrough — scroll-driven 4-step morph ────────────────────
function Workflow() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });

  // All useTransform calls happen at the top level — Rules of Hooks.
  // Step opacities (left column number badges).
  const s1Op = useTransform(scrollYProgress, [0.1, 0.3], [0.35, 1]);
  const s2Op = useTransform(scrollYProgress, [0.3, 0.5], [0.35, 1]);
  const s3Op = useTransform(scrollYProgress, [0.5, 0.7], [0.35, 1]);
  const s4Op = useTransform(scrollYProgress, [0.7, 0.9], [0.35, 1]);

  // Border colors (left column number badges).
  const s1Border = useTransform(scrollYProgress, [0.1, 0.3], [C.hairline, C.emerald]);
  const s2Border = useTransform(scrollYProgress, [0.3, 0.5], [C.hairline, C.emerald]);
  const s3Border = useTransform(scrollYProgress, [0.5, 0.7], [C.hairline, C.emerald]);
  const s4Border = useTransform(scrollYProgress, [0.7, 0.9], [C.hairline, C.emerald]);

  // Pipeline row opacities (right column).
  const p1Op = useTransform(scrollYProgress, [0.1, 0.3], [0.3, 1]);
  const p2Op = useTransform(scrollYProgress, [0.3, 0.5], [0.3, 1]);
  const p3Op = useTransform(scrollYProgress, [0.5, 0.7], [0.3, 1]);
  const p4Op = useTransform(scrollYProgress, [0.7, 0.9], [0.3, 1]);

  // Pipeline tick check opacities.
  const t1 = useTransform(scrollYProgress, [0.2, 0.3], [0, 1]);
  const t2 = useTransform(scrollYProgress, [0.4, 0.5], [0, 1]);
  const t3 = useTransform(scrollYProgress, [0.6, 0.7], [0, 1]);
  const t4 = useTransform(scrollYProgress, [0.8, 0.9], [0, 1]);

  // Pipeline tick backgrounds.
  const b1 = useTransform(scrollYProgress, [0.1, 0.3], [C.whisper, C.emeraldSoft]);
  const b2 = useTransform(scrollYProgress, [0.3, 0.5], [C.whisper, C.emeraldSoft]);
  const b3 = useTransform(scrollYProgress, [0.5, 0.7], [C.whisper, C.emeraldSoft]);
  const b4 = useTransform(scrollYProgress, [0.7, 0.9], [C.whisper, C.emeraldSoft]);

  const steps: Array<{
    n: string;
    t: string;
    d: string;
    op: import('framer-motion').MotionValue<number>;
    border: import('framer-motion').MotionValue<string>;
  }> = [
    { n: '01', t: 'Capture', d: 'Photo, email forward, or bank feed.', op: s1Op, border: s1Border },
    { n: '02', t: 'Categorise', d: 'AI assigns COA, VAT code, project, cost centre.', op: s2Op, border: s2Border },
    { n: '03', t: 'Reconcile', d: 'Matched against bank movements continuously.', op: s3Op, border: s3Border },
    { n: '04', t: 'File', d: 'VAT 201 drafted, signed, submitted to EmaraTax.', op: s4Op, border: s4Border },
  ];

  const pipeline: Array<{
    label: string;
    body: string;
    op: import('framer-motion').MotionValue<number>;
    tick: import('framer-motion').MotionValue<number>;
    bg: import('framer-motion').MotionValue<string>;
  }> = [
    { label: 'Receipt captured', body: 'Carrefour · AED 453.71', op: p1Op, tick: t1, bg: b1 },
    { label: 'Categorised', body: 'Office supplies · VAT 5%', op: p2Op, tick: t2, bg: b2 },
    { label: 'Reconciled', body: 'Matched ADCB · 0119', op: p3Op, tick: t3, bg: b3 },
    { label: 'VAT 201 queued', body: 'Q3 2026 · ready to file', op: p4Op, tick: t4, bg: b4 },
  ];

  return (
    <div ref={ref} className="relative">
      <div className="grid items-start gap-12 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: C.emerald }}>
            <span className="h-px w-8" style={{ background: C.emerald }} />
            How it works
          </div>
          <h2 className="font-serif text-4xl leading-[1.05] tracking-tight md:text-5xl" style={{ color: C.ink }}>
            From receipt to <span className="italic" style={{ color: C.emerald }}>filed</span>.<br />
            Untouched.
          </h2>
          <p className="mt-6 max-w-md text-base leading-relaxed" style={{ color: C.muted }}>
            Snap a receipt, forward an invoice, or sync a bank line.
            Muhasib categorises it, posts the journal, updates your VAT
            position, and queues the return — all before you'd have opened
            your spreadsheet.
          </p>

          <div className="mt-10 space-y-5">
            {steps.map((s) => (
              <motion.div key={s.n} style={{ opacity: s.op }} className="flex items-start gap-5">
                <motion.div
                  style={{ borderColor: s.border }}
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 font-mono text-xs font-semibold"
                >
                  {s.n}
                </motion.div>
                <div>
                  <div className="text-base font-semibold" style={{ color: C.ink }}>
                    {s.t}
                  </div>
                  <div className="mt-1 text-sm" style={{ color: C.muted }}>
                    {s.d}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="sticky top-32">
          <div
            className="relative overflow-hidden rounded-2xl border bg-white p-6"
            style={{ borderColor: C.hairline, boxShadow: '0 24px 60px -30px rgba(15,20,25,0.25)' }}
          >
            <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: C.muted }}>
              <Cpu className="h-3.5 w-3.5" style={{ color: C.emerald }} />
              Live pipeline
            </div>

            <div className="space-y-3">
              {pipeline.map((p, i) => (
                <motion.div
                  key={i}
                  style={{ opacity: p.op }}
                  className="flex items-center gap-3 rounded-xl border p-3"
                  data-border-color={C.hairline}
                >
                  <motion.div
                    className="flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{ background: p.bg }}
                  >
                    <motion.div style={{ opacity: p.tick }}>
                      <Check className="h-4 w-4" style={{ color: C.emerald }} />
                    </motion.div>
                  </motion.div>
                  <div className="flex-1">
                    <div className="text-[11px] font-semibold" style={{ color: C.ink }}>
                      {p.label}
                    </div>
                    <div className="font-mono text-[10px]" style={{ color: C.muted }}>
                      {p.body}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 9. Page ──────────────────────────────────────────────────────────────────
export default function MuhasibLanding() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-screen antialiased" style={{ background: C.paper, color: C.ink, fontFamily: '"Geist", system-ui, sans-serif' }}>
      {/* ─── Navbar ────────────────────────────────────────────────────── */}
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
          scrolled ? 'border-b bg-[#FAFAF6]/85 backdrop-blur-xl' : 'border-b border-transparent'
        }`}
        style={scrolled ? { borderColor: C.hairline } : undefined}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/">
            <div className="flex cursor-pointer items-center gap-2.5">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg font-serif text-base font-bold text-white"
                style={{ background: C.emerald }}
              >
                م
              </div>
              <span className="text-[15px] font-semibold tracking-tight">
                Muhasib<span style={{ color: C.emerald }}>.ai</span>
              </span>
            </div>
          </Link>

          <nav className="hidden items-center gap-8 md:flex">
            {[
              ['Product', '#capabilities'],
              ['Compliance', '#compliance'],
              ['Compare', '#compare'],
              ['Pricing', '/pricing'],
            ].map(([l, h]) => (
              <a
                key={l}
                href={h}
                className="group relative text-[13px] font-medium transition-colors"
                style={{ color: C.muted }}
              >
                {l}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <Link href="/login">
              <button className="text-[13px] font-medium" style={{ color: C.muted }}>
                Sign in
              </button>
            </Link>
            <Link href="/register">
              <button
                className="group flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold text-white transition-transform hover:scale-[1.02]"
                style={{ background: C.emerald }}
              >
                Start free
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </button>
            </Link>
          </div>

          <button
            className="rounded-md p-2 md:hidden"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Toggle menu"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="border-t bg-white md:hidden"
            style={{ borderColor: C.hairline }}
          >
            <div className="flex flex-col gap-1 p-4">
              {['Product', 'Compliance', 'Compare', 'Pricing'].map((l) => (
                <a key={l} href="#" className="rounded-md px-3 py-3 text-sm font-medium" style={{ color: C.ink }}>
                  {l}
                </a>
              ))}
              <Link href="/register" className="mt-2">
                <button className="w-full rounded-full px-4 py-3 text-sm font-semibold text-white" style={{ background: C.emerald }}>
                  Start free
                </button>
              </Link>
            </div>
          </motion.div>
        )}
      </header>

      {/* ─── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative pt-32 lg:pt-40">
        <HeroMesh />
        <div className="relative mx-auto max-w-7xl px-6">
          <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_1fr]">
            <div>
              {/* Eyebrow */}
              <Reveal>
                <div
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]"
                  style={{ borderColor: C.hairlineStrong, background: 'rgba(255,255,255,0.6)', color: C.muted }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: C.emerald }} />
                  Built in Dubai · for the UAE
                </div>
              </Reveal>

              {/* Headline */}
              <Reveal delay={0.05}>
                <h1
                  className="mt-7 font-serif text-[3.2rem] font-medium leading-[0.98] tracking-tight md:text-[4.4rem] lg:text-[5.2rem]"
                  style={{ color: C.ink }}
                >
                  The ledger,
                  <br />
                  <span className="italic" style={{ color: C.emerald }}>
                    handled.
                  </span>
                </h1>
              </Reveal>

              {/* Subhead */}
              <Reveal delay={0.15}>
                <p
                  className="mt-7 max-w-xl text-base leading-relaxed md:text-lg"
                  style={{ color: C.muted }}
                >
                  AI-native accounting for UAE businesses. Receipts captured, VAT
                  calculated, banks reconciled, and FTA returns filed —
                  continuously, by an agent that never sleeps and never
                  miscategorises.
                </p>
              </Reveal>

              {/* CTAs */}
              <Reveal delay={0.25}>
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <Link href="/register">
                    <button
                      className="group flex items-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
                      style={{ background: C.emerald }}
                    >
                      Start 30-day trial
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </Link>
                  <a
                    href="#capabilities"
                    className="flex items-center gap-2 rounded-full border px-6 py-3.5 text-sm font-semibold"
                    style={{ borderColor: C.hairlineStrong, color: C.ink }}
                  >
                    See the product
                    <ChevronRight className="h-4 w-4" />
                  </a>
                </div>
              </Reveal>

              {/* Trust strip */}
              <Reveal delay={0.4}>
                <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 text-[11px] font-medium uppercase tracking-[0.16em]" style={{ color: C.muted }}>
                  <div className="flex items-center gap-1.5">
                    <FileCheck className="h-3.5 w-3.5" style={{ color: C.emerald }} />
                    FTA · VAT 201
                  </div>
                  <span style={{ color: C.hairlineStrong }}>·</span>
                  <div className="flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5" style={{ color: C.emerald }} />
                    EmaraTax integrated
                  </div>
                  <span style={{ color: C.hairlineStrong }}>·</span>
                  <div className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" style={{ color: C.emerald }} />
                    e-Invoicing PINT AE
                  </div>
                  <span style={{ color: C.hairlineStrong }}>·</span>
                  <div className="flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5" style={{ color: C.emerald }} />
                    SOC 2 Type II
                  </div>
                </div>
              </Reveal>
            </div>

            {/* Product mock */}
            <div className="relative">
              <HeroProductMock />
            </div>
          </div>
        </div>
      </section>

      {/* ─── FTA Ticker ───────────────────────────────────────────────── */}
      <section className="mt-24">
        <FtaTicker />
      </section>

      {/* ─── Numbers ──────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
        <Reveal>
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {[
              { value: 500, suffix: '+', label: 'UAE businesses on Muhasib' },
              { value: 12, prefix: 'AED ', suffix: 'M', label: 'In VAT filed last quarter' },
              { value: 99, suffix: '%', label: 'AI categorisation accuracy' },
              { value: 22, suffix: 'h', label: 'Saved per company per month' },
            ].map((s) => (
              <div key={s.label}>
                <div className="font-serif text-5xl tracking-tight md:text-6xl" style={{ color: C.ink }}>
                  <Counter to={s.value} suffix={s.suffix} prefix={s.prefix} />
                </div>
                <div
                  className="mt-3 text-[11px] font-semibold uppercase tracking-[0.22em]"
                  style={{ color: C.muted }}
                >
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ─── Capabilities Bento ──────────────────────────────────────── */}
      <section id="capabilities" className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
        <Reveal>
          <div className="mb-14 max-w-3xl">
            <div className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: C.emerald }}>
              <span className="h-px w-8" style={{ background: C.emerald }} />
              Product
            </div>
            <h2 className="font-serif text-4xl leading-[1.05] tracking-tight md:text-6xl" style={{ color: C.ink }}>
              Every UAE accounting workflow,<br />
              <span className="italic" style={{ color: C.emerald }}>quietly automated.</span>
            </h2>
          </div>
        </Reveal>
        <CapabilityBento />
      </section>

      {/* ─── Workflow ─────────────────────────────────────────────────── */}
      <section
        id="compliance"
        className="mx-auto max-w-7xl px-6 py-24 lg:py-32"
        style={{ background: 'linear-gradient(180deg,transparent,rgba(13,92,61,0.025))' }}
      >
        <Workflow />
      </section>

      {/* ─── Compare ─────────────────────────────────────────────────── */}
      <section id="compare" className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
        <Reveal>
          <div className="mb-14 max-w-3xl">
            <div className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: C.emerald }}>
              <span className="h-px w-8" style={{ background: C.emerald }} />
              Compare
            </div>
            <h2 className="font-serif text-4xl leading-[1.05] tracking-tight md:text-5xl" style={{ color: C.ink }}>
              Other tools were built<br />
              <span className="italic" style={{ color: C.emerald }}>somewhere else.</span>
            </h2>
            <p className="mt-6 max-w-2xl text-base leading-relaxed" style={{ color: C.muted }}>
              QuickBooks was built for the US tax code. Xero for the Anzac
              market. Zoho is closer, but adapts global features for the UAE
              — instead of starting here.
            </p>
          </div>
        </Reveal>
        <ComparisonTable />
      </section>

      {/* ─── Testimonial ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-24 lg:py-32">
        <Reveal>
          <figure
            className="relative overflow-hidden rounded-3xl border p-12 lg:p-16"
            style={{ background: C.midnight, borderColor: 'rgba(255,255,255,0.06)' }}
          >
            {/* soft glow */}
            <div
              className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full blur-3xl"
              style={{ background: 'rgba(13,92,61,0.4)' }}
            />
            <div
              className="pointer-events-none absolute -bottom-32 -left-32 h-72 w-72 rounded-full blur-3xl"
              style={{ background: 'rgba(193,158,80,0.25)' }}
            />

            <div className="relative">
              <div className="mb-6 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: C.gold }}>
                <span className="h-px w-8" style={{ background: C.gold }} />
                Customer
              </div>
              <blockquote className="max-w-3xl font-serif text-3xl leading-tight md:text-4xl lg:text-5xl" style={{ color: '#F4F2EC' }}>
                "Our close went from 11 days to{' '}
                <span className="italic" style={{ color: C.gold }}>under two</span>. The VAT 201 is
                drafted before our accountant even looks at it."
              </blockquote>
              <figcaption className="mt-10 flex items-center gap-4 text-sm">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full font-serif text-lg font-semibold"
                  style={{ background: 'rgba(255,255,255,0.08)', color: '#F4F2EC' }}
                >
                  HM
                </div>
                <div>
                  <div className="font-semibold" style={{ color: '#F4F2EC' }}>
                    Hassan Mansour
                  </div>
                  <div className="text-[12px]" style={{ color: 'rgba(244,242,236,0.6)' }}>
                    Group CFO · Madar Holdings (Dubai)
                  </div>
                </div>
              </figcaption>
            </div>
          </figure>
        </Reveal>
      </section>

      {/* ─── Insight rail (Big Four trust signal) ────────────────────── */}
      <section className="mx-auto max-w-7xl px-6 py-24">
        <Reveal>
          <div className="flex items-end justify-between gap-6">
            <div>
              <div className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: C.emerald }}>
                <span className="h-px w-8" style={{ background: C.emerald }} />
                Insights
              </div>
              <h2 className="font-serif text-3xl tracking-tight md:text-5xl" style={{ color: C.ink }}>
                From the desk.
              </h2>
            </div>
            <a href="#" className="hidden items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.18em] sm:inline-flex" style={{ color: C.muted }}>
              All insights <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </Reveal>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {[
            ['FTA decision 5/2025', 'A practical guide to the new real-estate VAT clarification', '8 min read'],
            ['Corporate tax', 'When the AED 3M small-business relief actually saves you money', '6 min read'],
            ['e-Invoicing', 'PINT AE in plain Arabic: what changes for your invoicing in July 2026', '11 min read'],
          ].map(([eyebrow, title, meta], i) => (
            <Reveal key={i} delay={i * 0.08}>
              <article
                className="group relative h-full overflow-hidden rounded-2xl border bg-white p-7 transition-shadow hover:shadow-[0_12px_36px_-18px_rgba(15,20,25,0.18)]"
                style={{ borderColor: C.hairline }}
              >
                <div className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: C.emerald }}>
                  {eyebrow}
                </div>
                <h3 className="mt-3 font-serif text-2xl leading-tight" style={{ color: C.ink }}>
                  {title}
                </h3>
                <div className="mt-8 flex items-center justify-between text-[11px] font-medium" style={{ color: C.muted }}>
                  <span>{meta}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ─── Final CTA ───────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
        <Reveal>
          <div
            className="relative overflow-hidden rounded-3xl border p-12 text-center lg:p-20"
            style={{ background: C.paper, borderColor: C.hairline }}
          >
            <HeroMesh />
            <div className="relative">
              <div className="mb-6 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: C.emerald }}>
                <span className="h-px w-8" style={{ background: C.emerald }} />
                30-day trial · no card
              </div>
              <h2 className="mx-auto max-w-3xl font-serif text-4xl leading-[1.05] tracking-tight md:text-6xl" style={{ color: C.ink }}>
                Hand the ledger to an<br />
                <span className="italic" style={{ color: C.emerald }}>agent that never sleeps.</span>
              </h2>
              <p className="mx-auto mt-7 max-w-xl text-base leading-relaxed" style={{ color: C.muted }}>
                Migrate from your old tool in minutes. We import your COA,
                opening balances, contacts, and last twelve months.
              </p>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                <Link href="/register">
                  <button
                    className="group flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
                    style={{ background: C.emerald }}
                  >
                    Start 30-day trial
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </button>
                </Link>
                <a
                  href="mailto:hello@muhasib.ai"
                  className="rounded-full border px-7 py-3.5 text-sm font-semibold"
                  style={{ borderColor: C.hairlineStrong, color: C.ink }}
                >
                  Talk to founders
                </a>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────────── */}
      <footer className="border-t" style={{ borderColor: C.hairline, background: 'rgba(15,20,25,0.02)' }}>
        <div className="mx-auto max-w-7xl px-6 py-14">
          <div className="grid gap-10 md:grid-cols-4">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg font-serif text-base font-bold text-white"
                  style={{ background: C.emerald }}
                >
                  م
                </div>
                <span className="text-[15px] font-semibold tracking-tight">
                  Muhasib<span style={{ color: C.emerald }}>.ai</span>
                </span>
              </div>
              <p className="mt-5 max-w-md text-sm" style={{ color: C.muted }}>
                AI-native accounting, built in Dubai for the UAE. Headquartered
                in DIFC. Operating across the GCC.
              </p>
              <div className="mt-6 flex items-center gap-2 text-[11px]" style={{ color: C.muted }}>
                <Building2 className="h-3.5 w-3.5" />
                Index Tower · DIFC · Dubai
              </div>
            </div>

            <FooterCol title="Product" links={[['Receipts', '#'], ['VAT 201', '#'], ['Bank feeds', '#'], ['Bilingual invoices', '#'], ['Pricing', '/pricing']]} />
            <FooterCol title="Company" links={[['Sign in', '/login'], ['Register', '/register'], ['Privacy', '/privacy'], ['Terms', '/terms'], ['Cookies', '/cookies']]} />
          </div>

          <div className="mt-14 flex flex-col items-start justify-between gap-3 border-t pt-8 text-[11px] md:flex-row md:items-center" style={{ borderColor: C.hairline, color: C.muted }}>
            <div>© {new Date().getFullYear()} Muhasib.ai · DIFC, Dubai, United Arab Emirates</div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5" style={{ color: C.emerald }} />
              All systems normal
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className="mb-4 text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: C.muted }}>
        {title}
      </h4>
      <ul className="space-y-3">
        {links.map(([l, h]) => (
          <li key={l}>
            <a href={h} className="text-sm" style={{ color: C.ink }}>
              {l}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
