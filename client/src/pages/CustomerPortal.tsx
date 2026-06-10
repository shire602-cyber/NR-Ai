import { useParams } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Download, FileText, AlertCircle, Clock, Loader2, Receipt, DollarSign, FileCheck } from 'lucide-react';
import { apiUrl } from '@/lib/api';

interface PortalInfo {
  customerName: string;
  contactPerson: string | null;
  companyName: string;
  companyLogo: string | null;
}

interface PortalInvoice {
  id: string;
  number: string;
  date: string;
  currency: string;
  subtotal: number;
  vatAmount: number;
  total: number;
  status: string;
}

function formatCurrency(amount: number, currency: string = 'AED'): string {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-AE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'paid':
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Paid</Badge>;
    case 'sent':
      return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Sent</Badge>;
    case 'draft':
      return <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-100">Draft</Badge>;
    case 'void':
      return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Void</Badge>;
    default:
      return <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-100">{status}</Badge>;
  }
}

function isOverdue(invoice: PortalInvoice): boolean {
  if (invoice.status === 'paid' || invoice.status === 'void' || invoice.status === 'draft') return false;
  const invoiceDate = new Date(invoice.date);
  const thirtyDaysLater = new Date(invoiceDate);
  thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
  return new Date() > thirtyDaysLater;
}

export default function CustomerPortal() {
  const { token } = useParams<{ token: string }>();

  // Fetch portal info
  const { data: info, isLoading: infoLoading, error: infoError } = useQuery<PortalInfo>({
    queryKey: ['portal-info', token],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/portal/${token}/info`));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to load portal');
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  // Fetch invoices (only after info loads successfully)
  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<PortalInvoice[]>({
    queryKey: ['portal-invoices', token],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/portal/${token}/invoices`));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to load invoices');
      }
      return res.json();
    },
    enabled: !!token && !!info,
    retry: false,
  });

  const handleDownloadPDF = (invoiceId: string, invoiceNumber: string) => {
    window.open(apiUrl(`/api/portal/${token}/invoices/${invoiceId}/pdf`), '_blank');
  };

  // Loading state
  if (infoLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-500">Loading portal...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (infoError || !info) {
    const message = infoError instanceof Error ? infoError.message : 'Portal not found';
    const isExpired = message.includes('expired');

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            {isExpired ? (
              <Clock className="w-16 h-16 text-amber-500 mb-4" />
            ) : (
              <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
            )}
            <h2 className="text-xl font-semibold mb-2">
              {isExpired ? 'Link Expired' : 'Invalid Portal Link'}
            </h2>
            <p className="text-gray-500">
              {isExpired
                ? 'This portal link has expired. Please contact the accounting firm for a new link.'
                : 'This portal link is invalid or has been removed. Please contact the accounting firm for assistance.'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Calculate summary stats
  const totalOutstanding = invoices
    .filter(inv => inv.status !== 'paid' && inv.status !== 'void' && inv.status !== 'draft')
    .reduce((sum, inv) => sum + inv.total, 0);

  const totalPaid = invoices
    .filter(inv => inv.status === 'paid')
    .reduce((sum, inv) => sum + inv.total, 0);

  const invoiceCount = invoices.length;

  const defaultCurrency = invoices.length > 0 ? invoices[0].currency : 'AED';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{info.companyName}</h1>
              <p className="text-gray-500 mt-1">Client Portal</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Welcome,</p>
              <p className="text-lg font-semibold text-gray-900">{info.customerName}</p>
              {info.contactPerson && (
                <p className="text-sm text-gray-500">{info.contactPerson}</p>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-50 rounded-lg">
                  <DollarSign className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total Outstanding</p>
                  <p className="text-xl font-bold text-red-600">
                    {formatCurrency(totalOutstanding, defaultCurrency)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-50 rounded-lg">
                  <FileCheck className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total Paid</p>
                  <p className="text-xl font-bold text-green-600">
                    {formatCurrency(totalPaid, defaultCurrency)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Receipt className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total Invoices</p>
                  <p className="text-xl font-bold text-blue-600">{invoiceCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Invoices Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Invoices
            </CardTitle>
          </CardHeader>
          <CardContent>
            {invoicesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              </div>
            ) : invoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <FileText className="w-12 h-12 text-gray-300 mb-4" />
                <p className="text-lg font-medium text-gray-500">No invoices found</p>
                <p className="text-sm text-gray-400 mt-1">
                  Your invoices will appear here once they are created.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((invoice) => {
                      const overdue = isOverdue(invoice);
                      return (
                        <TableRow key={invoice.id}>
                          <TableCell className="font-medium">{invoice.number}</TableCell>
                          <TableCell>{formatDate(invoice.date)}</TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(invoice.total, invoice.currency)}
                          </TableCell>
                          <TableCell>
                            {overdue ? (
                              <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Overdue</Badge>
                            ) : (
                              getStatusBadge(invoice.status)
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDownloadPDF(invoice.id, invoice.number)}
                            >
                              <Download className="w-4 h-4 mr-1" />
                              PDF
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="border-t bg-white mt-12">
        <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-gray-400">
            Powered by {info.companyName}
          </p>
        </div>
      </footer>
    </div>
  );
}
