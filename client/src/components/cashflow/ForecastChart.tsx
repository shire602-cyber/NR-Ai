import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import type { ForecastWeek } from "@/lib/banking-api-types";
import { messages } from "./ForecastChart.i18n";
import { buildChartData } from "./chart-data";

/** Weekly bars (in above the axis, out below) and the closing balance as a line. */
export function ForecastChart({ weeks, currency }: { weeks: ForecastWeek[]; currency: string }) {
  const tr = messages.useT();
  const locale = useI18n((s) => s.locale);
  const data = buildChartData(weeks, locale);
  if (data.length === 0) return <p className="text-sm text-muted-foreground">{tr("empty")}</p>;
  const compact = (n: number) => new Intl.NumberFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-AE", { notation: "compact", maximumFractionDigits: 1 }).format(n);

  return (
    <div className="h-72 w-full" role="img" aria-label={tr("ariaLabel")} data-testid="forecast-chart" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={compact} width={52} stroke="hsl(var(--muted-foreground))" />
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
          <Tooltip
            formatter={(value: number, name: string) => [formatCurrency(Math.abs(value), currency, locale), name === "inflows" ? tr("inflows") : name === "outflows" ? tr("outflows") : tr("balance")]}
            labelFormatter={(_label, payload) => tr("weekOf", { date: String((payload?.[0]?.payload as { label?: string } | undefined)?.label ?? "") })}
            contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
          />
          <Bar dataKey="inflows" fill="hsl(var(--chart-5))" radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Bar dataKey="outflows" fill="hsl(var(--chart-4))" radius={[0, 0, 3, 3]} maxBarSize={28} />
          <Line type="monotone" dataKey="balance" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground" dir={locale === "ar" ? "rtl" : "ltr"}>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[hsl(var(--chart-5))]" />
          {tr("inflows")}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[hsl(var(--chart-4))]" />
          {tr("outflows")}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-[hsl(var(--chart-1))]" />
          {tr("balance")}
        </span>
      </div>
    </div>
  );
}
