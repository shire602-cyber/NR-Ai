import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiRequest } from '@/lib/queryClient';

function formatAed(n: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(n);
}

function StatRow({ label, amount, indent = false }: { label: string; amount: number; indent?: boolean }) {
  return (
    <div className={['flex justify-between items-center py-1.5', indent ? 'pl-4' : ''].join(' ')}>
      <span className={['text-sm', indent ? 'text-gray-500' : 'text-gray-700'].join(' ')}>{label}</span>
      <span className={['text-sm tabular-nums', indent ? 'text-gray-500' : 'font-medium text-gray-900'].join(' ')}>
        {formatAed(amount)}
      </span>
    </div>
  );
}

function SectionTotal({ label, amount, positive }: { label: string; amount: number; positive?: boolean }) {
  const color = positive === undefined ? 'text-gray-900' : amount >= 0 ? 'text-green-700' : 'text-red-600';
  return (
    <div className="flex justify-between items-center py-2 border-t border-gray-200 mt-1">
      <span className="text-sm font-semibold text-gray-900">{label}</span>
      <span className={['text-sm font-bold tabular-nums', color].join(' ')}>{formatAed(amount)}</span>
    </div>
  );
}

export default function PortalStatements() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-statements'],
    queryFn: () => apiRequest('GET', '/api/client-portal/statements'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pnl = data?.profitAndLoss ?? { revenue: 0, expenses: 0, netProfit: 0, items: [] };
  const bs = data?.balanceSheet ?? { assets: 0, liabilities: 0, equity: 0, items: [] };

  const revenueItems = pnl.items?.filter((i: any) => i.type === 'income') ?? [];
  const expenseItems = pnl.items?.filter((i: any) => i.type === 'expense') ?? [];
  const assetItems = bs.items?.filter((i: any) => i.type === 'asset') ?? [];
  const liabilityItems = bs.items?.filter((i: any) => i.type === 'liability') ?? [];
  const equityItems = bs.items?.filter((i: any) => i.type === 'equity') ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Financial Statements</h2>
        <p className="text-sm text-gray-500 mt-1">Read-only view of your company's financials.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Profit & Loss */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              {pnl.netProfit >= 0
                ? <TrendingUp className="w-4 h-4 text-green-500" />
                : <TrendingDown className="w-4 h-4 text-red-500" />}
              Profit & Loss
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Revenue</p>
              {revenueItems.length === 0
                ? <p className="text-xs text-gray-400 py-1">No revenue recorded</p>
                : revenueItems.map((i: any) => <StatRow key={i.name} label={i.name} amount={i.balance} indent />)
              }
              <SectionTotal label="Total Revenue" amount={pnl.revenue} />

              <div className="pt-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Expenses</p>
                {expenseItems.length === 0
                  ? <p className="text-xs text-gray-400 py-1">No expenses recorded</p>
                  : expenseItems.map((i: any) => <StatRow key={i.name} label={i.name} amount={i.balance} indent />)
                }
                <SectionTotal label="Total Expenses" amount={pnl.expenses} />
              </div>

              <div className="pt-1">
                <SectionTotal label="Net Profit / (Loss)" amount={pnl.netProfit} positive />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Balance Sheet */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Minus className="w-4 h-4 text-blue-500" />
              Balance Sheet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Assets</p>
              {assetItems.length === 0
                ? <p className="text-xs text-gray-400 py-1">No assets recorded</p>
                : assetItems.map((i: any) => <StatRow key={i.name} label={i.name} amount={i.balance} indent />)
              }
              <SectionTotal label="Total Assets" amount={bs.assets} />

              <div className="pt-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Liabilities</p>
                {liabilityItems.length === 0
                  ? <p className="text-xs text-gray-400 py-1">No liabilities recorded</p>
                  : liabilityItems.map((i: any) => <StatRow key={i.name} label={i.name} amount={i.balance} indent />)
                }
                <SectionTotal label="Total Liabilities" amount={bs.liabilities} />
              </div>

              <div className="pt-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Equity</p>
                {equityItems.length === 0
                  ? <p className="text-xs text-gray-400 py-1">No equity recorded</p>
                  : equityItems.map((i: any) => <StatRow key={i.name} label={i.name} amount={i.balance} indent />)
                }
                <SectionTotal label="Total Equity" amount={bs.equity} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
