import { useQuery } from '@tanstack/react-query';
import { FileText, AlertCircle, CheckCircle2, FolderOpen, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiRequest } from '@/lib/queryClient';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';

function formatAed(n: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(n);
}

function VatBadge({ vat }: { vat: { status: string; dueDate: string } | null }) {
  if (!vat) return <Badge variant="outline">No VAT Return</Badge>;
  const due = new Date(vat.dueDate);
  const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
  if (vat.status === 'filed' || vat.status === 'submitted') {
    return <Badge className="bg-green-100 text-green-800 border-green-200">Filed</Badge>;
  }
  if (days < 0) return <Badge variant="destructive">Overdue</Badge>;
  if (days <= 14) return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Due {format(due, 'MMM d')}</Badge>;
  return <Badge variant="outline">Due {format(due, 'MMM d')}</Badge>;
}

export default function PortalDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-dashboard'],
    queryFn: () => apiRequest('GET', '/api/client-portal/dashboard'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const inv = data?.invoices ?? {};
  const vatStatus = data?.vatStatus ?? null;
  const recentInvoices: any[] = data?.recentInvoices ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Overview</h2>
        <p className="text-sm text-gray-500 mt-1">Your account summary at a glance.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Outstanding</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{formatAed(inv.outstandingTotal ?? 0)}</p>
                <p className="text-xs text-gray-400 mt-1">{inv.outstanding ?? 0} invoice{inv.outstanding !== 1 ? 's' : ''}</p>
              </div>
              <AlertCircle className="w-5 h-5 text-amber-500 mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Paid</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{formatAed(inv.paidTotal ?? 0)}</p>
                <p className="text-xs text-gray-400 mt-1">{inv.paid ?? 0} invoice{inv.paid !== 1 ? 's' : ''}</p>
              </div>
              <CheckCircle2 className="w-5 h-5 text-green-500 mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Documents</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{data?.documents?.total ?? 0}</p>
                <p className="text-xs text-gray-400 mt-1">uploaded files</p>
              </div>
              <FolderOpen className="w-5 h-5 text-blue-500 mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">VAT Status</p>
                <div className="mt-2">
                  <VatBadge vat={vatStatus} />
                </div>
                {vatStatus?.dueDate && (
                  <p className="text-xs text-gray-400 mt-1">Period end: {format(new Date(vatStatus.periodEnd ?? vatStatus.dueDate), 'MMM d, yyyy')}</p>
                )}
              </div>
              <Calendar className="w-5 h-5 text-purple-500 mt-1" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent invoices */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Recent Invoices
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentInvoices.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No invoices yet.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {recentInvoices.map((inv: any) => (
                <div key={inv.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{inv.number}</p>
                    <p className="text-xs text-gray-400">
                      {inv.createdAt ? format(new Date(inv.createdAt), 'MMM d, yyyy') : '—'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">{formatAed(Number(inv.total) || 0)}</p>
                    <Badge
                      variant="outline"
                      className={
                        inv.status === 'paid' ? 'border-green-200 text-green-700 bg-green-50' :
                        inv.status === 'sent' ? 'border-blue-200 text-blue-700 bg-blue-50' :
                        inv.status === 'partial' ? 'border-amber-200 text-amber-700 bg-amber-50' :
                        'border-gray-200 text-gray-500'
                      }
                    >
                      {inv.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
