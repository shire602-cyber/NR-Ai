import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";
import { FileText, Receipt } from "lucide-react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { MeshGradient } from "@/components/ui/mesh-gradient";
import type { DashboardModel } from "./useCustomerDashboardModel";

export function DashboardHero({ m }: { m: DashboardModel }) {
  const {
    t,
    locale,
    stats,
    statsLoading,
    monthLabel,
    profit,
    margin,
    heroPeriodLabel,
    animatedProfit,
  } = m;
  return (
    <>
      {/* ── Editorial Hero ────────────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
        className="relative"
      >
        <MeshGradient className="rounded-3xl opacity-60" emerald={0.2} gold={0.16} />
        <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
          <div className="lg:col-span-7 xl:col-span-8">
            <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-accent mb-3 flex items-center gap-2">
              <span className="inline-block w-6 h-px bg-accent/60" />
              <span className="font-mono">{monthLabel}</span>
            </div>
            <h1 className="font-display text-[28px] md:text-[34px] leading-[1.05] tracking-tight text-foreground">
              {(t as any).welcomeBack ?? "Welcome back"}
              <span className="text-accent">.</span>
            </h1>
            <p className="mt-2 max-w-xl text-[13.5px] text-muted-foreground leading-relaxed">
              {(t as any).financialOverview ??
                "Your financial overview — revenue, expenses, and outstanding receivables."}
            </p>
          </div>

          <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-3">
            <div className="rounded-2xl border border-card-border bg-card/70 p-5 backdrop-blur-xl shadow-lg">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                  {heroPeriodLabel}
                </div>
                <Badge variant={profit >= 0 ? "success" : "danger"} dot>
                  {profit >= 0
                    ? ((t as any).positive ?? "Positive")
                    : ((t as any).negative ?? "Negative")}
                </Badge>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                {statsLoading ? (
                  <Skeleton className="h-10 w-40" />
                ) : (
                  <>
                    <span className="font-display text-[24px] md:text-[28px] leading-none tracking-tight tabular-nums text-foreground">
                      {formatCurrency(animatedProfit, "AED", locale)}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-2 text-[12px] text-muted-foreground">
                {statsLoading ? null : (
                  <>
                    {(t as any).margin ?? "Margin"}{" "}
                    <span className="font-mono tabular-nums font-medium text-foreground">
                      {margin.toFixed(1)}%
                    </span>{" "}
                    · {(t as any).revenue ?? "Revenue"}{" "}
                    <span className="font-mono tabular-nums">
                      {formatCurrency(stats?.revenue || 0, "AED", locale)}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/invoices">
                  <Button size="sm" variant="default" data-testid="button-quick-invoice">
                    <FileText className="w-3.5 h-3.5" />
                    {(t as any).newInvoice ?? "New Invoice"}
                  </Button>
                </Link>
                <Link href="/receipts">
                  <Button size="sm" variant="outline" data-testid="button-quick-receipt">
                    <Receipt className="w-3.5 h-3.5" />
                    {(t as any).scanReceipt ?? "Scan Receipt"}
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </motion.section>
    </>
  );
}
