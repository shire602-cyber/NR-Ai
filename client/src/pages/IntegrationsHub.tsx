import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Check, FileSpreadsheet, Landmark, Mail, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

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
  const { locale } = useI18n();
  const en = locale === "en";
  const { data: status } = useQuery<IntegrationsStatus>({ queryKey: ["/api/integrations/status"] });

  const cards: HubCard[] = [
    {
      id: "google-sheets",
      icon: FileSpreadsheet,
      title: "Google Sheets",
      description: en
        ? "Export invoices, expenses and journal entries to a spreadsheet, or import from one."
        : "صدّر الفواتير والمصروفات والقيود إلى جدول بيانات أو استوردها منه.",
      connected: status?.googleSheets?.connected,
      href: "/integrations",
      action: en ? "Open" : "فتح",
    },
    {
      id: "email",
      icon: Mail,
      title: en ? "Email" : "البريد الإلكتروني",
      description: en
        ? "Send invoices and payment reminders to customers by email."
        : "أرسل الفواتير وتذكيرات الدفع إلى العملاء بالبريد الإلكتروني.",
      connected: status?.email?.connected,
      href: "/invoices",
      action: en ? "Go to invoices" : "إلى الفواتير",
    },
    {
      id: "bank-import",
      icon: Landmark,
      title: en ? "Bank statement import" : "استيراد كشف الحساب البنكي",
      description: en
        ? "Import CSV or OFX bank statements and reconcile them against your books."
        : "استورد كشوف الحساب بصيغة CSV أو OFX وطابقها مع دفاترك.",
      href: "/bank-reconciliation",
      action: en ? "Import statements" : "استيراد الكشوف",
    },
  ];

  return (
    <div className="container max-w-6xl mx-auto py-8 px-4" dir={en ? "ltr" : "rtl"}>
      <PageHeader
        eyebrow="Settings"
        title={en ? "Connected services" : "الخدمات المتصلة"}
        testId="text-integrations-title"
        description={
          en
            ? "The connections that work today."
            : "الاتصالات المتاحة حالياً."
        }
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
                          <Check className="w-3 h-3 mr-1" /> {en ? "Connected" : "متصل"}
                        </>
                      ) : (
                        <>
                          <X className="w-3 h-3 mr-1" /> {en ? "Not configured" : "غير مهيأ"}
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
