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
import { Download, FileText, AlertCircle, Clock } from 'lucide-react';
import { apiUrl } from '@/lib/api';

interface PublicInvoiceData {
  invoice: {
    number: string;
    customerName: string;
    customerTrn: string | null;
    date: string;
    currency: string;
    subtotal: number;
    vatAmount: number;
    total: number;
    status: string;
  };
  lines: {
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    vatSupplyType: string | null;
  }[];
  company: {
    name: string;
    trnVatNumber: string | null;
    businessAddress: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    websiteUrl: string | null;
    logoUrl: string | null;
  };
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
    month: 'long',
    day: 'numeric',
  });
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'paid':
      return 'bg-green-100 text-green-800';
    case 'sent':
      return 'bg-blue-100 text-blue-800';
    case 'draft':
      return 'bg-gray-100 text-gray-800';
    case 'void':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export default function PublicInvoiceView() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error } = useQuery<PublicInvoiceData>({
    queryKey: ['public-invoice', token],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/public/invoices/${token}`));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to load invoice');
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  const handleDownloadPDF = () => {
    window.open(apiUrl(`/api/public/invoices/${token}/pdf`), '_blank');
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500">Loading invoice...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !data) {
    const message = error instanceof Error ? error?.message : 'Invoice not found';
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
              {isExpired ? 'Link Expired' : 'Invoice Not Found'}
            </h2>
            <p className="text-gray-500">
              {isExpired
                ? 'This invoice link has expired. Please contact the sender for a new link.'
                : 'This invoice link is invalid or has been removed.'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { invoice, lines, company } = data;
  const isVATRegistered = !!company.trnVatNumber;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header Card */}
        <Card className="overflow-hidden">
          {/* Blue Header */}
          <div className="bg-blue-700 text-white p-6">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold">{company.name}</h1>
                {company.businessAddress && (
                  <p className="text-blue-100 text-sm mt-1">{company.businessAddress}</p>
                )}
                {company.contactPhone && (
                  <p className="text-blue-100 text-sm">{company.contactPhone}</p>
                )}
                {company.contactEmail && (
                  <p className="text-blue-100 text-sm">{company.contactEmail}</p>
                )}
              </div>
              <div className="text-right">
                <h2 className="text-lg font-bold">
                  {isVATRegistered ? 'TAX INVOICE' : 'INVOICE'}
                </h2>
                {isVATRegistered && company.trnVatNumber && (
                  <p className="text-blue-100 text-sm mt-1">TRN: {company.trnVatNumber}</p>
                )}
              </div>
            </div>
          </div>

          <CardContent className="p-6 space-y-6">
            {/* Invoice Details */}
            <div className="flex flex-wrap gap-6 justify-between bg-gray-50 p-4 rounded-lg">
              <div>
                <p className="text-sm text-gray-500">Invoice Number</p>
                <p className="font-semibold text-lg">{invoice.number}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Date</p>
                <p className="font-semibold">{formatDate(invoice.date)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <Badge className={getStatusColor(invoice.status)}>
                  {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                </Badge>
              </div>
            </div>

            {/* Bill To */}
            <div>
              <h3 className="text-sm font-semibold text-blue-700 uppercase mb-2">Bill To</h3>
              <p className="font-semibold text-lg">{invoice.customerName}</p>
              {invoice.customerTrn && (
                <p className="text-sm text-gray-500">TRN: {invoice.customerTrn}</p>
              )}
            </div>

            {/* Line Items */}
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-blue-700 hover:bg-blue-700">
                    <TableHead className="text-white font-semibold">Description</TableHead>
                    <TableHead className="text-white font-semibold text-center">Qty</TableHead>
                    <TableHead className="text-white font-semibold text-center">Unit Price</TableHead>
                    <TableHead className="text-white font-semibold text-center">VAT</TableHead>
                    <TableHead className="text-white font-semibold text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, index) => {
                    const lineTotal = line.quantity * line.unitPrice;
                    const vatPercent = ((line.vatRate ?? 0.05) * 100).toFixed(0);
                    return (
                      <TableRow key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <TableCell className="font-medium">{line.description}</TableCell>
                        <TableCell className="text-center">{line.quantity}</TableCell>
                        <TableCell className="text-center">
                          {formatCurrency(line.unitPrice, invoice.currency)}
                        </TableCell>
                        <TableCell className="text-center">{vatPercent}%</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(lineTotal, invoice.currency)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-64 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Subtotal</span>
                  <span>{formatCurrency(invoice.subtotal, invoice.currency)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">VAT</span>
                  <span>{formatCurrency(invoice.vatAmount, invoice.currency)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg pt-2 border-t bg-blue-700 text-white -mx-3 px-3 py-2 rounded-lg">
                  <span>Total</span>
                  <span>{formatCurrency(invoice.total, invoice.currency)}</span>
                </div>
              </div>
            </div>

            {/* Download PDF */}
            <div className="flex justify-center pt-4 border-t">
              <Button
                onClick={handleDownloadPDF}
                className="bg-blue-700 hover:bg-blue-800"
                size="lg"
              >
                <Download className="w-5 h-5 mr-2" />
                Download PDF
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-sm text-gray-400 pb-4">
          <p>Thank you for your business</p>
          {isVATRegistered && (
            <p className="mt-1">This is a tax invoice - Please keep for your records</p>
          )}
        </div>
      </div>
    </div>
  );
}
