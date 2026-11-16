import { PageHeader } from "@/components/ui/page-header";
import { dateFnsOptions } from "@/lib/date-locale";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  parseISO,
  isToday,
  isBefore,
  differenceInDays,
} from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslation, formatMessage } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import {
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Receipt,
  Building2,
  CreditCard,
} from "lucide-react";

interface ComplianceTask {
  id: string;
  title: string;
  titleAr: string | null;
  category: string;
  priority: string;
  status: string;
  dueDate: string;
}

/** Generated + manual obligations from /compliance-calendar (W4-A, R08-21). */
interface ComplianceObligation {
  id: string;
  source: "manual" | "generated";
  obligationType: string | null;
  eventType: string;
  title: string;
  titleAr: string | null;
  dueDate: string;
  status: "upcoming" | "completed" | "overdue" | "dismissed";
  legalSource: string | null;
  daysUntilDue: number;
}

function obligationCategory(o: Pick<ComplianceObligation, "obligationType" | "eventType">) {
  switch (o.obligationType ?? o.eventType) {
    case "vat_return":
    case "vat_filing":
      return "vat_filing";
    case "corporate_tax_return":
    case "ct_registration":
    case "corporate_tax_filing":
      return "corporate_tax";
    case "wps_payroll":
    case "excise_return":
      return "payment";
    default:
      return "other";
  }
}

const CATEGORY_ICONS: Record<string, any> = {
  vat_filing: Receipt,
  corporate_tax: Building2,
  payment: CreditCard,
  document_upload: FileText,
  review: CheckCircle2,
  other: Clock,
};

const CATEGORY_COLORS: Record<string, string> = {
  vat_filing: "bg-info-subtle text-info-subtle-foreground ",
  corporate_tax: "bg-chart-5/10 text-chart-5 ",
  payment: "bg-success-subtle text-success-subtle-foreground ",
  document_upload: "bg-warning-subtle text-warning-subtle-foreground ",
  review: "bg-info-subtle text-info-subtle-foreground ",
  other: "bg-muted text-foreground ",
};

export default function ComplianceCalendar() {
  const { t } = useTranslation();
  const { t: _t, locale } = useTranslation();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const { data: tasks, isLoading: isLoadingTasks } = useQuery<ComplianceTask[]>({
    queryKey: ["/api/companies", companyId, "compliance-tasks"],
    enabled: !!companyId,
  });

  // Generated obligations: VAT by stagger, CT 9 months after year end, UBO,
  // licence, excise, e-invoicing and WPS. Status follows the return state.
  const { data: obligations } = useQuery<ComplianceObligation[]>({
    queryKey: ["/api/companies", companyId, "compliance-calendar"],
    enabled: !!companyId,
  });

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const startPadding = monthStart.getDay();
  const paddedDays = [...Array(startPadding).fill(null), ...daysInMonth];

  const allEvents = useMemo(() => {
    const events: Array<{
      id: string;
      date: Date;
      title: string;
      category: string;
      status: string;
      type: "task" | "obligation";
    }> = [];

    tasks?.forEach((task) => {
      events.push({
        id: task.id,
        date: parseISO(task.dueDate),
        title: locale === "ar" && task.titleAr ? task.titleAr : task.title,
        category: task.category,
        status: task.status,
        type: "task",
      });
    });

    obligations?.forEach((o) => {
      if (o.status === "dismissed") return;
      events.push({
        id: o.id,
        date: parseISO(o.dueDate),
        title: locale === "ar" && o.titleAr ? o.titleAr : o.title,
        category: obligationCategory(o),
        status: o.status,
        type: "obligation",
      });
    });

    return events;
  }, [tasks, obligations, locale]);

  const getEventsForDate = (date: Date) => {
    return allEvents.filter((event) => isSameDay(event.date, date));
  };

  const selectedDateEvents = selectedDate ? getEventsForDate(selectedDate) : [];

  const upcomingEvents = useMemo(() => {
    const now = new Date();
    return allEvents
      .filter((e) => !isBefore(e.date, now) && differenceInDays(e.date, now) <= 30)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 10);
  }, [allEvents]);

  const overdueEvents = useMemo(() => {
    const now = new Date();
    return allEvents
      .filter((e) => isBefore(e.date, now) && e.status !== "completed")
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [allEvents]);

  if (isLoadingCompany || isLoadingTasks) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Compliance"
        title={locale === "ar" ? "تقويم الامتثال" : t["pages.complianceCalendar2"]}
        description={
          locale === "ar"
            ? "عرض جميع المواعيد النهائية للضرائب والامتثال"
            : t["complianceCalendar.viewAllTaxAndCompliance"]
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentDate(subMonths(currentDate, 1))}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <h2 className="text-lg font-semibold">
                {format(currentDate, "MMMM yyyy", dateFnsOptions(locale))}
              </h2>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentDate(addMonths(currentDate, 1))}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <Button variant="outline" onClick={() => setCurrentDate(new Date())}>
              {locale === "ar" ? "اليوم" : "Today"}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-1 mb-2">
              {[0, 1, 2, 3, 4, 5, 6]
                .map((dayIndex) =>
                  format(new Date(2024, 0, 7 + dayIndex), "EEE", dateFnsOptions(locale))
                )
                .map((day) => (
                  <div
                    key={day}
                    className="text-center text-sm font-medium text-muted-foreground py-2"
                  >
                    {day}
                  </div>
                ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {paddedDays.map((day, index) => {
                if (!day) {
                  return <div key={`empty-${index}`} className="h-24" />;
                }

                const events = getEventsForDate(day);
                const _hasEvents = events.length > 0;
                const hasOverdue = events.some(
                  (e) => e.status !== "completed" && isBefore(e.date, new Date())
                );
                const isSelected = selectedDate && isSameDay(day, selectedDate);

                return (
                  <div
                    key={day.toISOString()}
                    className={`h-24 p-1 border rounded-md cursor-pointer transition-colors hover-elevate ${
                      !isSameMonth(day, currentDate) ? "opacity-50" : ""
                    } ${isToday(day) ? "border-primary bg-primary/5" : ""} ${
                      isSelected ? "ring-2 ring-primary" : ""
                    }`}
                    onClick={() => setSelectedDate(day)}
                  >
                    <div className={`text-sm font-medium ${isToday(day) ? "text-primary" : ""}`}>
                      {format(day, "d")}
                    </div>
                    <div className="mt-1 space-y-0.5 overflow-hidden">
                      {events.slice(0, 2).map((event) => {
                        const Icon = CATEGORY_ICONS[event.category] || Clock;
                        return (
                          <div
                            key={event.id}
                            className={`text-xs px-1 py-0.5 rounded truncate ${CATEGORY_COLORS[event.category]}`}
                          >
                            <Icon className="w-3 h-3 inline-block me-1" />
                            {event.title.substring(0, 15)}
                          </div>
                        );
                      })}
                      {events.length > 2 && (
                        <div className="text-xs text-muted-foreground px-1">
                          +{events.length - 2} more
                        </div>
                      )}
                    </div>
                    {hasOverdue && (
                      <AlertTriangle className="w-3 h-3 text-destructive absolute top-1 end-1" />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {selectedDate && selectedDateEvents.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  {format(selectedDate, "EEEE, MMMM d, yyyy", dateFnsOptions(locale))}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-48">
                  <div className="space-y-2">
                    {selectedDateEvents.map((event) => {
                      const Icon = CATEGORY_ICONS[event.category] || Clock;
                      return (
                        <div
                          key={event.id}
                          className={`p-2 rounded-md ${CATEGORY_COLORS[event.category]}`}
                        >
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4" />
                            <span className="font-medium text-sm">{event.title}</span>
                          </div>
                          <Badge variant="outline" className="mt-1 text-xs">
                            {event.status}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="w-4 h-4" />
                {locale === "ar" ? "المواعيد القادمة" : t["complianceCalendar.upcomingDeadlines"]}
              </CardTitle>
              <CardDescription>{locale === "ar" ? "خلال 30 يوم" : "Next 30 days"}</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-64">
                {upcomingEvents.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">
                      {locale === "ar"
                        ? "لا توجد مواعيد قادمة"
                        : t["pageLabels.noUpcomingDeadlines"]}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {upcomingEvents.map((event) => {
                      const Icon = CATEGORY_ICONS[event.category] || Clock;
                      const daysLeft = differenceInDays(event.date, new Date());
                      return (
                        <div
                          key={event.id}
                          className="flex items-start gap-3 p-2 rounded-md border"
                        >
                          <div className={`p-2 rounded-md ${CATEGORY_COLORS[event.category]}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{event.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {format(event.date, "MMM d, yyyy")}
                            </p>
                          </div>
                          <Badge
                            variant={daysLeft <= 7 ? "destructive" : "secondary"}
                            className="text-xs"
                          >
                            {daysLeft === 0
                              ? locale === "ar"
                                ? "اليوم"
                                : "Today"
                              : locale === "ar"
                                ? `${daysLeft} يوم`
                                : `${daysLeft}d`}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          {overdueEvents.length > 0 && (
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-4 h-4" />
                  {locale === "ar" ? "متأخرة" : "Overdue"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-32">
                  <div className="space-y-2">
                    {overdueEvents.map((event) => (
                      <div
                        key={event.id}
                        className="flex items-center justify-between p-2 bg-danger-subtle rounded-md"
                      >
                        <span className="text-sm font-medium truncate">{event.title}</span>
                        <Badge variant="destructive" className="text-xs">
                          {formatMessage(t["complianceCalendar.daysAgo"], {
                            count: Math.abs(differenceInDays(event.date, new Date())),
                          })}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{locale === "ar" ? "مفتاح الألوان" : "Legend"}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {Object.entries(CATEGORY_COLORS).map(([key, color]) => {
              const Icon = CATEGORY_ICONS[key];
              const labels: Record<string, { en: string; ar: string }> = {
                vat_filing: { en: "VAT Filing", ar: "إقرار ضريبة القيمة المضافة" },
                corporate_tax: { en: "Corporate Tax", ar: "ضريبة الشركات" },
                payment: { en: "Payment", ar: "دفع" },
                document_upload: { en: "Document Upload", ar: "رفع مستند" },
                review: { en: "Review", ar: "مراجعة" },
                other: { en: "Other", ar: "أخرى" },
              };
              return (
                <div key={key} className={`flex items-center gap-2 px-3 py-1 rounded-md ${color}`}>
                  <Icon className="w-4 h-4" />
                  <span className="text-sm">
                    {locale === "ar" ? labels[key].ar : labels[key].en}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
