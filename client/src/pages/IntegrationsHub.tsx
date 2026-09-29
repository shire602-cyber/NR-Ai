import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Check, FileSpreadsheet, Landmark, Mail, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { messages as pageMessages } from "./IntegrationsHub.i18n";

/**
 * What can genuinely be connected today. E-commerce / CRM platform sync
 * (Shopify, WooCommerce, Stripe, Salesforce) is not built, so it is not
 * offered here; those API routes answer 501 NOT_AVAILABLE.
 */
interface IntegrationsStatus {
  googleSheets?: { connected: boolean };
  email?: { connected: boolean };
}

interface HubCard {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  /** undefined = always available (no configuration to report). */
  connected?: boolean;
  href: string;
  action: string;
}

export default function IntegrationsHub() {
  const tr = pageMessages.useT();

  const { locale } = useI18n();
  const en = locale === "en";
  const { data: status } = useQuery<IntegrationsStatus>({ queryKey: ["/api/integrations/status"] });

  const cards: HubCard[] = [
    {
      id: "google-sheets",
      icon: FileSpreadsheet,
      title: tr("googleSheets"),
      description: tr("exportInvoicesExpensesAndJournalEntries"),
      connected: status?.googleSheets?.connected,
      href: "/integrations",
      action: tr("open"),
    },
    {
      id: "email",
      icon: Mail,
      title: tr("email"),
      description: tr("sendInvoicesAndPaymentRemindersTo"),
      connected: status?.email?.connected,
      href: "/invoices",
      action: tr("goToInvoices"),
    },
    {
      id: "bank-import",
      icon: Landmark,
      title: tr("bankStatementImport"),
      description: tr("importCsvOrOfxBankStatements"),
      href: "/bank-reconciliation",
      action: tr("importStatements"),
    },
  ];

  return (
    <div className="container max-w-6xl mx-auto py-8 px-4" dir={en ? "ltr" : "rtl"}>
      <PageHeader
        eyebrow={tr("settings")}
        title={tr("connectedServices")}
        testId="text-integrations-title"
        description={tr("theConnectionsThatWorkToday")}
        className="mb-8"
      />
      <div className="grid md:grid-cols-2 gap-6">
        {cards.map((card) => (
          <Card key={card.id} data-testid={`hub-card-${card.id}`}>
            <CardHeader className="flex flex-row items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                <card.icon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{card.title}</CardTitle>
                  {card.connected !== undefined && (
                    <Badge variant={card.connected ? "default" : "secondary"}>
                      {card.connected ? (
                        <>
                          <Check className="w-3 h-3 me-1" /> {tr("connected")}
                        </>
                      ) : (
                        <>
                          <X className="w-3 h-3 me-1" /> {tr("notConfigured")}
                        </>
                      )}
                    </Badge>
                  )}
                </div>
                <CardDescription className="mt-1">{card.description}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" size="sm">
                <Link href={card.href}>{card.action}</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
