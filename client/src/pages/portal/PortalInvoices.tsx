import { useQuery } from '@tanstack/react-query';
import { FileDown, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { format } from 'date-fns';
import { getAuthHeaders } from '@/lib/auth';
import { apiUrl } from '@/lib/api';

function formatAed(n: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(n);
}

const STATUS_STYLES: Record<string, string> = {
  paid:    'border-green-200 text-green-700 bg-green-50',
  sent:    'border-blue-200 text-blue-700 bg-blue-50',
  partial: 'border-amber-200 text-amber-700 bg-amber-50',
  draft:   'border-gray-200 text-gray-500',
  void:    'border-red-200 text-red-600 bg-red-50',
};

async function downloadPdf(invoiceId: string, invoiceNumber: string) {
  const res = await fetch(apiUrl(`/api/client-portal/invoices/${invoiceId}/pdf`), {
    headers: getAuthHeaders(),
  });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `invoice-${invoiceNumber}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PortalInvoices() {
  const { data: invoices = [], isLoading } = useQuery<any[]>({
    queryKey: ['portal-invoices'],
    queryFn: () => apiRequest('GET', '/api/client-portal/invoices'),
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Invoices</h2>
        <p className="text-sm text-gray-500 mt-1">View and download invoices issued by NR Accounting.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">No invoices found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Invoice #</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Due Date</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500">Amount</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {invoices.map((inv: any) => (
                    <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{inv.number}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {inv.date ? format(new Date(inv.date), 'MMM d, yyyy') : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {inv.dueDate ? format(new Date(inv.dueDate), 'MMM d, yyyy') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {formatAed(Number(inv.total) || 0)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={STATUS_STYLES[inv.status] ?? 'border-gray-200 text-gray-500'}>
                          {inv.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                          onClick={() => downloadPdf(inv.id, inv.number)}
                        >
                          <FileDown className="w-3.5 h-3.5 mr-1.5" />
                          PDF
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
