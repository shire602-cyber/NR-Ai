import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const SOURCE_LABELS: Record<string, { en: string; ar: string }> = {
  fta: { en: "Federal Tax Authority", ar: "الهيئة الاتحادية للضرائب" },
  gulf_news: { en: "Gulf News", ar: "جلف نيوز" },
  khaleej_times: { en: "Khaleej Times", ar: "خليج تايمز" },
  mof: { en: "Ministry of Finance", ar: "وزارة المالية" },
  other: { en: "Other", ar: "أخرى" },
};

interface NewsFeedStatus {
  status: "live" | "requires_external";
  feedCount: number;
  externalAction: { en: string; ar: string };
}

export default function UAENewsFeed() {
  const { t: _t, locale } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState("all");

  const {
    data: newsItems,
    isLoading,
    refetch,
  } = useQuery<NewsItem[]>({
    queryKey: ["/api/news"],
  });

  // No sample items: an empty feed is shown as empty, with the reason when the
  // external feed has not been configured yet.
  const { data: feedStatus } = useQuery<NewsFeedStatus>({
    queryKey: ["/api/news/status"],
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
        eyebrow="Insights"
        title={locale === "ar" ? "أخبار الضرائب والاقتصاد الإماراتي" : "UAE Tax & Finance News"}
        description={
          locale === "ar"
            ? "آخر التحديثات من الهيئة الاتحادية للضرائب والمصادر الموثوقة"
            : "Latest updates from FTA and trusted sources"
        }
        actions={
          <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh-news">
            <RefreshCw className="w-4 h-4 mr-2" />
            {locale === "ar" ? "تحديث" : "Refresh"}
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
                    <Icon className="w-3 h-3 mr-1" />
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
                <p>{locale === "ar" ? "لا توجد أخبار حالياً" : "No news available"}</p>
                {feedStatus?.status === "requires_external" && (
                  <p className="mt-2 text-xs" data-testid="news-feed-not-configured">
                    {locale === "ar"
                      ? "لم يتم ربط مصدر أخبار خارجي بعد. " + feedStatus.externalAction.ar
                      : "No external news feed is connected yet. " + feedStatus.externalAction.en}
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredNews.map((item) => {
                const Icon = getCategoryIcon(item.category);
                const sourceLabel = SOURCE_LABELS[item.source] || SOURCE_LABELS.other;

                return (
                  <Card key={item.id} className="hover-elevate" data-testid={`news-${item.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline" className="text-xs">
                              <Icon className="w-3 h-3 mr-1" />
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
                {locale === "ar" ? "مصادر الأخبار" : "News Sources"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(SOURCE_LABELS).map(([key, labels]) => (
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
              <CardTitle className="text-sm">
                {locale === "ar" ? "روابط مفيدة" : "Useful Links"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => window.open("https://tax.gov.ae", "_blank")}
                >
                  <Building2 className="w-4 h-4 mr-2" />
                  {locale === "ar" ? "الهيئة الاتحادية للضرائب" : "Federal Tax Authority"}
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => window.open("https://mof.gov.ae", "_blank")}
                >
                  <Scale className="w-4 h-4 mr-2" />
                  {locale === "ar" ? "وزارة المالية" : "Ministry of Finance"}
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => window.open("https://emaratax.tax.gov.ae", "_blank")}
                >
                  <Receipt className="w-4 h-4 mr-2" />
                  EmaraTax{/* i18n-ignore: brand or sample data */}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-primary/5 border-primary/20">
            <CardHeader>
              <CardTitle className="text-sm">
                {locale === "ar" ? "نصيحة اليوم" : "Tip of the Day"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {locale === "ar"
                  ? "تذكر أن تحتفظ بجميع الفواتير والإيصالات لمدة 5 سنوات على الأقل للامتثال لمتطلبات الهيئة الاتحادية للضرائب."
                  : "Remember to keep all invoices and receipts for at least 5 years to comply with FTA requirements."}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
