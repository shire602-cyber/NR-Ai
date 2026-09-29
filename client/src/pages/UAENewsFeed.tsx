import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "@/lib/i18n";
import {
  Newspaper,
  ExternalLink,
  Calendar,
  Building2,
  Receipt,
  TrendingUp,
  Scale,
  Globe,
  RefreshCw,
} from "lucide-react";
import { messages as pageMessages } from "./UAENewsFeed.i18n";

interface NewsItem {
  id: string;
  title: string;
  titleAr: string | null;
  summary: string | null;
  summaryAr: string | null;
  source: string;
  sourceUrl: string | null;
  category: string;
  imageUrl: string | null;
  publishedAt: string;
}

const NEWS_CATEGORIES = [
  { value: "all", labelEn: "All News", labelAr: "جميع الأخبار", icon: Newspaper },
  { value: "vat", labelEn: "VAT Updates", labelAr: "تحديثات الضريبة", icon: Receipt },
  { value: "corporate_tax", labelEn: "Corporate Tax", labelAr: "ضريبة الشركات", icon: Building2 },
  { value: "regulation", labelEn: "Regulations", labelAr: "اللوائح", icon: Scale },
  { value: "economy", labelEn: "Economy", labelAr: "الاقتصاد", icon: TrendingUp },
];

const getSourceLabels = (): Record<string, { en: string; ar: string }> => ({
  fta: { en: pageMessages.t("federalTaxAuthority"), ar: "الهيئة الاتحادية للضرائب" },
  gulf_news: { en: pageMessages.t("gulfNews"), ar: "جلف نيوز" },
  khaleej_times: { en: pageMessages.t("khaleejTimes"), ar: "خليج تايمز" },
  mof: { en: pageMessages.t("ministryOfFinance"), ar: "وزارة المالية" },
  other: { en: pageMessages.t("other"), ar: "أخرى" },
});

const getSampleNews = (): NewsItem[] => [
  {
    id: "1",
    title: pageMessages.t("ftaAnnouncesUpdatedVatReturnFiling"),
    titleAr:
      "الهيئة الاتحادية للضرائب تعلن عن مواعيد جديدة لتقديم إقرارات ضريبة القيمة المضافة لعام 2025",
    summary: pageMessages.t("theFederalTaxAuthorityHasReleased"),
    summaryAr:
      "أصدرت الهيئة الاتحادية للضرائب إرشادات محدثة لمواعيد تقديم إقرارات ضريبة القيمة المضافة، مع دخول التغييرات حيز التنفيذ اعتباراً من الربع الأول 2025.",
    source: "fta",
    sourceUrl: "https://tax.gov.ae",
    category: "vat",
    imageUrl: null,
    publishedAt: new Date().toISOString(),
  },
  {
    id: "2",
    title: pageMessages.t("corporateTaxSmallBusinessReliefExtended"),
    titleAr: "ضريبة الشركات: تمديد إعفاء الشركات الصغيرة حتى 2026",
    summary: pageMessages.t("theMinistryOfFinanceConfirmsThat"),
    summaryAr:
      "تؤكد وزارة المالية أن أحكام إعفاء الشركات الصغيرة بموجب قانون ضريبة الشركات ستُمدد، مما يعود بالنفع على آلاف الشركات الإماراتية.",
    source: "mof",
    sourceUrl: "https://mof.gov.ae",
    category: "corporate_tax",
    imageUrl: null,
    publishedAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: "3",
    title: pageMessages.t("uaeEInvoicingMandateWhatBusinesses"),
    titleAr: "الفوترة الإلكترونية في الإمارات: ما تحتاج الشركات معرفته",
    summary: pageMessages.t("withEInvoicingBecomingMandatoryFor"),
    summaryAr:
      "مع إلزامية الفوترة الإلكترونية للمعاملات بين الشركات بحلول 2027، يجب على الشركات البدء في إعداد أنظمتها للامتثال.",
    source: "gulf_news",
    sourceUrl: "https://gulfnews.com",
    category: "regulation",
    imageUrl: null,
    publishedAt: new Date(Date.now() - 172800000).toISOString(),
  },
  {
    id: "4",
    title: pageMessages.t("uaeEconomyShowsStrongGrowthIn"),
    titleAr: "الاقتصاد الإماراتي يُظهر نمواً قوياً في الربع الثالث 2024",
    summary: pageMessages.t("nonOilSectorsContinueToDrive"),
    summaryAr:
      "تواصل القطاعات غير النفطية دفع التوسع الاقتصادي، حيث تقود السياحة والتجارة مؤشرات النمو.",
    source: "khaleej_times",
    sourceUrl: "https://khaleejtimes.com",
    category: "economy",
    imageUrl: null,
    publishedAt: new Date(Date.now() - 259200000).toISOString(),
  },
];

export default function UAENewsFeed() {
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState("all");

  const {
    data: newsItems,
    isLoading,
    refetch,
  } = useQuery<NewsItem[]>({
    queryKey: ["/api/news"],
    initialData: getSampleNews(),
  });

  const filteredNews =
    newsItems?.filter((item) => selectedCategory === "all" || item.category === selectedCategory) ||
    [];

  const getCategoryIcon = (category: string) => {
    const cat = NEWS_CATEGORIES.find((c) => c.value === category);
    return cat?.icon || Newspaper;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-48" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("insights")}
        title={tr("uaeTaxFinanceNews")}
        description={tr("latestUpdatesFromFtaAndTrusted")}
        actions={
          <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh-news">
            <RefreshCw className="w-4 h-4 me-2" />
            {tr("refresh")}
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
            <TabsList className="grid w-full grid-cols-5">
              {NEWS_CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                return (
                  <TabsTrigger
                    key={cat.value}
                    value={cat.value}
                    className="text-xs"
                    data-testid={`tab-${cat.value}`}
                  >
                    <Icon className="w-3 h-3 me-1" />
                    <span className="hidden sm:inline">
                      {locale === "ar" ? cat.labelAr : cat.labelEn}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>

          {filteredNews.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Newspaper className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>{tr("noNewsAvailable")}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredNews.map((item) => {
                const Icon = getCategoryIcon(item.category);
                const sourceLabel = getSourceLabels()[item.source] || getSourceLabels().other;

                return (
                  <Card key={item.id} className="hover-elevate" data-testid={`news-${item.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline" className="text-xs">
                              <Icon className="w-3 h-3 me-1" />
                              {locale === "ar"
                                ? NEWS_CATEGORIES.find((c) => c.value === item.category)?.labelAr
                                : NEWS_CATEGORIES.find((c) => c.value === item.category)?.labelEn}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {locale === "ar" ? sourceLabel.ar : sourceLabel.en}
                            </Badge>
                          </div>
                          <CardTitle className="text-lg leading-tight">
                            {locale === "ar" && item.titleAr ? item.titleAr : item.title}
                          </CardTitle>
                        </div>
                        {item.sourceUrl && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => window.open(item.sourceUrl!, "_blank")}
                            data-testid={`button-open-${item.id}`}
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-muted-foreground text-sm mb-3">
                        {locale === "ar" && item.summaryAr ? item.summaryAr : item.summary}
                      </p>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        {format(parseISO(item.publishedAt), "MMM d, yyyy")}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Globe className="w-4 h-4" />
                {tr("newsSources")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(getSourceLabels()).map(([key, labels]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between p-2 rounded-md border"
                  >
                    <span className="text-sm">{locale === "ar" ? labels.ar : labels.en}</span>
                    <Badge variant="outline" className="text-xs">
                      {newsItems?.filter((n) => n.source === key).length || 0}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{tr("usefulLinks")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => window.open("https://tax.gov.ae", "_blank")}
                >
                  <Building2 className="w-4 h-4 me-2" />
                  {tr("federalTaxAuthority")}
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => window.open("https://mof.gov.ae", "_blank")}
                >
                  <Scale className="w-4 h-4 me-2" />
                  {tr("ministryOfFinance")}
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => window.open("https://emaratax.tax.gov.ae", "_blank")}
                >
                  <Receipt className="w-4 h-4 me-2" />
                  {tr("emaratax")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-primary/5 border-primary/20">
            <CardHeader>
              <CardTitle className="text-sm">{tr("tipOfTheDay")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{tr("rememberToKeepAllInvoicesAnd")}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
