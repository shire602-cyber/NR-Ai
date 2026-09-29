import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Download,
  FileText,
  AlertCircle,
  Clock,
  Loader2,
  Receipt,
  DollarSign,
  FileCheck,
} from "lucide-react";
import { apiUrl } from "@/lib/api";
import { messages as pageMessages } from "./CustomerPortal.i18n";

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
  invoiceType?: string;
  /** total - payments - credit notes, from the server. */
  outstandingAmount?: number;
  isFullyCredited?: boolean;
}

function formatCurrency(amount: number, currency: string = "AED"): string {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-AE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getStatusBadge(status: string) {
  switch (status) {
    case "paid":
      return (
        <Badge className="bg-success-subtle text-success-subtle-foreground hover:bg-success-subtle">
          {pageMessages.t("paid")}
        </Badge>
      );
    case "sent":
      return (
        <Badge className="bg-info-subtle text-info-subtle-foreground hover:bg-info-subtle">
          {pageMessages.t("sent")}
        </Badge>
      );
    case "draft":
      return (
        <Badge className="bg-muted text-foreground hover:bg-muted">{pageMessages.t("draft")}</Badge>
      );
    case "credited":
      return (
        <Badge className="bg-muted text-foreground hover:bg-muted">
          {pageMessages.t("credited")}
        </Badge>
      );
    case "void":
      return (
        <Badge className="bg-danger-subtle text-danger-subtle-foreground hover:bg-danger-subtle">
          {pageMessages.t("void")}
        </Badge>
      );
    default:
      return <Badge className="bg-muted text-foreground hover:bg-muted">{status}</Badge>;
  }
}

function isOverdue(invoice: PortalInvoice): boolean {
  if (
    invoice.status === "paid" ||
    invoice.status === "void" ||
    invoice.status === "draft" ||
    invoice.status === "credited" ||
    invoice.invoiceType === "credit_note" ||
    (invoice.outstandingAmount !== undefined && invoice.outstandingAmount <= 0.005)
  )
    return false;
  const invoiceDate = new Date(invoice.date);
  const thirtyDaysLater = new Date(invoiceDate);
  thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
  return new Date() > thirtyDaysLater;
}

export default function CustomerPortal() {
  const tr = pageMessages.useT();

  const { token } = useParams<{ token: string }>();

  // Fetch portal info
  const {
    data: info,
    isLoading: infoLoading,
    error: infoError,
  } = useQuery<PortalInfo>({
    queryKey: ["portal-info", token],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/portal/${token}/info`));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load portal");
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  // Fetch invoices (only after info loads successfully)
  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<PortalInvoice[]>({
    queryKey: ["portal-invoices", token],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/portal/${token}/invoices`));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load invoices");
      }
      return res.json();
    },
    enabled: !!token && !!info,
    retry: false,
  });

  const handleDownloadPDF = (invoiceId: string, invoiceNumber: string) => {
    window.open(apiUrl(`/api/portal/${token}/invoices/${invoiceId}/pdf`), "_blank");
  };

  // Loading state
  if (infoLoading) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-info mx-auto mb-4" />
          <p className="text-muted-foreground">{tr("loadingPortal")}</p>
        </div>
      </div>
    );
  }

  // Error state
  if (infoError || !info) {
    const message = infoError instanceof Error ? infoError.message : tr("portalNotFound");
    const isExpired = message.includes("expired");

    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            {isExpired ? (
              <Clock className="w-16 h-16 text-warning mb-4" />
            ) : (
              <AlertCircle className="w-16 h-16 text-destructive mb-4" />
            )}
            <h2 className="text-xl font-semibold mb-2">
              {isExpired ? tr("linkExpired") : tr("invalidPortalLink")}
            </h2>
            <p className="text-muted-foreground">
              {isExpired ? tr("thisPortalLinkHasExpiredPlease") : tr("thisPortalLinkIsInvalidOr")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Calculate summary stats
  // What is still owed after payments and credit notes (computed by the server).
  const totalOutstanding = invoices
    .filter(
      (inv) =>
        inv.invoiceType !== "credit_note" &&
        inv.status !== "paid" &&
        inv.status !== "void" &&
        inv.status !== "draft" &&
        inv.status !== "credited"
    )
    .reduce((sum, inv) => sum + (inv.outstandingAmount ?? inv.total), 0);

  const totalPaid = invoices
    .filter((inv) => inv.status === "paid")
    .reduce((sum, inv) => sum + inv.total, 0);

  const invoiceCount = invoices.length;

  const defaultCurrency = invoices.length > 0 ? invoices[0].currency : "AED";

  return (
    <div className="min-h-screen bg-muted">
      {/* Header */}
      <header className="bg-card border-b shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">{info.companyName}</h1>
              <p className="text-muted-foreground mt-1">{tr("clientPortal")}</p>
            </div>
            <div className="text-end">
              <p className="text-sm text-muted-foreground">{tr("welcome")}</p>
              <p className="text-lg font-semibold text-foreground">{info.customerName}</p>
              {info.contactPerson && (
                <p className="text-sm text-muted-foreground">{info.contactPerson}</p>
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
                <div className="p-2 bg-danger-subtle rounded-lg">
                  <DollarSign className="w-5 h-5 text-destructive" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{tr("totalOutstanding")}</p>
                  <p className="text-xl font-bold text-destructive">
                    {formatCurrency(totalOutstanding, defaultCurrency)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-success-subtle rounded-lg">
                  <FileCheck className="w-5 h-5 text-success" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{tr("totalPaid")}</p>
                  <p className="text-xl font-bold text-success">
                    {formatCurrency(totalPaid, defaultCurrency)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-info-subtle rounded-lg">
                  <Receipt className="w-5 h-5 text-info" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{tr("totalInvoices")}</p>
                  <p className="text-xl font-bold text-info">{invoiceCount}</p>
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
              {tr("invoices")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {invoicesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-info" />
              </div>
            ) : invoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <FileText className="w-12 h-12 text-muted-foreground/70 mb-4" />
                <p className="text-lg font-medium text-muted-foreground">{tr("noInvoicesFound")}</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  {tr("yourInvoicesWillAppearHereOnce")}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("invoice")}</TableHead>
                      <TableHead>{tr("date")}</TableHead>
                      <TableHead className="text-end">{tr("amount")}</TableHead>
                      <TableHead>{tr("status")}</TableHead>
                      <TableHead className="text-end">{tr("actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((invoice) => {
                      const overdue = isOverdue(invoice);
                      return (
                        <TableRow key={invoice.id}>
                          <TableCell className="font-medium">{invoice.number}</TableCell>
                          <TableCell>{formatDate(invoice.date)}</TableCell>
                          <TableCell className="text-end font-medium">
                            {formatCurrency(invoice.total, invoice.currency)}
                          </TableCell>
                          <TableCell>
                            {overdue ? (
                              <Badge className="bg-danger-subtle text-danger-subtle-foreground hover:bg-danger-subtle">
                                {tr("overdue")}
                              </Badge>
                            ) : (
                              getStatusBadge(invoice.status)
                            )}
                          </TableCell>
                          <TableCell className="text-end">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDownloadPDF(invoice.id, invoice.number)}
                            >
                              <Download className="w-4 h-4 me-1" />
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
      <footer className="border-t bg-card mt-12">
        <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-muted-foreground/70">
            {tr("poweredBy", { companyName: info.companyName })}
          </p>
        </div>
      </footer>
    </div>
  );
}
